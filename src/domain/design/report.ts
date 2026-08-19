import type { DocumentBlock, DocumentSection, IntermediateDocumentModel } from "@/domain/investment";
import type { DesignWorkspaceView } from "./types";

export const DESIGN_PROFESSIONAL_DISCLAIMER = "A análise automatizada apoia a revisão e a estruturação de decisões. Não substitui arquiteto, engenheiro, projetista, responsável técnico, ART/RRT, cálculo, verificação normativa formal, aprovação pública ou parecer profissional. Resultados identificados como inferidos, não verificados ou de baixa confiança exigem validação técnica.";

const metricName = (name: string) => ({ TOTAL_BUILT_AREA_M2: "Área construída", PRIVATE_AREA_M2: "Área privativa", PRIVATE_TOTAL_RATE: "Eficiência privativa", CIRCULATION_TOTAL_RATE: "Circulação / total", CORE_TOTAL_RATE: "Core / total", UNIT_COUNT: "Unidades", PARKING_SPACES: "Vagas", FLOOR_AREA_RATIO: "Coeficiente de aproveitamento" } as Record<string, string>)[name] ?? name.replaceAll("_", " ");
const value = (number: number, unit: string) => unit === "ratio" ? `${(number * 100).toFixed(1)}%` : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(number)} ${unit}`;
const baseRef = (workspace: DesignWorkspaceView) => `design:${workspace.package.id}:revision:${workspace.revision.id}`;

function narrative(workspace: DesignWorkspaceView, id: string, text: string, refs: string[] = []): DocumentBlock {
  return { type: "NARRATIVE", narrative: { id, text, origin: "SYSTEM_GENERATED", evidenceRefs: (refs.length ? refs : [baseRef(workspace)]).map((ref) => ({ ref, label: ref, sourceVersion: workspace.revision.label })) } };
}

function table(headers: string[], rows: string[][], refs: string[]): DocumentBlock {
  return { type: "TABLE", headers, rows: rows.length ? rows : [["Não verificado", ...headers.slice(1).map(() => "—")]], evidenceRefs: refs };
}

export function buildDesignReviewDocument(workspace: DesignWorkspaceView, input: { projectName: string; city: string; state: string; generatedAt?: string }): IntermediateDocumentModel {
  const findings = workspace.findings;
  const critical = findings.filter((finding) => ["CRITICAL", "HIGH"].includes(finding.severity));
  const metrics = workspace.metrics;
  const metricRefs = metrics.flatMap((metric) => metric.evidenceRefs);
  const findingRefs = findings.flatMap((finding) => finding.evidence.map((item) => item.ref));
  const opportunityRefs = workspace.opportunities.flatMap((opportunity) => opportunity.evidence.map((item) => item.ref));
  const sourceRefs = [...new Set([baseRef(workspace), ...metricRefs, ...findingRefs, ...opportunityRefs])];
  const sections: DocumentSection[] = [];
  const add = (title: string, blocks: DocumentBlock[]) => sections.push({ key: title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), title, order: sections.length + 1, blocks });
  const categorized = (categories: string[]) => findings.filter((finding) => categories.includes(finding.category) || categories.includes(finding.discipline));
  const findingTable = (items: typeof findings) => table(["Severidade", "Finding", "Confiança", "Status", "Recomendação"], items.map((item) => [item.severity, item.title, item.confidence, item.status, item.recommendation]), items.flatMap((item) => item.evidence.map((evidence) => evidence.ref)));

  add("Projeto analisado", [narrative(workspace, "project", `${input.projectName} · ${input.city}/${input.state}. Project Package: ${workspace.package.name}. Template: ${workspace.package.template}.`)]);
  add("Revisão", [narrative(workspace, "revision", `${workspace.revision.label} · status ${workspace.revision.status}. Pre-flight: ${workspace.package.preflightStatus}. Histórico preservado; esta revisão não sobrescreve revisões anteriores.`)]);
  add("Executive Summary", [narrative(workspace, "executive", `A revisão registra ${workspace.summary.openFindings} findings abertos, ${critical.length} findings high/critical e ${workspace.opportunities.length} oportunidades de Value Engineering. ${workspace.summary.quantifiedOpportunities} oportunidade(s) possuem impacto econômico quantificado com premissa rastreável.`)]);
  add("Documentos recebidos", [table(["Arquivo", "Disciplina", "Formato", "Processamento"], workspace.files.map((file) => [file.name, file.discipline, file.type, file.processingStatus]), workspace.files.map((file) => `design-file:${file.id}`))]);
  add("Documentos faltantes", [table(["Informação / limitação", "Status"], workspace.package.limitations.map((item) => [item, "NÃO VERIFICADO / LIMITADO"]), [baseRef(workspace)])]);
  add("Quadro de áreas", [table(["Métrica", "Valor", "Origem", "Confiança"], metrics.filter((metric) => /AREA|RATE|RATIO/.test(metric.name)).map((metric) => [metricName(metric.name), value(metric.value, metric.unit), metric.origin, metric.confidence]), metricRefs)]);
  add("Eficiência", [table(["Indicador", "Valor", "Origem", "Confiança"], metrics.filter((metric) => /PRIVATE_TOTAL|CIRCULATION_TOTAL|CORE_TOTAL|PARKING_AREA_PER/.test(metric.name)).map((metric) => [metricName(metric.name), value(metric.value, metric.unit), metric.origin, metric.confidence]), metricRefs)]);
  add("Produto", [findingTable(categorized(["PRODUCT", "ARCHITECTURE"]))]);
  add("Implantação", [findingTable(categorized(["SITE_PLAN", "URBANISM"]))]);
  add("Urbanismo", [findingTable(categorized(["URBAN_ALIGNMENT", "URBANISM"]))]);
  add("Tipologias", [findingTable(categorized(["UNIT_LAYOUT", "PRODUCT"]))]);
  add("Circulação", [findingTable(categorized(["CIRCULATION"]))]);
  add("Core", [findingTable(categorized(["CORE"]))]);
  add("Estacionamento", [findingTable(categorized(["PARKING"]))]);
  add("Engenharia", [findingTable(categorized(["STRUCTURAL", "FOUNDATION", "CONSTRUCTABILITY"]))]);
  add("Compatibilização", [findingTable(categorized(["COORDINATION", "BIM"]))]);
  add("Value Engineering", [table(["Oportunidade", "Categoria", "Esforço", "Confiança", "Impacto de custo"], workspace.opportunities.map((item) => [item.title, item.category, item.effort, item.confidence, item.costImpact === null ? "Ainda não quantificado" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(item.costImpact)]), opportunityRefs)]);
  add("Findings", [findingTable(findings)]);
  add("Findings críticos", [findingTable(critical)]);
  add("Impactos econômicos", [table(["Alternativa", "Status", "Engine", "REDE Score"], workspace.alternatives.map((item) => [item.name, item.status, item.financialImpact ? "Calculado" : "Não quantificado", item.scoreImpact ? JSON.stringify(item.scoreImpact) : "Não calculado"]), workspace.alternatives.map((item) => `design-alternative:${item.id}`))]);
  add("Alternativas", [table(["Alternativa", "Descrição", "Status", "Deltas"], workspace.alternatives.map((item) => [item.name, item.description, item.status, JSON.stringify(item.changes)]), workspace.alternatives.map((item) => `design-alternative:${item.id}`))]);
  add("Comparação", [narrative(workspace, "comparison", workspace.alternatives.length ? "As alternativas permanecem no Design Sandbox e são comparadas com o projeto corrente pelo REDE Engine e REDE Score. Nenhuma altera automaticamente o CAD/BIM oficial." : "Nenhuma alternativa foi calculada nesta revisão. Design Diff exige ao menos duas revisões processadas.")]);
  add("Recomendações", [table(["Prioridade", "Recomendação", "Evidência"], [...critical, ...findings.filter((item) => item.severity === "MEDIUM")].slice(0, 10).map((item) => [item.severity, item.recommendation, item.evidence[0]?.ref ?? baseRef(workspace)]), findingRefs)]);
  add("Próximos passos", [narrative(workspace, "next-steps", "Validar escalas e extrações pendentes; atribuir owners e prazos; responder findings; carregar nova revisão; revalidar condições; simular somente oportunidades aceitas; registrar decisões e emitir novo relatório versionado.")]);
  add("Disclaimer", [{ type: "DISCLAIMER", text: DESIGN_PROFESSIONAL_DISCLAIMER }]);
  add("Anexos", [table(["Referência", "Tipo"], sourceRefs.map((ref) => [ref, ref.startsWith("design-file") ? "Arquivo" : ref.includes(":ve:") ? "Value Engineering" : "Evidência"]), sourceRefs)]);

  return {
    schemaVersion: "REDE_DESIGN_REVIEW_REPORT_V1",
    artifactType: "DESIGN_REVIEW_REPORT",
    title: "REDE Design Review Report",
    subtitle: `${input.projectName} · ${workspace.revision.label}`,
    metadata: { projectId: workspace.package.projectId, designPackageId: workspace.package.id, designRevisionId: workspace.revision.id, revision: workspace.revision.label, preflight: workspace.package.preflightStatus },
    sections,
    disclaimers: [DESIGN_PROFESSIONAL_DISCLAIMER],
    sources: sourceRefs.map((ref) => ({ ref, title: ref, url: null })),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    audience: "INTERNAL",
    confidentialityBySection: Object.fromEntries(sections.map((section) => [section.key, "STRICTLY_CONFIDENTIAL"])),
  };
}
