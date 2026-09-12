import { createHash, randomUUID } from "node:crypto";
import { Prisma, type LegalEvidenceDocumentStatus } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { assertProtectedReadCapability } from "@/domain/auth/read-capabilities";
import { prisma } from "@/infrastructure/database/prisma";
import { legalEvidenceStorage } from "@/infrastructure/storage/legal-evidence-storage";
import { validateDocumentUpload } from "@/infrastructure/storage/upload-validation";
import { inspectUpload } from "@/infrastructure/storage/upload-policy";

/**
 * Fase 9S — correção estrutural final: serviço dedicado de evidência jurídica
 * canônica (`LegalEvidenceDocument`), desacoplado do gate (`closure-gate-service.ts`
 * só lê, nunca decide aqui). Reaproveita `validateDocumentUpload`/`inspectUpload`
 * (mesmo guard de MIME/extensão/assinatura binária/scanner antimalware fail-closed
 * em produção, já endurecido em 9Q.2B) e o `FileStorageProvider` genérico — o
 * binário nunca entra no Postgres. `documentLinkId`/`sourceDocumentLinkId`/
 * `evidenceDocumentIds` legados nunca são lidos nem escritos aqui.
 */

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const approvalRoles = new Set(["OWNER", "ADMIN"]);
const DECISION_MAX_ATTEMPTS = 3;

const json = (value: unknown) => value as Prisma.InputJsonValue;
const newCorrelationId = () => randomUUID();

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode registrar evidência jurídica.");
}
function assertApprover(context: Pick<AuthContext, "role">) {
  if (!approvalRoles.has(context.role)) throw new Error("Somente Administrador ou Owner pode revisar/revogar evidência jurídica.");
}

/**
 * Erro classificado (mesmo padrão de `ClosurePreparationError` — 9S): `reasonCode`
 * estático e seguro (nunca `storageKey`, conteúdo jurídico ou outro dado sensível),
 * `correlationId` sempre gerado no servidor. Nunca reexecutado automaticamente.
 */
export class LegalEvidenceConflictError extends Error {
  constructor(
    message: string,
    readonly reasonCode: "NOT_PENDING_REVIEW" | "NOT_VERIFIED" | "SELF_REVIEW_FORBIDDEN" | "CONCURRENCY_CONFLICT",
    readonly correlationId: string,
  ) {
    super(message);
    this.name = "LegalEvidenceConflictError";
  }
}

/**
 * Correção focal pós-auditoria — redação estrutural: nenhum `AuditLog` de evidência
 * jurídica pode conter `storageKey`, checksum integral, nome de arquivo, motivo em
 * texto livre ou qualquer outro conteúdo jurídico. `safeAuditRef` produz uma
 * referência determinística e NÃO reversível (SHA-256 de um material com prefixo
 * de domínio, truncado a 16 hex) — permite correlacionar duas entradas que se
 * referem ao MESMO arquivo (ex.: dois envios do mesmo conteúdo) sem nunca expor o
 * checksum original.
 *
 * Correção crítica final (autorrevisão adversarial): esta técnica é segura para
 * `checksum` (SHA-256 de 256 bits de entropia — inviável de adivinhar por
 * dicionário/força bruta), mas era usada também para `reason` (motivo livre de
 * recusa/revogação) sob o nome `reasonRef` — um erro real. Texto livre de domínio
 * jurídico/administrativo tem baixa entropia (frases previsíveis: "Documento
 * ilegível.", "Fora do prazo.", etc.) e o hash não tinha chave nem sal — qualquer
 * leitor do `AuditLog` com o algoritmo (público, está neste arquivo) e um pequeno
 * dicionário de motivos plausíveis recupera o texto original comparando hashes.
 * Confirmado experimentalmente: um dicionário de 15 frases recuperou os dois
 * motivos reais de um teste. `reasonRef` foi REMOVIDO — motivo livre nunca mais é
 * representado no `AuditLog` em nenhuma forma (nem hash, nem prefixo, nem
 * fragmento); só um `reasonCode` ESTÁTICO e allowlisted (nunca derivado do
 * conteúdo) indica que um motivo foi informado. O texto continua existindo só na
 * coluna canônica protegida (`revoked_reason`, para revogação) ou é descartado
 * após validar que não está vazio (recusa — sem coluna canônica própria; ver
 * `docs/PHASE_9S_CONTRACT.md` §23).
 */
function safeAuditRef(material: string): string {
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}
const evidenceRef = (checksum: string) => safeAuditRef(`legal-evidence-checksum:${checksum}`);

/** Códigos estáticos e allowlisted — nunca derivados do texto do motivo. Apenas
 * sinalizam a CATEGORIA operacional do evento ("um motivo foi informado nesta
 * decisão"), nunca o conteúdo. Dois motivos diferentes na mesma operação sempre
 * produzem o MESMO código — é isso que os distingue de um fingerprint. */
type LegalEvidenceAuditReasonCode = "LEGAL_EVIDENCE_REJECTION_REASON_PROVIDED" | "LEGAL_EVIDENCE_REVOCATION_REASON_PROVIDED";

/** Payload allowlisted único para todo `AuditLog` de evidência jurídica — helper
 * central (register/verify/reject/revoke todos passam por aqui) para que nenhum
 * call site invente um formato de redação divergente. Nunca aceita `checksum`
 * bruto nem `storageKey`: `checksum` só entra como `evidenceRef` (derivado);
 * `storageKey` nunca entra, em nenhuma forma — não é necessário para investigação
 * (a chave real fica só na linha canônica de `LegalEvidenceDocument`, nunca em
 * log). `reasonCode`, quando presente, é sempre um dos dois valores estáticos
 * acima — o motivo em texto livre NUNCA passa por este helper, em nenhuma forma
 * (nem bruto, nem hash, nem prefixo/sufixo/fragmento).
 */
interface EvidenceAuditFacts {
  diligenceCaseId: string;
  documentRequestId: string | null;
  checklistItemId: string | null;
  checksum: string;
  statusBefore: LegalEvidenceDocumentStatus | null;
  statusAfter: LegalEvidenceDocumentStatus;
  reasonCode?: LegalEvidenceAuditReasonCode;
}
const audit = (
  context: Pick<AuthContext, "organizationId" | "userId">,
  projectId: string,
  action: string,
  entityId: string,
  facts: EvidenceAuditFacts,
  correlationId: string,
) => ({
  organizationId: context.organizationId, userId: context.userId, projectId, action,
  entityType: "LegalEvidenceDocument", entityId,
  after: json({
    evidenceRef: evidenceRef(facts.checksum),
    statusBefore: facts.statusBefore,
    statusAfter: facts.statusAfter,
    diligenceCaseId: facts.diligenceCaseId,
    documentRequestId: facts.documentRequestId,
    checklistItemId: facts.checklistItemId,
    ...(facts.reasonCode !== undefined ? { reasonCode: facts.reasonCode } : {}),
  }),
  metadata: json({ correlationId }),
});

async function diligenceCaseForTenant(organizationId: string, projectId: string, diligenceCaseId: string) {
  const diligenceCase = await prisma.legalDueDiligenceCase.findFirst({ where: { id: diligenceCaseId, organizationId, projectId } });
  if (!diligenceCase) throw new Error("Diligência jurídica não encontrada nesta organização/empreendimento.");
  return diligenceCase;
}

/**
 * Correção focal pós-auditoria — idempotência estrutural (item 2). Os dois índices
 * únicos parciais reais (migration `20260911235000_phase_9s_legal_evidence_idempotency`)
 * são identificados aqui pelo CONJUNTO EXATO de colunas que o Postgres reporta em
 * `error.meta.target` — nunca por nome de índice (o Prisma reporta a lista de
 * colunas, não o nome da constraint, para índices criados fora do `schema.prisma`)
 * e nunca por "qualquer P2002" genérico. Qualquer outro P2002 (ex.: colisão de PK,
 * ou uma constraint futura não prevista aqui) propaga sem reclassificação.
 */
const REQUEST_IDENTITY_COLUMNS = ["organization_id", "project_id", "diligence_case_id", "document_request_id", "checksum"];
const CHECKLIST_IDENTITY_COLUMNS = ["organization_id", "project_id", "diligence_case_id", "checklist_item_id", "checksum"];

function isKnownIdentityConflict(error: unknown, columns: string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) && target.length === columns.length && columns.every((column) => target.includes(column));
}

function isTransientWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
function jitterDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 60)));
}

/** Retry limitado exclusivamente a `P2034` (conflito de serialização real, SSI) —
 * mesmo padrão de `recalculateExistingDraft` (9S). Uma recusa de negócio
 * (`LegalEvidenceConflictError`) nunca é reexecutada automaticamente, e qualquer
 * outro erro Prisma propaga imediatamente, sem retry. Nunca deixa persistência
 * parcial: se a transação abortar, nem o UPDATE nem o `AuditLog` ficam gravados. */
async function runWithSerializableRetry<T>(correlationId: string, actionLabel: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= DECISION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
    } catch (error) {
      if (error instanceof LegalEvidenceConflictError) throw error;
      if (!isTransientWriteConflict(error)) throw error;
      if (attempt === DECISION_MAX_ATTEMPTS) {
        throw new LegalEvidenceConflictError(`Não foi possível concluir ${actionLabel} após múltiplas tentativas — conflito de concorrência persistente.`, "CONCURRENCY_CONFLICT", correlationId);
      }
      await jitterDelay(attempt);
    }
  }
  throw new LegalEvidenceConflictError(`Não foi possível concluir ${actionLabel} após múltiplas tentativas — conflito de concorrência persistente.`, "CONCURRENCY_CONFLICT", correlationId);
}

export interface RegisterLegalEvidenceDocumentInput {
  projectId: string;
  diligenceCaseId: string;
  documentRequestId?: string | null;
  checklistItemId?: string | null;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

/**
 * Registra evidência jurídica canônica após storage seguro (item 5 da correção).
 * Vínculo exatamente único (`documentRequestId` XOR `checklistItemId`, reforçado
 * aqui além do CHECK/trigger da migration — defesa em profundidade) e confirmado
 * como pertencente à MESMA diligência antes de qualquer escrita (proteção IDOR).
 * Sempre nasce `PENDING_REVIEW` — a assinatura da função não aceita `status` do
 * chamador.
 *
 * Idempotência estrutural (correção focal pós-auditoria, item 2): a identidade
 * idempotente é organização+projeto+caso+vínculo jurídico+checksum, restrita às
 * linhas ainda ativas (`PENDING_REVIEW`/`VERIFIED`) — garantida por um dos dois
 * índices únicos parciais reais da migration
 * `20260911235000_phase_9s_legal_evidence_idempotency`, nunca só pela releitura
 * abaixo (achado real da auditoria anterior: um `findFirst` sozinho, sem
 * constraint, deixava 5 chamadas concorrentes idênticas criarem 5 linhas). A
 * releitura continua existindo como atalho para o caso comum (evita um
 * `storage.put` supérfluo quando não há corrida); a garantia real, sob
 * concorrência, é o `catch` de `P2002` abaixo, que só trata como retry idempotente
 * o conflito na constraint EXATA esperada — nunca um `P2002` genérico — e
 * devolve o registro vencedor em vez de inventar sucesso ou duplicar.
 * `REJECTED`/`REVOKED` ficam fora dos dois índices (estados terminais — reenviar
 * após rejeição/revogação é uma nova operação lógica, não um retry, e deve poder
 * criar uma nova linha `PENDING_REVIEW` — ver contrato §21.9/§22).
 */
export async function registerLegalEvidenceDocument(context: AuthContext, input: RegisterLegalEvidenceDocumentInput) {
  assertMutable(context);
  const diligenceCase = await diligenceCaseForTenant(context.organizationId, input.projectId, input.diligenceCaseId);

  const hasDocumentRequest = input.documentRequestId !== undefined && input.documentRequestId !== null;
  const hasChecklistItem = input.checklistItemId !== undefined && input.checklistItemId !== null;
  if (hasDocumentRequest === hasChecklistItem) {
    throw new Error("Informe exatamente um vínculo — solicitação documental OU item de checklist, nunca os dois ou nenhum.");
  }
  if (hasDocumentRequest) {
    const request = await prisma.legalDocumentRequest.findFirst({ where: { id: input.documentRequestId!, diligenceCaseId: diligenceCase.id } });
    if (!request) throw new Error("Solicitação documental não pertence a esta diligência jurídica.");
  }
  if (hasChecklistItem) {
    const item = await prisma.legalChecklistItem.findFirst({ where: { id: input.checklistItemId!, diligenceCaseId: diligenceCase.id } });
    if (!item) throw new Error("Item de checklist não pertence a esta diligência jurídica.");
  }

  const validated = validateDocumentUpload({ fileName: input.fileName, mimeType: input.mimeType, bytes: input.bytes });
  const inspection = await inspectUpload({ fileName: input.fileName, mimeType: validated.mimeType, bytes: input.bytes });

  const identityWhere = {
    organizationId: context.organizationId, projectId: input.projectId, diligenceCaseId: diligenceCase.id,
    documentRequestId: hasDocumentRequest ? input.documentRequestId! : null,
    checklistItemId: hasChecklistItem ? input.checklistItemId! : null,
    checksum: inspection.checksum,
    status: { in: ["PENDING_REVIEW", "VERIFIED"] as LegalEvidenceDocumentStatus[] },
  };

  const duplicate = await prisma.legalEvidenceDocument.findFirst({ where: identityWhere });
  if (duplicate) return duplicate;

  const stored = await legalEvidenceStorage.put({ organizationId: context.organizationId, packageId: diligenceCase.id, fileName: input.fileName, bytes: input.bytes });
  const correlationId = newCorrelationId();
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.legalEvidenceDocument.create({
        data: {
          organizationId: context.organizationId, projectId: input.projectId, diligenceCaseId: diligenceCase.id,
          documentRequestId: hasDocumentRequest ? input.documentRequestId! : null,
          checklistItemId: hasChecklistItem ? input.checklistItemId! : null,
          storageProvider: stored.provider, storageKey: stored.key, checksum: stored.checksum,
          contentType: validated.mimeType, sizeBytes: stored.size,
          uploadedById: context.userId, correlationId,
        },
      });
      await tx.auditLog.create({
        data: audit(context, input.projectId, "LEGAL_EVIDENCE_DOCUMENT_REGISTERED", created.id, {
          diligenceCaseId: diligenceCase.id, documentRequestId: created.documentRequestId, checklistItemId: created.checklistItemId,
          checksum: created.checksum, statusBefore: null, statusAfter: created.status,
        }, correlationId),
      });
      return created;
    });
  } catch (error) {
    const identityColumns = hasDocumentRequest ? REQUEST_IDENTITY_COLUMNS : CHECKLIST_IDENTITY_COLUMNS;
    if (isKnownIdentityConflict(error, identityColumns)) {
      const winner = await prisma.legalEvidenceDocument.findFirst({ where: identityWhere });
      if (winner) return winner;
      // Extremamente improvável (o vencedor decidiu — verify/reject/revoke — no intervalo
      // entre o P2002 e esta releitura, saindo do conjunto PENDING_REVIEW/VERIFIED) — nunca
      // inventa sucesso; propaga como erro genuíno para nova tentativa do chamador.
      throw new Error("Conflito de idempotência detectado, mas o registro concorrente não pôde ser localizado — tente novamente.");
    }
    throw error;
  }
}

/**
 * Transição comum de `PENDING_REVIEW` para `VERIFIED`/`REJECTED` (item 5:
 * verify/reject). CAS via `updateMany` condicionado a `id`+`organizationId`+
 * `status: "PENDING_REVIEW"` dentro de transação `Serializable` — TOCTOU-safe contra
 * outra revisão ou uma leitura de gate concorrente (mesmo padrão de
 * `recalculateExistingDraft`, 9S). Segregação de função (quem enviou não pode
 * revisar) verificada antes de qualquer escrita. Idempotente: reexecutar a MESMA
 * decisão pelo MESMO revisor retorna o registro já decidido em vez de conflitar;
 * qualquer outra tentativa de mudar um estado já decidido é recusada.
 */
async function decidePendingReviewEvidence(context: AuthContext, evidenceId: string, toStatus: "VERIFIED" | "REJECTED", action: string, reasonCode?: LegalEvidenceAuditReasonCode) {
  assertApprover(context);
  const correlationId = newCorrelationId();
  return runWithSerializableRetry(correlationId, action === "LEGAL_EVIDENCE_DOCUMENT_VERIFIED" ? "a verificação" : "a recusa", async (tx) => {
    const current = await tx.legalEvidenceDocument.findFirst({ where: { id: evidenceId, organizationId: context.organizationId } });
    if (!current) throw new Error("Evidência jurídica não encontrada nesta organização.");
    if (current.status === toStatus && current.reviewedById === context.userId) return current;
    if (current.status !== "PENDING_REVIEW") {
      throw new LegalEvidenceConflictError("Esta evidência não está mais pendente de revisão — outra operação já decidiu seu estado.", "NOT_PENDING_REVIEW", correlationId);
    }
    if (current.uploadedById === context.userId) {
      throw new LegalEvidenceConflictError("Quem enviou a evidência não pode revisá-la — segregação de função obrigatória.", "SELF_REVIEW_FORBIDDEN", correlationId);
    }
    const updated = await tx.legalEvidenceDocument.updateMany({
      where: { id: current.id, organizationId: context.organizationId, status: "PENDING_REVIEW" },
      data: { status: toStatus, reviewedById: context.userId, reviewedAt: new Date() },
    });
    if (updated.count !== 1) throw new LegalEvidenceConflictError("Esta evidência mudou de estado durante a revisão — outra operação a decidiu primeiro.", "CONCURRENCY_CONFLICT", correlationId);
    await tx.auditLog.create({
      data: audit(context, current.projectId, action, current.id, {
        diligenceCaseId: current.diligenceCaseId, documentRequestId: current.documentRequestId, checklistItemId: current.checklistItemId,
        checksum: current.checksum, statusBefore: "PENDING_REVIEW", statusAfter: toStatus, reasonCode,
      }, correlationId),
    });
    return tx.legalEvidenceDocument.findUniqueOrThrow({ where: { id: current.id } });
  });
}

/** Único caminho que permite `LegalEvidenceDocument` satisfazer o gate 9S (ver `gates.ts`).
 * `async` por simetria/defesa em profundidade com `rejectLegalEvidenceDocument` — garante
 * Promise rejeitada mesmo se um guard síncrono for adicionado aqui no futuro. */
export async function verifyLegalEvidenceDocument(context: AuthContext, evidenceId: string) {
  return decidePendingReviewEvidence(context, evidenceId, "VERIFIED", "LEGAL_EVIDENCE_DOCUMENT_VERIFIED");
}

/** `async` deliberado (não só um wrapper síncrono): garante que a recusa por motivo
 * vazio chegue ao chamador como Promise rejeitada, nunca como exceção síncrona —
 * mesma garantia que `registerLegalEvidenceDocument`/`revokeLegalEvidenceDocument`
 * já davam por serem `async function`. Bug real encontrado na autorrevisão
 * adversarial: com `function` simples, `rejectLegalEvidenceDocument(...).catch()`
 * nunca era alcançado — o `throw` escapava síncrono antes de existir qualquer Promise. */
export async function rejectLegalEvidenceDocument(context: AuthContext, evidenceId: string, reason: string) {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("Informe o motivo da recusa.");
  // `trimmedReason` só é usado para validar que o chamador informou algo — o
  // texto em si é descartado a partir daqui. `LegalChecklistItem`/
  // `LegalDocumentRequest` não têm coluna canônica de motivo de recusa (fora do
  // escopo desta correção); o `AuditLog` recebe só o código estático abaixo,
  // nunca o texto, hash ou fragmento do motivo (ver `audit()`/achado crítico).
  return decidePendingReviewEvidence(context, evidenceId, "REJECTED", "LEGAL_EVIDENCE_DOCUMENT_REJECTED", "LEGAL_EVIDENCE_REJECTION_REASON_PROVIDED");
}

/**
 * Revogação (item 4: ciclo de revogação) — única transição extra permitida após
 * `VERIFIED` (trigger `rede_legal_evidence_document_immutable`, protected-column-diff:
 * só `status`/`revoked_by_id`/`revoked_at`/`revoked_reason`/`updated_at` podem mudar).
 * O snapshot original (org/projeto/caso/vínculos/storage/checksum/upload/revisor)
 * nunca é sobrescrito — histórico explícito, nunca reescrita. CAS idêntico ao de
 * `decidePendingReviewEvidence`, mas condicionado a `status: "VERIFIED"`.
 */
export async function revokeLegalEvidenceDocument(context: AuthContext, evidenceId: string, reason: string) {
  assertApprover(context);
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("Informe o motivo da revogação.");
  const correlationId = newCorrelationId();
  return runWithSerializableRetry(correlationId, "a revogação", async (tx) => {
    const current = await tx.legalEvidenceDocument.findFirst({ where: { id: evidenceId, organizationId: context.organizationId } });
    if (!current) throw new Error("Evidência jurídica não encontrada nesta organização.");
    if (current.status === "REVOKED" && current.revokedById === context.userId) return current;
    if (current.status !== "VERIFIED") {
      throw new LegalEvidenceConflictError("Só evidência VERIFIED pode ser revogada.", "NOT_VERIFIED", correlationId);
    }
    const updated = await tx.legalEvidenceDocument.updateMany({
      where: { id: current.id, organizationId: context.organizationId, status: "VERIFIED" },
      data: { status: "REVOKED", revokedById: context.userId, revokedAt: new Date(), revokedReason: trimmedReason },
    });
    if (updated.count !== 1) throw new LegalEvidenceConflictError("Esta evidência mudou de estado durante a revogação — outra operação a decidiu primeiro.", "CONCURRENCY_CONFLICT", correlationId);
    // `trimmedReason` (texto livre) vai só para a coluna canônica `revoked_reason`
    // acima — protegida por trigger de imutabilidade, nunca reescrita. O
    // `AuditLog` recebe só o código estático abaixo, nunca o texto, hash ou
    // fragmento do motivo (ver `audit()`/achado crítico — `reasonRef` removido).
    await tx.auditLog.create({
      data: audit(context, current.projectId, "LEGAL_EVIDENCE_DOCUMENT_REVOKED", current.id, {
        diligenceCaseId: current.diligenceCaseId, documentRequestId: current.documentRequestId, checklistItemId: current.checklistItemId,
        checksum: current.checksum, statusBefore: "VERIFIED", statusAfter: "REVOKED", reasonCode: "LEGAL_EVIDENCE_REVOCATION_REASON_PROVIDED",
      }, correlationId),
    });
    return tx.legalEvidenceDocument.findUniqueOrThrow({ where: { id: current.id } });
  });
}

export interface LegalEvidenceQueryFilter {
  projectId: string;
  diligenceCaseId?: string;
  documentRequestId?: string;
  checklistItemId?: string;
  status?: "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "REVOKED";
}

/** Leitura protegida (`LEGAL_READ`, já existente — nenhuma capability nova) — sempre
 * escopada por `organizationId` do contexto, nunca por um valor informado pelo
 * chamador (proteção IDOR). */
export async function queryLegalEvidenceDocuments(context: Pick<AuthContext, "organizationId" | "role">, filter: LegalEvidenceQueryFilter) {
  assertProtectedReadCapability(context.role, "LEGAL_READ");
  return prisma.legalEvidenceDocument.findMany({
    where: {
      organizationId: context.organizationId,
      projectId: filter.projectId,
      ...(filter.diligenceCaseId ? { diligenceCaseId: filter.diligenceCaseId } : {}),
      ...(filter.documentRequestId ? { documentRequestId: filter.documentRequestId } : {}),
      ...(filter.checklistItemId ? { checklistItemId: filter.checklistItemId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
