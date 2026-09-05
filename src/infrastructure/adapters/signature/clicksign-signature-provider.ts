import { createHash, randomUUID } from "node:crypto";
import type {
  ExternalSignatureStatus,
  SignatureFinalEvidence,
  SignatureProvider,
  SignatureReconciliationRequest,
  SignatureReconciliationResult,
  SignatureSendRequest,
  SignatureSendResult,
} from "@/domain/sales/signature-provider";

const PDF_MIME = "application/pdf";
const JSON_API_MIME = "application/vnd.api+json";
export const CLICKSIGN_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set(["https://sandbox.clicksign.com", "https://app.clicksign.com"]);
const SANDBOX_CONTENT_HOST = "clicksign-sandbox-content.s3.amazonaws.com";
const SIGNED_LINK_RETRY_AFTER_MS = 2_000;

export type ClicksignErrorClass = "AUTHENTICATION" | "AUTHORIZATION" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "RATE_LIMIT" | "TIMEOUT" | "PROVIDER" | "UNEXPECTED";
export type ClicksignEvidenceFailureReason =
  | "STRUCTURE_INVALID"
  | "DOCUMENT_NOT_CLOSED"
  | "SIGNED_LINK_PENDING"
  | "CONTENT_HOST_FORBIDDEN"
  | "CONTENT_REDIRECTED"
  | "DOWNLOAD_UNAVAILABLE"
  | "PDF_INVALID"
  | "SIGNATURE_EVIDENCE_PENDING"
  | "SIGNATURE_EVIDENCE_INVALID"
  | "SIGNATURE_EVIDENCE_AMBIGUOUS"
  | "SIGNER_MISMATCH";

export class ClicksignProviderError extends Error {
  readonly name = "ClicksignProviderError";
  constructor(
    readonly errorClass: ClicksignErrorClass,
    readonly correlationId: string,
    readonly retryAfterMs: number | null = null,
    readonly reasonCode: ClicksignEvidenceFailureReason | null = null,
  ) {
    super(`${operatorMessage(errorClass)} Código de correlação: ${correlationId}.`);
  }
}

function operatorMessage(errorClass: ClicksignErrorClass) {
  const messages: Record<ClicksignErrorClass, string> = {
    AUTHENTICATION: "A credencial da Clicksign está ausente ou inválida.",
    AUTHORIZATION: "A Clicksign recusou a permissão para esta operação.",
    NOT_FOUND: "O envelope não foi encontrado ou não pertence a esta instalação.",
    CONFLICT: "A Clicksign reportou conflito no estado ou na versão do envelope.",
    VALIDATION: "A configuração ou os dados enviados à Clicksign são inválidos.",
    RATE_LIMIT: "A Clicksign limitou temporariamente as requisições.",
    TIMEOUT: "A Clicksign não respondeu dentro do tempo permitido.",
    PROVIDER: "A Clicksign está temporariamente indisponível.",
    UNEXPECTED: "Não foi possível concluir a operação de assinatura.",
  };
  return messages[errorClass];
}

export interface ClicksignHttpRequest {
  method: "GET" | "POST" | "PATCH";
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface ClicksignHttpResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
  finalUrl: string;
}

export interface ClicksignHttpTransport { request(input: ClicksignHttpRequest): Promise<ClicksignHttpResponse>; }

export const fetchClicksignTransport: ClicksignHttpTransport = {
  async request(input) {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > input.maxResponseBytes) throw new Error("CLICK_SIGN_RESPONSE_TOO_LARGE");
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > input.maxResponseBytes) { await reader.cancel(); throw new Error("CLICK_SIGN_RESPONSE_TOO_LARGE"); }
        chunks.push(value);
      }
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? undefined, "retry-after": response.headers.get("retry-after") ?? undefined },
      body,
      finalUrl: response.url,
    };
  },
};

export interface ClicksignProviderConfiguration {
  baseUrl: string;
  accessToken: string;
  timeoutMs?: number;
  defaultAuthentication?: "email";
}

type JsonObject = Record<string, unknown>;
const decoder = new TextDecoder("utf-8", { fatal: true });

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CLICK_SIGN_INVALID_RESPONSE");
  return value as JsonObject;
}

function dataObject(value: unknown) { return object(object(value).data); }
function idOf(value: unknown) {
  const id = dataObject(value).id;
  if (typeof id !== "string" || !id) throw new Error("CLICK_SIGN_INVALID_RESPONSE");
  return id;
}

function parseRetryAfter(value: string | undefined) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function assertPdfBytes(input: { mimeType: string; bytes: Uint8Array }, maxBytes: number) {
  if (input.mimeType.split(";", 1)[0]?.trim().toLowerCase() !== PDF_MIME) throw new Error("Documento de assinatura deve ser PDF.");
  if (!(input.bytes instanceof Uint8Array)) throw new Error("Corpo do documento PDF inválido.");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > maxBytes) throw new Error("Documento PDF vazio ou acima do limite permitido.");
  if (input.bytes.byteLength < 5 || decoder.decode(input.bytes.slice(0, 5)) !== "%PDF-") throw new Error("Conteúdo do documento não corresponde a um PDF válido.");
}

function assertPdf(input: SignatureSendRequest["document"]) {
  assertPdfBytes(input, CLICKSIGN_MAX_DOCUMENT_BYTES);
}

function evidenceError(errorClass: ClicksignErrorClass, correlationId: string, reasonCode: ClicksignEvidenceFailureReason, retryAfterMs: number | null = null) {
  return new ClicksignProviderError(errorClass, correlationId, retryAfterMs, reasonCode);
}

function safePresignedEvidenceUrl(raw: string, baseUrl: string, correlationId: string) {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw evidenceError("VALIDATION", correlationId, "CONTENT_HOST_FORBIDDEN"); }
  const apiOrigin = new URL(baseUrl).origin;
  const sandboxAllowed = apiOrigin === "https://sandbox.clicksign.com" && url.hostname === SANDBOX_CONTENT_HOST;
  // O host de conteúdo produtivo ainda não foi comprovado: produção permanece fail-closed.
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !sandboxAllowed) {
    throw evidenceError("VALIDATION", correlationId, "CONTENT_HOST_FORBIDDEN");
  }
  return url;
}

function safeBaseUrl(raw: string) {
  const parsed = new URL(raw);
  if (!ALLOWED_ORIGINS.has(parsed.origin) || parsed.pathname.replace(/\/$/, "") !== "/api/v3" || parsed.search || parsed.hash) throw new Error("Endpoint Clicksign não permitido.");
  return parsed.toString().replace(/\/$/, "");
}

function assertAccessToken(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Credencial Clicksign ausente ou inválida.");
  }
  return value;
}

function buildHeaders(accessToken: string, correlationId: string): Record<string, string> {
  return {
    Authorization: accessToken,
    Accept: JSON_API_MIME,
    "Content-Type": JSON_API_MIME,
    "x-correlation-id": correlationId,
  };
}

function relationship(type: string, id: string) { return { data: { type, id } }; }

export class ClicksignSignatureProvider implements SignatureProvider {
  readonly code = "CLICKSIGN" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly accessToken: string;
  private readonly defaultAuthentication: "email";

  constructor(config: ClicksignProviderConfiguration, private readonly transport: ClicksignHttpTransport = fetchClicksignTransport) {
    this.baseUrl = safeBaseUrl(config.baseUrl);
    this.timeoutMs = Math.min(30_000, Math.max(1_000, config.timeoutMs ?? 15_000));
    this.accessToken = assertAccessToken(config.accessToken);
    this.defaultAuthentication = config.defaultAuthentication ?? "email";
  }

  private async raw(method: ClicksignHttpRequest["method"], pathOrUrl: string, body?: unknown, maxResponseBytes = MAX_JSON_BYTES) {
    const url = pathOrUrl.startsWith("http") ? new URL(pathOrUrl) : new URL(`${this.baseUrl}${pathOrUrl}`);
    if (!ALLOWED_ORIGINS.has(url.origin)) throw new ClicksignProviderError("VALIDATION", randomUUID());
    const correlationId = randomUUID();
    let response: ClicksignHttpResponse;
    try {
      response = await this.transport.request({
        method,
        url: url.toString(),
        headers: buildHeaders(this.accessToken, correlationId),
        body: body === undefined ? undefined : JSON.stringify(body),
        timeoutMs: this.timeoutMs,
        maxResponseBytes,
      });
    } catch (error) {
      if (error instanceof ClicksignProviderError) throw error;
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw new ClicksignProviderError(timedOut ? "TIMEOUT" : "PROVIDER", correlationId);
    }
    if (new URL(response.finalUrl).origin !== url.origin) throw new ClicksignProviderError("VALIDATION", correlationId);
    if (response.status < 200 || response.status >= 300) {
      const errorClass: ClicksignErrorClass = response.status === 401 ? "AUTHENTICATION" : response.status === 403 ? "AUTHORIZATION" : response.status === 404 ? "NOT_FOUND" : response.status === 409 ? "CONFLICT" : response.status === 422 || response.status === 400 ? "VALIDATION" : response.status === 429 ? "RATE_LIMIT" : response.status >= 500 ? "PROVIDER" : "UNEXPECTED";
      throw new ClicksignProviderError(errorClass, correlationId, parseRetryAfter(response.headers["retry-after"]));
    }
    return response;
  }

  private async json(method: ClicksignHttpRequest["method"], path: string, body?: unknown) {
    const response = await this.raw(method, path, body);
    const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
    if (!contentType.includes("json")) throw new ClicksignProviderError("PROVIDER", randomUUID());
    try { return JSON.parse(decoder.decode(response.body)) as unknown; }
    catch { throw new ClicksignProviderError("PROVIDER", randomUUID()); }
  }

  private async reconciliationJson(path: string, correlationId: string) {
    const response = await this.raw("GET", path);
    // O contrato observado não contém documentId no evento. A resposta deve vir do endpoint exato.
    if (response.finalUrl !== new URL(`${this.baseUrl}${path}`).toString()) {
      throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_INVALID");
    }
    const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
    if (!contentType.includes("json")) throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_INVALID");
    try { return JSON.parse(decoder.decode(response.body)) as unknown; }
    catch { throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_INVALID"); }
  }

  private async downloadSignedPdf(rawUrl: string, correlationId: string) {
    const url = safePresignedEvidenceUrl(rawUrl, this.baseUrl, correlationId);
    let response: ClicksignHttpResponse;
    try {
      response = await this.transport.request({
        method: "GET",
        url: url.toString(),
        headers: { Accept: PDF_MIME },
        timeoutMs: this.timeoutMs,
        maxResponseBytes: MAX_EVIDENCE_BYTES,
      });
    } catch (error) {
      if (error instanceof ClicksignProviderError) throw error;
      if (error instanceof Error && error.message === "CLICK_SIGN_RESPONSE_TOO_LARGE") {
        throw evidenceError("VALIDATION", correlationId, "PDF_INVALID");
      }
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw evidenceError(timedOut ? "TIMEOUT" : "PROVIDER", correlationId, "DOWNLOAD_UNAVAILABLE");
    }
    if (response.finalUrl !== url.toString()) throw evidenceError("VALIDATION", correlationId, "CONTENT_REDIRECTED");
    if (response.status < 200 || response.status >= 300) {
      throw evidenceError("PROVIDER", correlationId, "DOWNLOAD_UNAVAILABLE", parseRetryAfter(response.headers["retry-after"]));
    }
    try {
      assertPdfBytes({ mimeType: response.headers["content-type"] ?? "", bytes: response.body }, MAX_EVIDENCE_BYTES);
    } catch {
      throw evidenceError("VALIDATION", correlationId, "PDF_INVALID");
    }
    return response.body;
  }

  async send(input: SignatureSendRequest): Promise<SignatureSendResult> {
    assertPdf(input.document);
    if (!input.parties.length || input.parties.some((party) => !party.email)) throw new Error("Todos os signatários Clicksign precisam de e-mail.");
    const envelopeId = idOf(await this.json("POST", "/envelopes", { data: { type: "envelopes", attributes: { name: `REDE-${input.requestId}` } } }));
    const documentId = idOf(await this.json("POST", `/envelopes/${encodeURIComponent(envelopeId)}/documents`, { data: { type: "documents", attributes: { filename: input.document.fileName, content_base64: `data:${PDF_MIME};base64,${Buffer.from(input.document.bytes).toString("base64")}` } } }));
    const parties: { order: number; externalPartyId: string }[] = [];
    for (const party of [...input.parties].sort((a, b) => a.order - b.order)) {
      const signerId = idOf(await this.json("POST", `/envelopes/${encodeURIComponent(envelopeId)}/signers`, { data: { type: "signers", attributes: { name: party.displayName, email: party.email, communicate_events: { signature_request: "email", signature_reminder: "email", document_signed: "email" } } } }));
      parties.push({ order: party.order, externalPartyId: signerId });
      const relationships = { document: relationship("documents", documentId), signer: relationship("signers", signerId) };
      await this.json("POST", `/envelopes/${encodeURIComponent(envelopeId)}/requirements`, { data: { type: "requirements", attributes: { action: "agree", role: "sign" }, relationships } });
      await this.json("POST", `/envelopes/${encodeURIComponent(envelopeId)}/requirements`, { data: { type: "requirements", attributes: { action: "provide_evidence", auth: this.defaultAuthentication }, relationships } });
    }
    await this.json("PATCH", `/envelopes/${encodeURIComponent(envelopeId)}`, { data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } } });
    await this.json("POST", `/envelopes/${encodeURIComponent(envelopeId)}/notifications`, { data: { type: "notifications", attributes: { message: null } } });
    return { externalId: envelopeId, parties };
  }

  async cancel(input: { externalId: string; reason: string }) {
    await this.json("PATCH", `/envelopes/${encodeURIComponent(input.externalId)}`, { data: { id: input.externalId, type: "envelopes", attributes: { status: "canceled" } } });
  }

  async status(externalId: string): Promise<ExternalSignatureStatus> {
    const payload = dataObject(await this.json("GET", `/envelopes/${encodeURIComponent(externalId)}`));
    const attributes = object(payload.attributes);
    const status = typeof attributes.status === "string" ? attributes.status.toLowerCase() : "";
    return status === "draft" ? "DRAFT" : status === "running" ? "RUNNING" : status === "closed" ? "CLOSED" : status === "canceled" || status === "cancelled" ? "CANCELLED" : "UNKNOWN";
  }

  async notify(externalId: string, message?: string | null) {
    await this.json("POST", `/envelopes/${encodeURIComponent(externalId)}/notifications`, { data: { type: "notifications", attributes: { message: message ?? null } } });
  }

  async reconcileSignatures(input: SignatureReconciliationRequest): Promise<SignatureReconciliationResult> {
    const correlationId = randomUUID();
    const expected = input.expectedExternalPartyIds;
    if (!input.externalId || !Array.isArray(expected) || expected.length === 0 || expected.some((id) => typeof id !== "string" || !id)) {
      throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_INVALID");
    }
    const expectedSet = new Set(expected);
    if (expectedSet.size !== expected.length) throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_AMBIGUOUS");

    try {
      const listPayload = object(await this.reconciliationJson(`/envelopes/${encodeURIComponent(input.externalId)}/documents`, correlationId));
      if (!Array.isArray(listPayload.data) || listPayload.data.length !== 1) throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_AMBIGUOUS");
      const listedDocument = object(listPayload.data[0]);
      if (typeof listedDocument.id !== "string" || !listedDocument.id) throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_INVALID");

      const detail = dataObject(await this.reconciliationJson(`/envelopes/${encodeURIComponent(input.externalId)}/documents/${encodeURIComponent(listedDocument.id)}`, correlationId));
      if (detail.id !== listedDocument.id) throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_AMBIGUOUS");
      const attributes = object(detail.attributes);
      if (attributes.status !== "closed") throw evidenceError("CONFLICT", correlationId, "DOCUMENT_NOT_CLOSED");

      const eventsPayload = object(await this.reconciliationJson(`/envelopes/${encodeURIComponent(input.externalId)}/documents/${encodeURIComponent(listedDocument.id)}/events`, correlationId));
      if (!Array.isArray(eventsPayload.data)) throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_INVALID");
      const signedByExternalId = new Map<string, string>();
      const seenEventIds = new Set<string>();
      for (const rawEvent of eventsPayload.data) {
        const event = object(rawEvent);
        const eventId = event.id;
        const eventAttributes = object(event.attributes);
        if (typeof eventId !== "string" || !eventId || typeof eventAttributes.name !== "string") {
          throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_INVALID");
        }
        if (eventAttributes.name !== "sign") continue;
        if (seenEventIds.has(eventId)) throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_AMBIGUOUS");
        seenEventIds.add(eventId);
        const eventData = object(eventAttributes.data);
        const signer = object(eventData.signer);
        const signerId = signer.key;
        if (typeof signerId !== "string" || !signerId) throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_INVALID");
        if (!expectedSet.has(signerId)) throw evidenceError("VALIDATION", correlationId, "SIGNER_MISMATCH");
        if (signedByExternalId.has(signerId)) throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_AMBIGUOUS");
        signedByExternalId.set(signerId, createHash("sha256").update(eventId).digest("hex"));
      }
      if (expected.some((id) => !signedByExternalId.has(id))) {
        throw evidenceError("PROVIDER", correlationId, "SIGNATURE_EVIDENCE_PENDING", SIGNED_LINK_RETRY_AFTER_MS);
      }
      return {
        documentStatus: "CLOSED",
        documentRef: createHash("sha256").update(listedDocument.id).digest("hex"),
        signedParties: expected.map((externalPartyId) => ({ externalPartyId, evidenceRef: signedByExternalId.get(externalPartyId)! })),
      };
    } catch (error) {
      if (error instanceof ClicksignProviderError) throw error;
      throw evidenceError("VALIDATION", correlationId, "SIGNATURE_EVIDENCE_INVALID");
    }
  }

  async finalEvidence(externalId: string): Promise<SignatureFinalEvidence> {
    const correlationId = randomUUID();
    let signedUrl: string;
    try {
      const listPayload = object(await this.json("GET", `/envelopes/${encodeURIComponent(externalId)}/documents`));
      if (!Array.isArray(listPayload.data) || listPayload.data.length !== 1) throw evidenceError("VALIDATION", correlationId, "STRUCTURE_INVALID");
      const listedDocument = object(listPayload.data[0]);
      if (typeof listedDocument.id !== "string" || !listedDocument.id) throw evidenceError("VALIDATION", correlationId, "STRUCTURE_INVALID");

      const detail = dataObject(await this.json("GET", `/envelopes/${encodeURIComponent(externalId)}/documents/${encodeURIComponent(listedDocument.id)}`));
      if (detail.id !== listedDocument.id) throw evidenceError("VALIDATION", correlationId, "STRUCTURE_INVALID");
      const attributes = object(detail.attributes);
      if (attributes.status !== "closed") throw evidenceError("CONFLICT", correlationId, "DOCUMENT_NOT_CLOSED");
      const links = object(detail.links);
      const files = object(links.files);
      if (files.signed === undefined || files.signed === null || files.signed === "") {
        throw evidenceError("PROVIDER", correlationId, "SIGNED_LINK_PENDING", SIGNED_LINK_RETRY_AFTER_MS);
      }
      if (typeof files.signed !== "string") throw evidenceError("VALIDATION", correlationId, "STRUCTURE_INVALID");
      signedUrl = files.signed;
    } catch (error) {
      if (error instanceof ClicksignProviderError) throw error;
      throw evidenceError("VALIDATION", correlationId, "STRUCTURE_INVALID");
    }
    const document = await this.downloadSignedPdf(signedUrl, correlationId);
    return {
      document: { fileName: "documento-assinado.pdf", mimeType: PDF_MIME, bytes: document },
    };
  }
}

export const clicksignInternals = { safeBaseUrl, safePresignedEvidenceUrl, parseRetryAfter, assertPdf, assertPdfBytes, assertAccessToken, buildHeaders, operatorMessage, MAX_EVIDENCE_BYTES, SANDBOX_CONTENT_HOST, SIGNED_LINK_RETRY_AFTER_MS };
