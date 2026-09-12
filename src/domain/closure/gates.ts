/**
 * Fase 9S — regras puras do gate de encerramento do empreendimento (operacional,
 * contratual/obra, jurídico, financeiro, contábil) e da elegibilidade de assistência
 * técnica impeditiva. Nenhuma consulta a banco aqui: a camada de aplicação busca os
 * fatos (unidades, condomínio, chamados, obrigações, obrigações fiscais, períodos
 * contábeis) e passa só o necessário. Mesmo formato do gate de entrega da 9R
 * (`src/domain/handover/gates.ts`) — copiado deliberadamente, não redesenhado.
 */

export type GateStatus = "APTO" | "PENDENTE" | "SEM_EVIDENCIA";

export interface GateOutcome {
  status: GateStatus;
  reason: string;
}

// ---------------------------------------------------------------------------
// Assistência técnica impeditiva (decisão 4 da Fase 9S)
// ---------------------------------------------------------------------------

export type PostSaleCategoryInput = "GARANTIA" | "ASSISTENCIA" | "OCORRENCIA" | "OUTRO";
export type PostSaleStatusInput = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";

const OPEN_POST_SALE_STATUSES = new Set<PostSaleStatusInput>(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"]);
const RESOLVED_POST_SALE_STATUSES = new Set<PostSaleStatusInput>(["RESOLVED", "CLOSED"]);
/** Categorias que bloqueiam só por estarem abertas (decisão 4, primeiro item) — ASSISTENCIA/OUTRO só bloqueiam pelas regras genéricas abaixo, nunca só por estarem abertas (mesmo tratamento explícito dado a OUTRO no texto da decisão). */
const INHERENTLY_BLOCKING_CATEGORIES = new Set<PostSaleCategoryInput>(["GARANTIA", "OCORRENCIA"]);

export interface PostSaleImpedimentInput {
  id: string;
  category: PostSaleCategoryInput;
  status: PostSaleStatusInput;
  slaDueAt: Date | null;
  responsibleId: string | null;
  supplierId: string | null;
  recurrenceOfId: string | null;
  estimatedCost: string | null;
  actualCost: string | null;
  now: Date;
  /** Existe uma `AccountingProvision` `ACTIVE` vinculada a este chamado (convenção `economicIdentityKey = "post_sale_request:<id>"`) — a provisão em si já carrega evidência e é o resultado de um fluxo contábil aprovado. */
  hasActiveProvision: boolean;
  /** `MaterialityPolicy.absoluteThreshold` da organização; `null` = nenhuma política ativa — falha fechado (qualquer custo > 0 sem provisão é material). */
  materialityThreshold: string | null;
}

export interface PostSaleImpedimentOutcome {
  impeditive: boolean;
  reasons: string[];
  /** `true` quando o chamado seria impeditivo mas foi formalmente provisionado (decisão 4, cláusula de exceção) — deixa de bloquear, mas continua auditável via `reasons`. */
  formallyProvisioned: boolean;
}

/**
 * Só deixa de bloquear quando formalmente provisionado: provisão ativa (evidência +
 * fluxo de aprovação contábil já embutidos em `AccountingProvision`) **e**
 * responsável ou fornecedor atribuído **e** custo informado **e** prazo (`slaDueAt`)
 * definido — os 5 elementos exigidos pela decisão 4 ("responsável/fornecedor, custo,
 * prazo, evidência e aprovação").
 */
export function evaluatePostSaleImpediment(input: PostSaleImpedimentInput): PostSaleImpedimentOutcome {
  const reasons: string[] = [];
  const isOpen = OPEN_POST_SALE_STATUSES.has(input.status);
  const isResolved = RESOLVED_POST_SALE_STATUSES.has(input.status);

  if (isOpen && INHERENTLY_BLOCKING_CATEGORIES.has(input.category)) {
    reasons.push(`Chamado de categoria ${input.category} ainda aberto.`);
  }
  if (input.slaDueAt && input.slaDueAt.getTime() < input.now.getTime() && !isResolved) {
    reasons.push("SLA vencido sem resolução registrada.");
  }
  if (input.recurrenceOfId && !isResolved) {
    reasons.push("Reincidência de um chamado anterior ainda não resolvida.");
  }
  if (isOpen && !input.responsibleId && !input.supplierId) {
    reasons.push("Nenhum responsável ou fornecedor atribuído ao chamado.");
  }
  const cost = input.actualCost ?? input.estimatedCost;
  if (isOpen && cost !== null) {
    const costValue = Number(cost);
    const threshold = input.materialityThreshold !== null ? Number(input.materialityThreshold) : 0;
    const isMaterial = input.materialityThreshold !== null ? costValue >= threshold : costValue > 0;
    if (isMaterial && !input.hasActiveProvision) reasons.push("Custo material sem provisão contábil ativa.");
  }

  if (reasons.length === 0) return { impeditive: false, reasons: [], formallyProvisioned: false };

  const formallyProvisioned = input.hasActiveProvision
    && (input.responsibleId !== null || input.supplierId !== null)
    && cost !== null
    && input.slaDueAt !== null;

  return { impeditive: !formallyProvisioned, reasons, formallyProvisioned };
}

// ---------------------------------------------------------------------------
// Subgates do encerramento
// ---------------------------------------------------------------------------

export interface OperationalGateInput {
  /** Unidades vendidas (`SalesUnit.status = "VENDIDA"`) ainda não entregues — bloqueia se > 0. */
  unitsPendingDeliveryCount: number;
  /** Estado da implantação do condomínio; `null` = nenhum `CondominiumSetup` criado ainda. `CANCELLED` é usado deliberadamente como "não aplicável" (mesmo estado terminal, sem novo campo). */
  condominiumStatus: "PLANNED" | "IN_PROGRESS" | "IMPLEMENTED" | "CANCELLED" | null;
  impeditivePostSaleRequestIds: string[];
}
export interface OperationalGateOutcome extends GateOutcome {
  snapshot: { unitsPendingDeliveryCount: number; condominiumStatus: string | null; impeditivePostSaleRequestIds: string[] };
}

function evaluateOperationalGate(input: OperationalGateInput): OperationalGateOutcome {
  const snapshot = { unitsPendingDeliveryCount: input.unitsPendingDeliveryCount, condominiumStatus: input.condominiumStatus, impeditivePostSaleRequestIds: input.impeditivePostSaleRequestIds };
  if (input.unitsPendingDeliveryCount > 0) {
    return { status: "PENDENTE", reason: `${input.unitsPendingDeliveryCount} unidade(s) vendida(s) ainda não entregue(s).`, snapshot };
  }
  if (input.impeditivePostSaleRequestIds.length > 0) {
    return { status: "PENDENTE", reason: `${input.impeditivePostSaleRequestIds.length} chamado(s) de assistência técnica impeditivo(s) em aberto.`, snapshot };
  }
  if (input.condominiumStatus === null) {
    return { status: "SEM_EVIDENCIA", reason: "Nenhuma implantação de condomínio registrada — ausência de evidência nunca é tratada como aprovação.", snapshot };
  }
  if (input.condominiumStatus !== "IMPLEMENTED" && input.condominiumStatus !== "CANCELLED") {
    return { status: "PENDENTE", reason: "A implantação do condomínio ainda não chegou a um estado terminal.", snapshot };
  }
  return { status: "APTO", reason: "Unidades entregues, condomínio implantado (ou marcado não aplicável) e assistência sem pendência impeditiva.", snapshot };
}

export interface ContractualGateInput {
  /** `OperationalContract` do projeto sem status terminal e sem provisão associada. */
  openContractIds: string[];
}
export interface ContractualGateOutcome extends GateOutcome {
  snapshot: { openContractIds: string[] };
}

function evaluateContractualGate(input: ContractualGateInput): ContractualGateOutcome {
  const snapshot = { openContractIds: input.openContractIds };
  if (input.openContractIds.length > 0) {
    return { status: "PENDENTE", reason: `${input.openContractIds.length} contrato(s) operacional(is) sem encerramento nem provisão.`, snapshot };
  }
  return { status: "APTO", reason: "Nenhum contrato operacional em aberto sem provisão.", snapshot };
}

export type LegalObligationStatusInput = "DRAFT" | "ACTIVE" | "DUE_SOON" | "OVERDUE" | "FULFILLED" | "WAIVED" | "CANCELLED";
const LEGAL_OBLIGATION_TERMINAL_STATUSES = new Set<LegalObligationStatusInput>(["FULFILLED", "WAIVED", "CANCELLED"]);

/** Enum real compartilhado por `LegalChecklistItem` e `LegalDocumentRequest` no schema — os dois modelos usam `LegalItemStatus`, mas cada um é avaliado por regras próprias abaixo (correção focal final — achado Alto: `CANCELLED` nunca é evidência positiva por si só). */
export type LegalItemStatusInput = "NOT_STARTED" | "REQUESTED" | "RECEIVED" | "UNDER_REVIEW" | "COMPLIANT" | "NON_COMPLIANT" | "WAIVED" | "EXPIRED" | "RESOLVED" | "CANCELLED";

export type LegalCriticalityInput = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
/** Criticidades cuja obrigação é considerada estrutural o bastante para exigir prova
 * canônica (`LegalEvidenceDocument` `VERIFIED`) mesmo quando o item já está
 * `COMPLIANT`/`WAIVED` — item 6 da correção estrutural final ("evidência deve ser
 * exigida quando o item/criticidade indicar obrigatoriedade"). `LOW`/`MEDIUM`
 * preservam a semântica anterior (não exigem documento canônico). */
const CRITICALITIES_REQUIRING_CANONICAL_EVIDENCE = new Set<LegalCriticalityInput>(["HIGH", "CRITICAL"]);

export interface LegalChecklistItemInput {
  id: string;
  status: LegalItemStatusInput;
  criticality: LegalCriticalityInput;
  /** Campos reais de `LegalChecklistItem` — únicos que podem provar uma dispensa formal auditável. */
  reviewedById: string | null;
  notes: string | null;
  /** Nunca mais consultado para decisão positiva (string livre legada, sem FK, sem
   * verificação) — preservado apenas para leitura/auditoria. Ver `hasVerifiedEvidence`. */
  evidenceDocumentIds: unknown;
  /** `true` quando existe ao menos um `LegalEvidenceDocument` `VERIFIED` vinculado a
   * este item, na mesma organização/projeto/caso (calculado pela camada de aplicação
   * via consulta real ao banco — nunca inferido de `evidenceDocumentIds`). */
  hasVerifiedEvidence: boolean;
}
export interface LegalDocumentRequestInput {
  id: string;
  status: LegalItemStatusInput;
  /** Nunca mais consultado para decisão positiva (string livre legada, sem FK, sem
   * verificação) — preservado apenas para leitura/auditoria. Ver `hasVerifiedEvidence`. */
  documentLinkId: string | null;
  /** `true` quando existe ao menos um `LegalEvidenceDocument` `VERIFIED` vinculado a
   * esta solicitação, na mesma organização/projeto/caso (calculado pela camada de
   * aplicação via consulta real ao banco). Única prova aceita de atendimento. */
  hasVerifiedEvidence: boolean;
}

/**
 * Justificativa auditável real de uma dispensa (`WAIVED`) — correção focal final
 * (última correção, "evidência jurídica não pode ser string livre"): revisor
 * identificado (`reviewedById`) E nota não vazia (`notes`, texto persistido na
 * PRÓPRIA linha, não uma referência externa). `evidenceDocumentIds` foi REMOVIDO
 * desta checagem — mapeamento comprovado nesta correção: não existe, em todo o
 * schema/código, nenhuma entidade canônica de documento (`LegalAssetRegistration`,
 * `LegalDocumentRequest`, `LegalLicense` e `LegalGuarantee` compartilham o MESMO
 * campo `documentLinkId`/`sourceDocumentLinkId`/`evidenceDocumentIds` livre, sem FK,
 * nunca escrito nem lido por nenhum serviço de aplicação em todo o repositório).
 * Uma lista de IDs que não referencia nada verificável nunca é evidência — contá-la
 * seria inventar uma garantia que o schema não oferece.
 */
function hasAuditableWaiverJustification(reviewedById: string | null, notes: string | null): boolean {
  if (reviewedById === null) return false;
  return typeof notes === "string" && notes.trim().length > 0;
}

/**
 * `LegalChecklistItem` — correção estrutural final ("evidência jurídica canônica"):
 * `COMPLIANT` satisfaz incondicionalmente para criticidade `LOW`/`MEDIUM` (semântica
 * preexistente preservada), mas para `HIGH`/`CRITICAL` exige também um
 * `LegalEvidenceDocument` `VERIFIED` vinculado (`hasVerifiedEvidence`) — a obrigação
 * é considerada estrutural o bastante para exigir prova canônica, não bastando o
 * estado declarado. `WAIVED` sempre exige revisor identificado E nota de
 * justificativa não vazia (nunca por `evidenceDocumentIds` — ver nota acima) e,
 * quando a criticidade indica obrigatoriedade documental (`HIGH`/`CRITICAL`),
 * também exige `hasVerifiedEvidence`. `CANCELLED` nunca satisfaz automaticamente.
 * Qualquer outro valor (`NOT_STARTED`, `REQUESTED`, `RECEIVED`, `UNDER_REVIEW`,
 * `NON_COMPLIANT`, `EXPIRED`, `RESOLVED`, ou um valor desconhecido) falha fechado.
 */
function isChecklistItemSatisfied(item: LegalChecklistItemInput): boolean {
  const requiresCanonicalEvidence = CRITICALITIES_REQUIRING_CANONICAL_EVIDENCE.has(item.criticality);
  if (item.status === "COMPLIANT") return !requiresCanonicalEvidence || item.hasVerifiedEvidence;
  if (item.status === "WAIVED") {
    if (!hasAuditableWaiverJustification(item.reviewedById, item.notes)) return false;
    return !requiresCanonicalEvidence || item.hasVerifiedEvidence;
  }
  return false;
}

export type DocumentRequestClassification = "SATISFIED" | "PENDING" | "UNVERIFIABLE";

/**
 * `LegalDocumentRequest` — correção estrutural final ("evidência jurídica canônica").
 * `documentLinkId` continua sendo uma string opaca sem FK e NUNCA é consultada para
 * decisão positiva (ver correção focal anterior, preservada). Agora existe uma
 * entidade canônica real (`LegalEvidenceDocument`) que a camada de aplicação
 * consulta para determinar `hasVerifiedEvidence` — só um `LegalEvidenceDocument`
 * `VERIFIED`, vinculado a esta solicitação específica e com organização/projeto/caso
 * coincidentes (garantido estruturalmente por FK + trigger de validação na
 * migration, nunca reconferido aqui), conta como prova. `RECEIVED` com
 * `hasVerifiedEvidence` classifica como `"SATISFIED"` (único caminho positivo real);
 * `RECEIVED` sem evidência verificada classifica como `"UNVERIFIABLE"` (evidência
 * alegada, sem prova canônica — vira `SEM_EVIDENCIA` no agregador, nunca `APTO`);
 * qualquer outro estado classifica como `"PENDING"` (aberto/recusado/vencido/
 * cancelado/dispensado sem prova — vira `PENDENTE`).
 */
function classifyDocumentRequest(item: LegalDocumentRequestInput): DocumentRequestClassification {
  if (item.status === "RECEIVED") return item.hasVerifiedEvidence ? "SATISFIED" : "UNVERIFIABLE";
  return "PENDING";
}

/** Valores reais de `LegalDecisionStatus` (schema Prisma) — nenhum nome inventado. */
export type LegalDecisionValueInput = "PROCEED" | "PROCEED_WITH_CONDITIONS" | "HOLD" | "DO_NOT_PROCEED" | "INSUFFICIENT_EVIDENCE";

/**
 * `LegalDecision.conditions` é `Json` livre — não existe campo estrutural de
 * "condição resolvida" no schema. Convenção adotada (documentada no contrato,
 * seção "Correção pós-reauditoria REPROVADA"): uma condição só conta como
 * formalmente resolvida quando o item é um objeto com `resolved === true`.
 * Lista vazia/ausente é vacuamente satisfeita (nenhuma condição impeditiva).
 * Qualquer outra forma falha fechado (não conta como resolvida).
 */
function areLegalConditionsResolved(conditions: unknown): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every((item) => typeof item === "object" && item !== null && (item as Record<string, unknown>).resolved === true);
}

export interface LegalGateInput {
  obligations: Array<{ id: string; status: LegalObligationStatusInput }>;
  /** `LegalDueDiligenceCase` (código `SPE-ENCERRAMENTO-*`) do encerramento societário. `null` = nenhum aberto. */
  closureDiligenceCase: {
    id: string;
    status: "DRAFT" | "IN_PROGRESS" | "UNDER_REVIEW" | "COMPLETED" | "SUPERSEDED" | "CANCELLED";
    checklistItems: LegalChecklistItemInput[];
    documentRequests: LegalDocumentRequestInput[];
    /** Decisão jurídica mais recente do caso (maior `version`, desempatada por `createdAt`/`id` na consulta) — `null` quando nenhuma foi registrada. */
    latestDecision: { decision: LegalDecisionValueInput; conditions: unknown } | null;
  } | null;
}
export interface LegalGateOutcome extends GateOutcome {
  snapshot: {
    blockingObligationIds: string[];
    closureDiligenceCaseId: string | null;
    openChecklistItemIds: string[];
    pendingDocumentRequestIds: string[];
    /** Solicitações marcadas `RECEIVED` mas cuja evidência não pode ser verificada (nenhuma entidade canônica de documento existe hoje — ver `classifyDocumentRequest`). Nunca contribuem para `APTO`. */
    unverifiableDocumentRequestIds: string[];
  };
}

function evaluateLegalGate(input: LegalGateInput): LegalGateOutcome {
  const blocking = input.obligations.filter((obligation) => !LEGAL_OBLIGATION_TERMINAL_STATUSES.has(obligation.status));
  const diligenceCase = input.closureDiligenceCase;
  const openChecklistItemIds = diligenceCase ? diligenceCase.checklistItems.filter((item) => !isChecklistItemSatisfied(item)).map((item) => item.id) : [];
  const documentClassifications = diligenceCase ? diligenceCase.documentRequests.map((item) => ({ id: item.id, classification: classifyDocumentRequest(item) })) : [];
  const pendingDocumentRequestIds = documentClassifications.filter((item) => item.classification === "PENDING").map((item) => item.id);
  const unverifiableDocumentRequestIds = documentClassifications.filter((item) => item.classification === "UNVERIFIABLE").map((item) => item.id);
  const snapshot = {
    blockingObligationIds: blocking.map((obligation) => obligation.id),
    closureDiligenceCaseId: diligenceCase?.id ?? null,
    openChecklistItemIds,
    pendingDocumentRequestIds,
    unverifiableDocumentRequestIds,
  };

  if (blocking.length > 0) {
    return { status: "PENDENTE", reason: `${blocking.length} obrigação(ões) jurídica(s) fora de estado terminal.`, snapshot };
  }
  if (!diligenceCase) {
    return { status: "SEM_EVIDENCIA", reason: "Nenhum checklist de encerramento societário registrado — ausência de evidência nunca é tratada como aprovação.", snapshot };
  }
  if (diligenceCase.status !== "COMPLETED") {
    return { status: "PENDENTE", reason: "O checklist de encerramento societário ainda não está concluído.", snapshot };
  }
  if (openChecklistItemIds.length > 0) {
    return { status: "PENDENTE", reason: `${openChecklistItemIds.length} item(ns) do checklist de encerramento societário sem conclusão materialmente comprovada (conforme, ou dispensado com revisor e justificativa registrados).`, snapshot };
  }
  if (pendingDocumentRequestIds.length > 0) {
    return { status: "PENDENTE", reason: `${pendingDocumentRequestIds.length} solicitação(ões) documental(is) do encerramento societário ainda aberta(s), recusada(s), vencida(s) ou cancelada(s).`, snapshot };
  }
  if (unverifiableDocumentRequestIds.length > 0) {
    return { status: "SEM_EVIDENCIA", reason: `${unverifiableDocumentRequestIds.length} solicitação(ões) documental(is) marcada(s) como recebida(s) sem entidade de documento canônica para comprovar autenticidade/pertencimento — ausência de evidência verificável nunca é tratada como aprovação.`, snapshot };
  }
  const decision = diligenceCase.latestDecision;
  if (!decision) {
    return { status: "SEM_EVIDENCIA", reason: "Checklist de encerramento societário concluído sem decisão jurídica registrada — ausência de evidência nunca é tratada como aprovação.", snapshot };
  }
  if (decision.decision === "INSUFFICIENT_EVIDENCE") {
    return { status: "SEM_EVIDENCIA", reason: "A decisão jurídica mais recente do encerramento societário registrou evidência insuficiente para concluir a diligência.", snapshot };
  }
  if (decision.decision === "HOLD" || decision.decision === "DO_NOT_PROCEED") {
    return { status: "PENDENTE", reason: "A decisão jurídica mais recente do encerramento societário não autoriza prosseguir com o encerramento.", snapshot };
  }
  if (decision.decision === "PROCEED_WITH_CONDITIONS" && !areLegalConditionsResolved(decision.conditions)) {
    return { status: "PENDENTE", reason: "A decisão jurídica mais recente do encerramento societário está condicionada, com condição(ões) impeditiva(s) ainda não formalmente resolvida(s).", snapshot };
  }
  if (decision.decision !== "PROCEED" && decision.decision !== "PROCEED_WITH_CONDITIONS") {
    return { status: "PENDENTE", reason: "Valor de decisão jurídica não reconhecido para fins de encerramento — falha fechada.", snapshot };
  }
  return { status: "APTO", reason: "Nenhuma obrigação jurídica pendente, checklist e documentos do encerramento societário concluídos e decisão jurídica favorável ao encerramento.", snapshot };
}

export interface FinancialGateInput {
  overdueInstallmentCount: number;
  pendingDisbursementCount: number;
}
function evaluateFinancialGate(input: FinancialGateInput): GateOutcome {
  const reasons: string[] = [];
  if (input.overdueInstallmentCount > 0) reasons.push(`${input.overdueInstallmentCount} parcela(s) vencida(s) sem provisão/renegociação`);
  if (input.pendingDisbursementCount > 0) reasons.push(`${input.pendingDisbursementCount} repasse(s) bancário(s) não conciliado(s)`);
  if (reasons.length > 0) return { status: "PENDENTE", reason: `${reasons.join("; ")}.` };
  return { status: "APTO", reason: "Sem parcelas vencidas não provisionadas e todos os repasses conciliados ou cancelados." };
}

export type ClosurePeriodStatusInput = "OPEN" | "RECONCILING" | "CLOSED" | "REOPENED";
/** `VALID` = `LedgerSnapshot` (`CLOSING_TRIAL_BALANCE`) presente e com `checksum` igual ao `closeChecksum` gravado no fechamento do período — mesmo checksum escrito atomicamente por `closeAccountingPeriod` (`accounting-service.ts`), nunca recomputado aqui. `undefined` = período de uma fonte sem esse conceito estrutural (`FinancialPeriodClosure`, que não tem `LedgerSnapshot`) — não se inventa evidência que o schema não sustenta. */
export type LedgerEvidenceStateInput = "VALID" | "MISSING" | "INCONSISTENT";
export interface AccountingGateInput {
  /** `AccountingPeriod`/`FinancialPeriodClosure` relevantes do(s) `Company` do projeto. */
  periods: Array<{ id: string; status: ClosurePeriodStatusInput | "UNDER_REVIEW" | "ADJUSTMENT"; ledgerEvidence?: LedgerEvidenceStateInput }>;
}
export interface AccountingGateOutcome extends GateOutcome {
  snapshot: { openPeriodIds: string[]; missingLedgerEvidencePeriodIds: string[]; inconsistentLedgerEvidencePeriodIds: string[] };
}
function evaluateAccountingGate(input: AccountingGateInput): AccountingGateOutcome {
  const openPeriodIds = input.periods.filter((period) => period.status !== "CLOSED").map((period) => period.id);
  const missingLedgerEvidencePeriodIds = input.periods.filter((period) => period.ledgerEvidence === "MISSING").map((period) => period.id);
  const inconsistentLedgerEvidencePeriodIds = input.periods.filter((period) => period.ledgerEvidence === "INCONSISTENT").map((period) => period.id);
  const snapshot = { openPeriodIds, missingLedgerEvidencePeriodIds, inconsistentLedgerEvidencePeriodIds };

  if (input.periods.length === 0) return { status: "SEM_EVIDENCIA", reason: "Nenhum período contábil/financeiro encontrado para a(s) empresa(s) do projeto.", snapshot };
  if (openPeriodIds.length > 0) return { status: "PENDENTE", reason: `${openPeriodIds.length} período(s) contábil(is)/financeiro(s) ainda não fechado(s).`, snapshot };
  if (inconsistentLedgerEvidencePeriodIds.length > 0) {
    return { status: "PENDENTE", reason: `${inconsistentLedgerEvidencePeriodIds.length} período(s) contábil(is) fechado(s) com snapshot de balancete (LedgerSnapshot) inconsistente com o registro de fechamento — estado contraditório, falha fechada.`, snapshot };
  }
  if (missingLedgerEvidencePeriodIds.length > 0) {
    return { status: "SEM_EVIDENCIA", reason: `${missingLedgerEvidencePeriodIds.length} período(s) contábil(is) fechado(s) sem snapshot de balancete (LedgerSnapshot) registrado — ausência de evidência nunca é tratada como aprovação.`, snapshot };
  }
  return { status: "APTO", reason: "Todos os períodos contábeis/financeiros relevantes estão fechados, com balancete de fechamento íntegro onde exigido.", snapshot };
}

// ---------------------------------------------------------------------------
// Agregador — mesmo formato de `evaluateDeliveryGate` (9R)
// ---------------------------------------------------------------------------

export interface ProjectClosureGateResult {
  operational: OperationalGateOutcome;
  contractual: ContractualGateOutcome;
  legal: LegalGateOutcome;
  financial: GateOutcome;
  accounting: AccountingGateOutcome;
  overall: "APTO" | "BLOQUEADO";
}

export function evaluateProjectClosureGate(input: {
  operational: OperationalGateInput;
  contractual: ContractualGateInput;
  legal: LegalGateInput;
  financial: FinancialGateInput;
  accounting: AccountingGateInput;
}): ProjectClosureGateResult {
  const operational = evaluateOperationalGate(input.operational);
  const contractual = evaluateContractualGate(input.contractual);
  const legal = evaluateLegalGate(input.legal);
  const financial = evaluateFinancialGate(input.financial);
  const accounting = evaluateAccountingGate(input.accounting);
  const overall = [operational, contractual, legal, financial, accounting].every((gate) => gate.status === "APTO") ? "APTO" : "BLOQUEADO";
  return { operational, contractual, legal, financial, accounting, overall };
}
