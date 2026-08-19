import type { AIAnswer, AIResponseEvidenceInput, AIStructuredBlock, AIToolCallResult, RelevantContextPackage } from "@/domain/ai";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 2 });
const exactMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percent = (value: unknown) => value === null || value === undefined ? "N/D" : `${number.format(Number(value) * 100)}%`;
const pp = (value: number) => `${value >= 0 ? "+" : ""}${number.format(value * 100)} p.p.`;

function result<T>(tools: AIToolCallResult[], name: string): T | undefined { return tools.find((item) => item.name === name && item.status === "COMPLETED")?.data as T | undefined; }
function dedupeEvidence(tools: AIToolCallResult[]) { const map = new Map<string, AIResponseEvidenceInput>(); for (const item of tools) for (const source of item.evidence ?? []) map.set(source.evidenceRef, source); return [...map.values()]; }

export function composeGroundedAnswer(context: RelevantContextPackage, tools: AIToolCallResult[], task: AIAnswer["task"]): AIAnswer {
  const blocks: AIStructuredBlock[] = [];
  const parts: string[] = [];
  const engine = result<{ scenario: string; metrics: Record<string, string | number | null>; recommendation: { label: string; dominantReason: string } }>(tools, "getEngineResults");
  const score = result<{ totalScore: number; classification: string; explanation?: { strengths: string[]; weaknesses: string[]; criticalFactors: string[] } }>(tools, "getScore") ?? result(tools, "getScoreExplanation");
  const redTeam = result<{ conclusion?: { decision: string; dominantRisk: string; executiveSummary: string }; findings?: { title: string; severity: string; status: string; recommendedAction: string }[]; unavailable?: boolean }>(tools, "getRedTeam");
  const readiness = result<{ investment: { score: number; label: string; blockers: string[] }; dataRoom: { overall: number }; urban: number; label: string }>(tools, "getReadiness");
  const project = result<{ name: string; city: string; state: string; assumptions: { units: number; landAreaM2: string } }>(tools, "getProject");
  if (project) parts.push(`${project.name}, em ${project.city}/${project.state}, possui ${project.assumptions.units} unidades modeladas no Snapshot v${context.workspace.bundle.studyVersionNumber}.`);
  if (engine) {
    const metrics = engine.metrics;
    parts.push(`No cenário ${engine.scenario}, o Engine registra VGV de ${exactMoney.format(Number(metrics.vgv))}, margem de ${percent(metrics.marginOnVgv)}, VPL de ${exactMoney.format(Number(metrics.npv))} e exposição máxima de ${exactMoney.format(Number(metrics.maximumCashExposure))}.`);
    blocks.push({ type: "metric", title: "VGV", value: money.format(Number(metrics.vgv)), evidenceStatementId: `engine-${engine.scenario}-vgv` }, { type: "metric", title: "Margem", value: percent(metrics.marginOnVgv), tone: Number(metrics.marginOnVgv) * 100 >= Number(context.workspace.bundle.assumptions.policy.minimumMarginRate) ? "positive" : "critical", evidenceStatementId: `engine-${engine.scenario}-marginOnVgv` }, { type: "metric", title: "VPL", value: money.format(Number(metrics.npv)), tone: Number(metrics.npv) >= 0 ? "positive" : "critical", evidenceStatementId: `engine-${engine.scenario}-npv` }, { type: "metric", title: "Equity", value: money.format(Number(metrics.equityCapitalRequired)), evidenceStatementId: `engine-${engine.scenario}-equityCapitalRequired` });
  }
  if (score) {
    parts.push(`O REDE Score é ${number.format(score.totalScore)} (${score.classification}).`);
    blocks.push({ type: "metric", title: "REDE Score", value: number.format(score.totalScore), tone: score.totalScore >= 70 ? "positive" : score.totalScore >= 50 ? "warning" : "critical", evidenceStatementId: `score-${context.workspace.bundle.studyVersionId}-${context.selection.financialScenario}` });
    if (score.explanation?.weaknesses?.length) parts.push(`Principais perdas: ${score.explanation.weaknesses.slice(0, 3).join("; ")}.`);
  }
  if (redTeam?.conclusion) {
    parts.push(`O Red Team recomenda ${redTeam.conclusion.decision}; o risco dominante é ${redTeam.conclusion.dominantRisk}.`);
    blocks.push({ type: "warning", title: `Red Team · ${redTeam.conclusion.decision}`, content: redTeam.conclusion.dominantRisk, severity: redTeam.conclusion.decision === "REJECT" ? "CRITICAL" : "WARNING" }, { type: "deep_link", label: "Abrir REDE Red Team", module: "redteam" });
  }
  if (readiness) parts.push(`Investment Readiness: ${number.format(readiness.investment.score)}% (${readiness.investment.label}); Data Room: ${number.format(readiness.dataRoom.overall)}%.`);

  const simulation = result<{ label: string; changes: Record<string, number>; base: { metrics: Record<string, string | number | null>; score: { totalScore: number }; decision: { label: string } }; simulated: { metrics: Record<string, string | number | null>; score: { totalScore: number }; decision: { label: string } } }>(tools, "runEngineSimulation");
  if (simulation) {
    const metricKeys = [["Margem", "marginOnVgv", true], ["VPL", "npv", false], ["Exposição", "maximumCashExposure", false], ["Equity", "equityCapitalRequired", false]] as const;
    const rows = metricKeys.map(([label, key, isPercent]) => { const base = Number(simulation.base.metrics[key]); const simulated = Number(simulation.simulated.metrics[key]); return { label, base: isPercent ? percent(base) : money.format(base), simulated: isPercent ? percent(simulated) : money.format(simulated), delta: isPercent ? pp(simulated - base) : money.format(simulated - base) }; });
    parts.length = 0;
    parts.push(`SIMULAÇÃO — NÃO OFICIAL. Com ${Object.entries(simulation.changes).map(([key, value]) => `${key}: ${value}`).join(", ")}, a margem passa de ${rows[0].base} para ${rows[0].simulated}; o Score passa de ${number.format(simulation.base.score.totalScore)} para ${number.format(simulation.simulated.score.totalScore)}.`);
    parts.push(`A recomendação determinística muda de ${simulation.base.decision.label} para ${simulation.simulated.decision.label}. A hipótese não altera o snapshot oficial.`);
    blocks.length = 0;
    blocks.push({ type: "simulation", title: "What-if determinístico", changes: Object.entries(simulation.changes).map(([key, value]) => `${key}: ${value}`), metrics: rows, disclaimer: "SIMULAÇÃO — NÃO OFICIAL. Projeções não são garantia de retorno." });
  }

  const comparison = result<{ scenario: string; metrics: Record<string, string | null>; score: { totalScore: number } }[]>(tools, "compareScenarios");
  if (comparison) {
    parts.length = 0;
    const bestNpv = [...comparison].sort((a, b) => Number(b.metrics.npv) - Number(a.metrics.npv))[0];
    const leastEquity = [...comparison].sort((a, b) => Number(a.metrics.equityCapitalRequired) - Number(b.metrics.equityCapitalRequired))[0];
    const bestScore = [...comparison].sort((a, b) => b.score.totalScore - a.score.totalScore)[0];
    parts.push(`Melhor VPL: ${bestNpv.scenario}. Menor equity: ${leastEquity.scenario}. Melhor Score: ${bestScore.scenario}. A escolha depende do limite de exposição e da política do investimento.`);
    blocks.length = 0;
    blocks.push({ type: "comparison", title: "Comparação financeira", columns: ["Cenário", "VPL", "Margem", "Equity", "Score"], rows: comparison.map((item) => [item.scenario, money.format(Number(item.metrics.npv)), percent(item.metrics.marginOnVgv), money.format(Number(item.metrics.equityCapitalRequired)), number.format(item.score.totalScore)]) });
  }

  const reverse = result<{ label: string; result: { requiredFAR: number; requiredOccupancyRate: number; requiredHeight: number; requiredFloors: number; feasible: boolean; warnings: string[] } }>(tools, "runReverseZoningSolver");
  if (reverse) {
    parts.length = 0;
    parts.push(`SIMULAÇÃO URBANÍSTICA — NÃO EQUIVALE A APROVAÇÃO. O programa exige CA ${number.format(reverse.result.requiredFAR)}, ocupação ${number.format(reverse.result.requiredOccupancyRate)}%, altura estimada ${number.format(reverse.result.requiredHeight)} m e ${reverse.result.requiredFloors} pavimentos.`);
    if (reverse.result.warnings.length) parts.push(reverse.result.warnings.join(" "));
    blocks.length = 0;
    blocks.push({ type: "metric", title: "CA necessário", value: number.format(reverse.result.requiredFAR), tone: reverse.result.feasible ? "positive" : "critical" }, { type: "metric", title: "Pavimentos", value: String(reverse.result.requiredFloors) }, { type: "warning", title: "Nota regulatória", content: "Cenário calculado pelo Reverse Zoning Solver; não representa aprovação municipal.", severity: "WARNING" });
  }

  const ceiling = result<{ maximumLandPrice: number; bindingConstraint: string; result: { metrics: Record<string, string | null> } }>(tools, "calculateLandValueCeiling");
  if (ceiling) { parts.length = 0; parts.push(`O valor máximo determinístico suportável do terreno é ${exactMoney.format(ceiling.maximumLandPrice)} no cenário ${context.selection.financialScenario}. A restrição vinculante é ${ceiling.bindingConstraint}.`); blocks.length = 0; blocks.push({ type: "metric", title: "Terreno máximo", value: exactMoney.format(ceiling.maximumLandPrice), tone: "warning" }); }
  const delay = result<{ delayMonths: number; deltaNpv: number; deltaExposure: number; result: { metrics: Record<string, string | null> } }>(tools, "calculateCostOfDelay");
  if (delay) { parts.length = 0; parts.push(`SIMULAÇÃO — NÃO OFICIAL. Um atraso de ${delay.delayMonths} meses altera o VPL em ${exactMoney.format(delay.deltaNpv)} e a exposição máxima em ${exactMoney.format(delay.deltaExposure)}.`); blocks.length = 0; blocks.push({ type: "simulation", title: `Atraso de ${delay.delayMonths} meses`, changes: [`Aprovação +${delay.delayMonths} meses`], metrics: [{ label: "VPL", base: "Snapshot", simulated: money.format(Number(delay.result.metrics.npv)), delta: money.format(delay.deltaNpv) }, { label: "Exposição", base: "Snapshot", simulated: money.format(Number(delay.result.metrics.maximumCashExposure)), delta: money.format(delay.deltaExposure) }], disclaimer: "SIMULAÇÃO — NÃO OFICIAL." }); }

  const documentStatus = result<{ completeness: { overall: number }; missing: { title: string; category: string; critical: boolean }[] }>(tools, "getDocumentStatus");
  if (documentStatus) { parts.push(`Há ${documentStatus.missing.length} evidências pendentes; completude documental de ${number.format(documentStatus.completeness.overall)}%.`); for (const item of documentStatus.missing.slice(0, 5)) blocks.push({ type: "action", title: item.title, status: "PENDENTE", priority: item.critical ? "CRITICAL" : "NORMAL", description: item.category }); }
  const conditions = result<{ title: string; status: string; priority: string; description: string; isBlocker: boolean }[]>(tools, "getConditions");
  const blockers = result<{ title?: string; target?: string; evidenceRequired?: string }[]>(tools, "getBlockers");
  if (conditions || blockers) { const open = conditions?.filter((item) => item.status !== "VERIFIED") ?? []; parts.push(`Para aprovação, permanecem ${blockers?.length ?? 0} blockers e ${open.length} condicionantes abertas.`); for (const item of open.slice(0, 5)) blocks.push({ type: "action", title: item.title, status: item.status, priority: item.priority, description: item.description }); }
  const brief = result<Record<string, unknown>>(tools, "prepareCommitteeBrief");
  if (brief) { parts.length = 0; parts.push(`Briefing do Comitê preparado sobre o Snapshot v${context.workspace.bundle.studyVersionNumber}. Ele consolida decisão anterior, mudanças, métricas, Score, Red Team, blockers, condições, riscos, documentos e Gates registrados.`); blocks.push({ type: "deep_link", label: "Abrir Investment Committee", module: "committee" }); }
  const search = result<{ title: string; excerpt: string; source: string }[]>(tools, "searchInternalEvidence");
  if (search) { if (!search.length) parts.push("Não encontrei evidência suficiente para afirmar isso."); else { parts.push(`Encontrei ${search.length} referências internas autorizadas.`); for (const item of search.slice(0, 6)) blocks.push({ type: "action", title: item.title, status: item.source, priority: "EVIDÊNCIA", description: item.excerpt }); } }
  const contextChanged = result<Record<string, unknown>>(tools, "changeContext");
  if (contextChanged) { parts.length = 0; parts.push(`Contexto alterado explicitamente para ${"studyVersionNumber" in contextChanged ? `StudyVersion v${contextChanged.studyVersionNumber}` : "a seleção solicitada"}${"financialScenario" in contextChanged ? ` · cenário ${contextChanged.financialScenario}` : ""}. Mensagens anteriores permanecem ligadas ao contexto original.`); }
  const preflight = result<{ canGenerateFinal: boolean; blockers: unknown[]; warnings: unknown[] }>(tools, "preflightMasterReport");
  if (preflight) { parts.push(`Preflight do Full Dossier: ${preflight.canGenerateFinal ? "apto para FINAL" : "FINAL bloqueado"}; ${preflight.blockers.length} blockers e ${preflight.warnings.length} warnings.`); }
  if (context.staleConversation) parts.unshift(`Aviso: esta conversa foi iniciada em uma versão anterior. O contexto preservado é v${context.selection.studyVersionNumber}.`);
  if (!parts.length) parts.push("Esse dado não está disponível no estudo atual.");
  const failed = tools.filter((item) => item.status === "FAILED");
  if (failed.length) parts.push(`Não foi possível concluir ${failed.map((item) => item.name).join(", ")}. Os demais módulos permaneceram disponíveis.`);
  return { content: parts.join("\n\n"), structuredContent: blocks, evidence: dedupeEvidence(tools), tools, task, providerStatus: "LIMITED" };
}
