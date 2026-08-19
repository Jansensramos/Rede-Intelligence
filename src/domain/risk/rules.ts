import Decimal from "decimal.js";
import type { FinancialResult } from "../financial/types";

export type FindingSeverity = "critical" | "warning" | "positive";
export type RecommendationStatus = "NAO_AVANCAR" | "AVANCAR_COM_AJUSTES" | "AVANCAR";

export interface RiskFinding {
  id: string;
  severity: FindingSeverity;
  category: "financeiro" | "comercial" | "engenharia" | "governanca";
  title: string;
  evidence: string;
  action: string;
  classification: "fato" | "calculo" | "premissa";
  metric?: string;
  actualValue?: string;
  thresholdValue?: string;
}

export interface ProjectRecommendation {
  status: RecommendationStatus;
  label: string;
  dominantReason: string;
  findings: RiskFinding[];
}

const pct = (value: string | null) => value === null ? null : new Decimal(value).times(100);
const brl = (value: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value));

export function analyzeRisk(result: FinancialResult): ProjectRecommendation {
  const { metrics, assumptions } = result;
  const findings: RiskFinding[] = [];
  const margin = pct(metrics.marginOnVgv)!;
  const roi = pct(metrics.roi);
  const irr = pct(metrics.annualIrr);
  const exposure = new Decimal(metrics.maximumCashExposure);

  if (margin.lt(assumptions.policy.minimumMarginRate)) {
    findings.push({ id: "policy-margin", severity: "critical", category: "financeiro", title: "Margem abaixo da política", evidence: `Margem de ${margin.toFixed(1)}% contra mínimo de ${assumptions.policy.minimumMarginRate}%.`, action: "Reprecificar produto, renegociar terreno ou reduzir custo de obra antes de avançar.", classification: "calculo", metric: "marginOnVgv", actualValue: margin.toString(), thresholdValue: assumptions.policy.minimumMarginRate });
  } else {
    findings.push({ id: "policy-margin-ok", severity: "positive", category: "financeiro", title: "Margem atende à política", evidence: `Margem de ${margin.toFixed(1)}% para mínimo de ${assumptions.policy.minimumMarginRate}%.`, action: "Preservar a folga nos próximos refinamentos.", classification: "calculo", metric: "marginOnVgv", actualValue: margin.toString(), thresholdValue: assumptions.policy.minimumMarginRate });
  }

  if (exposure.gt(assumptions.policy.maximumExposure)) {
    findings.push({ id: "policy-exposure", severity: "critical", category: "financeiro", title: "Exposição acima do limite", evidence: `${brl(metrics.maximumCashExposure)} no mês ${metrics.maximumExposureMonth}, acima da política de ${brl(assumptions.policy.maximumExposure)}.`, action: "Aumentar funding, escalonar o terreno ou antecipar recebimentos.", classification: "calculo", metric: "maximumCashExposure", actualValue: metrics.maximumCashExposure, thresholdValue: assumptions.policy.maximumExposure });
  }

  if (roi === null || roi.lt(assumptions.policy.minimumRoiRate)) {
    findings.push({ id: "policy-roi", severity: "warning", category: "financeiro", title: "ROI não remunera a política", evidence: roi ? `ROI de ${roi.toFixed(1)}% contra mínimo de ${assumptions.policy.minimumRoiRate}%.` : "ROI não calculável por ausência de capital próprio negativo no fluxo.", action: "Revisar a relação entre funding, lucro e capital próprio exposto.", classification: "calculo", metric: "roi", actualValue: roi?.toString(), thresholdValue: assumptions.policy.minimumRoiRate });
  }

  if (irr === null || irr.lt(assumptions.policy.minimumIrrRate)) {
    findings.push({ id: "policy-irr", severity: "warning", category: "financeiro", title: "TIR abaixo da meta", evidence: irr ? `TIR anual de ${irr.toFixed(1)}% contra meta de ${assumptions.policy.minimumIrrRate}%.` : "O fluxo não tem sinais adequados para calcular a TIR.", action: "Reduzir o ciclo de caixa ou melhorar a geração de caixa antecipada.", classification: "calculo", metric: "annualIrr", actualValue: irr?.toString(), thresholdValue: assumptions.policy.minimumIrrRate });
  }

  if (new Decimal(assumptions.contingencyRate).lt(assumptions.policy.minimumContingencyRate)) {
    findings.push({ id: "contingency", severity: "critical", category: "engenharia", title: "Contingência insuficiente", evidence: `Premissa de ${assumptions.contingencyRate}% contra mínimo de ${assumptions.policy.minimumContingencyRate}%.`, action: "Recompor a contingência antes da aprovação do investimento.", classification: "premissa", metric: "contingencyRate", actualValue: assumptions.contingencyRate, thresholdValue: assumptions.policy.minimumContingencyRate });
  }

  if (metrics.salesEndMonth > metrics.deliveryMonth) {
    findings.push({ id: "post-delivery-stock", severity: "warning", category: "comercial", title: "Estoque após a entrega", evidence: `As vendas terminam no mês ${metrics.salesEndMonth}, após a entrega no mês ${metrics.deliveryMonth}.`, action: "Validar absorção e custo de carregamento do estoque pronto.", classification: "calculo", metric: "salesEndMonth", actualValue: metrics.salesEndMonth.toString(), thresholdValue: metrics.deliveryMonth.toString() });
  }

  findings.push({ id: "model-gaps", severity: "warning", category: "governanca", title: "Riscos ainda não modelados", evidence: "O v1 não aplica inflação, distrato, inadimplência, permuta ou parcelamento do terreno.", action: "Tratar essas variáveis antes de uma decisão final de investimento.", classification: "fato" });

  const critical = findings.find((finding) => finding.severity === "critical");
  const warning = findings.find((finding) => finding.severity === "warning");
  if (critical) return { status: "NAO_AVANCAR", label: "Não avançar nesta estrutura", dominantReason: critical.title, findings };
  if (warning) return { status: "AVANCAR_COM_AJUSTES", label: "Avançar com ajustes", dominantReason: warning.title, findings };
  return { status: "AVANCAR", label: "Avançar para diligência", dominantReason: "As políticas modeladas foram atendidas", findings };
}
