import type { FinancialMetrics } from "@/domain/financial/types";
import type {
  ApprovalPathItem,
  AudienceProfile,
  DocumentBlock,
  DocumentConfidentiality,
  DocumentSection,
  IntermediateDocumentModel,
  InvestmentReadiness,
  InvestmentSnapshotBundle,
  LockedMetric,
  StudioArtifactType,
  UrbanTransformationView,
} from "./types";
import { DOCUMENT_MODEL_VERSION } from "./types";

export const CENTRAL_URBAN_DISCLAIMER = "Este material apresenta estudo preliminar de potencial urbanístico e econômico. Cenários urbanísticos simulados não representam direito adquirido, aprovação municipal ou garantia de alteração legislativa. Parâmetros, áreas, programas, cronogramas e projeções estão sujeitos à validação técnica, jurídica, ambiental, mercadológica e pelos órgãos competentes.";
export const CENTRAL_FINANCIAL_DISCLAIMER = "Projeções financeiras são cenários derivados das premissas e versões identificadas neste documento; não constituem promessa de retorno, oferta de investimento ou garantia de desempenho.";

const SECTION_TEMPLATES: Record<StudioArtifactType, string[]> = {
  DESIGN_REVIEW_REPORT: ["Projeto analisado", "Revisão", "Executive Summary", "Documentos recebidos", "Documentos faltantes", "Quadro de áreas", "Eficiência", "Produto", "Implantação", "Urbanismo", "Tipologias", "Circulação", "Core", "Estacionamento", "Engenharia", "Compatibilização", "Value Engineering", "Findings", "Findings críticos", "Impactos econômicos", "Alternativas", "Comparação", "Recomendações", "Próximos passos", "Disclaimer", "Anexos"],
  MASTER_REPORT: ["Capa", "Sumário", "O projeto em 60 segundos", "Executive Dashboard", "Executive Summary", "Tese do investimento", "Decisão e recomendação", "Localização", "Terreno", "Documentação do terreno", "Urbanismo vigente", "Cenários urbanísticos", "Urban Gap", "Hoje × cenário proposto", "Regulatory Confidence", "Masterplan", "Massa 3D", "Alternativas", "Produto", "Fases", "Quadro de áreas", "Densidade", "Design Intelligence", "Premissas", "Receitas e custos", "Cenários financeiros", "Fluxo de caixa", "Capital stack", "Fontes e usos", "Funding", "Exposição", "Retorno", "Sensibilidade", "Stress Tests", "Pontos de ruptura", "REDE Score", "Red Team", "Investment Committee", "Decision History", "O que mudou?", "Transformação urbana", "Infraestrutura", "Impactos", "Mitigações", "Contrapartidas", "Option Economics", "Value Creation Bridge", "Valor máximo suportável do terreno", "Critical Path", "Cost of Delay", "Risk Register", "Stakeholders", "Action Center", "Readiness", "Data Room Status", "Document Index", "Assumption Register", "Claims Ledger", "Informações ainda pendentes", "Limitações da análise", "Conclusão", "Próximos passos", "Matriz de fontes", "Trilha de cálculo", "Audit Page", "Metodologia REDE", "Disclaimer", "Anexos"],
  INVESTMENT_BOOK: ["Capa", "Executive Summary", "Tese do investimento", "Localização", "Terreno", "Situação urbanística atual", "Alteração urbanística proposta", "Urban Gap", "Uplift potencial", "Masterplan", "Massa 3D", "Produto", "Fases", "Quadro de áreas", "Mercado e premissas comerciais", "Premissas financeiras", "VGV", "Custos", "Fluxo de caixa", "Funding", "Exposição", "Margem", "ROI", "TIR", "VPL", "REDE Score", "Sensibilidade", "Stress Tests", "Break-even", "Red Team", "Riscos", "Condicionantes", "Caminho para aprovação", "Conclusão", "Disclaimer", "Anexos"],
  INVESTMENT_MEMO: ["Oportunidade", "Estrutura", "Investimento", "Principais números", "Riscos", "REDE Score", "Red Team", "Decisão", "Condicionantes", "Disclaimer"],
  INVESTOR_DECK: ["Capa", "A oportunidade", "O terreno", "Situação atual", "Transformação urbanística", "Masterplan", "Produto", "Mercado", "Economia do negócio", "Capital", "Retorno", "Sensibilidade", "REDE Score", "Red Team", "Estratégia de execução", "Fases", "Riscos", "Caminho para aprovação", "Proposta / estrutura", "Encerramento"],
  ONE_PAGE: ["Projeto", "Produto", "Números-chave", "Risco e decisão"],
  COMMITTEE_MEMO: ["Executive Decision Summary", "Posições independentes", "Caso de investimento", "Readiness", "Blockers", "Condicionantes", "Caminho para aprovação", "Decisão solicitada", "Disclaimer"],
  URBAN_CASE: ["Capa", "Executive Summary", "A oportunidade", "Localização", "Terreno", "Situação vigente", "Diagnóstico urbanístico", "Cenário proposto", "Gap urbanístico", "Transformação 3D", "Masterplan", "Produto", "Fases", "Densidade", "Infraestrutura", "Impactos", "Mitigações", "Contrapartidas", "Potencial econômico", "Uplift", "Value Creation Bridge", "Engine", "REDE Score", "Sensibilidade", "Downcase", "Red Team", "Riscos", "Roadmap de aprovação", "Stage Gates", "Condicionantes", "Próximos passos", "Conclusão", "Disclaimer", "Fontes", "Anexos"],
  EXECUTIVE_REPORT: ["Executive Summary", "Evolução", "Economia", "Riscos", "Governança", "Próximos passos", "Disclaimer"],
  RED_TEAM_REPORT: ["Executive Summary", "Posição por agente", "Achados", "Divergências", "Evidências solicitadas", "O que muda a decisão", "Conclusão", "Disclaimer"],
  DATA_ROOM_INDEX: ["Índice", "Completude", "Documentos críticos", "Pendências", "Confidencialidade", "Disclaimer"],
  INVESTOR_QA_PACK: ["Principais dúvidas", "Respostas validadas", "Riscos", "Premissas", "Documentos", "Fontes", "Disclaimer"],
  MANAGEMENT_SUMMARY: ["Status atual", "Decisão vigente", "Evolução desde o último comitê", "Principais riscos", "Blockers", "Ações e prazos", "Capital em risco", "Próximos Gates"],
  BOARD_SUMMARY: ["Tese", "Números", "Decisão", "Risco dominante", "Capital necessário", "Estágio", "Próximos marcos"],
  MUNICIPALITY_PRESENTATION: ["Situação atual", "Transformação", "Densidade", "Infraestrutura", "Benefícios", "Impactos", "Mitigação", "Contrapartidas", "Faseamento", "Disclaimer"],
  LANDOWNER_PRESENTATION: ["Potencial vigente", "Potencial transformado", "Estrutura proposta", "Riscos", "Prazo", "Cenários", "Upside", "Disclaimer"],
  FINANCIER_PACK: ["Capital stack", "Exposição", "Fluxo", "Garantias", "Indicadores disponíveis", "Vendas", "Stress", "Riscos", "Documentação", "Condicionantes", "Disclaimer"],
};

const INTERNAL_ONLY = new Set(["Premissas financeiras", "ROI", "TIR", "VPL", "Capital em risco", "Estrutura", "Proposta / estrutura", "Value Creation Bridge", "Economia do negócio", "Retorno"]);
const FINANCIAL_SECTIONS = new Set(["Capital stack", "Exposição", "Fluxo", "Funding", "Capital", "Garantias", "Indicadores disponíveis", "Vendas", "Stress"]);

export interface StudioModelInput {
  artifactType: StudioArtifactType;
  audience: AudienceProfile;
  bundle: InvestmentSnapshotBundle;
  readiness: InvestmentReadiness;
  approvalPath: ApprovalPathItem[];
  urban: UrbanTransformationView;
  generatedAt: string;
}

export function buildIntermediateDocumentModel(input: StudioModelInput): IntermediateDocumentModel {
  const { artifactType, audience, bundle, generatedAt } = input;
  const sectionNames = SECTION_TEMPLATES[artifactType].filter((title) => isVisibleForAudience(title, audience));
  const confidentialityBySection: Record<string, DocumentConfidentiality> = {};
  const sections = sectionNames.map((title, order) => {
    const key = slug(title);
    confidentialityBySection[key] = sectionConfidentiality(title);
    return buildSection(title, order + 1, input);
  });
  const sources = buildSourceIndex(bundle);
  const disclaimers = artifactType === "URBAN_CASE" || audience === "MUNICIPALITY"
    ? [CENTRAL_URBAN_DISCLAIMER, CENTRAL_FINANCIAL_DISCLAIMER]
    : [CENTRAL_FINANCIAL_DISCLAIMER, ...(bundle.land ? [CENTRAL_URBAN_DISCLAIMER] : [])];
  return {
    schemaVersion: DOCUMENT_MODEL_VERSION,
    artifactType,
    title: artifactTitle(artifactType),
    subtitle: `${bundle.project.name} · ${bundle.project.city}/${bundle.project.state}`,
    metadata: {
      organizationId: bundle.organizationId,
      projectId: bundle.projectId,
      studyVersionId: bundle.studyVersionId,
      studyVersion: `v${bundle.studyVersionNumber}`,
      landStudyVersionId: bundle.landStudyVersionId ?? "não vinculado",
      redTeamRunId: bundle.redTeamRunId ?? "não vinculado",
      snapshotFrozenAt: bundle.frozenAt,
      scenario: bundle.scenario,
    },
    sections,
    disclaimers,
    sources,
    generatedAt,
    audience,
    confidentialityBySection,
  };
}

export function validateDocumentTraceability(model: IntermediateDocumentModel): string[] {
  const errors: string[] = [];
  const sourceRefs = new Set(model.sources.map((source) => source.ref));
  model.sections.forEach((section) => section.blocks.forEach((block) => {
    if (block.type === "NARRATIVE") {
      if (!block.narrative.evidenceRefs.length) errors.push(`${section.key}: narrativa sem evidência`);
      block.narrative.evidenceRefs.forEach((evidence) => {
        if (!sourceRefs.has(evidence.ref)) errors.push(`${section.key}: evidência desconhecida ${evidence.ref}`);
      });
    }
    if (block.type === "METRICS") block.metrics.forEach((metric) => {
      if (!metric.locked || !metric.sourceRef || !metric.sourceVersion) errors.push(`${section.key}: métrica não congelada ${metric.key}`);
    });
  }));
  return errors;
}

export function artifactSections(type: StudioArtifactType): readonly string[] {
  return SECTION_TEMPLATES[type];
}

function buildSection(title: string, order: number, input: StudioModelInput): DocumentSection {
  const key = slug(title);
  if (title === "Disclaimer") return { key, title, order, blocks: input.bundle.land ? [{ type: "DISCLAIMER", text: CENTRAL_URBAN_DISCLAIMER }, { type: "DISCLAIMER", text: CENTRAL_FINANCIAL_DISCLAIMER }] : [{ type: "DISCLAIMER", text: CENTRAL_FINANCIAL_DISCLAIMER }] };
  if (isFinancialSection(title)) return { key, title, order, blocks: [{ type: "METRICS", metrics: financialMetrics(input.bundle) }] };
  if (title.includes("Score")) return { key, title, order, blocks: [scoreBlock(input.bundle)] };
  if (title.includes("Sensibilidade") || title === "Stress" || title === "Stress Tests" || title === "Downcase" || title === "Break-even") return { key, title, order, blocks: [sensitivityBlock(input.bundle, title)] };
  if (title.includes("3D") || title === "Massa 3D") return { key, title, order, blocks: [massingBlock(input.bundle)] };
  if (title === "Fluxo" || title === "Fluxo de caixa") return { key, title, order, blocks: [cashFlowBlock(input.bundle)] };
  if (title.includes("Readiness") || title === "Status atual") return { key, title, order, blocks: [readinessBlock(input.readiness, input.bundle)] };
  if (title.includes("Caminho para aprovação") || title === "Próximos passos" || title === "Próximos marcos") return { key, title, order, blocks: [approvalPathBlock(input.approvalPath)] };
  if (title.includes("Infraestrutura")) return { key, title, order, blocks: [listTable(["Categoria", "Diagnóstico", "Status", "Fonte"], input.urban.infrastructure.map((item) => [item.category, item.description, item.status, item.source]), [`land:${input.bundle.landStudyVersionId}`])] };
  if (title === "Impactos" || title === "Benefícios" || title === "Mitigações" || title === "Mitigação") return { key, title, order, blocks: [listTable(["Categoria", "Direção", "Impacto", "Mitigação"], input.urban.impacts.map((item) => [item.category, item.direction, item.description, item.mitigation]), [`land:${input.bundle.landStudyVersionId}`])] };
  if (title === "Contrapartidas") return { key, title, order, blocks: [listTable(["Contrapartida", "Fase", "Custo", "Status"], input.urban.contributions.map((item) => [item.title, item.phase, item.estimatedCost === null ? "Não informado" : brl(item.estimatedCost), item.status]), [`urban:${input.bundle.projectId}:contributions`])] };
  if (title === "Fases" || title === "Faseamento") return { key, title, order, blocks: [phasingBlock(input.bundle)] };
  if (title.includes("Red Team") || title === "Riscos" || title === "Risco e decisão" || title === "Risco dominante") return { key, title, order, blocks: [redTeamBlock(input.bundle)] };
  return { key, title, order, blocks: [narrativeBlock(title, input.bundle)] };
}

function financialMetrics(bundle: InvestmentSnapshotBundle): LockedMetric[] {
  const metrics = bundle.engineResults[bundle.scenario].metrics;
  const ref = `engine:${bundle.studyVersionId}:${bundle.scenario}`;
  const version = bundle.engineResults[bundle.scenario].engineVersion;
  const entries: [keyof FinancialMetrics, string, string, (value: string | number | null) => string][] = [
    ["vgv", "VGV", "BRL", (value) => brl(Number(value))],
    ["totalCost", "Custo total", "BRL", (value) => brl(Number(value))],
    ["profit", "Lucro", "BRL", (value) => brl(Number(value))],
    ["marginOnVgv", "Margem sobre VGV", "%", (value) => pct(value)],
    ["roi", "ROI", "%", (value) => pct(value)],
    ["annualIrr", "TIR anual", "%", (value) => pct(value)],
    ["npv", "VPL", "BRL", (value) => brl(Number(value))],
    ["equityCapitalRequired", "Capital próprio", "BRL", (value) => brl(Number(value))],
    ["maximumCashExposure", "Exposição máxima", "BRL", (value) => brl(Number(value))],
  ];
  return entries.map(([key, label, unit, formatter]) => ({ key, label, value: formatter(metrics[key]), unit, sourceRef: `${ref}:${key}`, sourceVersion: version, locked: true }));
}

function narrativeBlock(title: string, bundle: InvestmentSnapshotBundle): DocumentBlock {
  const source = baseEvidence(bundle);
  const landSentence = bundle.land ? ` O estudo urbanístico vinculado é a versão ${bundle.land.versionNumber}, com confiança regulatória de ${bundle.land.regulatoryConfidence.score}/100.` : " Não há snapshot urbanístico vinculado a este pacote.";
  return {
    type: "NARRATIVE",
    narrative: {
      id: `narrative-${slug(title)}`,
      text: `${title}: análise determinística do projeto ${bundle.project.name}, no cenário ${bundle.scenario}, congelada na versão ${bundle.studyVersionNumber}.${landSentence}`,
      origin: "SYSTEM_GENERATED",
      evidenceRefs: [source, ...(bundle.land ? [landEvidence(bundle)] : [])],
    },
  };
}

function scoreBlock(bundle: InvestmentSnapshotBundle): DocumentBlock {
  const score = bundle.scores[bundle.scenario];
  return { type: "METRICS", metrics: [{ key: "redeScore", label: "REDE Score", value: score.totalScore.toFixed(1), unit: "/100", sourceRef: `score:${bundle.studyVersionId}:${bundle.scenario}`, sourceVersion: score.policyVersion, locked: true }] };
}

function sensitivityBlock(bundle: InvestmentSnapshotBundle, title: string): DocumentBlock {
  const source = `sensitivity:${bundle.studyVersionId}`;
  if (title === "Break-even") return listTable(["Variável", "Valor", "Status"], bundle.sensitivity.breakEvens.map((item) => [item.label, `${item.value}`, item.status]), [source]);
  return listTable(["Teste", "Score", "VPL", "Políticas violadas"], bundle.sensitivity.stresses.map((item) => [item.label, item.score.toFixed(1), brl(Number(item.metrics.npv)), item.violatedPolicies.join(", ") || "Nenhuma"]), [source]);
}

function cashFlowBlock(bundle: InvestmentSnapshotBundle): DocumentBlock {
  const cashFlow = bundle.cashFlow;
  const step = Math.max(1, Math.ceil(cashFlow.length / 24));
  const sampled = cashFlow.filter((_, index) => index % step === 0 || index === cashFlow.length - 1);
  return { type: "CHART", chartType: "CASH_FLOW", title: "Fluxo acumulado do equity", labels: sampled.map((row) => `M${row.month}`), values: sampled.map((row) => Number(row.cumulativeEquityCash)), evidenceRefs: [`engine:${bundle.studyVersionId}:${bundle.scenario}:cashFlow`] };
}

function massingBlock(bundle: InvestmentSnapshotBundle): DocumentBlock {
  const land = bundle.land;
  const current = land?.options[0]?.massing.buildings ?? [];
  const proposed = land?.options.find((option) => option.id === land.selectedOptionId)?.massing.buildings ?? land?.options.at(-1)?.massing.buildings ?? [];
  return {
    type: "MASSING",
    title: "Comparação volumétrica AS-IS × TO-BE",
    current: current.map(({ x, y, width, depth, floors }) => ({ x, y, width, depth, floors })),
    proposed: proposed.map(({ x, y, width, depth, floors }) => ({ x, y, width, depth, floors })),
    evidenceRefs: land ? [`land:${bundle.landStudyVersionId}:massing`] : [],
  };
}

function phasingBlock(bundle: InvestmentSnapshotBundle): DocumentBlock {
  const option = bundle.land?.options.find((item) => item.id === bundle.land?.selectedOptionId);
  return listTable(["Fase", "Unidades", "Início", "Duração"], option?.masterplan.phases.map((phase) => [phase.name, `${phase.units}`, `M${phase.startMonth}`, `${phase.constructionMonths} meses`]) ?? [], bundle.land ? [`land:${bundle.landStudyVersionId}:masterplan`] : []);
}

function readinessBlock(readiness: InvestmentReadiness, bundle: InvestmentSnapshotBundle): DocumentBlock {
  return listTable(["Dimensão", "Score", "Lacunas"], readiness.dimensions.map((dimension) => [dimension.key, `${dimension.score}/100`, dimension.missing.join(", ") || "Nenhuma"]), [`bundle:${bundle.studyVersionId}:readiness`]);
}

function approvalPathBlock(items: ApprovalPathItem[]): DocumentBlock {
  return listTable(["Ação", "Origem", "Meta", "Situação"], items.map((item) => [item.title, item.source, item.target, item.resolved ? "Atendida" : item.blocker ? "Blocker" : "Pendente"]), items.map((item) => item.evidenceRef));
}

function redTeamBlock(bundle: InvestmentSnapshotBundle): DocumentBlock {
  if (!bundle.redTeam) return narrativeBlock("Red Team não vinculado", bundle);
  return listTable(["Achado", "Severidade", "Status", "Ação"], bundle.redTeam.findings.slice(0, 12).map((finding) => [finding.title, finding.severity, finding.status, finding.recommendedAction]), [`redteam:${bundle.redTeamRunId}`]);
}

function listTable(headers: string[], rows: string[][], evidenceRefs: string[]): DocumentBlock {
  return { type: "TABLE", headers, rows: rows.length ? rows : [["Sem dados registrados para esta versão"]], evidenceRefs };
}

function buildSourceIndex(bundle: InvestmentSnapshotBundle): IntermediateDocumentModel["sources"] {
  const refs: IntermediateDocumentModel["sources"] = [
    { ref: `bundle:${bundle.studyVersionId}`, title: `Investment Snapshot Bundle · estudo v${bundle.studyVersionNumber}`, url: null },
    { ref: `engine:${bundle.studyVersionId}:${bundle.scenario}`, title: `REDE Engine · ${bundle.engineResults[bundle.scenario].engineVersion}`, url: null },
    { ref: `score:${bundle.studyVersionId}:${bundle.scenario}`, title: `REDE Score · ${bundle.scores[bundle.scenario].policyVersion}`, url: null },
    { ref: `sensitivity:${bundle.studyVersionId}`, title: `Sensibilidade · ${bundle.sensitivity.configVersion}`, url: null },
    { ref: `bundle:${bundle.studyVersionId}:readiness`, title: "Readiness calculado a partir do snapshot", url: null },
  ];
  Object.keys(bundle.engineResults[bundle.scenario].metrics).forEach((key) => refs.push({ ref: `engine:${bundle.studyVersionId}:${bundle.scenario}:${key}`, title: `REDE Engine · ${key}`, url: null }));
  refs.push({ ref: `engine:${bundle.studyVersionId}:${bundle.scenario}:cashFlow`, title: "REDE Engine · fluxo de caixa", url: null });
  if (bundle.land) {
    refs.push({ ref: `land:${bundle.landStudyVersionId}`, title: `REDE Land · versão ${bundle.land.versionNumber}`, url: null });
    refs.push({ ref: `land:${bundle.landStudyVersionId}:massing`, title: "REDE Land · massa 3D", url: null });
    refs.push({ ref: `land:${bundle.landStudyVersionId}:masterplan`, title: "REDE Land · masterplan", url: null });
    bundle.land.sources.forEach((source) => refs.push({ ref: `urban-source:${source.id}`, title: source.title, url: source.url }));
  }
  if (bundle.redTeamRunId) refs.push({ ref: `redteam:${bundle.redTeamRunId}`, title: `REDE Red Team · ${bundle.redTeam?.redTeamVersion ?? "versão vinculada"}`, url: null });
  refs.push({ ref: `urban:${bundle.projectId}:contributions`, title: "Contrapartidas urbanas registradas", url: null });
  bundle.documents.forEach((document) => refs.push({ ref: `document:${document.id}:v${document.version}`, title: document.title, url: null }));
  return refs;
}

function isVisibleForAudience(title: string, audience: AudienceProfile): boolean {
  if (audience === "INTERNAL" || audience === "INVESTMENT_COMMITTEE" || audience === "BOARD") return true;
  if (audience === "MUNICIPALITY") return !INTERNAL_ONLY.has(title) && !FINANCIAL_SECTIONS.has(title);
  if (audience === "LANDOWNER") return !["Premissas financeiras", "Funding", "Capital stack", "Garantias", "Indicadores disponíveis"].includes(title);
  if (audience === "FINANCIER") return title !== "Proposta / estrutura";
  return true;
}

function sectionConfidentiality(title: string): DocumentConfidentiality {
  if (INTERNAL_ONLY.has(title)) return "STRICTLY_CONFIDENTIAL";
  if (FINANCIAL_SECTIONS.has(title)) return "CONFIDENTIAL";
  return "PUBLIC_INTERNAL";
}

function isFinancialSection(title: string): boolean {
  return ["Principais números", "Números-chave", "Números", "Economia", "Economia do negócio", "Potencial econômico", "Engine", "VGV", "Custos", "Funding", "Exposição", "Margem", "ROI", "TIR", "VPL", "Capital", "Retorno", "Capital em risco", "Capital necessário", "Indicadores disponíveis", "Upside", "Value Creation Bridge"].includes(title);
}

function baseEvidence(bundle: InvestmentSnapshotBundle) {
  return { ref: `bundle:${bundle.studyVersionId}`, label: `Snapshot do estudo v${bundle.studyVersionNumber}`, sourceVersion: bundle.bundleVersion };
}

function landEvidence(bundle: InvestmentSnapshotBundle) {
  return { ref: `land:${bundle.landStudyVersionId}`, label: `Snapshot urbanístico v${bundle.landVersionNumber}`, sourceVersion: bundle.land?.version ?? "não vinculado" };
}

function artifactTitle(type: StudioArtifactType): string {
  return ({ MASTER_REPORT: "Dossiê Completo REDE", DESIGN_REVIEW_REPORT: "Design Review Report", INVESTMENT_BOOK: "Investment Book", INVESTMENT_MEMO: "Investment Memo", INVESTOR_DECK: "Investor Deck", ONE_PAGE: "One Page", COMMITTEE_MEMO: "Committee Memo", URBAN_CASE: "Urban Transformation Case", EXECUTIVE_REPORT: "Executive Report", RED_TEAM_REPORT: "Red Team Report", DATA_ROOM_INDEX: "Data Room Index", INVESTOR_QA_PACK: "Investor Q&A Pack", MANAGEMENT_SUMMARY: "Management Summary", BOARD_SUMMARY: "Board Summary", MUNICIPALITY_PRESENTATION: "Urban Transformation · Public Sector", LANDOWNER_PRESENTATION: "Landowner Case", FINANCIER_PACK: "Financier Pack" } satisfies Record<StudioArtifactType, string>)[type];
}

function pct(value: string | number | null): string {
  return value === null ? "N/D" : `${(Number(value) * 100).toFixed(1)}%`;
}

function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

function slug(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
