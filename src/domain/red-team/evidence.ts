import type { ProjectAssumptions } from "@/domain/financial/types";
import type { RedTeamEvidenceInput, RedTeamEvidenceItem, RedTeamEvidencePack, MissingEvidenceItem } from "./types";

const expectedDocuments = [
  { key: "detailed_budget", category: "ENGINEERING", requestedDocument: "Orçamento detalhado de obra", reason: "Validar custo por m², escopo, quantitativos e exclusões.", priority: "HIGH" },
  { key: "land_title", category: "LEGAL", requestedDocument: "Matrícula atualizada do imóvel", reason: "Confirmar titularidade, ônus e restrições do terreno.", priority: "HIGH" },
  { key: "market_study", category: "COMMERCIAL", requestedDocument: "Estudo de mercado e absorção", reason: "Sustentar preço, velocidade e estoque projetados.", priority: "HIGH" },
  { key: "construction_schedule", category: "ENGINEERING", requestedDocument: "Cronograma físico-financeiro", reason: "Validar prazo de obra e curva de desembolso.", priority: "HIGH" },
  { key: "land_contract", category: "LEGAL", requestedDocument: "Contrato ou minuta de aquisição do terreno", reason: "Validar preço, forma de aquisição, condições e garantias.", priority: "HIGH" },
  { key: "municipal_approval", category: "LEGAL", requestedDocument: "Aprovação municipal e licenças disponíveis", reason: "Confirmar o estágio regulatório e condicionantes do cronograma.", priority: "HIGH" },
  { key: "geotechnical_report", category: "ENGINEERING", requestedDocument: "Sondagem e relatório geotécnico", reason: "Reduzir incerteza de fundações e custos não contemplados.", priority: "MEDIUM" },
  { key: "technical_specification", category: "ENGINEERING", requestedDocument: "Memorial descritivo do produto", reason: "Confrontar padrão construtivo, preço e orçamento.", priority: "MEDIUM" },
  { key: "funding_term_sheet", category: "FINANCE", requestedDocument: "Term sheet ou proposta de funding", reason: "Comprovar limite, custo, garantias e condições de desembolso.", priority: "HIGH" },
] as const;

function flattenAssumptions(input: ProjectAssumptions) {
  const { policy, ...assumptions } = input;
  return { assumptions, policy };
}

function variationToken(value: number) {
  if (value === 0) return "BASE";
  return value > 0 ? `PLUS_${String(value).replace(".", "_")}` : `MINUS_${String(Math.abs(value)).replace(".", "_")}`;
}

export function buildEvidencePack(input: RedTeamEvidenceInput): RedTeamEvidencePack {
  const uploadedEvidence = input.uploadedEvidence ?? [];
  const availableCategories = new Set(uploadedEvidence.map((document) => document.category.toLowerCase()));
  const missingEvidence: MissingEvidenceItem[] = expectedDocuments
    .filter((document) => !availableCategories.has(document.key) && !availableCategories.has(document.category.toLowerCase()))
    .map((document) => ({ ...document, evidenceRef: `MISSING_EVIDENCE.${document.key}` }));
  const items: RedTeamEvidenceItem[] = [];
  const add = (item: RedTeamEvidenceItem) => items.push(item);
  const { assumptions, policy } = flattenAssumptions(input.assumptions);

  for (const [key, value] of Object.entries(assumptions)) {
    add({ ref: `ASSUMPTION.${key}`, kind: "ASSUMPTION", label: key, value, source: input.assumptionSources[key] ?? "USER_INPUT", trust: "SYSTEM" });
  }
  for (const [key, value] of Object.entries(policy)) {
    add({ ref: `POLICY.${key}`, kind: "POLICY", label: key, value, source: "INVESTMENT_POLICY", trust: "SYSTEM" });
  }
  for (const [key, value] of Object.entries(input.engineResult.metrics)) {
    add({ ref: `ENGINE.${key}`, kind: "ENGINE", label: key, value, source: `${input.engineResult.engineVersion}:${input.engineResult.scenario}`, trust: "SYSTEM" });
  }
  add({ ref: "SCORE.TOTAL", kind: "SCORE", label: "REDE Score", value: { totalScore: input.score.totalScore, classification: input.score.classification }, source: input.score.policyVersion, trust: "SYSTEM" });
  for (const dimension of input.score.dimensions) {
    add({ ref: `SCORE.${dimension.key}`, kind: "SCORE", label: dimension.key, value: dimension, source: input.score.policyVersion, trust: "SYSTEM" });
    for (const rule of dimension.reasons) {
      add({ ref: `SCORE_RULE.${rule.ruleKey}`, kind: "SCORE", label: rule.label, value: rule, source: input.score.policyVersion, trust: "SYSTEM" });
    }
  }
  for (const gate of input.score.gates) {
    add({ ref: `SCORE_GATE.${gate.key}`, kind: "SCORE", label: gate.key, value: gate, source: input.score.policyVersion, trust: "SYSTEM" });
  }
  for (const penalty of input.score.penalties) {
    add({ ref: `SCORE_PENALTY.${penalty.key}`, kind: "SCORE", label: penalty.key, value: penalty, source: input.score.policyVersion, trust: "SYSTEM" });
  }
  for (const ranking of input.sensitivity.ranking) {
    add({ ref: `SENSITIVITY.${ranking.variable}.WORST`, kind: "SENSITIVITY", label: ranking.label, value: ranking, source: input.sensitivity.configVersion, trust: "SYSTEM" });
  }
  for (const sensitivityCase of input.sensitivity.cases) {
    add({ ref: `SENSITIVITY.${sensitivityCase.variable}.${variationToken(sensitivityCase.variation)}`, kind: "SENSITIVITY", label: `${sensitivityCase.label} ${sensitivityCase.variation}`, value: sensitivityCase, source: input.sensitivity.configVersion, trust: "SYSTEM" });
  }
  for (const stress of input.sensitivity.stresses) {
    add({ ref: `STRESS.${stress.key}`, kind: "STRESS", label: stress.label, value: stress, source: input.sensitivity.configVersion, trust: "SYSTEM" });
  }
  for (const breakEven of input.sensitivity.breakEvens) {
    add({ ref: `BREAK_EVEN.${breakEven.key}`, kind: "BREAK_EVEN", label: breakEven.label, value: breakEven, source: input.sensitivity.configVersion, trust: "SYSTEM" });
  }
  for (const alert of input.alerts) {
    add({ ref: `ALERT.${alert.id}`, kind: "ALERT", label: alert.title, value: alert, source: "REDE_ENGINE_RULES", trust: "SYSTEM" });
  }
  for (const trace of input.engineResult.auditTrail) {
    add({ ref: `TRACE.${trace.metric}`, kind: "TRACE", label: trace.label, value: trace, source: trace.engineVersion, trust: "SYSTEM" });
  }
  for (const document of uploadedEvidence) {
    add({ ref: `DOCUMENT.${document.category}.${document.id}`, kind: "DOCUMENT", label: document.title, value: { content: document.content, source: document.source }, source: document.source ?? "USER_UPLOAD", trust: "USER_UNTRUSTED" });
  }
  for (const missing of missingEvidence) {
    add({ ref: missing.evidenceRef, kind: "MISSING_EVIDENCE", label: missing.requestedDocument, value: missing, source: "EVIDENCE_GAP_CHECK", trust: "SYSTEM" });
  }

  return {
    version: "RED_TEAM_EVIDENCE_PACK_V1.0.0",
    generatedAt: input.generatedAt,
    organization: input.organization,
    project: input.project,
    study: input.study,
    studyVersion: input.studyVersion,
    scenario: input.scenario,
    assumptions: input.assumptions,
    assumptionSources: input.assumptionSources,
    engineResult: input.engineResult,
    score: input.score,
    sensitivity: input.sensitivity,
    alerts: input.alerts,
    uploadedEvidence,
    missingEvidence,
    items,
  };
}

export function validateEvidenceReferences(pack: RedTeamEvidencePack, refs: string[]) {
  const available = new Set(pack.items.map((item) => item.ref));
  const missing = refs.filter((ref) => !available.has(ref));
  if (missing.length) throw new Error(`Referências de evidência inexistentes: ${missing.join(", ")}`);
}
