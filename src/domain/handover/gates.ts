/**
 * Fase 9R — regras puras dos gates de entrega (técnico/jurídico/financeiro), SLA e
 * reincidência de assistência. Nenhuma consulta a banco aqui: a camada de aplicação
 * busca os fatos (vistoria, licenças 9D, parcelas, repasses) e passa só o necessário.
 *
 * Gate jurídico: decisão aprovada da 9R — consome `LegalLicense` (9D) como fonte
 * oficial, sem duplicar checklist ou regra jurídica. Ausência de licença cadastrada
 * nunca é tratada como aprovação (convenção `SEM_EVIDENCIA` já usada em 9I/9M/9K.4A).
 */

export type GateStatus = "APTO" | "PENDENTE" | "SEM_EVIDENCIA";

export type SalesInspectionOutcomeInput = "ACCEPTED" | "ACCEPTED_WITH_PENDING" | "REJECTED";

/**
 * Achado Alto da reauditoria 9R (corrigido): o chamador deve resolver a vistoria
 * MAIS RECENTE da venda (ordenada por scheduledAt, createdAt, id — determinístico,
 * nunca "qualquer vistoria aceita alguma vez") e repassar só ela aqui. Esta função
 * nunca procura uma aprovação antiga como fallback — só olha para o resultado dessa
 * única vistoria (ou a ausência dela).
 */
export interface TechnicalGateInput {
  mostRecentInspection: { id: string; outcome: SalesInspectionOutcomeInput | null; nextInspectionAt: Date | null } | null;
}

export interface TechnicalGateOutcome extends GateOutcome {
  /** Referência segura (id) da vistoria usada na decisão — nunca o conteúdo do checklist/pendências. */
  snapshot: { inspectionId: string | null };
}

export type LegalLicenseStatusInput =
  | "NOT_STARTED" | "IN_PREPARATION" | "SUBMITTED" | "UNDER_REVIEW"
  | "APPROVED" | "APPROVED_WITH_CONDITIONS" | "REJECTED" | "SUSPENDED"
  | "EXPIRED" | "RENEWAL_REQUIRED";

export interface LegalGateInput {
  licenses: Array<{ id: string; status: LegalLicenseStatusInput }>;
}

export interface FinancialGateInput {
  overdueInstallmentCount: number;
  pendingDisbursementCount: number;
}

export interface GateOutcome {
  status: GateStatus;
  reason: string;
}

export interface LegalGateOutcome extends GateOutcome {
  /** Resultado agregado e snapshot auditável — nunca o checklist/regra jurídica em si (decisão 4 do contrato). */
  snapshot: { licenseCount: number; blockingCount: number; blockingLicenseIds: string[] };
}

export interface DeliveryGateResult {
  technical: TechnicalGateOutcome;
  legal: LegalGateOutcome;
  financial: GateOutcome;
  overall: "APTO" | "BLOQUEADO";
}

function evaluateTechnicalGate(input: TechnicalGateInput): TechnicalGateOutcome {
  const inspection = input.mostRecentInspection;
  if (!inspection) {
    return { status: "SEM_EVIDENCIA", reason: "Nenhuma vistoria registrada para esta venda — ausência de evidência nunca é tratada como aprovação.", snapshot: { inspectionId: null } };
  }
  if (inspection.outcome === "REJECTED") {
    return { status: "PENDENTE", reason: "A vistoria mais recente foi rejeitada.", snapshot: { inspectionId: inspection.id } };
  }
  if (inspection.outcome === null) {
    return { status: "PENDENTE", reason: "A vistoria mais recente ainda não tem resultado registrado.", snapshot: { inspectionId: inspection.id } };
  }
  // ACCEPTED_WITH_PENDING só libera se não houver reinspeção de acompanhamento ainda em
  // aberto (nextInspectionAt) — a regra existente (9E) já tratava ACCEPTED_WITH_PENDING
  // como suficiente por si só; aqui só fechamos a lacuna de uma pendência que o próprio
  // inspetor marcou como exigindo nova verificação e essa verificação ainda não ocorreu
  // (nesse caso a vistoria de acompanhamento, quando registrada, passa a ser a mais
  // recente e é ela — não esta — que decide o gate).
  if (inspection.outcome === "ACCEPTED_WITH_PENDING" && inspection.nextInspectionAt !== null) {
    return { status: "PENDENTE", reason: "A vistoria mais recente foi aceita com pendências e uma reinspeção de acompanhamento ainda está em aberto.", snapshot: { inspectionId: inspection.id } };
  }
  return { status: "APTO", reason: "A vistoria mais recente foi aceita.", snapshot: { inspectionId: inspection.id } };
}

const BLOCKING_LICENSE_STATUSES = new Set<LegalLicenseStatusInput>(["NOT_STARTED", "IN_PREPARATION", "SUBMITTED", "UNDER_REVIEW", "REJECTED", "SUSPENDED", "EXPIRED", "RENEWAL_REQUIRED"]);

function evaluateLegalGate(input: LegalGateInput): LegalGateOutcome {
  if (input.licenses.length === 0) {
    return {
      status: "SEM_EVIDENCIA",
      reason: "Nenhuma licença (9D) registrada para este empreendimento — ausência de evidência nunca é tratada como aprovação.",
      snapshot: { licenseCount: 0, blockingCount: 0, blockingLicenseIds: [] },
    };
  }
  const blocking = input.licenses.filter((license) => BLOCKING_LICENSE_STATUSES.has(license.status));
  if (blocking.length > 0) {
    return {
      status: "PENDENTE",
      reason: `${blocking.length} licença(s) do empreendimento sem aprovação (9D).`,
      snapshot: { licenseCount: input.licenses.length, blockingCount: blocking.length, blockingLicenseIds: blocking.map((license) => license.id) },
    };
  }
  return {
    status: "APTO",
    reason: "Todas as licenças do empreendimento aprovadas (9D).",
    snapshot: { licenseCount: input.licenses.length, blockingCount: 0, blockingLicenseIds: [] },
  };
}

function evaluateFinancialGate(input: FinancialGateInput): GateOutcome {
  const reasons: string[] = [];
  if (input.overdueInstallmentCount > 0) reasons.push(`${input.overdueInstallmentCount} parcela(s) vencida(s) em aberto`);
  if (input.pendingDisbursementCount > 0) reasons.push(`${input.pendingDisbursementCount} repasse(s) bancário(s) não conciliado(s)`);
  if (reasons.length > 0) return { status: "PENDENTE", reason: `${reasons.join("; ")}.` };
  return { status: "APTO", reason: "Sem parcelas vencidas e todos os repasses conciliados." };
}

/** "Apta à entrega" combina as três leituras — nunca uma nova máquina de estados cross-domain. */
export function evaluateDeliveryGate(input: { technical: TechnicalGateInput; legal: LegalGateInput; financial: FinancialGateInput }): DeliveryGateResult {
  const technical = evaluateTechnicalGate(input.technical);
  const legal = evaluateLegalGate(input.legal);
  const financial = evaluateFinancialGate(input.financial);
  const overall = technical.status === "APTO" && legal.status === "APTO" && financial.status === "APTO" ? "APTO" : "BLOQUEADO";
  return { technical, legal, financial, overall };
}

// ---------------------------------------------------------------------------
// Assistência técnica — SLA e reincidência
// ---------------------------------------------------------------------------

export type PostSaleStatusInput = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
const OPEN_POST_SALE_STATUSES = new Set<PostSaleStatusInput>(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"]);

export interface PostSaleSlaInput {
  slaDueAt: Date | null;
  status: PostSaleStatusInput;
  now: Date;
}

/** Violação de SLA é sempre derivada (slaDueAt + status), nunca persistida — evita uma segunda fonte de verdade que pudesse divergir do estado real do chamado. */
export function evaluatePostSaleSla(input: PostSaleSlaInput): { violated: boolean } {
  if (!input.slaDueAt) return { violated: false };
  if (!OPEN_POST_SALE_STATUSES.has(input.status)) return { violated: false };
  return { violated: input.slaDueAt.getTime() < input.now.getTime() };
}

/** Reincidência só é válida entre chamados da mesma unidade, nunca autorreferente. */
export function isValidPostSaleRecurrence(input: { currentId: string; currentSalesUnitId: string; previousId: string; previousSalesUnitId: string }): { valid: boolean; reason?: string } {
  if (input.previousId === input.currentId) return { valid: false, reason: "Um chamado não pode ser reincidência de si mesmo." };
  if (input.previousSalesUnitId !== input.currentSalesUnitId) return { valid: false, reason: "A reincidência precisa ser de um chamado da mesma unidade." };
  return { valid: true };
}
