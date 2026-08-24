import { createHash } from "node:crypto";
import { MembershipRole, type PrismaClient } from "@prisma/client";
import { MockGoogleDriveConnector } from "../src/domain/integrations";
import {
  createConnectorInstallation,
  decideIntegrationConflict,
  getIntegrationsWorkspace,
  receiveWebhookEvent,
  registerConnectorDefinition,
  reprocessQuarantineItem,
  runConnectorSync,
  storeInstallationCredential,
} from "../src/application/integrations/integrations-service";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

type SeedIntegrationsInput = {
  organizationId: string;
  userId: string;
  projectId: string;
  companyId: string;
  supplierId: string;
  supplierTaxId: string;
};

export async function seedIntegrationsDemo(prisma: PrismaClient, input: SeedIntegrationsInput) {
  const context = { organizationId: input.organizationId, userId: input.userId, role: MembershipRole.OWNER };

  const driveDefinition = await registerConnectorDefinition({
    code: "GOOGLE_DRIVE_MOCK",
    name: "Google Drive (mock)",
    provider: "GOOGLE_DRIVE",
    category: "STORAGE",
    authMethod: "OAUTH2",
    capabilities: [{ code: "DOCUMENTS", direction: "INBOUND", description: "Lista, referencia e detecta novas versões de arquivos do Drive." }],
    sourceOfTruthDefault: { DOCUMENTS: "EXTERNAL_REFERENCE" },
    adapterVersion: "1.0.0",
    contractVersion: "1.0.0",
    sandboxAvailable: true,
  });

  const erpDefinition = await registerConnectorDefinition({
    code: "ERP_SUPPLIERS_MOCK",
    name: "ERP — Cadastro de fornecedores (mock)",
    provider: "ERP_GENERIC",
    category: "ERP",
    authMethod: "API_KEY",
    capabilities: [{ code: "SUPPLIERS", direction: "INBOUND", description: "Sincroniza cadastro de fornecedores; CNPJ é mestre do ERP, qualificação segue mestre do REDE." }],
    sourceOfTruthDefault: { "Supplier.taxId": "ERP", "Supplier.qualification": "REDE" },
    adapterVersion: "1.0.0",
    contractVersion: "1.0.0",
    sandboxAvailable: true,
  });

  let driveInstallation = await prisma.connectorInstallation.findFirst({ where: { organizationId: input.organizationId, connectorDefinitionId: driveDefinition.id, projectId: input.projectId } });
  driveInstallation ??= await createConnectorInstallation(context, {
    connectorDefinitionCode: driveDefinition.code,
    name: "Google Drive — START BUTANTÃ",
    direction: "INBOUND",
    projectId: input.projectId,
    configuration: { rootFolder: "START BUTANTÃ / Documentos", policy: "REFERENCE_BEFORE_COPY" },
  });

  let erpInstallation = await prisma.connectorInstallation.findFirst({ where: { organizationId: input.organizationId, connectorDefinitionId: erpDefinition.id, companyId: input.companyId } });
  erpInstallation ??= await createConnectorInstallation(context, {
    connectorDefinitionCode: erpDefinition.code,
    name: "ERP — Fornecedores (Núcleo de Negócios)",
    direction: "INBOUND",
    companyId: input.companyId,
    configuration: { syncMode: "SHADOW_READ_ONLY" },
  });

  await storeInstallationCredential(context, driveInstallation.id, { method: "OAUTH2", secret: "demo-oauth-refresh-token-not-a-real-secret", scopes: ["drive.readonly"], expiresAt: new Date("2027-01-01T00:00:00.000Z") });
  await storeInstallationCredential(context, erpInstallation.id, { method: "API_KEY", secret: "demo-erp-api-key-not-a-real-secret", expiresAt: new Date("2026-09-01T00:00:00.000Z") });
  // Caso Crítico D: token expirado é registrado/alertado, nunca apaga dados nem entra em loop de retry.
  await prisma.credentialReference.update({ where: { installationId: erpInstallation.id }, data: { status: "EXPIRED" } });

  // Google Drive: referência sem cópia; nova versão identificada sem perder a anterior (Caso Crítico E).
  const driveFiles = [
    { externalId: "drive-file-memorial", versionId: "v1", name: "Memorial descritivo — START BUTANTÃ.pdf", mimeType: "application/pdf", size: 812_400, webUrl: "https://drive.example.com/file/drive-file-memorial", checksum: hash("memorial-v1"), modifiedAt: new Date("2026-08-10T00:00:00.000Z") },
    { externalId: "drive-file-planta", versionId: "v2", name: "Planta baixa — pavimento tipo.dwg", mimeType: "application/dwg", size: 4_512_000, webUrl: "https://drive.example.com/file/drive-file-planta", checksum: hash("planta-v2"), modifiedAt: new Date("2026-08-18T00:00:00.000Z") },
  ];
  const driveConnector = new MockGoogleDriveConnector(driveFiles);
  const existingDriveRun = await prisma.integrationSyncRun.findFirst({ where: { installationId: driveInstallation.id, status: { in: ["SUCCEEDED", "PARTIAL"] } } });
  if (!existingDriveRun) await runConnectorSync(context, driveInstallation.id, { mode: "FULL", capability: "DOCUMENTS", connector: driveConnector });
  const driveSyncRun = await prisma.integrationSyncRun.findFirstOrThrow({ where: { installationId: driveInstallation.id }, orderBy: { startedAt: "desc" } });

  // Webhook duplicado deve ter efeito único (Caso Crítico B) — mesma chamada duas vezes, uma linha só.
  const webhookPayload = { fileId: "drive-file-planta", changeType: "content" };
  await receiveWebhookEvent(context, driveInstallation.id, { provider: "GOOGLE_DRIVE", eventId: "evt-planta-v2", signatureValid: true, payload: webhookPayload });
  await receiveWebhookEvent(context, driveInstallation.id, { provider: "GOOGLE_DRIVE", eventId: "evt-planta-v2", signatureValid: true, payload: webhookPayload });
  const inboxDedupCount = await prisma.integrationInboxEvent.count({ where: { installationId: driveInstallation.id, provider: "GOOGLE_DRIVE", eventId: "evt-planta-v2" } });

  // ERP → Supplier: mesmo CNPJ já cadastrado no REDE — vincula referência externa, nunca duplica (Caso Crítico A).
  let supplierReference = await prisma.externalEntityReference.findUnique({
    where: { installationId_externalType_externalId: { installationId: erpInstallation.id, externalType: "ERP_SUPPLIER", externalId: "ERP-SUP-0042" } },
  });
  supplierReference ??= await prisma.externalEntityReference.create({
    data: { organizationId: input.organizationId, installationId: erpInstallation.id, entityType: "Supplier", entityId: input.supplierId, externalType: "ERP_SUPPLIER", externalId: "ERP-SUP-0042", externalVersion: "1", companyId: input.companyId, metadata: { matchedBy: "CANONICAL_TAX_ID", taxId: input.supplierTaxId } },
  });
  const supplierCountForTaxId = await prisma.supplier.count({ where: { organizationId: input.organizationId, taxId: input.supplierTaxId } });

  // Ownership por domínio/campo — nunca "último que escreveu vence" universal.
  const ownershipPolicies: Array<{ domain: string; entityType: string; fieldPattern: string | null; masterSystem: string; allowedSources: string[]; consumers: string[]; direction: "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL"; conflictPolicy: "EXTERNAL_WINS" | "REDE_WINS" | "MANUAL_REVIEW"; riskLevel: "LOW" | "MEDIUM" | "HIGH" }> = [
    { domain: "PROCUREMENT", entityType: "Supplier", fieldPattern: "taxId", masterSystem: "ERP", allowedSources: ["ERP_SUPPLIERS_MOCK"], consumers: ["REDE"], direction: "INBOUND", conflictPolicy: "EXTERNAL_WINS", riskLevel: "LOW" },
    { domain: "PROCUREMENT", entityType: "Supplier", fieldPattern: "qualification", masterSystem: "REDE", allowedSources: ["REDE"], consumers: ["ERP_SUPPLIERS_MOCK"], direction: "OUTBOUND", conflictPolicy: "REDE_WINS", riskLevel: "MEDIUM" },
    { domain: "STORAGE", entityType: "ConnectorDocumentReference", fieldPattern: null, masterSystem: "GOOGLE_DRIVE_MOCK", allowedSources: ["GOOGLE_DRIVE_MOCK"], consumers: ["REDE"], direction: "INBOUND", conflictPolicy: "EXTERNAL_WINS", riskLevel: "LOW" },
  ];
  for (const policy of ownershipPolicies) {
    const existing = await prisma.dataOwnershipPolicy.findFirst({ where: { organizationId: input.organizationId, domain: policy.domain, entityType: policy.entityType, fieldPattern: policy.fieldPattern } });
    if (!existing) {
      await prisma.dataOwnershipPolicy.create({
        data: { organizationId: input.organizationId, domain: policy.domain, entityType: policy.entityType, fieldPattern: policy.fieldPattern, masterSystem: policy.masterSystem, allowedSources: policy.allowedSources, consumers: policy.consumers, direction: policy.direction, conflictPolicy: policy.conflictPolicy, riskLevel: policy.riskLevel, version: 1, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), approvedById: input.userId, createdById: input.userId },
      });
    }
  }

  let mappingProfile = await prisma.mappingProfile.findFirst({ where: { installationId: erpInstallation.id, capability: "SUPPLIERS", version: 1 } });
  mappingProfile ??= await prisma.mappingProfile.create({
    data: { organizationId: input.organizationId, installationId: erpInstallation.id, capability: "SUPPLIERS", version: 1, status: "ACTIVE", rules: { taxId: "taxId", legalName: "legalName", name: "tradeName" }, identityRules: { canonicalField: "taxId" }, createdById: input.userId, approvedById: input.userId, approvedAt: new Date("2026-08-20T00:00:00.000Z") },
  });

  // Conflito: mesmo campo alterado nos dois lados — nunca sobrescreve silenciosamente (Caso Crítico F).
  let conflict = await prisma.integrationConflict.findFirst({ where: { installationId: erpInstallation.id, entityType: "Supplier", entityId: input.supplierId, fieldName: "email" } });
  conflict ??= await prisma.integrationConflict.create({
    data: { organizationId: input.organizationId, installationId: erpInstallation.id, externalReferenceId: supplierReference.id, entityType: "Supplier", entityId: input.supplierId, fieldName: "email", localValue: "financeiro@horizonteconstrutora.com.br", externalValue: "contato-erp@horizonteconstrutora.com.br", localUpdatedAt: new Date("2026-08-15T00:00:00.000Z"), externalUpdatedAt: new Date("2026-08-19T00:00:00.000Z"), policyApplied: "MANUAL_REVIEW", status: "OPEN" },
  });
  if (conflict.status === "OPEN") conflict = await decideIntegrationConflict(context, conflict.id, { decision: "KEEP_LOCAL", notes: "E-mail financeiro validado manualmente; CNPJ segue mestre do ERP, contato segue REDE até confirmação." });

  // Quarentena: identidade não resolvida nunca contamina o domínio principal.
  let quarantineItem = await prisma.integrationQuarantineItem.findFirst({ where: { installationId: erpInstallation.id, externalId: "ERP-SUP-9999" } });
  quarantineItem ??= await prisma.integrationQuarantineItem.create({
    data: { organizationId: input.organizationId, installationId: erpInstallation.id, capability: "SUPPLIERS", externalType: "ERP_SUPPLIER", externalId: "ERP-SUP-9999", reason: "CNPJ ausente no payload — identidade não pode ser resolvida sem risco de duplicata.", errorClass: "MAPPING", payload: { name: "Fornecedor sem CNPJ", taxId: null }, status: "PENDING" },
  });
  if (quarantineItem.status === "PENDING") quarantineItem = await reprocessQuarantineItem(context, quarantineItem.id, { discard: false, notes: "Aguardando CNPJ correto do ERP antes de reprocessar." });

  // Dead-letter: falha permanente preservada para diagnóstico, sem apagar dados e sem retry infinito.
  let deadLetter = await prisma.integrationDeadLetter.findFirst({ where: { organizationId: input.organizationId, sourceType: "JOB", sourceId: `credential-refresh:${erpInstallation.id}` } });
  deadLetter ??= await prisma.integrationDeadLetter.create({
    data: { organizationId: input.organizationId, sourceType: "JOB", sourceId: `credential-refresh:${erpInstallation.id}`, installationId: erpInstallation.id, reason: "Token do ERP expirado; renovação automática não é permitida sem novo consentimento do operador.", errorClass: "AUTHENTICATION", payload: { attempts: 3 } },
  });

  const driveHealthExisting = await prisma.integrationHealthSnapshot.findFirst({ where: { installationId: driveInstallation.id } });
  if (!driveHealthExisting) {
    await prisma.integrationHealthSnapshot.create({ data: { organizationId: input.organizationId, installationId: driveInstallation.id, availability: 1, successRate: 1, avgLatencyMs: 120, freshnessSeconds: 300, backlogCount: 0, healthScore: 0.98, components: { availability: 1, successRate: 1, latencyScore: 0.97, freshnessScore: 0.99, backlogScore: 1 } } });
  }
  const erpHealthExisting = await prisma.integrationHealthSnapshot.findFirst({ where: { installationId: erpInstallation.id } });
  if (!erpHealthExisting) {
    await prisma.integrationHealthSnapshot.create({ data: { organizationId: input.organizationId, installationId: erpInstallation.id, availability: 0, successRate: 0, avgLatencyMs: null, freshnessSeconds: 7 * 24 * 60 * 60, backlogCount: 1, healthScore: 0.1, components: { availability: 0, successRate: 0, latencyScore: null, freshnessScore: 0.2, backlogScore: 0.9 } } });
  }

  // Preço externo (web) versus compra real preservados como observações separadas — nunca substitui histórico (Caso Crítico I).
  let priceObservation = await prisma.externalPriceObservation.findFirst({ where: { organizationId: input.organizationId, itemCode: "ACO-CA50-10MM", sourceProvider: "INDICE_PUBLICO_DEMO" } });
  priceObservation ??= await prisma.externalPriceObservation.create({
    data: { organizationId: input.organizationId, itemCode: "ACO-CA50-10MM", itemDescription: "Aço CA-50 10mm", specification: "Barra 12m, conforme NBR 7480", region: "São Paulo/SP", observedAt: new Date("2026-08-15T00:00:00.000Z"), quantity: "1000", unit: "kg", price: "100.00", freight: "8.00", taxes: "12.00", currency: "BRL", supplierName: "Índice público de referência (demonstração)", sourceProvider: "INDICE_PUBLICO_DEMO", sourceUrl: "https://precos.exemplo.gov.br/aco-ca50", evidenceChecksum: hash("aco-ca50-observacao"), confidence: 0.6, licenseNote: "Uso interno de referência; não substitui cotação formal.", createdById: input.userId },
  });

  const workspace = await getIntegrationsWorkspace(context, input.projectId);

  return {
    driveDefinition,
    erpDefinition,
    driveInstallation,
    erpInstallation,
    driveSyncRun,
    inboxDedupCount,
    supplierReference,
    supplierCountForTaxId,
    conflict,
    quarantineItem,
    deadLetter,
    priceObservation,
    workspace,
  };
}
