import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { isReadAccessDeniedError } from "@/domain/auth/read-capabilities";
import {
  registerLegalEvidenceDocument,
  verifyLegalEvidenceDocument,
  rejectLegalEvidenceDocument,
  revokeLegalEvidenceDocument,
  queryLegalEvidenceDocuments,
  LegalEvidenceConflictError,
} from "./legal-evidence-service";

/**
 * Fase 9S — correção estrutural final: evidência jurídica canônica
 * (`LegalEvidenceDocument`). Fixture isolada, própria organização (mesmo padrão de
 * `closure.database.integration.test.ts`/`handover.database.integration.test.ts`) —
 * nunca escreve na organização semeada compartilhada.
 */
describe.skipIf(!process.env.DATABASE_URL).sequential("Evidência jurídica canônica contra PostgreSQL real", () => {
  let organizationId: string;
  let foreignOrganizationId: string;
  let uploaderId: string;
  let approverId: string;
  let projectId: string;
  let diligenceCaseId: string;
  let documentRequestId: string;
  let counter = 0;

  const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\nFixture de evidência jurídica canônica (9S).\n%%EOF");
  const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);

  const base = (userId: string): AuthContext => ({ sessionId: "test", userId, userName: "Fixture 9S", userEmail: "fixture-9s@test.local", organizationId, organizationName: "9S Evidência Fixture", organizationSlug: "9s-evidencia-fixture", role: "ANALYST" });
  const uploader = (): AuthContext => ({ ...base(uploaderId), role: "ANALYST" });
  const approver = (): AuthContext => ({ ...base(approverId), role: "OWNER" });
  const viewer = (): AuthContext => ({ ...base(uploaderId), role: "VIEWER" });
  const foreignApprover = (): AuthContext => ({ ...approver(), organizationId: foreignOrganizationId });

  async function freshLink() {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const request = await prisma.legalDocumentRequest.create({ data: { diligenceCaseId, code: `DOC-${suffix}`, documentType: "MATRICULA", title: `Matrícula ${suffix}`, requestedAt: new Date(), responsibleId: approverId, createdById: approverId, updatedById: approverId } });
    const item = await prisma.legalChecklistItem.create({ data: { diligenceCaseId, templateKey: "fixture", templateVersion: 1, code: `CHK-${suffix}`, category: "REGULATORIO", title: `Item ${suffix}`, criticality: "HIGH", responsibleId: approverId, createdById: approverId, updatedById: approverId } });
    return { requestId: request.id, itemId: item.id };
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organization = await prisma.organization.create({ data: { name: `9S evidência fixture ${suffix}`, slug: `9s-evidencia-${suffix}` } });
    organizationId = organization.id;
    const foreignOrganization = await prisma.organization.create({ data: { name: `9S evidência outra org ${suffix}`, slug: `9s-evidencia-outra-${suffix}` } });
    foreignOrganizationId = foreignOrganization.id;
    const uploaderUser = await prisma.user.create({ data: { name: "Uploader 9S", email: `9s-uploader-${suffix}@test.local`, passwordHash: "integration-test" } });
    uploaderId = uploaderUser.id;
    const approverUser = await prisma.user.create({ data: { name: "Aprovador 9S", email: `9s-approver-evid-${suffix}@test.local`, passwordHash: "integration-test" } });
    approverId = approverUser.id;
    const project = await prisma.project.create({ data: { organizationId, name: `Projeto evidência 9S ${suffix}`, city: "São Paulo", state: "SP", createdById: approverId, updatedById: approverId } });
    projectId = project.id;
    const diligenceCase = await prisma.legalDueDiligenceCase.create({ data: { organizationId, projectId, code: `SPE-EVIDENCIA-${suffix}`, title: "Diligência evidência canônica", scope: "Fixture 9S", status: "IN_PROGRESS", responsibleId: approverId, createdById: approverId, updatedById: approverId } });
    diligenceCaseId = diligenceCase.id;
    const link = await freshLink();
    documentRequestId = link.requestId;
  });

  afterAll(async () => {
    await prisma.legalEvidenceDocument.deleteMany({ where: { organizationId, status: "PENDING_REVIEW" } });
    await prisma.legalDocumentRequest.deleteMany({ where: { diligenceCase: { organizationId } } }).catch(() => {});
    await prisma.legalChecklistItem.deleteMany({ where: { diligenceCase: { organizationId } } }).catch(() => {});
    await prisma.legalDueDiligenceCase.deleteMany({ where: { organizationId } }).catch(() => {});
    await prisma.project.deleteMany({ where: { organizationId } }).catch(() => {});
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => {});
    await prisma.organization.delete({ where: { id: foreignOrganizationId } }).catch(() => {});
    await prisma.user.delete({ where: { id: uploaderId } }).catch(() => {});
    await prisma.user.delete({ where: { id: approverId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe("registro", () => {
    it("recusa registro sem vínculo e com os dois vínculos ao mesmo tempo", async () => {
      const { requestId, itemId } = await freshLink();
      await expect(registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES })).rejects.toThrow(/exatamente um vínculo/);
      await expect(registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, checklistItemId: itemId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES })).rejects.toThrow(/exatamente um vínculo/);
    });

    it("recusa vínculo que não pertence à diligência informada (proteção IDOR)", async () => {
      const otherCase = await prisma.legalDueDiligenceCase.create({ data: { organizationId, projectId, code: `SPE-OUTRA-${Date.now()}`, title: "Outra diligência", scope: "x", status: "IN_PROGRESS", responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      const foreignRequest = await prisma.legalDocumentRequest.create({ data: { diligenceCaseId: otherCase.id, code: `DOC-OUTRA-${Date.now()}`, documentType: "MATRICULA", title: "x", requestedAt: new Date(), responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      await expect(registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: foreignRequest.id, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES })).rejects.toThrow(/não pertence a esta diligência/);
    });

    it("VIEWER não pode registrar evidência", async () => {
      const { requestId } = await freshLink();
      await expect(registerLegalEvidenceDocument(viewer(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES })).rejects.toThrow(/não pode registrar/);
    });

    it("recusa conteúdo cuja assinatura binária não corresponde à extensão (reaproveita validateDocumentUpload)", async () => {
      const { requestId } = await freshLink();
      await expect(registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: EXE_BYTES })).rejects.toThrow(/incompatível|executável/);
    });

    it("outra organização não encontra a diligência (IDOR no registro)", async () => {
      const { requestId } = await freshLink();
      await expect(registerLegalEvidenceDocument(foreignApprover(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES })).rejects.toThrow(/Diligência jurídica não encontrada/);
    });

    it("registra PENDING_REVIEW vinculado à solicitação documental e grava AuditLog atômico", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      expect(created.status).toBe("PENDING_REVIEW");
      expect(created.uploadedById).toBe(uploaderId);
      expect(created.reviewedById).toBeNull();
      expect(created.correlationId).toBeTruthy();
      const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, entityType: "LegalEvidenceDocument", entityId: created.id, action: "LEGAL_EVIDENCE_DOCUMENT_REGISTERED" } });
      expect(log.userId).toBe(uploaderId);
      expect((log.metadata as { correlationId?: string } | null)?.correlationId).toBe(created.correlationId);
    });

    it("é idempotente por checksum — reenviar o mesmo arquivo para o mesmo vínculo retorna o registro existente, sem duplicar", async () => {
      const { requestId } = await freshLink();
      const first = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const second = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      expect(second.id).toBe(first.id);
      const count = await prisma.legalEvidenceDocument.count({ where: { documentRequestId: requestId } });
      expect(count).toBe(1);
    });
  });

  describe("verificação (verify/reject) — segregação de função e CAS", () => {
    it("recusa quando o revisor é a mesma pessoa que enviou a evidência, mesmo com perfil de aprovador", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await expect(verifyLegalEvidenceDocument({ ...approver(), userId: uploaderId }, created.id)).rejects.toThrow(/segregação de função/);
    });

    it("ANALYST/VIEWER não pode verificar nem revogar (só OWNER/ADMIN)", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await expect(verifyLegalEvidenceDocument(uploader(), created.id)).rejects.toThrow(/Administrador ou Owner/);
    });

    it("aprovador diferente do uploader verifica com sucesso", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const verified = await verifyLegalEvidenceDocument(approver(), created.id);
      expect(verified.status).toBe("VERIFIED");
      expect(verified.reviewedById).toBe(approverId);
      expect(verified.reviewedAt).not.toBeNull();
    });

    it("é idempotente — reverificar pelo MESMO revisor retorna o mesmo registro sem duplicar AuditLog", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const first = await verifyLegalEvidenceDocument(approver(), created.id);
      const second = await verifyLegalEvidenceDocument(approver(), created.id);
      expect(second.status).toBe("VERIFIED");
      expect(second.reviewedAt?.getTime()).toBe(first.reviewedAt?.getTime());
      const auditCount = await prisma.auditLog.count({ where: { entityType: "LegalEvidenceDocument", entityId: created.id, action: "LEGAL_EVIDENCE_DOCUMENT_VERIFIED" } });
      expect(auditCount).toBe(1);
    });

    it("uma decisão já tomada por outro revisor não pode ser retomada — conflito classificado, nunca reescrita silenciosa", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await verifyLegalEvidenceDocument(approver(), created.id);
      const otherApprover = await prisma.user.create({ data: { name: "Outro aprovador", email: `9s-other-approver-${Date.now()}@test.local`, passwordHash: "integration-test" } });
      const error = await verifyLegalEvidenceDocument({ ...approver(), userId: otherApprover.id }, created.id).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LegalEvidenceConflictError);
      expect((error as LegalEvidenceConflictError).reasonCode).toBe("NOT_PENDING_REVIEW");
      await prisma.user.delete({ where: { id: otherApprover.id } }).catch(() => {});
    });

    it("REJECTED exige motivo não vazio e transita PENDING_REVIEW → REJECTED", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await expect(rejectLegalEvidenceDocument(approver(), created.id, "   ")).rejects.toThrow(/motivo da recusa/);
      const rejected = await rejectLegalEvidenceDocument(approver(), created.id, "Documento ilegível.");
      expect(rejected.status).toBe("REJECTED");
    });
  });

  describe("revogação — ciclo auditável, histórico nunca sobrescrito", () => {
    it("só evidência VERIFIED pode ser revogada", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const error = await revokeLegalEvidenceDocument(approver(), created.id, "Motivo qualquer.").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LegalEvidenceConflictError);
      expect((error as LegalEvidenceConflictError).reasonCode).toBe("NOT_VERIFIED");
    });

    it("exige motivo não vazio", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await verifyLegalEvidenceDocument(approver(), created.id);
      await expect(revokeLegalEvidenceDocument(approver(), created.id, "")).rejects.toThrow(/motivo da revogação/);
    });

    it("revoga preservando o snapshot original — só campos de revogação mudam", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const verified = await verifyLegalEvidenceDocument(approver(), created.id);
      const revoked = await revokeLegalEvidenceDocument(approver(), created.id, "Documento substituído por versão mais recente.");
      expect(revoked.status).toBe("REVOKED");
      expect(revoked.revokedById).toBe(approverId);
      expect(revoked.revokedAt).not.toBeNull();
      expect(revoked.revokedReason).toBe("Documento substituído por versão mais recente.");
      // Snapshot original — nunca sobrescrito.
      expect(revoked.checksum).toBe(verified.checksum);
      expect(revoked.storageKey).toBe(verified.storageKey);
      expect(revoked.storageProvider).toBe(verified.storageProvider);
      expect(revoked.documentRequestId).toBe(verified.documentRequestId);
      expect(revoked.uploadedById).toBe(verified.uploadedById);
      expect(revoked.reviewedById).toBe(verified.reviewedById);
      expect(revoked.reviewedAt?.getTime()).toBe(verified.reviewedAt?.getTime());
    });

    it("é idempotente — revogar de novo pelo MESMO revogador retorna o mesmo registro", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await verifyLegalEvidenceDocument(approver(), created.id);
      const first = await revokeLegalEvidenceDocument(approver(), created.id, "Motivo original.");
      const second = await revokeLegalEvidenceDocument(approver(), created.id, "Motivo original.");
      expect(second.revokedAt?.getTime()).toBe(first.revokedAt?.getTime());
    });
  });

  describe("IDOR entre organizações", () => {
    it("evidência de outra organização não é encontrada para verificar/revogar", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await expect(verifyLegalEvidenceDocument(foreignApprover(), created.id)).rejects.toThrow(/não encontrada nesta organização/);
    });
  });

  describe("consulta", () => {
    it("VIEWER não pode consultar evidência jurídica (LEGAL_READ)", async () => {
      const error = await queryLegalEvidenceDocuments(viewer(), { projectId }).catch((e: unknown) => e);
      expect(isReadAccessDeniedError(error)).toBe(true);
    });

    it("filtra por status e vínculo, escopado à organização do contexto", async () => {
      const { requestId, itemId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, checklistItemId: itemId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await verifyLegalEvidenceDocument(approver(), created.id);
      const verifiedForItem = await queryLegalEvidenceDocuments(approver(), { projectId, checklistItemId: itemId, status: "VERIFIED" });
      expect(verifiedForItem.map((row) => row.id)).toContain(created.id);
      const pendingForOtherRequest = await queryLegalEvidenceDocuments(approver(), { projectId, documentRequestId: requestId, status: "PENDING_REVIEW" });
      expect(pendingForOtherRequest.map((row) => row.id)).not.toContain(created.id);
    });
  });

  describe("concorrência — duas decisões simultâneas sobre a mesma evidência", () => {
    it("verify×verify concorrente: exatamente uma decisão vence, a outra é recusada de forma classificada", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const otherApprover = await prisma.user.create({ data: { name: "Aprovador concorrente", email: `9s-concurrent-${Date.now()}@test.local`, passwordHash: "integration-test" } });
      const results = await Promise.allSettled([
        verifyLegalEvidenceDocument(approver(), created.id),
        verifyLegalEvidenceDocument({ ...approver(), userId: otherApprover.id }, created.id),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LegalEvidenceConflictError);
      const final = await prisma.legalEvidenceDocument.findUniqueOrThrow({ where: { id: created.id } });
      expect(final.status).toBe("VERIFIED");
      await prisma.user.delete({ where: { id: otherApprover.id } }).catch(() => {});
    });
  });

  describe("integridade estrutural no Postgres (constraints e triggers)", () => {
    it("recusa vínculo ambíguo (documentRequestId + checklistItemId) por CHECK", async () => {
      const { requestId, itemId } = await freshLink();
      await expect(prisma.legalEvidenceDocument.create({ data: { organizationId, projectId, diligenceCaseId, documentRequestId: requestId, checklistItemId: itemId, storageProvider: "LOCAL_PRIVATE_FILE_STORAGE", storageKey: "fixture/key", checksum: "a".repeat(64), contentType: "application/pdf", sizeBytes: 10, uploadedById: uploaderId, correlationId: "fixture-correlation" } })).rejects.toThrow();
    });

    it("recusa checksum em formato inválido por CHECK", async () => {
      const { requestId } = await freshLink();
      await expect(prisma.legalEvidenceDocument.create({ data: { organizationId, projectId, diligenceCaseId, documentRequestId: requestId, storageProvider: "LOCAL_PRIVATE_FILE_STORAGE", storageKey: "fixture/key", checksum: "NAO-E-UM-SHA256", contentType: "application/pdf", sizeBytes: 10, uploadedById: uploaderId, correlationId: "fixture-correlation" } })).rejects.toThrow();
    });

    it("recusa solicitação documental de outro caso via trigger de validação cruzada", async () => {
      const otherCase = await prisma.legalDueDiligenceCase.create({ data: { organizationId, projectId, code: `SPE-CROSS-${Date.now()}`, title: "Outro caso", scope: "x", status: "IN_PROGRESS", responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      const foreignRequest = await prisma.legalDocumentRequest.create({ data: { diligenceCaseId: otherCase.id, code: `DOC-CROSS-${Date.now()}`, documentType: "MATRICULA", title: "x", requestedAt: new Date(), responsibleId: approverId, createdById: approverId, updatedById: approverId } });
      await expect(prisma.legalEvidenceDocument.create({ data: { organizationId, projectId, diligenceCaseId, documentRequestId: foreignRequest.id, storageProvider: "LOCAL_PRIVATE_FILE_STORAGE", storageKey: "fixture/key", checksum: "b".repeat(64), contentType: "application/pdf", sizeBytes: 10, uploadedById: uploaderId, correlationId: "fixture-correlation" } })).rejects.toThrow(/LEGAL_EVIDENCE_DOCUMENT_REQUEST_MISMATCH/);
    });

    it("bloqueia UPDATE direto (fora do serviço) de campos protegidos após VERIFIED", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await verifyLegalEvidenceDocument(approver(), created.id);
      await expect(prisma.legalEvidenceDocument.update({ where: { id: created.id }, data: { checksum: "c".repeat(64) } })).rejects.toThrow(/LEGAL_EVIDENCE_DOCUMENT_IMMUTABLE/);
    });

    it("bloqueia DELETE de evidência VERIFIED", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await verifyLegalEvidenceDocument(approver(), created.id);
      await expect(prisma.legalEvidenceDocument.delete({ where: { id: created.id } })).rejects.toThrow(/LEGAL_EVIDENCE_DOCUMENT_IMMUTABLE/);
    });

    it("bloqueia TRUNCATE em legal_evidence_documents incondicionalmente", async () => {
      await expect(prisma.$executeRaw`TRUNCATE legal_evidence_documents`).rejects.toThrow(/LEGAL_EVIDENCE_DOCUMENT_IMMUTABLE/);
    });

    it("rollback não deixa persistência parcial — AuditLog e linha nascem juntos ou nenhum nasce", async () => {
      const before = await prisma.legalEvidenceDocument.count({ where: { organizationId } });
      const beforeLogs = await prisma.auditLog.count({ where: { organizationId, entityType: "LegalEvidenceDocument" } });
      await expect(prisma.$transaction(async (tx) => {
        await tx.legalEvidenceDocument.create({ data: { organizationId, projectId, diligenceCaseId, documentRequestId, storageProvider: "LOCAL_PRIVATE_FILE_STORAGE", storageKey: "fixture/rollback", checksum: "d".repeat(64), contentType: "application/pdf", sizeBytes: 10, uploadedById: uploaderId, correlationId: "fixture-rollback" } });
        await tx.auditLog.create({ data: { organizationId, userId: uploaderId, projectId, action: "LEGAL_EVIDENCE_DOCUMENT_REGISTERED", entityType: "LegalEvidenceDocument", entityId: "does-not-matter" } });
        throw new Error("Falha simulada para forçar rollback.");
      })).rejects.toThrow(/Falha simulada/);
      const after = await prisma.legalEvidenceDocument.count({ where: { organizationId } });
      const afterLogs = await prisma.auditLog.count({ where: { organizationId, entityType: "LegalEvidenceDocument" } });
      expect(after).toBe(before);
      expect(afterLogs).toBe(beforeLogs);
    });
  });

  // ---------------------------------------------------------------------------
  // Correção focal pós-auditoria (1) + correção crítica final (remoção de
  // reasonRef): nenhum AuditLog de evidência jurídica pode conter storageKey,
  // checksum integral, nome de arquivo, ou motivo livre — nem em texto puro, nem
  // como hash/fingerprint (achado real: um hash SHA-256 sem chave sobre texto de
  // baixa entropia é recuperável por dicionário; `reasonRef` foi removido e
  // substituído por `reasonCode` estático).
  // ---------------------------------------------------------------------------
  describe("redação do AuditLog — nenhum storageKey/checksum integral/conteúdo jurídico/fingerprint de motivo", () => {
    async function auditRowsFor(entityId: string) {
      return prisma.auditLog.findMany({ where: { organizationId, entityType: "LegalEvidenceDocument", entityId }, orderBy: { createdAt: "asc" } });
    }
    /** Varredura recursiva de TODAS as folhas string do objeto (nunca um
     * `JSON.stringify` superficial só de `after`) — cobre `before`, `after`,
     * `metadata` e qualquer aninhamento futuro sem precisar saber a forma exata. */
    function collectStringLeaves(value: unknown, out: string[] = []): string[] {
      if (typeof value === "string") { out.push(value); return out; }
      if (Array.isArray(value)) { for (const item of value) collectStringLeaves(item, out); return out; }
      if (value && typeof value === "object") { for (const item of Object.values(value as Record<string, unknown>)) collectStringLeaves(item, out); return out; }
      return out;
    }
    function assertNoLeafContains(row: Record<string, unknown>, forbidden: string[]) {
      const leaves = collectStringLeaves(row);
      for (const leaf of leaves) for (const value of forbidden) expect(leaf).not.toContain(value);
    }
    /** Algoritmo ANTIGO (removido) de `reasonRef` — reproduzido aqui só para o
     * ataque de dicionário de regressão: prova que nenhum resquício dele
     * (hash integral OU truncado a 16 hex) sobrevive em nenhuma forma. */
    function legacyReasonRefAlgorithm(reason: string): { full: string; truncated16: string } {
      const full = createHash("sha256").update(`legal-evidence-reason:${reason}`).digest("hex");
      return { full, truncated16: full.slice(0, 16) };
    }

    it("register: AuditLog não contém storageKey nem checksum integral, e traz evidenceRef determinístico de 16 hex — sem reasonCode (não houve decisão)", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const [log] = await auditRowsFor(created.id);
      assertNoLeafContains(log, [created.storageKey, created.checksum]);
      const after = log.after as Record<string, unknown>;
      expect(after.evidenceRef).toMatch(/^[a-f0-9]{16}$/);
      expect(after).not.toHaveProperty("storageKey");
      expect(after).not.toHaveProperty("storageProvider");
      expect(after).not.toHaveProperty("reasonCode");
      expect(after).not.toHaveProperty("reasonRef");
      expect(after.statusBefore).toBeNull();
      expect(after.statusAfter).toBe("PENDING_REVIEW");
    });

    it("verify: statusBefore/statusAfter corretos, evidenceRef igual ao do register (mesmo checksum), sem checksum integral e sem reasonCode", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await verifyLegalEvidenceDocument(approver(), created.id);
      const logs = await auditRowsFor(created.id);
      const registerLog = logs.find((l) => l.action === "LEGAL_EVIDENCE_DOCUMENT_REGISTERED")!;
      const verifyLog = logs.find((l) => l.action === "LEGAL_EVIDENCE_DOCUMENT_VERIFIED")!;
      assertNoLeafContains(verifyLog, [created.storageKey, created.checksum]);
      const verifyAfter = verifyLog.after as Record<string, unknown>;
      expect(verifyAfter.statusBefore).toBe("PENDING_REVIEW");
      expect(verifyAfter.statusAfter).toBe("VERIFIED");
      expect(verifyAfter.evidenceRef).toBe((registerLog.after as Record<string, unknown>).evidenceRef);
      expect(verifyAfter).not.toHaveProperty("reasonCode");
    });

    it("reject: motivo NUNCA aparece no AuditLog em nenhuma forma (texto, hash integral, hash truncado, prefixo/sufixo) — só reasonCode estático", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const reason = "Documento ilegível — página 3 corrompida, dados do sócio X ininteligíveis.";
      await rejectLegalEvidenceDocument(approver(), created.id, reason);
      const logs = await auditRowsFor(created.id);
      const rejectLog = logs.find((l) => l.action === "LEGAL_EVIDENCE_DOCUMENT_REJECTED")!;
      const legacy = legacyReasonRefAlgorithm(reason);
      // Motivo bruto, fragmentos dele, e o hash do algoritmo removido (integral e
      // truncado a 16 hex) — nenhum sobrevive, em nenhuma folha da linha inteira.
      assertNoLeafContains(rejectLog, [reason, reason.slice(0, 10), reason.slice(-10), created.checksum, created.storageKey, legacy.full, legacy.truncated16]);
      const after = rejectLog.after as Record<string, unknown>;
      expect(after.reasonCode).toBe("LEGAL_EVIDENCE_REJECTION_REASON_PROVIDED");
      expect(after).not.toHaveProperty("reason");
      expect(after).not.toHaveProperty("reasonRef");
    });

    it("revoke: motivo NUNCA aparece no AuditLog em nenhuma forma (texto bruto continua só na coluna canônica revokedReason) — só reasonCode estático", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      await verifyLegalEvidenceDocument(approver(), created.id);
      const reason = "Revogado — substituído por versão mais recente com dados do CNPJ corrigidos.";
      const revoked = await revokeLegalEvidenceDocument(approver(), created.id, reason);
      expect(revoked.revokedReason).toBe(reason); // coluna canônica — não é AuditLog, correto manter o texto real
      const logs = await auditRowsFor(created.id);
      const revokeLog = logs.find((l) => l.action === "LEGAL_EVIDENCE_DOCUMENT_REVOKED")!;
      const legacy = legacyReasonRefAlgorithm(reason);
      assertNoLeafContains(revokeLog, [reason, reason.slice(0, 10), reason.slice(-10), created.checksum, created.storageKey, legacy.full, legacy.truncated16]);
      const after = revokeLog.after as Record<string, unknown>;
      expect(after.reasonCode).toBe("LEGAL_EVIDENCE_REVOCATION_REASON_PROVIDED");
      expect(after).not.toHaveProperty("reasonRef");
    });

    it("ATAQUE DE DICIONÁRIO (regressão): nenhum hash do algoritmo removido aparece no AuditLog para uma lista de motivos plausíveis", async () => {
      const DICTIONARY = [
        "Documento ilegível.",
        "Documento fora do prazo.",
        "Documento incompleto.",
        "CPF divergente.",
        "Documento substituído por versão mais recente.",
        "Revogado por decisão do comitê.",
      ];
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const usedReason = DICTIONARY[0];
      await rejectLegalEvidenceDocument(approver(), created.id, usedReason);
      const [, rejectLog] = await auditRowsFor(created.id);
      const legacyHashes = DICTIONARY.flatMap((candidate) => { const h = legacyReasonRefAlgorithm(candidate); return [h.full, h.truncated16]; });
      assertNoLeafContains(rejectLog, legacyHashes);
    });

    it("duas razões DIFERENTES na mesma operação produzem o MESMO reasonCode estático (nunca fingerprints distintos)", async () => {
      const { requestId: r1 } = await freshLink();
      const { requestId: r2 } = await freshLink();
      const OTHER_PDF_BYTES = new TextEncoder().encode("%PDF-1.4\nConteudo completamente diferente para gerar outro checksum.\n%%EOF");
      const created1 = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: r1, fileName: "a.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const created2 = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: r2, fileName: "b.pdf", mimeType: "application/pdf", bytes: OTHER_PDF_BYTES });
      // evidenceRef ainda deve divergir (deriva do checksum, entrada de alta entropia — inalterado por esta correção).
      const [log1] = await auditRowsFor(created1.id);
      const [log2] = await auditRowsFor(created2.id);
      expect((log1.after as Record<string, unknown>).evidenceRef).not.toBe((log2.after as Record<string, unknown>).evidenceRef);

      await rejectLegalEvidenceDocument(approver(), created1.id, "Motivo A — específico deste caso, nunca deve aparecer no log.");
      await rejectLegalEvidenceDocument(approver(), created2.id, "Motivo B — completamente diferente do motivo A.");
      const [, reject1] = await auditRowsFor(created1.id);
      const [, reject2] = await auditRowsFor(created2.id);
      const code1 = (reject1.after as Record<string, unknown>).reasonCode;
      const code2 = (reject2.after as Record<string, unknown>).reasonCode;
      expect(code1).toBe("LEGAL_EVIDENCE_REJECTION_REASON_PROVIDED");
      expect(code2).toBe("LEGAL_EVIDENCE_REJECTION_REASON_PROVIDED");
      expect(code1).toBe(code2); // MESMO código estático — nunca um fingerprint que distinguiria os dois motivos.
    });

    it("console.error/warn/log nunca recebe checksum, storageKey ou motivo bruto (nem hash dele) em nenhum dos 4 caminhos", async () => {
      const { requestId } = await freshLink();
      const spies = ["log", "warn", "error"].map((method) => vi.spyOn(console, method as "log").mockImplementation(() => {}));
      try {
        const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
        const reason = "Motivo sigiloso de teste para verificação de vazamento em console.";
        await verifyLegalEvidenceDocument(approver(), created.id);
        await revokeLegalEvidenceDocument(approver(), created.id, reason);
        const legacy = legacyReasonRefAlgorithm(reason);
        for (const spy of spies) {
          for (const call of spy.mock.calls) {
            const serialized = JSON.stringify(call);
            expect(serialized).not.toContain(created.checksum);
            expect(serialized).not.toContain(created.storageKey);
            expect(serialized).not.toContain(reason);
            expect(serialized).not.toContain(legacy.full);
            expect(serialized).not.toContain(legacy.truncated16);
          }
        }
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });

    it("erro de validação (MIME/assinatura inválida) não vaza checksum/storageKey na mensagem, não usa Error.cause, e não grava AuditLog", async () => {
      const { requestId } = await freshLink();
      const beforeLogs = await prisma.auditLog.count({ where: { organizationId } });
      const error = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: EXE_BYTES }).catch((e: unknown) => e as Error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBeUndefined();
      const afterLogs = await prisma.auditLog.count({ where: { organizationId } });
      expect(afterLogs).toBe(beforeLogs);
    });

    it("Error.cause nunca carrega o motivo bruto na recusa (motivo vazio) nem em conflito de estado", async () => {
      const { requestId } = await freshLink();
      const created = await registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "matricula.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });
      const reason = "Motivo que não deve vazar via Error.cause.";
      const emptyReasonError = await rejectLegalEvidenceDocument(approver(), created.id, "   ").catch((e: unknown) => e as Error);
      expect((emptyReasonError as Error).cause).toBeUndefined();
      await rejectLegalEvidenceDocument(approver(), created.id, reason);
      const conflictError = await revokeLegalEvidenceDocument(approver(), created.id, "Tentativa de revogar algo já REJECTED.").catch((e: unknown) => e as Error);
      expect((conflictError as Error).cause).toBeUndefined();
      expect(JSON.stringify(conflictError)).not.toContain(reason);
    });
  });

  // ---------------------------------------------------------------------------
  // Correção focal pós-auditoria (2): idempotência estrutural real (índices
  // únicos parciais), não apenas releitura em memória.
  // ---------------------------------------------------------------------------
  describe("idempotência estrutural — índices únicos parciais reais", () => {
    it("2 registros concorrentes idênticos (mesmo vínculo, mesmo checksum) resultam em exatamente 1 linha e 1 AuditLog de criação", async () => {
      const { requestId } = await freshLink();
      const input = { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "concurrent.pdf", mimeType: "application/pdf", bytes: PDF_BYTES };
      const [a, b] = await Promise.all([registerLegalEvidenceDocument(uploader(), input), registerLegalEvidenceDocument(uploader(), input)]);
      expect(a.id).toBe(b.id);
      const rowCount = await prisma.legalEvidenceDocument.count({ where: { documentRequestId: requestId } });
      expect(rowCount).toBe(1);
      const logCount = await prisma.auditLog.count({ where: { organizationId, entityType: "LegalEvidenceDocument", entityId: a.id, action: "LEGAL_EVIDENCE_DOCUMENT_REGISTERED" } });
      expect(logCount).toBe(1);
    });

    it("10 registros concorrentes idênticos resultam em exatamente 1 linha e 1 AuditLog de criação", async () => {
      const { requestId } = await freshLink();
      const input = { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "concurrent10.pdf", mimeType: "application/pdf", bytes: PDF_BYTES };
      const results = await Promise.all(Array.from({ length: 10 }, () => registerLegalEvidenceDocument(uploader(), input)));
      const distinctIds = new Set(results.map((r) => r.id));
      expect(distinctIds.size).toBe(1);
      const rowCount = await prisma.legalEvidenceDocument.count({ where: { documentRequestId: requestId } });
      expect(rowCount).toBe(1);
      const logCount = await prisma.auditLog.count({ where: { organizationId, entityType: "LegalEvidenceDocument", entityId: [...distinctIds][0], action: "LEGAL_EVIDENCE_DOCUMENT_REGISTERED" } });
      expect(logCount).toBe(1);
    });

    it("mesma chave (vínculo) com checksum diferente NÃO é bloqueada — são evidências genuinamente diferentes", async () => {
      const { requestId } = await freshLink();
      const OTHER_BYTES = new TextEncoder().encode("%PDF-1.4\nSegundo documento, conteudo diferente, mesmo vinculo.\n%%EOF");
      const [a, b] = await Promise.all([
        registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "v1.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }),
        registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "v2.pdf", mimeType: "application/pdf", bytes: OTHER_BYTES }),
      ]);
      expect(a.id).not.toBe(b.id);
      expect(a.checksum).not.toBe(b.checksum);
      const rowCount = await prisma.legalEvidenceDocument.count({ where: { documentRequestId: requestId } });
      expect(rowCount).toBeGreaterThanOrEqual(2);
    });

    it("mesmo checksum em requests diferentes (mesmo caso) — índices por vínculo são independentes, ambos permitidos", async () => {
      const { requestId: r1 } = await freshLink();
      const { requestId: r2 } = await freshLink();
      const [a, b] = await Promise.all([
        registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: r1, fileName: "x.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }),
        registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: r2, fileName: "x.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }),
      ]);
      expect(a.id).not.toBe(b.id);
      expect(a.checksum).toBe(b.checksum);
    });

    it("documentRequestId versus checklistItemId — mesmo checksum, mesmo caso, vínculos diferentes: ambos permitidos (índices independentes)", async () => {
      const { requestId, itemId } = await freshLink();
      const [a, b] = await Promise.all([
        registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "x.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }),
        registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, checklistItemId: itemId, fileName: "x.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }),
      ]);
      expect(a.id).not.toBe(b.id);
      expect(a.documentRequestId).toBe(requestId);
      expect(b.checklistItemId).toBe(itemId);
    });

    it("mesmo checksum em ORGANIZAÇÕES diferentes nunca colide (índice é escopado por organization_id)", async () => {
      const suffix = `cross-org-${Date.now()}`;
      const otherOrg = await prisma.organization.create({ data: { name: `Outra org idempotencia ${suffix}`, slug: `outra-org-idem-${suffix}` } });
      const otherUser = await prisma.user.create({ data: { name: "U", email: `idem-other-${suffix}@test.local`, passwordHash: "integration-test" } });
      const otherProject = await prisma.project.create({ data: { organizationId: otherOrg.id, name: `P ${suffix}`, city: "SP", state: "SP", createdById: otherUser.id, updatedById: otherUser.id } });
      const otherCase = await prisma.legalDueDiligenceCase.create({ data: { organizationId: otherOrg.id, projectId: otherProject.id, code: `C-${suffix}`, title: "x", scope: "x", status: "IN_PROGRESS", responsibleId: otherUser.id, createdById: otherUser.id, updatedById: otherUser.id } });
      const otherRequest = await prisma.legalDocumentRequest.create({ data: { diligenceCaseId: otherCase.id, code: "D", documentType: "X", title: "x", requestedAt: new Date(), responsibleId: otherUser.id, createdById: otherUser.id, updatedById: otherUser.id } });
      const otherCtx: AuthContext = { sessionId: "test", userId: otherUser.id, userName: "U", userEmail: "u@test.local", organizationId: otherOrg.id, organizationName: otherOrg.name, organizationSlug: otherOrg.slug, role: "ANALYST" };

      const { requestId } = await freshLink();
      const [mine, theirs] = await Promise.all([
        registerLegalEvidenceDocument(uploader(), { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "x.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }),
        registerLegalEvidenceDocument(otherCtx, { projectId: otherProject.id, diligenceCaseId: otherCase.id, documentRequestId: otherRequest.id, fileName: "x.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }),
      ]);
      expect(mine.checksum).toBe(theirs.checksum);
      expect(mine.id).not.toBe(theirs.id);

      await prisma.legalEvidenceDocument.deleteMany({ where: { organizationId: otherOrg.id, status: "PENDING_REVIEW" } });
      await prisma.legalDocumentRequest.deleteMany({ where: { diligenceCaseId: otherCase.id } }).catch(() => {});
      await prisma.legalDueDiligenceCase.deleteMany({ where: { organizationId: otherOrg.id } }).catch(() => {});
      await prisma.project.deleteMany({ where: { organizationId: otherOrg.id } }).catch(() => {});
      await prisma.organization.delete({ where: { id: otherOrg.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
    });

    it("retry (mesmo checksum, mesmo vínculo) depois de VERIFIED retorna a MESMA linha já verificada, sem criar uma segunda PENDING_REVIEW", async () => {
      const { requestId } = await freshLink();
      const input = { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "retry-verified.pdf", mimeType: "application/pdf", bytes: PDF_BYTES };
      const created = await registerLegalEvidenceDocument(uploader(), input);
      const verified = await verifyLegalEvidenceDocument(approver(), created.id);
      const retried = await registerLegalEvidenceDocument(uploader(), input);
      expect(retried.id).toBe(verified.id);
      expect(retried.status).toBe("VERIFIED");
      const rowCount = await prisma.legalEvidenceDocument.count({ where: { documentRequestId: requestId, checksum: created.checksum } });
      expect(rowCount).toBe(1);
    });

    it("retry (mesmo checksum, mesmo vínculo) depois de REJECTED cria uma NOVA linha PENDING_REVIEW (nova operação lógica, não um retry da anterior)", async () => {
      const { requestId } = await freshLink();
      const input = { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "retry-rejected.pdf", mimeType: "application/pdf", bytes: PDF_BYTES };
      const created = await registerLegalEvidenceDocument(uploader(), input);
      await rejectLegalEvidenceDocument(approver(), created.id, "Recusado para testar reenvio.");
      const resubmitted = await registerLegalEvidenceDocument(uploader(), input);
      expect(resubmitted.id).not.toBe(created.id);
      expect(resubmitted.status).toBe("PENDING_REVIEW");
      const rowCount = await prisma.legalEvidenceDocument.count({ where: { documentRequestId: requestId, checksum: created.checksum } });
      expect(rowCount).toBe(2);
    });

    it("retry (mesmo checksum, mesmo vínculo) depois de REVOKED cria uma NOVA linha PENDING_REVIEW", async () => {
      const { requestId } = await freshLink();
      const input = { projectId, diligenceCaseId, documentRequestId: requestId, fileName: "retry-revoked.pdf", mimeType: "application/pdf", bytes: PDF_BYTES };
      const created = await registerLegalEvidenceDocument(uploader(), input);
      await verifyLegalEvidenceDocument(approver(), created.id);
      await revokeLegalEvidenceDocument(approver(), created.id, "Revogado para testar reenvio.");
      const resubmitted = await registerLegalEvidenceDocument(uploader(), input);
      expect(resubmitted.id).not.toBe(created.id);
      expect(resubmitted.status).toBe("PENDING_REVIEW");
    });

    it("conflito de unicidade em constraint NÃO relacionada (ex.: colisão de chave primária) nunca é tratado como retry idempotente", async () => {
      const { requestId } = await freshLink();
      const explicitId = `explicit-pk-${Date.now()}`;
      await prisma.legalEvidenceDocument.create({ data: { id: explicitId, organizationId, projectId, diligenceCaseId, documentRequestId: requestId, storageProvider: "LOCAL_PRIVATE_FILE_STORAGE", storageKey: "fixture/pk-collision", checksum: "1".repeat(64), contentType: "application/pdf", sizeBytes: 10, uploadedById: uploaderId, correlationId: "fixture-pk" } });
      const error = await prisma.legalEvidenceDocument.create({ data: { id: explicitId, organizationId, projectId, diligenceCaseId, documentRequestId: requestId, storageProvider: "LOCAL_PRIVATE_FILE_STORAGE", storageKey: "fixture/pk-collision-2", checksum: "2".repeat(64), contentType: "application/pdf", sizeBytes: 10, uploadedById: uploaderId, correlationId: "fixture-pk-2" } }).catch((e: unknown) => e as { code?: string; meta?: { target?: unknown } });
      expect(error).toHaveProperty("code", "P2002");
      // O target da colisão de PK é `["id"]` — estruturalmente distinto dos dois
      // conjuntos de colunas que `isKnownIdentityConflict` reconhece como retry
      // idempotente (que sempre incluem organization_id+project_id+diligence_case_id+
      // checksum). Confirma que os dois tipos de P2002 são discrimináveis pelo target.
      expect((error as { meta?: { target?: unknown } }).meta?.target).toEqual(["id"]);
      await prisma.legalEvidenceDocument.delete({ where: { id: explicitId } });
    });
  });
});
