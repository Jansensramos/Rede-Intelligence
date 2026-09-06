import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, type IntegrationJob } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { integrationSecretVault } from "@/infrastructure/security/secret-vault";
import { ClicksignProviderError, ClicksignSignatureProvider, type ClicksignHttpTransport } from "@/infrastructure/adapters/signature/clicksign-signature-provider";
import type { SignatureProvider } from "@/domain/sales/signature-provider";
import { assertIntegrationCapability } from "@/domain/integrations";
import { applyProviderRateLimitSignal, checkAndConsumeRateLimit, checkCircuitBreakerGate, recordCircuitBreakerOutcome } from "@/application/integrations/resilience-service";
import { cancelSignatureRequestFromProvider, completeRealSignatureRequest, markSignatureError, recordPartyDeclined, recordPartySigned } from "./signature-service";

const json = (value: unknown) => value as Prisma.InputJsonValue;
export const CLICKSIGN_WEBHOOK_MAX_BYTES = 1024 * 1024;
export const CLICKSIGN_DEFINITION_CODE = "CLICKSIGN_API_V3";
export const CLICKSIGN_PROVIDER = "CLICKSIGN";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}; }
function string(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }

type ClicksignMode = "DISABLED" | "MOCK" | "REAL";
interface ClicksignConfiguration {
  mode: ClicksignMode;
  signatureEnvelopeEnabled: boolean;
  environment: "SANDBOX" | "PRODUCTION";
  baseUrl: string;
  timeoutMs?: number;
}

function parseConfiguration(value: Prisma.JsonValue): ClicksignConfiguration {
  const config = record(value);
  const mode = config.mode;
  const environment = config.environment;
  if (mode !== "DISABLED" && mode !== "MOCK" && mode !== "REAL") throw new Error("Configuração Clicksign inválida: mode.");
  if (environment !== "SANDBOX" && environment !== "PRODUCTION") throw new Error("Configuração Clicksign inválida: environment.");
  if (typeof config.signatureEnvelopeEnabled !== "boolean" || typeof config.baseUrl !== "string") throw new Error("Configuração Clicksign incompleta.");
  let origin: string;
  try { origin = new URL(config.baseUrl).origin; } catch { throw new Error("Endpoint Clicksign inválido."); }
  if (environment === "SANDBOX" && origin !== "https://sandbox.clicksign.com") throw new Error("Host Clicksign incompatível com Sandbox.");
  if (environment === "PRODUCTION" && origin !== "https://app.clicksign.com") throw new Error("Host Clicksign incompatível com produção.");
  return { mode, environment, signatureEnvelopeEnabled: config.signatureEnvelopeEnabled, baseUrl: config.baseUrl, timeoutMs: typeof config.timeoutMs === "number" ? config.timeoutMs : undefined };
}

function parseSecretBundle(secret: string) {
  try {
    const bundle = record(JSON.parse(secret));
    const accessToken = string(bundle.accessToken);
    const webhookSecret = string(bundle.webhookSecret);
    if (!accessToken || !webhookSecret) throw new Error();
    return { accessToken, webhookSecret };
  } catch {
    throw new Error("Credencial Clicksign incompleta no cofre.");
  }
}

async function installationById(installationId: string) {
  return prisma.connectorInstallation.findFirst({
    where: { id: installationId, status: "ACTIVE", connectorDefinition: { code: CLICKSIGN_DEFINITION_CODE } },
    include: { credential: true, connectorDefinition: true },
  });
}

async function installationForOrganization(organizationId: string) {
  return prisma.connectorInstallation.findFirst({
    where: { organizationId, status: "ACTIVE", connectorDefinition: { code: CLICKSIGN_DEFINITION_CODE } },
    include: { credential: true, connectorDefinition: true },
    orderBy: { createdAt: "asc" },
  });
}

async function resolvedInstallation(installation: Awaited<ReturnType<typeof installationById>>) {
  if (!installation) throw new Error("Instalação Clicksign não encontrada ou indisponível.");
  const configuration = parseConfiguration(installation.configuration);
  if (configuration.mode !== "REAL" || !configuration.signatureEnvelopeEnabled) throw new Error("Integração Clicksign REAL desativada para esta organização.");
  if (!installation.credential || installation.credential.status !== "ACTIVE") throw new Error("Credencial Clicksign ausente ou inativa.");
  const secrets = parseSecretBundle(await integrationSecretVault.read(installation.credential.secretRef));
  return { installation, configuration, secrets };
}

export async function clicksignProviderForOrganization(organizationId: string, transport?: ClicksignHttpTransport): Promise<{ provider: SignatureProvider; installationId: string }> {
  const resolved = await resolvedInstallation(await installationForOrganization(organizationId));
  const base = new ClicksignSignatureProvider({ baseUrl: resolved.configuration.baseUrl, accessToken: resolved.secrets.accessToken, timeoutMs: resolved.configuration.timeoutMs }, transport);
  const scopeKey = `clicksign:${resolved.installation.id}`;
  const ratePolicy = { limit: resolved.configuration.environment === "SANDBOX" ? 20 : 50, windowMs: 10_000 };
  const circuitPolicy = { failureThreshold: 5, cooldownMs: 60_000 };
  const guarded = async <T>(operation: () => Promise<T>) => {
    const rate = await checkAndConsumeRateLimit(organizationId, scopeKey, ratePolicy);
    if (!rate.allowed) throw new ClicksignProviderError("RATE_LIMIT", randomUUID(), rate.retryAfterMs);
    const circuit = await checkCircuitBreakerGate(organizationId, scopeKey, circuitPolicy);
    if (!circuit.allow) throw new ClicksignProviderError("PROVIDER", randomUUID(), circuit.retryAfterMs);
    try {
      const result = await operation();
      await recordCircuitBreakerOutcome(organizationId, scopeKey, true, circuitPolicy);
      return result;
    } catch (error) {
      if (error instanceof ClicksignProviderError && error.errorClass === "RATE_LIMIT" && error.retryAfterMs != null) await applyProviderRateLimitSignal(organizationId, scopeKey, error.retryAfterMs);
      const providerFailure = error instanceof ClicksignProviderError && ["RATE_LIMIT", "TIMEOUT", "PROVIDER", "UNEXPECTED"].includes(error.errorClass);
      if (providerFailure) await recordCircuitBreakerOutcome(organizationId, scopeKey, false, circuitPolicy);
      throw error;
    }
  };
  const provider: Required<SignatureProvider> = {
    code: "CLICKSIGN",
    send: (input) => guarded(() => base.send(input)),
    cancel: (input) => guarded(() => base.cancel(input)),
    status: (externalId) => guarded(() => base.status(externalId)),
    notify: (externalId, message) => guarded(() => base.notify(externalId, message)),
    reconcileSignatures: (input) => guarded(() => base.reconcileSignatures(input)),
    finalEvidence: (externalId) => guarded(() => base.finalEvidence(externalId)),
  };
  return {
    installationId: resolved.installation.id,
    provider,
  };
}

export async function configureClicksignInstallation(context: Pick<AuthContext, "organizationId" | "userId" | "role">, installationId: string, input: ClicksignConfiguration) {
  assertIntegrationCapability(context.role, "INTEGRATION_CONFIGURE");
  const installation = await prisma.connectorInstallation.findFirst({ where: { id: installationId, organizationId: context.organizationId, connectorDefinition: { code: CLICKSIGN_DEFINITION_CODE } }, include: { credential: true } });
  if (!installation) throw new Error("Instalação não encontrada nesta organização.");
  const configuration = parseConfiguration(input as unknown as Prisma.JsonValue);
  if (configuration.mode === "REAL" && (!configuration.signatureEnvelopeEnabled || installation.credential?.status !== "ACTIVE")) throw new Error("Ativação REAL exige feature gate e credencial ativa.");
  const status = configuration.mode === "REAL" ? "ACTIVE" as const : configuration.mode === "DISABLED" ? "PAUSED" as const : "DRAFT" as const;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.connectorInstallation.update({ where: { id: installation.id }, data: { configuration: json(configuration), status } });
    await tx.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, projectId: installation.projectId, action: "CLICKSIGN_INSTALLATION_CONFIGURED", entityType: "ConnectorInstallation", entityId: installation.id, after: json({ mode: configuration.mode, environment: configuration.environment, signatureEnvelopeEnabled: configuration.signatureEnvelopeEnabled }) } });
    return updated;
  });
}

export function validateClicksignWebhookSignature(rawBody: Uint8Array, suppliedSignature: string | null, secret: string) {
  if (!suppliedSignature) return false;
  const normalized = suppliedSignature.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const supplied = Buffer.from(normalized, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export type NormalizedClicksignEventType = "PARTY_SIGNED" | "PARTY_DECLINED" | "ENVELOPE_CLOSED" | "ENVELOPE_CANCELLED" | "ERROR" | "UNKNOWN";
export interface NormalizedClicksignWebhook {
  eventId: string;
  eventType: NormalizedClicksignEventType;
  envelopeId: string;
  signerId: string | null;
  occurredAt: string | null;
}

function nestedId(value: unknown) { return string(record(record(value).data).id); }

export function parseClicksignWebhook(rawBody: Uint8Array): NormalizedClicksignWebhook {
  let root: RecordValue;
  try { root = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody))); }
  catch { throw new Error("JSON de webhook malformado."); }
  const data = record(root.data);
  const attributes = record(data.attributes);
  const relationships = record(data.relationships);
  const eventId = string(data.id) ?? string(root.event_id);
  const eventName = (string(attributes.event_name) ?? string(attributes.event) ?? string(data.type) ?? "").toLowerCase();
  const envelopeId = nestedId(relationships.envelope) ?? string(attributes.envelope_id) ?? string(root.envelope_id);
  const signerId = nestedId(relationships.signer) ?? string(attributes.signer_id) ?? string(root.signer_id);
  if (!eventId || !envelopeId || !eventName) throw new Error("Webhook Clicksign sem identificadores obrigatórios.");
  const eventType: NormalizedClicksignEventType =
    eventName.includes("sign") && (eventName.includes("declin") || eventName.includes("refus")) ? "PARTY_DECLINED" :
    eventName.includes("sign") && (eventName.includes("complete") || eventName.includes("signed")) ? "PARTY_SIGNED" :
    eventName.includes("envelope") && eventName.includes("closed") ? "ENVELOPE_CLOSED" :
    eventName.includes("cancel") ? "ENVELOPE_CANCELLED" :
    eventName.includes("error") || eventName.includes("fail") ? "ERROR" : "UNKNOWN";
  return { eventId, eventType, envelopeId, signerId, occurredAt: string(attributes.occurred_at) ?? string(root.occurred_at) };
}

async function quarantineDuplicateConflict(input: { organizationId: string; installationId: string; event: NormalizedClicksignWebhook }) {
  const externalId = `duplicate:${input.event.eventId}`;
  const existing = await prisma.integrationQuarantineItem.findFirst({ where: { installationId: input.installationId, capability: "CLICKSIGN_SIGNATURE_WEBHOOK", externalId } });
  if (existing) return existing;
  return prisma.integrationQuarantineItem.create({ data: {
    organizationId: input.organizationId, installationId: input.installationId, capability: "CLICKSIGN_SIGNATURE_WEBHOOK",
    externalType: input.event.eventType, externalId, reason: "Mesmo eventId recebido com conteúdo diferente.", errorClass: "CONFLICT",
    payload: json({ eventId: input.event.eventId, envelopeId: input.event.envelopeId }),
  } });
}

export async function receiveClicksignWebhook(input: { installationId: string; rawBody: Uint8Array; signature: string | null }) {
  if (input.rawBody.byteLength === 0 || input.rawBody.byteLength > CLICKSIGN_WEBHOOK_MAX_BYTES) throw new Error("Payload de webhook vazio ou acima do limite.");
  const resolved = await resolvedInstallation(await installationById(input.installationId));
  if (!validateClicksignWebhookSignature(input.rawBody, input.signature, resolved.secrets.webhookSecret)) throw new Error("Assinatura de webhook inválida.");
  const event = parseClicksignWebhook(input.rawBody);
  const payloadChecksum = createHash("sha256").update(input.rawBody).digest("hex");
  const existing = await prisma.integrationInboxEvent.findUnique({ where: { installationId_provider_eventId: { installationId: resolved.installation.id, provider: CLICKSIGN_PROVIDER, eventId: event.eventId } } });
  if (existing) {
    if (existing.payloadChecksum !== payloadChecksum) await quarantineDuplicateConflict({ organizationId: resolved.installation.organizationId, installationId: resolved.installation.id, event });
    return { status: existing.payloadChecksum === payloadChecksum ? "DUPLICATE" as const : "CONFLICT" as const, inboxEventId: existing.id };
  }
  try {
    const inbox = await prisma.$transaction(async (tx) => {
      const created = await tx.integrationInboxEvent.create({ data: {
        organizationId: resolved.installation.organizationId, installationId: resolved.installation.id, provider: CLICKSIGN_PROVIDER,
        eventId: event.eventId, signatureValid: true, payloadChecksum, payload: json(event), status: "RECEIVED",
      } });
      await tx.integrationJob.create({ data: {
        organizationId: resolved.installation.organizationId, installationId: resolved.installation.id, jobType: "PROCESS_SIGNATURE_WEBHOOK",
        priority: "CRITICAL", payload: json({ inboxEventId: created.id }), correlationId: randomUUID(), maxAttempts: 8,
      } });
      return created;
    });
    return { status: "ACCEPTED" as const, inboxEventId: inbox.id };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const raced = await prisma.integrationInboxEvent.findUniqueOrThrow({ where: { installationId_provider_eventId: { installationId: resolved.installation.id, provider: CLICKSIGN_PROVIDER, eventId: event.eventId } } });
    if (raced.payloadChecksum !== payloadChecksum) await quarantineDuplicateConflict({ organizationId: resolved.installation.organizationId, installationId: resolved.installation.id, event });
    return { status: raced.payloadChecksum === payloadChecksum ? "DUPLICATE" as const : "CONFLICT" as const, inboxEventId: raced.id };
  }
}

async function quarantineUnknown(job: IntegrationJob, event: NormalizedClicksignWebhook, reason: string) {
  await prisma.integrationQuarantineItem.create({ data: {
    organizationId: job.organizationId, installationId: job.installationId!, capability: "CLICKSIGN_SIGNATURE_WEBHOOK",
    externalType: event.eventType, externalId: event.eventId, reason, errorClass: "MAPPING",
    payload: json({ eventId: event.eventId, envelopeId: event.envelopeId }),
  } });
}

async function quarantineAndMark(job: IntegrationJob, inboxId: string, event: NormalizedClicksignWebhook, reason: string) {
  await quarantineUnknown(job, event, reason);
  await prisma.integrationInboxEvent.update({ where: { id: inboxId }, data: { status: "QUARANTINED", processedAt: new Date(), errorMessage: reason } });
}

export async function processClicksignWebhookJob(job: IntegrationJob) {
  if (!job.installationId) throw new Error("Job Clicksign sem instalação.");
  const payload = record(job.payload);
  const inboxEventId = string(payload.inboxEventId);
  if (!inboxEventId) throw new Error("Job Clicksign sem inboxEventId.");
  const inbox = await prisma.integrationInboxEvent.findFirst({ where: { id: inboxEventId, organizationId: job.organizationId, installationId: job.installationId, provider: CLICKSIGN_PROVIDER, signatureValid: true } });
  if (!inbox || !inbox.payload) throw new Error("Evento Clicksign não encontrado no tenant do job.");
  if (inbox.status === "PROCESSED") return;
  const event = inbox.payload as unknown as NormalizedClicksignWebhook;
  const reference = await prisma.externalEntityReference.findFirst({ where: {
    organizationId: job.organizationId, installationId: job.installationId, externalType: "CLICKSIGN_ENVELOPE", externalId: event.envelopeId, entityType: "SignatureRequest",
  } });
  if (!reference) { await quarantineAndMark(job, inbox.id, event, "Envelope não pertence a uma solicitação desta instalação."); return; }
  const request = await prisma.signatureRequest.findFirst({ where: { id: reference.entityId, organizationId: job.organizationId, provider: "CLICKSIGN", externalId: event.envelopeId }, include: { parties: true } });
  if (!request) { await quarantineAndMark(job, inbox.id, event, "Solicitação não encontrada no tenant da instalação."); return; }
  const installation = await installationById(job.installationId);
  if (!installation) throw new Error("Instalação Clicksign indisponível.");
  const membership = await prisma.organizationMembership.findFirst({ where: { organizationId: job.organizationId, userId: installation.createdById, isActive: true } });
  if (!membership) throw new Error("Responsável pela instalação não pertence ao tenant.");
  const context = { organizationId: job.organizationId, userId: installation.createdById, role: membership.role } as AuthContext;

  if (event.eventType === "PARTY_SIGNED" || event.eventType === "PARTY_DECLINED") {
    const party = request.parties.find((item) => item.externalPartyId === event.signerId);
    if (!party) { await quarantineAndMark(job, inbox.id, event, "Signatário externo não pertence ao envelope registrado."); return; }
    if (event.eventType === "PARTY_SIGNED") await recordPartySigned(context, { requestId: request.id, partyId: party.id, authMethod: "clicksign" }, inbox.id);
    else await recordPartyDeclined(context, { requestId: request.id, partyId: party.id, reason: "Recusa registrada pelo provider." }, inbox.id);
  } else if (event.eventType === "ENVELOPE_CANCELLED") {
    await cancelSignatureRequestFromProvider(context, request.id, inbox.id);
  } else if (event.eventType === "ENVELOPE_CLOSED") {
    if (["CANCELADO", "RECUSADO"].includes(request.status)) {
      await quarantineAndMark(job, inbox.id, event, "Envelope fechado para uma solicitação em estado terminal incompatível.");
      return;
    }
    await completeRealSignatureRequest(context, request.id, job.installationId, inbox.id);
  } else if (event.eventType === "ERROR") {
    await markSignatureError(context, { requestId: request.id, message: "Erro reportado pelo provider de assinatura." }, inbox.id);
  } else {
    await quarantineAndMark(job, inbox.id, event, "Evento desconhecido preservado em quarentena.");
    return;
  }
  await prisma.integrationInboxEvent.update({ where: { id: inbox.id }, data: { status: "PROCESSED", processedAt: new Date() } });
}

export const clicksignServiceInternals = { parseConfiguration, parseSecretBundle, installationForOrganization };
