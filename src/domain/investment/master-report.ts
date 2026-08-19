import { createHash } from "node:crypto";
import type { ScenarioKey } from "@/domain/financial/types";
import type { UrbanScenarioType } from "@/domain/land";
import { artifactSections, buildIntermediateDocumentModel, validateDocumentTraceability } from "./studio";
import { calculateCriticalPath, calculateDelayStress, calculateLandValueCeiling } from "./transformation";
import type {
  AudienceProfile,
  ArtifactWatermark,
  DocumentConfidentiality,
  DocumentSection,
  IntermediateDocumentModel,
  InvestmentCaseWorkspace,
} from "./types";

export type MasterReportLevel = "EXECUTIVE" | "COMPLETE" | "FULL_DOSSIER" | "CUSTOM";
export type MasterReportLanguage = "PT_BR" | "EN_US";
export type MasterReportJobStatus = "QUEUED" | "VALIDATING" | "RENDERING" | "ASSEMBLING" | "FINALIZING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type MasterReportPreflightStatus = "READY" | "READY_WITH_WARNINGS" | "NOT_READY";

export interface MasterReportConfig {
  investmentCaseId: string;
  snapshotBundleId: string;
  reportLevel: MasterReportLevel;
  audienceProfile: AudienceProfile;
  language: MasterReportLanguage;
  confidentiality: DocumentConfidentiality;
  selectedSections: string[];
  selectedFinancialScenarios: ScenarioKey[];
  selectedUrbanScenarios: UrbanScenarioType[];
  selectedStressTests: string[];
  selectedVersions: string[];
  includeAppendices: boolean;
  includeAuditTrail: boolean;
  includeDocumentsIndex: boolean;
  includeDataSources: boolean;
  includeCalculationTrace: boolean;
  include3DViews: boolean;
  includeRedTeamDetails: boolean;
  includeCommitteeHistory: boolean;
  includeDataRoomStatus: boolean;
  includeDesignIntelligence: boolean;
  includeWatermark: boolean;
  watermark: ArtifactWatermark;
  templateId: string | null;
  brandId: string | null;
  pageSize: "A4" | "LETTER";
  saveFinalToDataRoom: boolean;
}

export interface MasterReportPreflightIssue {
  code: string;
  severity: "WARNING" | "BLOCKER";
  area: "SNAPSHOT" | "FINANCIAL" | "SCORE" | "RED_TEAM" | "URBAN" | "DOCUMENTS" | "SOURCES" | "VISUALS" | "COMMITTEE" | "INTEGRITY";
  message: string;
}

export interface MasterReportReadiness {
  score: number;
  dimensions: { key: "FINANCIAL_DATA" | "URBAN_DATA" | "RISK" | "RED_TEAM" | "COMMITTEE" | "DOCUMENTS" | "SOURCES" | "VISUALS"; score: number; missing: string[] }[];
  blockers: string[];
}

export interface MasterReportPreflight {
  status: MasterReportPreflightStatus;
  issues: MasterReportPreflightIssue[];
  readiness: MasterReportReadiness;
  canGenerateDraft: boolean;
  canGenerateFinal: boolean;
}

export interface MasterReportSection extends DocumentSection {
  sourceRefs: string[];
  scenarioRefs: string[];
  versionRefs: string[];
  visibility: AudienceProfile[];
  pageBreakRules: { startOnNewPage: boolean; keepWithNext: boolean };
  renderingOptions: { orientation: "PORTRAIT" | "LANDSCAPE"; allowSplit: boolean };
}

export interface MasterReportModel extends Omit<IntermediateDocumentModel, "sections"> {
  reportId: string;
  reportVersion: number;
  reportLevel: MasterReportLevel;
  configDigest: string;
  sections: MasterReportSection[];
  toc: { id: string; title: string; order: number }[];
  footnotes: { id: string; text: string; sourceRef: string }[];
  appendices: string[];
  auditMetadata: {
    snapshotBundleId: string;
    snapshotChecksum: string;
    engineVersion: string;
    scoreVersion: string;
    redTeamVersion: string | null;
    templateVersion: string;
  };
}

const COMPLETE_SECTIONS = [
  "Capa", "Sumário", "O projeto em 60 segundos", "Executive Dashboard", "Executive Summary", "Tese do investimento", "Decisão e recomendação", "Localização", "Terreno", "Urbanismo vigente", "Cenários urbanísticos", "Urban Gap", "Hoje × cenário proposto", "Regulatory Confidence", "Masterplan", "Massa 3D", "Produto", "Fases", "Quadro de áreas", "Densidade", "Design Intelligence", "Premissas", "Receitas e custos", "Cenários financeiros", "Fluxo de caixa", "Capital stack", "Fontes e usos", "Funding", "Exposição", "Retorno", "Sensibilidade", "Stress Tests", "Pontos de ruptura", "REDE Score", "Red Team", "Investment Committee", "Decision History", "Transformação urbana", "Infraestrutura", "Impactos", "Mitigações", "Contrapartidas", "Critical Path", "Risk Register", "Action Center", "Readiness", "Data Room Status", "Document Index", "Informações ainda pendentes", "Limitações da análise", "Conclusão", "Próximos passos", "Matriz de fontes", "Audit Page", "Metodologia REDE", "Disclaimer", "Anexos",
];

const EXECUTIVE_SECTIONS = [
  "Capa", "Sumário", "O projeto em 60 segundos", "Executive Dashboard", "Executive Summary", "Tese do investimento", "Localização", "Terreno", "Urbanismo vigente", "Hoje × cenário proposto", "Masterplan", "Produto", "Fases", "Cenários financeiros", "Retorno", "Sensibilidade", "REDE Score", "Red Team", "Investment Committee", "Risk Register", "Action Center", "Readiness", "Conclusão", "Próximos passos", "Disclaimer",
];

export function createMasterReportConfig(
  workspace: InvestmentCaseWorkspace,
  level: MasterReportLevel,
  audience: AudienceProfile = "INTERNAL",
): MasterReportConfig {
  const all = [...artifactSections("MASTER_REPORT")];
  const selectedSections = level === "EXECUTIVE" ? EXECUTIVE_SECTIONS : level === "COMPLETE" ? COMPLETE_SECTIONS : level === "CUSTOM" ? [] : all;
  return {
    investmentCaseId: workspace.id,
    snapshotBundleId: workspace.bundleId,
    reportLevel: level,
    audienceProfile: audience,
    language: "PT_BR",
    confidentiality: audience === "INTERNAL" || audience === "INVESTMENT_COMMITTEE" ? "STRICTLY_CONFIDENTIAL" : "CONFIDENTIAL",
    selectedSections,
    selectedFinancialScenarios: ["conservative", "base", "aggressive"],
    selectedUrbanScenarios: workspace.bundle.land?.scenarios.map((scenario) => scenario.type) ?? [],
    selectedStressTests: workspace.bundle.sensitivity.stresses.map((stress) => stress.key),
    selectedVersions: [workspace.bundle.studyVersionId, ...(workspace.bundle.landStudyVersionId ? [workspace.bundle.landStudyVersionId] : [])],
    includeAppendices: level !== "EXECUTIVE",
    includeAuditTrail: level === "FULL_DOSSIER",
    includeDocumentsIndex: level !== "EXECUTIVE",
    includeDataSources: level !== "EXECUTIVE",
    includeCalculationTrace: level === "FULL_DOSSIER",
    include3DViews: true,
    includeRedTeamDetails: level !== "EXECUTIVE",
    includeCommitteeHistory: level !== "EXECUTIVE",
    includeDataRoomStatus: level !== "EXECUTIVE",
    includeDesignIntelligence: level !== "EXECUTIVE",
    includeWatermark: true,
    watermark: "DRAFT",
    templateId: null,
    brandId: null,
    pageSize: "A4",
    saveFinalToDataRoom: true,
  };
}

export function runMasterReportPreflight(workspace: InvestmentCaseWorkspace, config: MasterReportConfig): MasterReportPreflight {
  const issues: MasterReportPreflightIssue[] = [];
  if (config.investmentCaseId !== workspace.id || config.snapshotBundleId !== workspace.bundleId) issues.push(issue("SNAPSHOT_BINDING", "BLOCKER", "SNAPSHOT", "A configuração não corresponde ao Investment Case e ao Snapshot selecionados."));
  if (!workspace.bundle.frozenAt || !workspace.bundleChecksum) issues.push(issue("SNAPSHOT_NOT_FROZEN", "BLOCKER", "SNAPSHOT", "Snapshot não está congelado ou não possui checksum."));
  config.selectedFinancialScenarios.forEach((scenario) => {
    if (!workspace.bundle.engineResults[scenario]) issues.push(issue(`MISSING_ENGINE_${scenario}`, "BLOCKER", "FINANCIAL", `Resultado do Engine ausente para o cenário ${scenario}.`));
    if (!workspace.bundle.scores[scenario]) issues.push(issue(`MISSING_SCORE_${scenario}`, "BLOCKER", "SCORE", `REDE Score ausente para o cenário ${scenario}.`));
  });
  if (!workspace.bundle.redTeam) issues.push(issue("RED_TEAM_MISSING", "WARNING", "RED_TEAM", "Red Team não vinculado ao Snapshot."));
  if (!workspace.bundle.land) issues.push(issue("LAND_MISSING", "WARNING", "URBAN", "Estudo urbanístico não vinculado ao Snapshot."));
  if (config.include3DViews && !workspace.bundle.land?.options.some((option) => option.massing.buildings.length > 0)) issues.push(issue("MASSING_MISSING", "WARNING", "VISUALS", "Visual 3D não está disponível para a versão geométrica selecionada."));
  if (workspace.dataRoomCompleteness.overall < 100) issues.push(issue("DATA_ROOM_INCOMPLETE", "WARNING", "DOCUMENTS", `Data Room está ${workspace.dataRoomCompleteness.overall}% completo.`));
  if (config.includeDesignIntelligence && !workspace.artifacts.some((artifact) => artifact.type === "DESIGN_REVIEW_REPORT")) issues.push(issue("DESIGN_REVIEW_MISSING", "WARNING", "DOCUMENTS", "Design Intelligence selecionado, mas nenhum Design Review Report foi emitido para este Investment Case."));
  if (!workspace.rounds.length) issues.push(issue("COMMITTEE_NOT_STARTED", "WARNING", "COMMITTEE", "Nenhum review round registrado."));
  if (!workspace.bundle.land?.sources.length) issues.push(issue("URBAN_SOURCES_MISSING", "WARNING", "SOURCES", "Fontes urbanísticas não disponíveis."));
  const selectedUnknown = config.selectedSections.filter((section) => !artifactSections("MASTER_REPORT").includes(section));
  if (selectedUnknown.length) issues.push(issue("UNKNOWN_SECTIONS", "BLOCKER", "INTEGRITY", `Seções desconhecidas: ${selectedUnknown.join(", ")}.`));
  if (!config.selectedSections.length) issues.push(issue("NO_SECTIONS", "BLOCKER", "INTEGRITY", "Selecione ao menos uma seção."));
  const readiness = calculateReportReadiness(workspace);
  const blockers = issues.filter((item) => item.severity === "BLOCKER");
  return {
    status: blockers.length ? "NOT_READY" : issues.length ? "READY_WITH_WARNINGS" : "READY",
    issues,
    readiness,
    canGenerateDraft: blockers.length === 0,
    canGenerateFinal: blockers.length === 0 && Boolean(workspace.bundle.frozenAt && workspace.bundleChecksum && workspace.id),
  };
}

export function buildMasterReportModel(
  workspace: InvestmentCaseWorkspace,
  config: MasterReportConfig,
  reportId: string,
  reportVersion: number,
  generatedAt: string,
): MasterReportModel {
  const preflight = runMasterReportPreflight(workspace, config);
  if (!preflight.canGenerateDraft) throw new Error(`Master Report não pode ser gerado: ${preflight.issues.filter((item) => item.severity === "BLOCKER").map((item) => item.message).join(" ")}`);
  const base = buildIntermediateDocumentModel({
    artifactType: "MASTER_REPORT",
    audience: config.audienceProfile,
    bundle: workspace.bundle,
    readiness: workspace.readiness,
    approvalPath: workspace.approvalPath,
    urban: workspace.urbanTransformation,
    generatedAt,
  });
  const selected = new Set(config.selectedSections.map(slug));
  const scenarioSection = buildScenarioMatrixSection(workspace, config);
  const baseSections = base.sections.filter((section) => selected.has(section.key)).map((section) => materializeMasterSection(section, workspace, config));
  const sections = baseSections.map((section, index) => enrichSection(section, index + 1, workspace, config));
  const scenarioIndex = sections.findIndex((section) => section.key === "cenarios-financeiros");
  if (scenarioIndex >= 0) sections[scenarioIndex] = enrichSection(scenarioSection, scenarioIndex + 1, workspace, config);
  const model: MasterReportModel = {
    ...base,
    reportId,
    reportVersion,
    reportLevel: config.reportLevel,
    configDigest: sha256(stableJson(config)),
    sections,
    toc: sections.map((section) => ({ id: section.key, title: section.title, order: section.order })),
    footnotes: base.sources.map((source, index) => ({ id: `source-${index + 1}`, text: source.title, sourceRef: source.ref })),
    appendices: config.includeAppendices ? ["Matriz de fontes", ...(config.includeCalculationTrace ? ["Trilha de cálculo"] : []), ...(config.includeDocumentsIndex ? ["Document Index"] : [])] : [],
    auditMetadata: {
      snapshotBundleId: workspace.bundleId,
      snapshotChecksum: workspace.bundleChecksum,
      engineVersion: workspace.bundle.engineResults[workspace.bundle.scenario].engineVersion,
      scoreVersion: workspace.bundle.scores[workspace.bundle.scenario].policyVersion,
      redTeamVersion: workspace.bundle.redTeam?.redTeamVersion ?? null,
      templateVersion: "REDE_MASTER_REPORT_V1.0.0",
    },
  };
  const traceErrors = validateDocumentTraceability(model);
  if (traceErrors.length) throw new Error(`Falha de provenance: ${traceErrors.join("; ")}`);
  return model;
}

export function calculateReportReadiness(workspace: InvestmentCaseWorkspace): MasterReportReadiness {
  const sourceCompleteness = workspace.bundle.land ? Math.round((workspace.bundle.land.sources.length / Math.max(workspace.bundle.land.sources.length + workspace.bundle.land.regulatoryConfidence.missing.length, 1)) * 100) : 0;
  const dimensions: MasterReportReadiness["dimensions"] = [
    { key: "FINANCIAL_DATA", score: Object.keys(workspace.bundle.engineResults).length === 3 ? 100 : 33, missing: Object.keys(workspace.bundle.engineResults).length === 3 ? [] : ["Cenários financeiros incompletos"] },
    { key: "URBAN_DATA", score: workspace.bundle.land?.regulatoryConfidence.score ?? 0, missing: workspace.bundle.land?.regulatoryConfidence.missing ?? ["Snapshot urbanístico"] },
    { key: "RISK", score: workspace.readiness.dimensions.find((item) => item.key === "RISK")?.score ?? 0, missing: workspace.readiness.blockers },
    { key: "RED_TEAM", score: workspace.bundle.redTeam ? 100 : 0, missing: workspace.bundle.redTeam ? [] : ["Red Team"] },
    { key: "COMMITTEE", score: workspace.rounds.length ? (workspace.decisions.length ? 100 : 60) : 0, missing: workspace.rounds.length ? (workspace.decisions.length ? [] : ["Decisão do comitê"]) : ["Review round"] },
    { key: "DOCUMENTS", score: workspace.dataRoomCompleteness.overall, missing: workspace.checklist.filter((item) => item.required && !["RECEIVED", "UNDER_REVIEW", "VERIFIED"].includes(item.status)).map((item) => item.title) },
    { key: "SOURCES", score: sourceCompleteness, missing: workspace.bundle.land?.regulatoryConfidence.missing ?? ["Fontes urbanísticas"] },
    { key: "VISUALS", score: workspace.bundle.land?.options.some((option) => option.massing.buildings.length) ? 100 : 0, missing: workspace.bundle.land?.options.some((option) => option.massing.buildings.length) ? [] : ["Captura 3D"] },
  ];
  return {
    score: Math.round(dimensions.reduce((total, dimension) => total + dimension.score, 0) / dimensions.length),
    dimensions,
    blockers: dimensions.filter((dimension) => dimension.score === 0).flatMap((dimension) => dimension.missing),
  };
}

export function createReportId(projectName: string, sequence: number, reportVersion: number): string {
  const code = projectName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  return `RI-${code}-${sequence.toString().padStart(6, "0")}-V${reportVersion.toString().padStart(2, "0")}-MR`;
}

export function masterReportFileName(projectName: string, studyVersion: number, generatedAt: string): string {
  const safe = projectName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(generatedAt));
  return `REDE_${safe}_InvestmentCase_MasterReport_v${studyVersion}_${date}.pdf`;
}

function buildScenarioMatrixSection(workspace: InvestmentCaseWorkspace, config: MasterReportConfig): DocumentSection {
  return {
    key: "cenarios-financeiros",
    title: "Cenários financeiros",
    order: 0,
    blocks: [{
      type: "TABLE",
      headers: ["Cenário", "VGV", "Custo", "Margem", "Equity", "Exposição", "ROI", "TIR", "VPL", "Score"],
      rows: config.selectedFinancialScenarios.map((scenario) => {
        const result = workspace.bundle.engineResults[scenario];
        const score = workspace.bundle.scores[scenario];
        return [scenario.toUpperCase(), result.metrics.vgv, result.metrics.totalCost, result.metrics.marginOnVgv, result.metrics.equityCapitalRequired, result.metrics.maximumCashExposure, result.metrics.roi ?? "N/D", result.metrics.annualIrr ?? "N/D", result.metrics.npv, `${score.totalScore}`];
      }),
      evidenceRefs: config.selectedFinancialScenarios.map((scenario) => `engine:${workspace.bundle.studyVersionId}:${scenario}`),
    }],
  };
}

function materializeMasterSection(section: DocumentSection, workspace: InvestmentCaseWorkspace, config: MasterReportConfig): DocumentSection {
  const { bundle } = workspace;
  const table = (headers: string[], rows: string[][], evidenceRefs: string[]): DocumentSection => ({ ...section, blocks: [{ type: "TABLE", headers, rows: rows.length ? rows : [["Sem dados registrados para este snapshot"]], evidenceRefs }] });
  if (section.key === "premissas") return table(["Premissa", "Valor", "Origem"], Object.entries(bundle.assumptions).filter(([, value]) => typeof value !== "object").map(([key, value]) => [key, String(value ?? ""), `StudyVersion v${bundle.studyVersionNumber}`]), [`bundle:${bundle.studyVersionId}`]);
  if (section.key === "cenarios-urbanisticos") return table(["Cenário", "Tipo", "Status", "Hipótese", "Zoneamento"], bundle.land?.scenarios.filter((item) => config.selectedUrbanScenarios.includes(item.type)).map((item) => [item.name, item.type, item.status, item.isHypothetical ? "CENÁRIO URBANÍSTICO SIMULADO" : "Vigente", item.parameters.zoningCode.value]) ?? [], bundle.land ? [`land:${bundle.landStudyVersionId}`] : []);
  if (section.key === "data-room-status") return table(["Categoria", "Completude", "Disponíveis", "Total"], workspace.dataRoomCompleteness.categories.map((item) => [item.category, `${item.score}%`, `${item.received}`, `${item.total}`]), workspace.checklist.map((item) => `checklist:${item.id}`));
  if (section.key === "document-index") return table(["Documento", "Categoria", "Versão", "Status", "Confidencialidade", "Checksum"], workspace.documents.map((item) => [item.title, item.category, `v${item.version}`, item.status, item.confidentiality, item.checksum.slice(0, 12)]), workspace.documents.map((item) => `document:${item.id}:v${item.version}`));
  if (section.key === "design-intelligence") {
    const artifacts = workspace.artifacts.filter((item) => item.type === "DESIGN_REVIEW_REPORT");
    return table(["Design Review Report", "Versão", "Status", "Páginas", "Checksum", "Snapshot"], artifacts.map((item) => [item.fileName ?? "Design Review Report", `v${item.version}`, item.status, String(item.pageCount ?? "N/D"), item.checksum?.slice(0, 12) ?? "N/D", item.sourceOutdated ? "DESATUALIZADO" : "ATUAL"]), artifacts.map((item) => `design-report:${item.id}`));
  }
  if (section.key === "assumption-register") return table(["Premissa", "Valor", "Categoria", "Status", "Versão", "Evidência"], workspace.assumptionsRegister.map((item) => [item.key, `${item.value} ${item.unit}`, item.category, item.status, item.sourceVersion, item.evidenceRef]), workspace.assumptionsRegister.map((item) => item.evidenceRef));
  if (section.key === "claims-ledger") return table(["Claim", "Status", "Evidências"], workspace.claims.map((item) => [item.statement, item.status, item.evidenceRefs.join(", ")]), workspace.claims.flatMap((item) => item.evidenceRefs));
  if (section.key === "risk-register") {
    const rows = [
      ...(bundle.redTeam?.findings.map((item) => [item.title, item.severity, "RED_TEAM", item.status, item.recommendedAction]) ?? []),
      ...workspace.urbanTransformation.risks.map((item) => [item.title, item.severity, "URBAN", "ACTIVE", item.mitigation]),
      ...workspace.issues.map((item) => [item.title, item.priority, "ISSUE", item.status, item.nextAction]),
    ];
    return table(["Risco", "Severidade", "Fonte", "Status", "Mitigação"], rows, [...(bundle.redTeamRunId ? [`redteam:${bundle.redTeamRunId}`] : []), ...workspace.urbanTransformation.risks.map((item) => item.evidenceRef)]);
  }
  if (section.key === "investment-committee") return table(["Round", "Bundle", "Status", "Decisão", "Racional"], workspace.rounds.map((round) => { const decision = workspace.decisions.find((item) => item.roundNumber === round.roundNumber); return [`${round.roundNumber}`, round.bundleId, round.status, decision?.decision ?? "PENDENTE", decision?.rationale ?? "Sem decisão registrada"]; }), workspace.rounds.map((round) => `bundle:${round.bundleId}`));
  if (section.key === "decision-history") return table(["Data", "Evento", "Decisão", "Responsável", "Evidência"], workspace.decisionLedger.map((item) => [new Date(item.decidedAt).toLocaleDateString("pt-BR"), item.title, item.decision, item.decidedBy, item.evidenceRefs.join(", ")]), workspace.decisionLedger.flatMap((item) => item.evidenceRefs));
  if (section.key === "o-que-mudou") return table(["Métrica", "Versão anterior", "Versão atual", "Delta"], workspace.changeReport.map((item) => [item.metric, item.previous, item.current, item.delta === null ? "N/D" : item.delta.toFixed(4)]), workspace.changeReport.flatMap((item) => [`bundle:${item.previousBundleId}`, `bundle:${item.currentBundleId}`]));
  if (section.key === "critical-path") {
    const milestones = workspace.urbanTransformation.milestones.map((item) => ({ id: item.id, title: item.title, durationMonths: null, dependencyIds: [] }));
    const critical = calculateCriticalPath(milestones);
    return table(["Marco", "Status", "Data planejada", "Caminho crítico"], workspace.urbanTransformation.milestones.map((item) => [item.title, item.status, item.plannedDate ?? "Não informada", critical.pathIds.includes(item.id) ? "SIM" : "NÃO DETERMINADO"]), milestones.map((item) => `urban-milestone:${item.id}`));
  }
  if (section.key === "cost-of-delay") {
    const points = calculateDelayStress(bundle.assumptions, bundle.scenario, [3, 6, 12], bundle.frozenAt);
    return table(["Atraso", "VPL", "TIR", "Exposição", "Delta VPL"], points.map((item) => [`+${item.delayMonths} meses`, item.result.metrics.npv, item.result.metrics.annualIrr ?? "N/D", item.result.metrics.maximumCashExposure, item.deltaNpv.toFixed(2)]), [`engine:${bundle.studyVersionId}:${bundle.scenario}`]);
  }
  if (section.key === "valor-maximo-suportavel-do-terreno") {
    const ceiling = calculateLandValueCeiling(bundle.assumptions, bundle.scenario, bundle.frozenAt);
    return table(["Valor máximo", "Restrição vinculante", "Margem", "ROI", "TIR", "Exposição"], [[ceiling.maximumLandPrice.toFixed(2), ceiling.bindingConstraint, ceiling.result.metrics.marginOnVgv, ceiling.result.metrics.roi ?? "N/D", ceiling.result.metrics.annualIrr ?? "N/D", ceiling.result.metrics.maximumCashExposure]], [`engine:${bundle.studyVersionId}:${bundle.scenario}`]);
  }
  if (section.key === "action-center") return table(["Prioridade", "Item", "Status", "Próxima ação"], [...workspace.issues.map((item) => [item.priority, item.title, item.status, item.nextAction]), ...workspace.conditions.map((item) => [item.priority, item.title, item.status, item.evidenceRequired])], [...workspace.issues.map((item) => `issue:${item.id}`), ...workspace.conditions.map((item) => `condition:${item.id}`)]);
  if (section.key === "informacoes-ainda-pendentes") return table(["Categoria", "Pendência", "Criticidade", "Origem"], workspace.checklist.filter((item) => !["RECEIVED", "UNDER_REVIEW", "VERIFIED"].includes(item.status)).map((item) => [item.category, item.title, item.critical ? "CRÍTICA" : "NORMAL", item.source]), workspace.checklist.map((item) => `checklist:${item.id}`));
  if (section.key === "matriz-de-fontes") return table(["Referência", "Fonte", "Link"], bundle.land?.sources.map((source) => [`urban-source:${source.id}`, source.title, source.url ?? "Interna"]) ?? [], bundle.land?.sources.map((source) => `urban-source:${source.id}`) ?? []);
  if (section.key === "trilha-de-calculo") return table(["Métrica", "Fórmula", "Resultado", "Engine"], bundle.engineResults[bundle.scenario].auditTrail.map((item) => [item.label, item.formula, item.result, item.engineVersion]), [`engine:${bundle.studyVersionId}:${bundle.scenario}`]);
  if (section.key === "audit-page") return table(["Campo", "Identificação"], [["Snapshot Bundle", workspace.bundleId], ["Checksum", workspace.bundleChecksum], ["Engine", bundle.engineResults[bundle.scenario].engineVersion], ["Score", bundle.scores[bundle.scenario].policyVersion], ["Red Team", bundle.redTeam?.redTeamVersion ?? "Não vinculado"], ["StudyVersion", `v${bundle.studyVersionNumber}`], ["LandVersion", bundle.landVersionNumber === null ? "Não vinculada" : `v${bundle.landVersionNumber}`]], [`bundle:${bundle.studyVersionId}`]);
  if (section.key === "limitacoes-da-analise") {
    const limitations = [...bundle.missingEvidence, ...(bundle.land?.regulatoryConfidence.missing ?? ["Snapshot urbanístico não vinculado"]), ...workspace.checklist.filter((item) => item.status === "REQUESTED").map((item) => item.title)];
    return table(["Limitação", "Origem"], [...new Set(limitations)].map((item) => [item, "Snapshot / Data Room"]), [`bundle:${bundle.studyVersionId}`]);
  }
  return section;
}

function enrichSection(section: DocumentSection, order: number, workspace: InvestmentCaseWorkspace, config: MasterReportConfig): MasterReportSection {
  const evidenceRefs = section.blocks.flatMap((block) => block.type === "NARRATIVE" ? block.narrative.evidenceRefs.map((item) => item.ref) : "evidenceRefs" in block ? block.evidenceRefs : block.type === "METRICS" ? block.metrics.map((item) => item.sourceRef) : []);
  const wide = section.blocks.some((block) => block.type === "TABLE" && block.headers.length > 7);
  return {
    ...section,
    order,
    sourceRefs: [...new Set(evidenceRefs)],
    scenarioRefs: config.selectedFinancialScenarios,
    versionRefs: config.selectedVersions,
    visibility: [config.audienceProfile],
    pageBreakRules: { startOnNewPage: section.key !== "capa", keepWithNext: section.blocks.length === 0 },
    renderingOptions: { orientation: wide ? "LANDSCAPE" : "PORTRAIT", allowSplit: !wide },
  };
}

function issue(code: string, severity: MasterReportPreflightIssue["severity"], area: MasterReportPreflightIssue["area"], message: string): MasterReportPreflightIssue {
  return { code, severity, area, message };
}

function slug(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
