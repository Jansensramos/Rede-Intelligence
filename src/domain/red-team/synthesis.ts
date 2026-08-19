import Decimal from "decimal.js";
import { analyzeRisk } from "@/domain/risk/rules";
import type {
  AssumptionChallenge,
  EvidenceRequest,
  ExecutiveRedTeamConclusion,
  RedTeamAgentKey,
  RedTeamCrossReview,
  RedTeamDisagreement,
  RedTeamEvidencePack,
  RedTeamFinding,
  RedTeamSeverity,
  WhatWouldChangeDecision,
} from "./types";

const severityRank: Record<RedTeamSeverity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export function sortFindings(findings: RedTeamFinding[]) {
  return [...findings].sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || left.id.localeCompare(right.id));
}

export function classifyAssumptions(pack: RedTeamEvidencePack): AssumptionChallenge[] {
  const configs = [
    { key: "unitPrice", missing: "market_study", ref: "ASSUMPTION.unitPrice" },
    { key: "salesVelocityUnitsMonth", missing: "market_study", ref: "ASSUMPTION.salesVelocityUnitsMonth" },
    { key: "constructionCostPerM2", missing: "detailed_budget", ref: "ASSUMPTION.constructionCostPerM2" },
    { key: "constructionMonths", missing: "construction_schedule", ref: "ASSUMPTION.constructionMonths" },
    { key: "landPrice", missing: "land_contract", ref: "ASSUMPTION.landPrice" },
    { key: "financingLimit", missing: "funding_term_sheet", ref: "ASSUMPTION.financingLimit" },
  ];
  return configs.map((config, index) => {
    const gap = pack.missingEvidence.find((item) => item.key === config.missing);
    const sensitivity = pack.sensitivity.ranking.find((item) => {
      if (config.key === "unitPrice") return item.variable === "SALE_PRICE";
      if (config.key === "salesVelocityUnitsMonth") return item.variable === "SALES_VELOCITY";
      if (config.key === "constructionCostPerM2") return item.variable === "CONSTRUCTION_COST";
      if (config.key === "constructionMonths") return item.variable === "CONSTRUCTION_DURATION";
      if (config.key === "landPrice") return item.variable === "LAND_COST";
      return item.variable === "FINANCING_COST";
    });
    return {
      id: `RTA-${String(index + 1).padStart(3, "0")}`,
      assumptionKey: config.key,
      classification: gap ? "UNSUPPORTED" : sensitivity && sensitivity.scoreImpact >= 10 ? "AGGRESSIVE" : "SUPPORTED",
      reason: gap ? `Premissa declarada sem ${gap.requestedDocument.toLowerCase()} anexado.` : sensitivity && sensitivity.scoreImpact >= 10 ? `Premissa suportada, porém com impacto potencial de ${sensitivity.scoreImpact} pontos no Score.` : "Premissa possui evidência identificável no pacote.",
      evidenceRefs: [config.ref, ...(gap ? [gap.evidenceRef] : []), ...(sensitivity ? [`SENSITIVITY.${sensitivity.variable}.WORST`] : [])],
    } satisfies AssumptionChallenge;
  });
}

export function buildEvidenceRequests(pack: RedTeamEvidencePack, findings: RedTeamFinding[]): EvidenceRequest[] {
  return pack.missingEvidence.map((item, index) => ({
    id: `RTE-${String(index + 1).padStart(3, "0")}`,
    category: item.category,
    requestedDocument: item.requestedDocument,
    reason: item.reason,
    priority: item.priority,
    relatedFindingId: findings.find((finding) => finding.evidenceRefs.includes(item.evidenceRef))?.id ?? null,
    evidenceRefs: [item.evidenceRef],
    status: "OPEN",
  }));
}

const reviewers: Record<RedTeamAgentKey, RedTeamAgentKey> = {
  FINANCE_FUNDING: "INVESTOR_CFO",
  ENGINEERING_COST: "DEVELOPER_OPERATOR",
  COMMERCIAL_MARKET: "FINANCE_FUNDING",
  LEGAL_STRUCTURING: "DEVELOPER_OPERATOR",
  INVESTOR_CFO: "FINANCE_FUNDING",
  DEVELOPER_OPERATOR: "ENGINEERING_COST",
};

export function crossReview(findings: RedTeamFinding[]): RedTeamCrossReview[] {
  return findings.filter((finding) => finding.severity === "HIGH" || finding.severity === "CRITICAL").map((finding, index) => {
    const reduce = finding.agent === "FINANCE_FUNDING" && finding.title.toLowerCase().includes("funding");
    return {
      id: `RTR-${String(index + 1).padStart(3, "0")}`,
      findingId: finding.id,
      originalAgent: finding.agent,
      reviewerAgent: reviewers[finding.agent],
      decision: reduce ? "REDUCE" : "CONFIRM",
      rationale: reduce ? "A operação pode mitigar parte do risco com faseamento e antecipação, mas isso ainda precisa ser demonstrado pelo Engine em nova versão." : "A evidência citada é suficiente para manter severidade e ação recomendada.",
    };
  });
}

export function detectDisagreements(findings: RedTeamFinding[], reviews: RedTeamCrossReview[]): RedTeamDisagreement[] {
  const finance = findings.find((finding) => finding.agent === "FINANCE_FUNDING" && finding.title.toLowerCase().includes("funding"));
  const operator = findings.find((finding) => finding.agent === "DEVELOPER_OPERATOR" && finding.type === "OPPORTUNITY");
  const reduced = finance && reviews.find((review) => review.findingId === finance.id && review.decision === "REDUCE");
  if (!finance || !operator || !reduced) return [];
  return [{
    id: "RTD-001",
    findingAId: finance.id,
    findingBId: operator.id,
    agents: [finance.agent, operator.agent],
    description: "Financeiro trata a falta de folga como risco material; Operações identifica flexibilidade comercial que poderia mitigar parte da pressão.",
    resolution: "A mitigação não foi incorporada ao Engine. O risco financeiro permanece aberto até uma nova StudyVersion demonstrar redução objetiva da exposição.",
    status: "RESOLVED",
  }];
}

function money(value: Decimal.Value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value));
}

function whatWouldChangeDecision(pack: RedTeamEvidencePack): WhatWouldChangeDecision[] {
  const items: WhatWouldChangeDecision[] = [];
  const exposure = new Decimal(pack.engineResult.metrics.maximumCashExposure);
  const exposureLimit = new Decimal(pack.assumptions.policy.maximumExposure);
  if (exposure.gt(exposureLimit)) items.push({ key: "REDUCE_EXPOSURE", action: "Reduzir o pico de exposição", target: `Redução mínima de ${money(exposure.minus(exposureLimit))}, até o limite de ${money(exposureLimit)}.`, evidenceRefs: ["ENGINE.maximumCashExposure", "POLICY.maximumExposure"] });
  const maxDebt = Decimal.max(...pack.engineResult.cashFlow.map((row) => new Decimal(row.outstandingDebt)), 0);
  const fundingLimit = new Decimal(pack.assumptions.financingLimit);
  if (maxDebt.gte(fundingLimit.times("0.9"))) items.push({ key: "FUNDING_HEADROOM", action: "Comprovar funding com folga", target: `Term sheet deve cobrir o pico de dívida de ${money(maxDebt)} e reserva para contingências.`, evidenceRefs: ["ASSUMPTION.financingLimit", "SCORE_RULE.CAPITAL_FUNDING", "MISSING_EVIDENCE.funding_term_sheet"] });
  const price = pack.sensitivity.breakEvens.find((item) => item.key === "SALE_PRICE");
  if (price?.status === "FOUND") {
    const floor = new Decimal(pack.assumptions.unitPrice).times(new Decimal(1).minus(price.value));
    items.push({ key: "PRICE_FLOOR", action: "Validar preço mínimo de proteção", target: `Preço médio não inferior a ${money(floor)} por unidade para preservar a margem mínima modelada.`, evidenceRefs: ["BREAK_EVEN.SALE_PRICE", "ASSUMPTION.unitPrice", "POLICY.minimumMarginRate"] });
  }
  const construction = pack.sensitivity.breakEvens.find((item) => item.key === "CONSTRUCTION_COST");
  if (construction?.status === "FOUND") {
    const ceiling = new Decimal(pack.assumptions.constructionCostPerM2).times(new Decimal(1).plus(construction.value));
    items.push({ key: "COST_CEILING", action: "Contratar obra dentro do teto", target: `Custo de obra não superior a ${money(ceiling)} por m² para preservar a margem mínima.`, evidenceRefs: ["BREAK_EVEN.CONSTRUCTION_COST", "ASSUMPTION.constructionCostPerM2", "POLICY.minimumMarginRate"] });
  }
  const delay = pack.sensitivity.breakEvens.find((item) => item.key === "SALES_START_DELAY");
  if (delay?.status === "FOUND") items.push({ key: "SALES_START_LIMIT", action: "Proteger o início das vendas", target: `Manter atraso acumulado em no máximo ${delay.value} meses para preservar VPL não negativo.`, evidenceRefs: ["BREAK_EVEN.SALES_START_DELAY", "ENGINE.npv"] });
  items.push({ key: "EVIDENCE_BASELINE", action: "Fechar diligência mínima", target: "Apresentar orçamento, mercado, terreno, aprovações, cronograma e funding antes da aprovação final.", evidenceRefs: pack.missingEvidence.slice(0, 6).map((item) => item.evidenceRef) });
  return items.slice(0, 6);
}

export function synthesizeConclusion(
  pack: RedTeamEvidencePack,
  findings: RedTeamFinding[],
  requests: EvidenceRequest[],
  disagreements: RedTeamDisagreement[],
): ExecutiveRedTeamConclusion {
  const sorted = sortFindings(findings);
  const critical = sorted.filter((finding) => finding.severity === "CRITICAL");
  const blockers = sorted.filter((finding) => finding.type === "DECISION_BLOCKER" || finding.type === "POLICY_BREACH");
  const financialLoss = Number(pack.engineResult.metrics.npv) < 0 || Number(pack.engineResult.metrics.profit) < 0;
  const decision = financialLoss ? "DO_NOT_ADVANCE" : blockers.some((finding) => finding.severity === "CRITICAL") ? "RESTRUCTURE" : requests.filter((request) => request.priority === "HIGH" || request.priority === "CRITICAL").length >= 4 ? "INSUFFICIENT_EVIDENCE" : sorted.some((finding) => finding.severity === "HIGH") ? "ADVANCE_WITH_CONDITIONS" : "ADVANCE";
  const objectiveCritical = critical.some((finding) => finding.type === "POLICY_BREACH" || finding.type === "DECISION_BLOCKER" || finding.evidenceRefs.some((ref) => ref.startsWith("ENGINE.") || ref.startsWith("SCORE_GATE.")));
  const confidence = decision === "INSUFFICIENT_EVIDENCE" ? "LOW" : objectiveCritical ? "HIGH" : "MEDIUM";
  const engineRecommendation = analyzeRisk(pack.engineResult);
  const enginePosition = `${engineRecommendation.label}: ${engineRecommendation.dominantReason}.`;
  const dominant = sorted[0];
  const requiredActions = Array.from(new Set(sorted.filter((finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH").map((finding) => finding.recommendedAction))).slice(0, 5);
  return {
    decision,
    confidence,
    dominantRisk: dominant?.title ?? "Nenhum risco material identificado",
    topFindingIds: sorted.slice(0, 5).map((finding) => finding.id),
    decisionBlockerIds: blockers.map((finding) => finding.id),
    requiredActions,
    evidenceRequestIds: requests.map((request) => request.id),
    disagreementIds: disagreements.map((item) => item.id),
    strengths: pack.score.explanation.strengths.slice(0, 3),
    mitigations: findings.filter((finding) => finding.type === "OPPORTUNITY").map((finding) => finding.recommendedAction).slice(0, 3),
    residualRisk: critical.length ? `${critical.length} finding(s) crítico(s) permanecem abertos; retorno elevado não elimina a fragilidade estrutural.` : "Riscos altos e lacunas documentais permanecem condicionantes da decisão.",
    whatWouldChangeDecision: whatWouldChangeDecision(pack),
    enginePosition,
    executiveSummary: `${decision}: ${dominant?.title ?? "análise sem blocker dominante"}. A posição objetiva do Engine permanece ${enginePosition}`,
  };
}
