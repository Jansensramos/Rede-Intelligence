import type {
  ApprovalPathItem,
  DataRoomCategory,
  DataRoomChecklistItemView,
  DataRoomCompleteness,
  InvestmentConditionView,
  InvestmentReadiness,
  InvestmentSnapshotBundle,
} from "./types";

export interface DefaultChecklistDefinition {
  code: string;
  category: DataRoomCategory;
  title: string;
  critical: boolean;
}

export const DEFAULT_DATA_ROOM_CHECKLIST: DefaultChecklistDefinition[] = [
  { code: "LAND_TITLE", category: "01_TERRENO", title: "Matrícula atualizada do terreno", critical: true },
  { code: "LAND_CONTROL", category: "01_TERRENO", title: "Instrumento de controle ou aquisição do terreno", critical: true },
  { code: "ZONING_CERTIFICATE", category: "02_URBANISTICO", title: "Certidão e parâmetros urbanísticos vigentes", critical: true },
  { code: "URBAN_SOURCES", category: "02_URBANISTICO", title: "Fontes urbanísticas e legislação aplicável", critical: true },
  { code: "LEGAL_DD", category: "03_JURIDICO", title: "Due diligence jurídica", critical: true },
  { code: "CONCEPT_DESIGN", category: "04_PROJETOS", title: "Estudo de massa e projeto conceitual", critical: false },
  { code: "SITE_INVESTIGATION", category: "05_ENGENHARIA", title: "Sondagem e investigação do terreno", critical: true },
  { code: "COST_PLAN", category: "06_ORCAMENTO", title: "Orçamento paramétrico com data-base", critical: true },
  { code: "MARKET_STUDY", category: "07_MERCADO", title: "Estudo de mercado e concorrência", critical: true },
  { code: "SALES_EVIDENCE", category: "08_COMERCIAL", title: "Evidência de preço e velocidade de vendas", critical: true },
  { code: "FINANCIAL_MODEL", category: "09_FINANCEIRO", title: "Modelo financeiro e memória de cálculo", critical: true },
  { code: "FUNDING_TERM", category: "10_FUNDING", title: "Estratégia ou term sheet de funding", critical: false },
  { code: "CORPORATE_STRUCTURE", category: "11_SOCIETARIO", title: "Estrutura societária proposta", critical: false },
  { code: "ENVIRONMENTAL_DD", category: "12_AMBIENTAL", title: "Due diligence ambiental", critical: true },
  { code: "COMMITTEE_PACK", category: "13_COMITE", title: "Pacote congelado para o comitê", critical: true },
];

const acceptedStatuses = new Set(["RECEIVED", "UNDER_REVIEW", "VERIFIED"]);

export function calculateDataRoomCompleteness(items: DataRoomChecklistItemView[]): DataRoomCompleteness {
  const categories = [...new Set(items.map((item) => item.category))].sort().map((category) => {
    const categoryItems = items.filter((item) => item.category === category && item.required);
    const received = categoryItems.filter((item) => acceptedStatuses.has(item.status)).length;
    return {
      category,
      score: categoryItems.length === 0 ? 100 : Math.round((received / categoryItems.length) * 100),
      received,
      total: categoryItems.length,
    };
  });
  const required = items.filter((item) => item.required);
  const received = required.filter((item) => acceptedStatuses.has(item.status)).length;
  const overall = required.length === 0 ? 0 : Math.round((received / required.length) * 100);
  return {
    overall,
    categories,
    warning: "Completude documental mede disponibilidade; não substitui validação jurídica, técnica ou urbanística.",
  };
}

export function calculateInvestmentReadiness(
  bundle: InvestmentSnapshotBundle,
  checklist: DataRoomChecklistItemView[],
  conditions: InvestmentConditionView[],
): InvestmentReadiness {
  const completeness = calculateDataRoomCompleteness(checklist);
  const redTeamBlockers = bundle.redTeam?.findings.filter((finding) =>
    finding.status !== "RESOLVED" && (finding.type === "DECISION_BLOCKER" || finding.severity === "CRITICAL"),
  ) ?? [];
  const criticalDocuments = checklist.filter((item) => item.required && item.critical && !acceptedStatuses.has(item.status));
  const conditionBlockers = conditions.filter((condition) => condition.isBlocker && !["VERIFIED", "WAIVED", "CLOSED"].includes(condition.status));
  const score = bundle.scores[bundle.scenario];
  const result = bundle.engineResults[bundle.scenario];
  const basePolicyBreaks = [
    Number(result.metrics.marginOnVgv) * 100 < Number(bundle.assumptions.policy.minimumMarginRate),
    result.metrics.roi === null || Number(result.metrics.roi) * 100 < Number(bundle.assumptions.policy.minimumRoiRate),
    result.metrics.annualIrr === null || Number(result.metrics.annualIrr) * 100 < Number(bundle.assumptions.policy.minimumIrrRate),
    Number(result.metrics.maximumCashExposure) > Number(bundle.assumptions.policy.maximumExposure),
  ].filter(Boolean).length;
  const urbanMissing = bundle.land?.regulatoryConfidence.missing ?? ["Snapshot urbanístico não vinculado"];

  const dimensions: InvestmentReadiness["dimensions"] = [
    { key: "FINANCIAL", score: Math.max(0, 100 - basePolicyBreaks * 22), evidenceRefs: [`engine:${bundle.studyVersionId}:${bundle.scenario}`], missing: basePolicyBreaks ? [`${basePolicyBreaks} política(s) financeira(s) não atendida(s)`] : [] },
    { key: "URBAN", score: bundle.land?.regulatoryConfidence.score ?? 0, evidenceRefs: bundle.land ? [`land:${bundle.landStudyVersionId}`] : [], missing: urbanMissing },
    { key: "LEGAL", score: categoryScore(completeness, "03_JURIDICO"), evidenceRefs: checklistRefs(checklist, "03_JURIDICO"), missing: categoryMissing(checklist, "03_JURIDICO") },
    { key: "ENGINEERING", score: average([categoryScore(completeness, "05_ENGENHARIA"), categoryScore(completeness, "06_ORCAMENTO")]), evidenceRefs: [...checklistRefs(checklist, "05_ENGENHARIA"), ...checklistRefs(checklist, "06_ORCAMENTO")], missing: [...categoryMissing(checklist, "05_ENGENHARIA"), ...categoryMissing(checklist, "06_ORCAMENTO")] },
    { key: "COMMERCIAL", score: average([categoryScore(completeness, "07_MERCADO"), categoryScore(completeness, "08_COMERCIAL")]), evidenceRefs: [...checklistRefs(checklist, "07_MERCADO"), ...checklistRefs(checklist, "08_COMERCIAL")], missing: [...categoryMissing(checklist, "07_MERCADO"), ...categoryMissing(checklist, "08_COMERCIAL")] },
    { key: "FUNDING", score: categoryScore(completeness, "10_FUNDING"), evidenceRefs: checklistRefs(checklist, "10_FUNDING"), missing: categoryMissing(checklist, "10_FUNDING") },
    { key: "DOCUMENTATION", score: completeness.overall, evidenceRefs: checklist.map((item) => `checklist:${item.id}`), missing: criticalDocuments.map((item) => item.title) },
    { key: "RISK", score: Math.max(0, Math.round((score.totalScore + (100 - redTeamBlockers.length * 25)) / 2)), evidenceRefs: [`score:${bundle.studyVersionId}:${bundle.scenario}`, ...(bundle.redTeamRunId ? [`redteam:${bundle.redTeamRunId}`] : [])], missing: redTeamBlockers.map((finding) => finding.title) },
  ];
  const blockers = [
    ...redTeamBlockers.map((finding) => finding.title),
    ...criticalDocuments.map((item) => `Documento crítico: ${item.title}`),
    ...conditionBlockers.map((condition) => `Condicionante: ${condition.title}`),
    ...(basePolicyBreaks ? [`${basePolicyBreaks} política(s) financeira(s) não atendida(s)`] : []),
  ];
  const weighted = Math.round(dimensions.reduce((total, dimension) => total + dimension.score, 0) / dimensions.length);
  return {
    score: weighted,
    dimensions,
    blockers: [...new Set(blockers)],
    label: blockers.length > 0 || weighted < 55 ? "NOT_READY" : weighted >= 80 ? "READY" : "PARTIALLY_READY",
  };
}

export function buildApprovalPath(bundle: InvestmentSnapshotBundle, conditions: InvestmentConditionView[]): ApprovalPathItem[] {
  const result = bundle.engineResults[bundle.scenario];
  const items: ApprovalPathItem[] = [];
  const policies = [
    { key: "margin", title: "Margem mínima", actual: Number(result.metrics.marginOnVgv) * 100, target: Number(bundle.assumptions.policy.minimumMarginRate), ref: `engine:${bundle.studyVersionId}:${bundle.scenario}:marginOnVgv` },
    { key: "roi", title: "ROI mínimo", actual: result.metrics.roi === null ? -Infinity : Number(result.metrics.roi) * 100, target: Number(bundle.assumptions.policy.minimumRoiRate), ref: `engine:${bundle.studyVersionId}:${bundle.scenario}:roi` },
    { key: "irr", title: "TIR mínima", actual: result.metrics.annualIrr === null ? -Infinity : Number(result.metrics.annualIrr) * 100, target: Number(bundle.assumptions.policy.minimumIrrRate), ref: `engine:${bundle.studyVersionId}:${bundle.scenario}:annualIrr` },
  ];
  policies.forEach((policy) => items.push({
    id: `policy-${policy.key}`,
    title: policy.title,
    source: "POLICY",
    evidenceRef: policy.ref,
    target: `${policy.target.toFixed(1)}%`,
    blocker: policy.actual < policy.target,
    resolved: policy.actual >= policy.target,
  }));
  bundle.sensitivity.breakEvens.forEach((breakEven) => items.push({
    id: `break-even-${breakEven.key}`,
    title: breakEven.label,
    source: "BREAK_EVEN",
    evidenceRef: `sensitivity:${bundle.studyVersionId}:break-even:${breakEven.key}`,
    target: breakEven.status === "FOUND" ? `${breakEven.value}${breakEven.unit === "MONTHS" ? " meses" : "%"}` : breakEven.status,
    blocker: breakEven.status === "BASE_FAILS_POLICY",
    resolved: breakEven.status === "FOUND",
  }));
  bundle.redTeam?.conclusion.whatWouldChangeDecision.forEach((change, index) => items.push({
    id: `redteam-${change.key || index}`,
    title: change.action,
    source: "RED_TEAM",
    evidenceRef: change.evidenceRefs[0] ?? `redteam:${bundle.redTeamRunId}`,
    target: change.target,
    blocker: true,
    resolved: false,
  }));
  conditions.forEach((condition) => items.push({
    id: `condition-${condition.id}`,
    title: condition.title,
    source: "CONDITION",
    evidenceRef: `condition:${condition.id}`,
    target: condition.evidenceRequired,
    blocker: condition.isBlocker,
    resolved: ["VERIFIED", "WAIVED", "CLOSED"].includes(condition.status),
  }));
  return items;
}

function average(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function categoryScore(completeness: DataRoomCompleteness, category: DataRoomCategory): number {
  return completeness.categories.find((item) => item.category === category)?.score ?? 0;
}

function checklistRefs(items: DataRoomChecklistItemView[], category: DataRoomCategory): string[] {
  return items.filter((item) => item.category === category).map((item) => `checklist:${item.id}`);
}

function categoryMissing(items: DataRoomChecklistItemView[], category: DataRoomCategory): string[] {
  return items.filter((item) => item.category === category && item.required && !acceptedStatuses.has(item.status)).map((item) => item.title);
}
