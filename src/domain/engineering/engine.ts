export type CostEvidenceStatus = "VALIDATED_PRICE" | "COMPARABLE_HISTORICAL_PRICE" | "ESTIMATED_PRICE" | "NO_EVIDENCE";
export type ReviewDecision = "ACCEPTED" | "ADJUSTED" | "REJECTED" | "REVISION_REQUESTED";

export interface BudgetSourceSnapshot {
  quantity: { value: number; unit: string; origin: string; referenceId: string | null };
  composition: { id: string | null; key: string | null; version: number | null; checksum: string | null };
  price: { value: number | null; source: string | null; referenceId: string | null; observedAt: string | null; region: string | null; supplier: string | null };
  confidence: string;
  baseDate: string | null;
  normalization: { currency: string; sourceUnit: string; targetUnit: string; factor: number };
}

export interface SmartBudgetLineInput {
  quantity: number;
  unit: string;
  quantityOrigin: string;
  quantityReferenceId?: string | null;
  composition?: { id: string; key: string; version: number; checksum: string } | null;
  price?: { value: number; source: string; referenceId?: string | null; observedAt?: string | null; region?: string | null; supplier?: string | null; evidenceStatus: Exclude<CostEvidenceStatus, "NO_EVIDENCE"> } | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  baseDate?: string | null;
  normalization?: { currency: string; sourceUnit: string; targetUnit: string; factor: number };
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** Motor determinístico: não estima preço ausente e congela exatamente os inputs usados. */
export function calculateSmartBudgetLine(input: SmartBudgetLineInput) {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new Error("Quantidade inválida.");
  if (input.price && (!Number.isFinite(input.price.value) || input.price.value < 0)) throw new Error("Preço inválido.");
  const normalization = input.normalization ?? { currency: "BRL", sourceUnit: input.unit, targetUnit: input.unit, factor: 1 };
  if (!Number.isFinite(normalization.factor) || normalization.factor <= 0) throw new Error("Normalização inválida.");
  const unitCost = input.price ? round(input.price.value * normalization.factor, 4) : 0;
  const totalCost = round(input.quantity * unitCost, 2);
  const evidenceStatus: CostEvidenceStatus = input.price?.evidenceStatus ?? "NO_EVIDENCE";
  const snapshot: BudgetSourceSnapshot = {
    quantity: { value: input.quantity, unit: input.unit, origin: input.quantityOrigin, referenceId: input.quantityReferenceId ?? null },
    composition: input.composition ? { id: input.composition.id, key: input.composition.key, version: input.composition.version, checksum: input.composition.checksum } : { id: null, key: null, version: null, checksum: null },
    price: input.price ? { value: input.price.value, source: input.price.source, referenceId: input.price.referenceId ?? null, observedAt: input.price.observedAt ?? null, region: input.price.region ?? null, supplier: input.price.supplier ?? null } : { value: null, source: null, referenceId: null, observedAt: null, region: null, supplier: null },
    confidence: input.confidence,
    baseDate: input.baseDate ?? input.price?.observedAt ?? null,
    normalization,
  };
  return { unitCost, totalCost, evidenceStatus, snapshot };
}

export interface ApprovalGateLine {
  id: string;
  evidenceRequired: boolean;
  evidenceStatus: CostEvidenceStatus;
  sourceSnapshot: unknown;
  latestDecision: ReviewDecision | null;
}

export function evaluateAutoBudgetApprovalGate(lines: ApprovalGateLine[]) {
  const blockers: { lineId: string; reason: string }[] = [];
  if (lines.length === 0) blockers.push({ lineId: "proposal", reason: "A proposta não possui itens." });
  for (const line of lines) {
    if (!line.latestDecision) blockers.push({ lineId: line.id, reason: "Item pendente de revisão." });
    if (line.latestDecision === "REJECTED") blockers.push({ lineId: line.id, reason: "Item rejeitado." });
    if (line.latestDecision === "REVISION_REQUESTED") blockers.push({ lineId: line.id, reason: "Item com revisão solicitada." });
    if (line.evidenceRequired && line.evidenceStatus === "NO_EVIDENCE") blockers.push({ lineId: line.id, reason: "Item obrigatório sem evidência de preço." });
    if (!line.sourceSnapshot || typeof line.sourceSnapshot !== "object") blockers.push({ lineId: line.id, reason: "Snapshot de origem ausente." });
  }
  return { allowed: blockers.length === 0, blockers };
}

export interface CostCycleInput {
  economicItemId: string;
  code: string;
  description: string;
  budgeted: number;
  contracted: number;
  measured: number;
  realized: number;
  remainingEstimate?: number | null;
}

/** Cada estágio é uma perspectiva; nunca soma orçado+contratado+medido+realizado. */
export function buildCostCycleRow(input: CostCycleInput) {
  const openCommitment = Math.max(0, round(input.contracted - input.realized, 2));
  const finalProjected = input.remainingEstimate == null ? null : round(input.realized + openCommitment + input.remainingEstimate, 2);
  return {
    ...input,
    deltaBudgetContracted: round(input.contracted - input.budgeted, 2),
    deltaContractedMeasured: round(input.measured - input.contracted, 2),
    deltaMeasuredRealized: round(input.realized - input.measured, 2),
    deltaBudgetRealized: round(input.realized - input.budgeted, 2),
    openCommitment,
    finalProjected,
    projectedDeviation: finalProjected == null ? null : round(finalProjected - input.budgeted, 2),
  };
}

export function compareValueEngineeringAlternatives<T extends { name: string; cost: number | null; scheduleMonths: number | null; risk: string; technicalImpact: string }>(alternatives: T[]) {
  return alternatives.map((item) => ({ ...item, decision: null as null, humanDecisionRequired: true as const }));
}
