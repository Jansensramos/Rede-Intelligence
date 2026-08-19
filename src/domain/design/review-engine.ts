import type {
  DesignConfidence,
  DesignEvidence,
  DesignFindingDraft,
  DesignMetricInput,
  DesignReviewInput,
  DesignReviewOutput,
  DesignScorecardDimension,
  VEOpportunityDraft,
} from "./types";

export const DESIGN_REVIEW_VERSION = "REDE_DESIGN_REVIEW_V1.0.0";

const severityOrder = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 } as const;
const confidenceOrder = { HIGH: 4, MEDIUM: 3, LOW: 2, NOT_VERIFIED: 1 } as const;
const confidenceFactor = { HIGH: 1, MEDIUM: 0.75, LOW: 0.4, NOT_VERIFIED: 0.15 } as const;
const effortFactor = { LOW: 1, MEDIUM: 0.65, HIGH: 0.35 } as const;

const rounded = (value: number, decimals = 4) => Number(value.toFixed(decimals));
const percent = (value: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value * 100)}%`;
const area = (value: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)} m²`;

function bestMetric(metrics: DesignMetricInput[], name: string) {
  return metrics
    .filter((metric) => metric.name === name && Number.isFinite(metric.value))
    .sort((a, b) => confidenceOrder[b.confidence] - confidenceOrder[a.confidence])[0];
}

function combineConfidence(...values: Array<DesignConfidence | undefined>): DesignConfidence {
  const present = values.filter(Boolean) as DesignConfidence[];
  if (!present.length) return "NOT_VERIFIED";
  return present.sort((a, b) => confidenceOrder[a] - confidenceOrder[b])[0];
}

function calculatedMetric(name: string, value: number, unit: string, inputs: DesignMetricInput[], method: string): DesignMetricInput {
  const confidence = combineConfidence(...inputs.map((input) => input.confidence));
  return {
    name,
    value: rounded(value, unit === "ratio" ? 6 : 3),
    unit,
    origin: "CALCULATED",
    confidence,
    evidence: [...inputs.flatMap((input) => input.evidence), { ref: `CALC:${name}`, label: name, value: `${rounded(value, unit === "ratio" ? 6 : 3)} ${unit}`, origin: "CALCULATED", confidence, method }],
    entityType: "REVISION",
    entityId: inputs[0]?.entityId,
  };
}

function derivedMetrics(input: DesignReviewInput) {
  const metrics = [...input.metrics];
  const total = bestMetric(metrics, "TOTAL_BUILT_AREA_M2");
  const privateArea = bestMetric(metrics, "PRIVATE_AREA_M2");
  const circulation = bestMetric(metrics, "CIRCULATION_AREA_M2");
  const core = bestMetric(metrics, "CORE_AREA_M2");
  const common = bestMetric(metrics, "COMMON_AREA_M2");
  const parkingArea = bestMetric(metrics, "PARKING_AREA_M2");
  const spaces = bestMetric(metrics, "PARKING_SPACES");
  if (total && total.value > 0 && privateArea) metrics.push(calculatedMetric("PRIVATE_TOTAL_RATE", privateArea.value / total.value, "ratio", [privateArea, total], "PRIVATE_AREA_DIV_TOTAL_BUILT_AREA"));
  if (total && total.value > 0 && circulation) metrics.push(calculatedMetric("CIRCULATION_TOTAL_RATE", circulation.value / total.value, "ratio", [circulation, total], "CIRCULATION_AREA_DIV_TOTAL_BUILT_AREA"));
  if (total && total.value > 0 && core) metrics.push(calculatedMetric("CORE_TOTAL_RATE", core.value / total.value, "ratio", [core, total], "CORE_AREA_DIV_TOTAL_BUILT_AREA"));
  if (total && total.value > 0 && common) metrics.push(calculatedMetric("COMMON_TOTAL_RATE", common.value / total.value, "ratio", [common, total], "COMMON_AREA_DIV_TOTAL_BUILT_AREA"));
  if (parkingArea && spaces && spaces.value > 0) metrics.push(calculatedMetric("PARKING_AREA_PER_SPACE_M2", parkingArea.value / spaces.value, "m2/space", [parkingArea, spaces], "PARKING_AREA_DIV_SPACES"));
  if (input.economics?.engineBuiltAreaM2 && total) metrics.push(calculatedMetric("BUILT_AREA_ENGINE_DRIFT_RATE", (total.value - input.economics.engineBuiltAreaM2) / input.economics.engineBuiltAreaM2, "ratio", [total], "DESIGN_MINUS_ENGINE_DIV_ENGINE"));
  if (input.economics?.enginePrivateAreaM2 && privateArea) metrics.push(calculatedMetric("PRIVATE_AREA_ENGINE_DRIFT_RATE", (privateArea.value - input.economics.enginePrivateAreaM2) / input.economics.enginePrivateAreaM2, "ratio", [privateArea], "DESIGN_MINUS_ENGINE_DIV_ENGINE"));
  return metrics;
}

function metricEvidence(...metrics: Array<DesignMetricInput | undefined>) {
  return metrics.filter(Boolean).flatMap((metric) => metric!.evidence);
}

function syntheticEvidence(ref: string, label: string, value: string, method: string, confidence: DesignConfidence = "HIGH"): DesignEvidence {
  return { ref, label, value, origin: "CONFIRMED", confidence, method };
}

function preflight(input: DesignReviewInput) {
  const limitations: string[] = [];
  const missingInformation: string[] = [];
  if (!input.documents.length) return { status: "NOT_READY" as const, limitations: ["Nenhum arquivo de projeto foi recebido."], missingInformation: ["Arquivos de projeto"], dataQuality: "NOT_VERIFIED" as const };
  const architecture = input.documents.some((document) => document.discipline === "ARCHITECTURE");
  const hasIfc = input.documents.some((document) => document.extension.toLowerCase() === "ifc");
  const measurable = input.documents.some((document) => ["CONFIRMED", "HIGH"].includes(document.scaleConfidence ?? "UNKNOWN")) || hasIfc;
  const partial = input.documents.filter((document) => document.support !== "SUPPORTED");
  if (!architecture) missingInformation.push("Projeto de arquitetura");
  if (!input.metrics.some((metric) => metric.name === "DECLARED_TOTAL_AREA_M2")) missingInformation.push("Quadro de áreas verificado");
  if (!measurable) limitations.push("Nenhuma prancha possui escala confirmada e nenhum IFC geométrico está disponível; medições automáticas estão limitadas.");
  if (!hasIfc) limitations.push("IFC não disponível; coordenação BIM, quantidades e clashes não foram verificados.");
  if (partial.length) limitations.push(`${partial.length} arquivo(s) dependem de processamento parcial ou conversão.`);
  if (input.reviewMode === "FULL_REVIEW" && !input.documents.some((document) => document.discipline === "STRUCTURAL")) missingInformation.push("Projeto estrutural");
  const quality: DesignConfidence = measurable && architecture ? (partial.length ? "MEDIUM" : "HIGH") : architecture ? "LOW" : "NOT_VERIFIED";
  return { status: !architecture ? "NOT_READY" as const : limitations.length || missingInformation.length ? "READY_WITH_LIMITATIONS" as const : "READY" as const, limitations, missingInformation, dataQuality: quality };
}

function evaluateFindings(input: DesignReviewInput, metrics: DesignMetricInput[], flight: ReturnType<typeof preflight>) {
  const findings: DesignFindingDraft[] = [];
  const add = (finding: Omit<DesignFindingDraft, "status">) => findings.push({ ...finding, status: "OPEN" });
  for (const missing of flight.missingInformation) add({ key: `MISSING:${missing}`, discipline: "OTHER", category: "DOCUMENT_COMPLETENESS", type: "MISSING_INFORMATION", severity: missing === "Projeto de arquitetura" ? "HIGH" : "MEDIUM", confidence: "HIGH", title: `${missing} não disponível`, description: `A informação “${missing}” não foi localizada no pacote atual.`, implication: "A revisão correspondente permanece limitada e não pode ser tratada como verificação completa.", recommendation: `Fornecer ${missing.toLowerCase()} ou registrar validação manual e sua proveniência.`, evidence: [syntheticEvidence(`PREFLIGHT:MISSING:${missing}`, "Pre-flight", "Ausente", "DOCUMENT_INVENTORY")] });
  if (input.documents.some((document) => document.scaleConfidence === "UNKNOWN" && ["pdf", "png", "jpg", "jpeg", "webp"].includes(document.extension.toLowerCase()))) add({ key: "SCALE:UNKNOWN", discipline: "ARCHITECTURE", category: "DOCUMENTATION", type: "MISSING_INFORMATION", severity: "MEDIUM", confidence: "HIGH", title: "Escala não confirmada", description: "Há pranchas 2D sem escala confirmada. O sistema não calculou dimensões a partir delas.", implication: "Áreas, larguras e distâncias podem permanecer não verificadas.", recommendation: "Calibrar a prancha com dois pontos e uma distância real, ou fornecer IFC/DXF com unidades confiáveis.", evidence: input.documents.filter((document) => document.scaleConfidence === "UNKNOWN").map((document) => syntheticEvidence(`FILE:${document.id}:SCALE`, document.name, "UNKNOWN", "SHEET_METADATA")) });

  const declared = bestMetric(metrics, "DECLARED_TOTAL_AREA_M2");
  const geometry = bestMetric(metrics, "GEOMETRY_TOTAL_AREA_M2");
  if (declared && geometry) {
    const delta = geometry.value - declared.value;
    const rate = declared.value === 0 ? 1 : Math.abs(delta) / Math.abs(declared.value);
    const exceeds = Math.abs(delta) > (input.areaToleranceM2 ?? 20) && rate > (input.areaToleranceRate ?? 0.01);
    if (exceeds) add({ key: "AREA:RECONCILIATION", discipline: "ARCHITECTURE", category: "AREAS", type: "AREA_MISMATCH", severity: rate > 0.05 ? "HIGH" : "MEDIUM", confidence: combineConfidence(declared.confidence, geometry.confidence), title: "Quadro de áreas não reconcilia com a geometria", description: `Quadro informado: ${area(declared.value)}; geometria: ${area(geometry.value)}; diferença: ${area(delta)} (${percent(rate)}).`, implication: "A divergência pode afetar eficiência, custo, produto e aderência ao estudo econômico.", recommendation: "Validar escala e critérios de medição; depois corrigir o quadro ou a geometria e reprocessar a revisão.", evidence: metricEvidence(declared, geometry), relatedMetric: "AREA_RECONCILIATION_DELTA_M2", potentialImpact: { areaDeltaM2: rounded(delta, 2), areaDeltaRate: rounded(rate, 6) } });
  }

  const total = bestMetric(metrics, "TOTAL_BUILT_AREA_M2");
  const privateArea = bestMetric(metrics, "PRIVATE_AREA_M2");
  const efficiency = bestMetric(metrics, "PRIVATE_TOTAL_RATE");
  if (efficiency && input.brief?.targetEfficiencyRate !== undefined && efficiency.value < input.brief.targetEfficiencyRate) {
    const gap = input.brief.targetEfficiencyRate - efficiency.value;
    add({ key: "EFFICIENCY:PRIVATE_TOTAL", discipline: "ARCHITECTURE", category: "EFFICIENCY", type: "INEFFICIENCY", severity: gap >= 0.05 ? "HIGH" : "MEDIUM", confidence: efficiency.confidence, title: "Eficiência privativa abaixo da meta", description: `Eficiência calculada: ${percent(efficiency.value)}; meta do brief: ${percent(input.brief.targetEfficiencyRate)}.`, implication: "Mais área construída é consumida por áreas não privativas para o mesmo produto.", recommendation: "Revisar circulação, core e áreas comuns sem comprometer requisitos técnicos e de produto.", evidence: [...efficiency.evidence, syntheticEvidence("BRIEF:TARGET_EFFICIENCY", "Meta de eficiência", percent(input.brief.targetEfficiencyRate), "PROJECT_BRIEF")], relatedMetric: "PRIVATE_TOTAL_RATE", potentialImpact: { gapRate: rounded(gap, 6), avoidableBuiltAreaM2: total && privateArea ? rounded(Math.max(0, total.value - privateArea.value / input.brief.targetEfficiencyRate), 2) : null } });
  }

  const circulation = bestMetric(metrics, "CIRCULATION_TOTAL_RATE");
  if (circulation && input.brief?.maximumCirculationRate !== undefined && circulation.value > input.brief.maximumCirculationRate) {
    const excessArea = total ? (circulation.value - input.brief.maximumCirculationRate) * total.value : null;
    add({ key: "EFFICIENCY:CIRCULATION", discipline: "ARCHITECTURE", category: "CIRCULATION", type: "INEFFICIENCY", severity: circulation.value - input.brief.maximumCirculationRate >= 0.03 ? "HIGH" : "MEDIUM", confidence: circulation.confidence, title: "Circulação acima do target", description: `Circulação: ${percent(circulation.value)}; target máximo: ${percent(input.brief.maximumCirculationRate)}.`, implication: "O pavimento dedica área acima da meta a circulação não vendável.", recommendation: "Avaliar encurtamento de corredores, posição do núcleo e repetição do pavimento, com validação de acessibilidade e incêndio.", evidence: [...circulation.evidence, syntheticEvidence("BRIEF:MAX_CIRCULATION", "Máximo de circulação", percent(input.brief.maximumCirculationRate), "PROJECT_BRIEF")], relatedMetric: "CIRCULATION_TOTAL_RATE", potentialImpact: { excessAreaM2: excessArea === null ? null : rounded(excessArea, 2) } });
  }

  const core = bestMetric(metrics, "CORE_TOTAL_RATE");
  if (core && input.brief?.maximumCoreRate !== undefined && core.value > input.brief.maximumCoreRate) add({ key: "EFFICIENCY:CORE", discipline: "ARCHITECTURE", category: "CORE", type: "INEFFICIENCY", severity: core.value - input.brief.maximumCoreRate >= 0.02 ? "HIGH" : "MEDIUM", confidence: core.confidence, title: "Core acima da meta de projeto", description: `Core: ${percent(core.value)}; meta máxima: ${percent(input.brief.maximumCoreRate)}.`, implication: "Área não vendável e complexidade do núcleo podem estar pressionando a eficiência.", recommendation: "Revisar dimensionamento e arranjo de elevadores, escadas, halls e shafts com os responsáveis técnicos.", evidence: [...core.evidence, syntheticEvidence("BRIEF:MAX_CORE", "Máximo de core", percent(input.brief.maximumCoreRate), "PROJECT_BRIEF")], relatedMetric: "CORE_TOTAL_RATE", potentialImpact: { excessAreaM2: total ? rounded((core.value - input.brief.maximumCoreRate) * total.value, 2) : null } });

  const units = bestMetric(metrics, "UNIT_COUNT");
  if (units && input.brief?.targetUnits !== undefined && Math.round(units.value) !== input.brief.targetUnits) {
    const delta = Math.round(units.value) - input.brief.targetUnits;
    add({ key: "PRODUCT:UNIT_COUNT", discipline: "ARCHITECTURE", category: "PRODUCT", type: "PRODUCT_OPPORTUNITY", severity: Math.abs(delta) / Math.max(1, input.brief.targetUnits) > 0.03 ? "HIGH" : "MEDIUM", confidence: units.confidence, title: "Quantidade de unidades diverge do brief", description: `Projeto: ${Math.round(units.value)} unidades; brief: ${input.brief.targetUnits}; diferença: ${delta > 0 ? "+" : ""}${delta}.`, implication: "A alteração pode afetar mix, vagas, VGV, custo e premissas do Engine.", recommendation: "Confirmar a contagem por torre/pavimento e reconciliar Product Strategy e Engine.", evidence: [...units.evidence, syntheticEvidence("BRIEF:TARGET_UNITS", "Unidades-alvo", String(input.brief.targetUnits), "PROJECT_BRIEF")], relatedMetric: "UNIT_COUNT", potentialImpact: { unitsDelta: delta } });
  }

  const parking = bestMetric(metrics, "PARKING_SPACES");
  if (parking && input.brief?.targetParkingSpaces !== undefined && Math.round(parking.value) !== input.brief.targetParkingSpaces) add({ key: "PRODUCT:PARKING", discipline: "PARKING", category: "PRODUCT", type: "INCONSISTENCY", severity: "MEDIUM", confidence: parking.confidence, title: "Vagas divergem da meta", description: `Projeto: ${Math.round(parking.value)} vagas; meta: ${input.brief.targetParkingSpaces}.`, implication: "Pode haver divergência de produto ou área de subsolo desnecessária.", recommendation: "Validar associação vagas/unidades e reconciliar o brief comercial.", evidence: [...parking.evidence, syntheticEvidence("BRIEF:TARGET_PARKING", "Vagas-alvo", String(input.brief.targetParkingSpaces), "PROJECT_BRIEF")], relatedMetric: "PARKING_SPACES", potentialImpact: { parkingDelta: Math.round(parking.value) - input.brief.targetParkingSpaces } });

  const floorAreaRatio = bestMetric(metrics, "FLOOR_AREA_RATIO");
  if (floorAreaRatio && input.urban?.maximumFloorAreaRatio !== undefined && floorAreaRatio.value > input.urban.maximumFloorAreaRatio) add({ key: "URBAN:FLOOR_AREA_RATIO", discipline: "URBANISM", category: "URBAN_ALIGNMENT", type: "URBAN_CONFLICT", severity: "HIGH", confidence: combineConfidence(floorAreaRatio.confidence, input.urban.confidence), title: "Potencial conflito com o cenário urbanístico", description: `CA do projeto: ${rounded(floorAreaRatio.value, 2)}; limite do cenário ${input.urban.scenarioType}: ${rounded(input.urban.maximumFloorAreaRatio, 2)}.`, implication: "O projeto pode exceder a premissa urbanística usada na viabilidade.", recommendation: "Validar método de cálculo, regra versionada e cenário; não tratar este check preliminar como parecer legal.", evidence: [...floorAreaRatio.evidence, syntheticEvidence(input.urban.sourceRef ?? `URBAN:${input.urban.scenarioType}:MAX_CA`, `CA máximo · ${input.urban.scenarioType}`, String(input.urban.maximumFloorAreaRatio), "URBAN_SCENARIO", input.urban.confidence)], relatedMetric: "FLOOR_AREA_RATIO", potentialImpact: { excess: rounded(floorAreaRatio.value - input.urban.maximumFloorAreaRatio, 4), scenarioType: input.urban.scenarioType } });

  if (total && input.economics?.engineBuiltAreaM2) {
    const delta = total.value - input.economics.engineBuiltAreaM2;
    const rate = Math.abs(delta) / input.economics.engineBuiltAreaM2;
    if (rate > (input.areaToleranceRate ?? 0.01)) add({ key: "ECONOMICS:BUILT_AREA", discipline: "COST", category: "DESIGN_TO_ECONOMICS", type: "INCONSISTENCY", severity: rate > 0.05 ? "HIGH" : "MEDIUM", confidence: total.confidence, title: "Área construída diverge do Engine", description: `Projeto: ${area(total.value)}; Engine: ${area(input.economics.engineBuiltAreaM2)}; desvio: ${area(delta)} (${percent(rate)}).`, implication: "Custos e retornos do estudo podem não representar o projeto corrente.", recommendation: "Criar Design Alternative com delta estruturado e recalcular no REDE Engine; não duplicar fórmulas financeiras neste módulo.", evidence: [...total.evidence, syntheticEvidence(input.economics.engineEvidenceRef ?? "ENGINE:BUILT_AREA", "Área construída no Engine", area(input.economics.engineBuiltAreaM2), "REDE_ENGINE")], relatedMetric: "TOTAL_BUILT_AREA_M2", potentialImpact: { areaDeltaM2: rounded(delta, 2), quantification: input.economics.constructionCostPerM2 === undefined ? "PENDING" : "AVAILABLE" } });
  }

  return findings.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity] || b.key.localeCompare(a.key));
}

function opportunitiesFromFindings(input: DesignReviewInput, findings: DesignFindingDraft[]): VEOpportunityDraft[] {
  const costRate = input.economics?.constructionCostPerM2;
  const result: VEOpportunityDraft[] = [];
  for (const finding of findings) {
    const potentialArea = Number(finding.potentialImpact?.avoidableBuiltAreaM2 ?? finding.potentialImpact?.excessAreaM2 ?? 0);
    const quantifiedCost = costRate !== undefined && potentialArea > 0 ? rounded(potentialArea * costRate, 2) : null;
    if (finding.key === "EFFICIENCY:PRIVATE_TOTAL") result.push({ key: "VE:AREA_EFFICIENCY", title: "Recuperar eficiência privativa", category: "AREA_EFFICIENCY", currentCondition: finding.description, proposedCondition: "Reduzir área não privativa preservando requisitos técnicos, ou converter área construída em área privativa.", evidence: finding.evidence, relatedFindingKeys: [finding.key], designImpact: { avoidableBuiltAreaM2: potentialArea || null }, costImpact: quantifiedCost, revenueImpact: null, scheduleImpactMonths: null, riskImpact: "Requer validação integrada de arquitetura, estrutura, acessibilidade e incêndio.", confidence: finding.confidence, effort: "HIGH", requiresProfessionalValidation: true, valueRank: 0 });
    if (finding.key === "EFFICIENCY:CIRCULATION") result.push({ key: "VE:CIRCULATION", title: "Otimizar circulação do pavimento", category: "CIRCULATION", currentCondition: finding.description, proposedCondition: "Testar núcleo e distribuição com menos área de corredor, sem assumir alteração automática da geometria oficial.", evidence: finding.evidence, relatedFindingKeys: [finding.key], designImpact: { potentialAreaM2: potentialArea || null }, costImpact: quantifiedCost, revenueImpact: null, scheduleImpactMonths: null, riskImpact: "Rotas, acessibilidade, evacuação e experiência do usuário precisam de validação profissional.", confidence: finding.confidence, effort: "MEDIUM", requiresProfessionalValidation: true, valueRank: 0 });
    if (finding.key === "EFFICIENCY:CORE") result.push({ key: "VE:CORE", title: "Reavaliar área do núcleo vertical", category: "CORE", currentCondition: finding.description, proposedCondition: "Revisar halls, shafts, escadas e elevadores contra demanda e regras configuradas.", evidence: finding.evidence, relatedFindingKeys: [finding.key], designImpact: { potentialAreaM2: potentialArea || null }, costImpact: quantifiedCost, revenueImpact: null, scheduleImpactMonths: null, riskImpact: "Não reduzir capacidade ou segurança sem estudo dos projetistas responsáveis.", confidence: finding.confidence, effort: "HIGH", requiresProfessionalValidation: true, valueRank: 0 });
    if (finding.key === "PRODUCT:UNIT_COUNT") result.push({ key: "VE:PRODUCT", title: "Reconciliar produto e quantidade de unidades", category: "PRODUCT", currentCondition: finding.description, proposedCondition: "Testar no Design Sandbox o mix e a contagem previstos no brief e enviar o delta ao Engine.", evidence: finding.evidence, relatedFindingKeys: [finding.key], designImpact: { unitsDelta: Number(finding.potentialImpact?.unitsDelta ?? 0) }, costImpact: null, revenueImpact: null, scheduleImpactMonths: null, riskImpact: "Impacto econômico ainda não quantificado; depende de tipologia, preço e custos do Engine.", confidence: finding.confidence, effort: "MEDIUM", requiresProfessionalValidation: true, valueRank: 0 });
  }
  return result.map((opportunity) => {
    const economicValue = Math.max(0, opportunity.costImpact ?? 0) + Math.max(0, opportunity.revenueImpact ?? 0);
    const severity = Math.max(...opportunity.relatedFindingKeys.map((key) => severityOrder[findings.find((finding) => finding.key === key)?.severity ?? "INFO"]));
    return { ...opportunity, valueRank: rounded((economicValue / 1000 + severity * 10) * confidenceFactor[opportunity.confidence] * effortFactor[opportunity.effort], 3) };
  }).sort((a, b) => b.valueRank - a.valueRank || a.key.localeCompare(b.key));
}

function scorecard(input: DesignReviewInput, metrics: DesignMetricInput[], findings: DesignFindingDraft[], flight: ReturnType<typeof preflight>): DesignScorecardDimension[] {
  const dimension = (key: DesignScorecardDimension["key"], label: string, related: (finding: DesignFindingDraft) => boolean, value: number | null, positive: string, notVerified: string): DesignScorecardDimension => {
    const matches = findings.filter(related);
    const highest = matches[0]?.severity;
    return { key, label, status: !matches.length && value === null ? "NOT_VERIFIED" : highest === "CRITICAL" || highest === "HIGH" ? "CRITICAL" : highest ? "ATTENTION" : "POSITIVE", value, explanation: matches[0]?.title ?? (value === null ? notVerified : positive), evidenceRefs: matches.flatMap((finding) => finding.evidence.map((item) => item.ref)).slice(0, 12) };
  };
  const efficiency = bestMetric(metrics, "PRIVATE_TOTAL_RATE")?.value ?? null;
  return [
    dimension("AREA_EFFICIENCY", "Eficiência de área", (finding) => ["EFFICIENCY", "CIRCULATION", "CORE", "AREAS"].includes(finding.category), efficiency, "Métricas de eficiência sem desvio acima das tolerâncias configuradas.", "Área total e privativa verificadas são necessárias."),
    dimension("PRODUCT_ALIGNMENT", "Aderência ao produto", (finding) => finding.category === "PRODUCT", bestMetric(metrics, "UNIT_COUNT")?.value ?? null, "Produto reconciliado com o brief disponível.", "Brief e contagem de unidades são necessários."),
    dimension("URBAN_ALIGNMENT", `Urbanismo · ${input.urban?.scenarioType ?? "não configurado"}`, (finding) => finding.category === "URBAN_ALIGNMENT", bestMetric(metrics, "FLOOR_AREA_RATIO")?.value ?? null, "Nenhum conflito preliminar foi identificado no cenário selecionado.", "Cenário urbanístico e métricas de implantação não verificados."),
    dimension("CONSTRUCTABILITY", "Construtibilidade", (finding) => ["CONSTRUCTABILITY", "STRUCTURE"].includes(finding.category), null, "Sem flags preliminares.", "Projetos técnicos não permitem conclusão de construtibilidade."),
    dimension("COST_OPPORTUNITY", "Oportunidade de custo", (finding) => ["COST", "DESIGN_TO_ECONOMICS"].includes(finding.category), input.economics?.constructionCostPerM2 ?? null, "Projeto reconciliado com premissas econômicas disponíveis.", "Orçamento/custo unitário não disponível."),
    { key: "DOCUMENT_COMPLETENESS", label: "Completude documental", status: flight.status === "READY" ? "POSITIVE" : flight.status === "NOT_READY" ? "CRITICAL" : "ATTENTION", value: input.documents.length, explanation: flight.missingInformation.length ? `${flight.missingInformation.length} informação(ões) necessária(s) ainda faltam.` : "Pacote suficiente para o modo de revisão selecionado.", evidenceRefs: input.documents.map((document) => `FILE:${document.id}`) },
    dimension("COORDINATION", "Coordenação", (finding) => finding.category === "COORDINATION", input.documents.some((document) => document.extension.toLowerCase() === "ifc") ? 1 : null, "Base BIM disponível para coordenação.", "IFCs coordenados não estão disponíveis; clashes não verificados."),
  ];
}

export function reviewDesign(input: DesignReviewInput): DesignReviewOutput {
  const calculatedMetrics = derivedMetrics(input);
  const flight = preflight(input);
  const findings = evaluateFindings(input, calculatedMetrics, flight);
  const opportunities = opportunitiesFromFindings(input, findings);
  const card = scorecard(input, calculatedMetrics, findings, flight);
  const efficiency = bestMetric(calculatedMetrics, "PRIVATE_TOTAL_RATE")?.value ?? null;
  const driftRates = [bestMetric(calculatedMetrics, "BUILT_AREA_ENGINE_DRIFT_RATE")?.value, bestMetric(calculatedMetrics, "PRIVATE_AREA_ENGINE_DRIFT_RATE")?.value].filter((value): value is number => value !== undefined);
  const designDriftRate = driftRates.length ? Math.max(...driftRates.map(Math.abs)) : null;
  const insights = [
    ...findings.slice(0, 3).map((finding) => finding.title),
    ...opportunities.slice(0, 2).map((opportunity) => opportunity.title),
  ].filter((value, index, list) => list.indexOf(value) === index);
  return {
    schemaVersion: "REDE_DESIGN_REVIEW_V1",
    preflight: flight,
    calculatedMetrics,
    findings,
    opportunities,
    scorecard: card,
    insights,
    summary: {
      criticalFindings: findings.filter((finding) => finding.severity === "CRITICAL").length,
      openFindings: findings.length,
      quantifiedOpportunities: opportunities.filter((opportunity) => opportunity.costImpact !== null || opportunity.revenueImpact !== null).length,
      efficiencyRate: efficiency,
      designDriftRate,
    },
  };
}

export interface DesignRevisionDiff {
  name: string;
  unit: string;
  from: number | null;
  to: number | null;
  delta: number | null;
  deltaRate: number | null;
  kind: "ADDED" | "REMOVED" | "MODIFIED" | "UNCHANGED";
  confidence: DesignConfidence;
  evidenceRefs: string[];
}

export function compareDesignMetrics(fromMetrics: DesignMetricInput[], toMetrics: DesignMetricInput[], toleranceRate = 0.001): DesignRevisionDiff[] {
  const names = [...new Set([...fromMetrics.map((metric) => metric.name), ...toMetrics.map((metric) => metric.name)])].sort();
  return names.map((name) => {
    const from = bestMetric(fromMetrics, name);
    const to = bestMetric(toMetrics, name);
    const delta = from && to ? to.value - from.value : null;
    const rate = delta !== null && from && from.value !== 0 ? delta / Math.abs(from.value) : null;
    const kind = !from ? "ADDED" : !to ? "REMOVED" : rate !== null ? Math.abs(rate) <= toleranceRate ? "UNCHANGED" : "MODIFIED" : Math.abs(delta ?? 0) <= toleranceRate ? "UNCHANGED" : "MODIFIED";
    return { name, unit: to?.unit ?? from?.unit ?? "", from: from?.value ?? null, to: to?.value ?? null, delta: delta === null ? null : rounded(delta, 6), deltaRate: rate === null ? null : rounded(rate, 6), kind, confidence: combineConfidence(from?.confidence, to?.confidence), evidenceRefs: [...(from?.evidence ?? []), ...(to?.evidence ?? [])].map((item) => item.ref) };
  });
}

export function manualScaleCalibration(input: { pixelDistance: number; realDistance: number; unit: "mm" | "cm" | "m" }) {
  if (!Number.isFinite(input.pixelDistance) || input.pixelDistance <= 0 || !Number.isFinite(input.realDistance) || input.realDistance <= 0) throw new Error("Distâncias de calibração devem ser positivas.");
  const metres = input.unit === "m" ? input.realDistance : input.unit === "cm" ? input.realDistance / 100 : input.realDistance / 1000;
  return { metresPerPixel: rounded(metres / input.pixelDistance, 10), confidence: "CONFIRMED" as const, method: "USER_TWO_POINT_CALIBRATION" };
}
