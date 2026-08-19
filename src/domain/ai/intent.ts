import type { AIIntentPlan, AIResponseMode, AIToolCallRequest } from "./types";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
const has = (text: string, pattern: RegExp) => pattern.test(text);
const numberMatch = (text: string, pattern: RegExp) => Number(text.match(pattern)?.[1]?.replace(",", "."));
const localizedIntegerMatch = (text: string, pattern: RegExp) => {
  const raw = text.match(pattern)?.[1];
  return raw ? Number(raw.replace(/[.\s]/g, "")) : Number.NaN;
};

function simulationChanges(text: string) {
  const changes: Record<string, number> = {};
  const construction = numberMatch(text, /(?:obra|custo(?: de construcao)?)[^\d]{0,30}(\d+(?:[,.]\d+)?)\s*%/);
  if (Number.isFinite(construction)) changes.constructionCostPercent = /reduz|cai|menos|queda/.test(text) ? -construction : construction;
  const price = numberMatch(text, /(?:preco|venda)[^\d]{0,30}(\d+(?:[,.]\d+)?)\s*%/);
  if (Number.isFinite(price)) changes.unitPricePercent = /reduz|cai|menos|queda/.test(text) ? -price : price;
  const velocity = numberMatch(text, /(?:velocidade|mais devagar|vender)[^\d]{0,30}(\d+(?:[,.]\d+)?)\s*%/);
  if (Number.isFinite(velocity)) changes.salesVelocityPercent = /mais devagar|reduz|cai|menos|queda/.test(text) ? -velocity : velocity;
  const delay = numberMatch(text, /(?:atras|aprovacao)[^\d]{0,24}(\d+)\s*mes/);
  if (Number.isFinite(delay)) changes.approvalMonthsDelta = delay;
  const units = localizedIntegerMatch(text, /(\d[\d.]*)\s*(?:apartamentos|unidades)/);
  if (Number.isFinite(units)) changes.units = units;
  const funding = numberMatch(text, /funding[^\d]{0,30}(\d+(?:[,.]\d+)?)\s*(?:p\.p|pontos)/);
  if (Number.isFinite(funding)) changes.financingRateDeltaPp = /reduz|cai|menos|queda/.test(text) ? -funding : funding;
  return changes;
}

function responseMode(text: string): AIResponseMode | undefined {
  if (/tecnic|detalh|executiv/.test(text)) return /tecnic/.test(text) ? "TECHNICAL" : /detalh/.test(text) ? "DETAILED" : "EXECUTIVE";
}

export function planAIIntent(question: string): AIIntentPlan {
  const text = normalize(question);
  const calls: AIToolCallRequest[] = [];
  const mode = responseMode(text);
  const financialScenario = has(text, /conservador/) ? "conservative" : has(text, /agressiv/) ? "aggressive" : has(text, /cenario base|financeiro base/) ? "base" : undefined;
  const urbanScenarioType = has(text, /optimized|otimizad/) ? "OPTIMIZED" : has(text, /target|alvo/) ? "TARGET" : has(text, /current legal|vigente|ca atual/) ? "CURRENT_LEGAL" : undefined;
  const version = numberMatch(text, /(?:versao|snapshot|\bv)\s*(\d+)/);
  const latestVersion = /(?:ultima|mais recente|atual)(?:\s+versao|\s+snapshot)|atualize.*(?:versao|contexto)/.test(text);
  if (/use |agora |mude |troque |contexto|atualize/.test(text) && (financialScenario || urbanScenarioType || Number.isFinite(version) || latestVersion)) {
    return { task: "CHAT", calls: [{ name: "changeContext", arguments: { ...(financialScenario ? { financialScenario } : {}), ...(urbanScenarioType ? { urbanScenarioType } : {}), ...(Number.isFinite(version) ? { studyVersionNumber: version } : {}), ...(latestVersion ? { latestVersion: true } : {}) } }], responseMode: mode };
  }

  const changes = simulationChanges(text);
  if ((/e se|simul|cenario com|what.?if/.test(text)) && Object.keys(changes).length) {
    return { task: "TOOL_ORCHESTRATION", calls: [{ name: "runEngineSimulation", arguments: { ...(financialScenario ? { scenario: financialScenario } : {}), changes } }], responseMode: mode };
  }
  if (/ca .*precis|coeficiente .*precis|reverse|zoneamento necessario/.test(text)) {
    const units = localizedIntegerMatch(text, /(\d[\d.]*)\s*(?:apartamentos|unidades)/);
    calls.push({ name: "runReverseZoningSolver", arguments: { units: Number.isFinite(units) ? units : 1300 } });
    return { task: "ANALYSIS", calls, responseMode: mode };
  }
  if (/quanto.*(?:pagar|terreno)|terreno maximo|land value ceiling/.test(text)) return { task: "ANALYSIS", calls: [{ name: "calculateLandValueCeiling", arguments: { ...(financialScenario ? { scenario: financialScenario } : {}) } }], responseMode: mode };
  if (/quanto custa.*atras|custo.*atras/.test(text)) {
    const months = numberMatch(text, /(\d+)\s*mes/);
    return { task: "ANALYSIS", calls: [{ name: "calculateCostOfDelay", arguments: { months: Number.isFinite(months) ? months : 6 } }], responseMode: mode };
  }
  const designRevisionNumbers = [...text.matchAll(/\brev(?:isao)?\s*(\d+)/g)].map((match) => Number(match[1]));
  if (/compare|comparar|mudou|diferenca/.test(text) && /\brev(?:isao)?\s*\d+|revisoes de projeto|design diff/.test(text)) return { task: "COMPARE", calls: [{ name: "compareDesignRevisions", arguments: { ...(designRevisionNumbers[0] ? { from: designRevisionNumbers[0] } : {}), ...(designRevisionNumbers[1] ? { to: designRevisionNumbers[1] } : {}) } }], responseMode: mode };
  if (/gere|gerar|crie|prepare/.test(text) && /design review report|relatorio de revisao de projeto/.test(text)) return { task: "REPORT_NARRATIVE", calls: [{ name: "getDesignReview", arguments: {} }, { name: "getDesignMetrics", arguments: {} }, { name: "getDesignFindings", arguments: {} }, { name: "getDesignOpportunities", arguments: {} }], mutationIntent: { actionType: "GENERATE_DESIGN_REVIEW_REPORT", arguments: {} }, responseMode: mode };
  if (/briefing.*arquitet|brief.*arquitet/.test(text)) return { task: "SYNTHESIS", calls: [{ name: "getDesignReview", arguments: {} }, { name: "getDesignFindings", arguments: {} }, { name: "getDesignOpportunities", arguments: {} }, { name: "getDesignMetrics", arguments: {} }], responseMode: mode };
  if (/analise.*(?:projeto|planta|prancha)|o que (?:voce )?mudaria|cinco maiores oportunidades|5 maiores oportunidades/.test(text)) return { task: "SYNTHESIS", calls: [{ name: "getDesignReview", arguments: {} }, { name: "getDesignMetrics", arguments: {} }, { name: "getDesignFindings", arguments: {} }, { name: "getDesignOpportunities", arguments: {} }], responseMode: mode };
  if (/quadro de areas|perdendo area|pavimento.*(?:pior|menos).*eficien|tipologia.*area|quantos apartamentos|quantas unidades|area.*fecha/.test(text)) return { task: "ANALYSIS", calls: [{ name: "getDesignMetrics", arguments: {} }, { name: "getDesignFindings", arguments: {} }], responseMode: mode };
  if (/value engineering|oportunidade.*(?:projeto|design)|qual.*melhoria.*valor|alternativa.*melhor|alteracao.*(?:custo|score)/.test(text)) return { task: "SYNTHESIS", calls: [{ name: "getDesignOpportunities", arguments: {} }, { name: "getDesignReview", arguments: {} }, { name: "getEngineResults", arguments: { scenario: financialScenario ?? "base" } }, { name: "getScore", arguments: { scenario: financialScenario ?? "base" } }], responseMode: mode };
  if (/finding.*critic|diferenca.*projeto.*engine|projeto.*engine/.test(text)) return { task: "ANALYSIS", calls: [{ name: "getDesignFindings", arguments: {} }, { name: "getDesignMetrics", arguments: {} }, { name: "getEngineResults", arguments: { scenario: financialScenario ?? "base" } }], responseMode: mode };
  if (/gere|gerar|crie|prepare/.test(text) && /dossie|master report|relatorio completo/.test(text)) return { task: "REPORT_NARRATIVE", calls: [{ name: "preflightMasterReport", arguments: {} }], mutationIntent: { actionType: "GENERATE_MASTER_REPORT", arguments: { final: true, level: "FULL_DOSSIER" } }, responseMode: mode };
  if (/gere|gerar|crie|prepare/.test(text) && /deck|one page|investment book|memo/.test(text)) return { task: "REPORT_NARRATIVE", calls: [{ name: "getStudioArtifacts", arguments: {} }], mutationIntent: { actionType: "GENERATE_STUDIO_DRAFT", arguments: { type: /deck/.test(text) ? "INVESTOR_DECK" : /one page/.test(text) ? "ONE_PAGE" : /memo/.test(text) ? "INVESTMENT_MEMO" : "INVESTMENT_BOOK", format: /deck/.test(text) ? "PPTX" : "PDF" } }, responseMode: mode };
  if (/prepare.*comite|brief.*comite|reuniao/.test(text)) return { task: "SYNTHESIS", calls: [{ name: "prepareCommitteeBrief", arguments: {} }], responseMode: mode };
  if (/compare/.test(text) && /target|optimized|otimizad|urban/.test(text)) return { task: "COMPARE", calls: [{ name: "compareUrbanScenarios", arguments: {} }], responseMode: mode };
  if (/compare/.test(text) && /vers|snapshot|mudou/.test(text)) return { task: "COMPARE", calls: [{ name: "compareVersions", arguments: {} }], responseMode: mode };
  if (/compare|melhor cenario|maior vpl|menor equity/.test(text)) return { task: "COMPARE", calls: [{ name: "compareScenarios", arguments: { scenarios: ["conservative", "base", "aggressive"] } }], responseMode: mode };
  if (/score|perdeu pontos|pontuacao/.test(text)) calls.push({ name: "getScoreExplanation", arguments: { ...(financialScenario ? { scenario: financialScenario } : {}) } });
  if (/red team|finding|maior risco|riscos|problema/.test(text)) calls.push({ name: "getRedTeam", arguments: {} }, { name: "getRiskRegister", arguments: {} });
  if (/document|data room|evidencia|faltando/.test(text)) calls.push({ name: "getDocumentStatus", arguments: {} });
  if (/aprovar|aprovacao|comite|blocker|condi/.test(text)) calls.push({ name: "getCommitteeDecision", arguments: {} }, { name: "getConditions", arguments: {} }, { name: "getBlockers", arguments: {} }, { name: "getReadiness", arguments: {} });
  if (/premissa|confiar|qualidade|desatualiz/.test(text)) calls.push({ name: "getAssumptions", arguments: {} });
  if (/ca atual|zoneamento|urbanistic|terreno/.test(text)) calls.push({ name: "getUrbanScenario", arguments: { type: urbanScenarioType ?? "CURRENT_LEGAL" } }, { name: "getLandAsset", arguments: {} });
  if (/funding|encontre tudo|buscar|procure/.test(text)) calls.push({ name: "searchInternalEvidence", arguments: { query: /funding/.test(text) ? "funding" : question.slice(0, 200), limit: 12 } });
  if (/sensibil|stress|break.?even|onde quebra/.test(text)) calls.push({ name: "getSensitivity", arguments: {} }, { name: "getStressTests", arguments: {} }, { name: "getBreakEven", arguments: {} });
  if (/fluxo|exposicao|vgv|margem|roi|tir|vpl|econom|financeir/.test(text)) calls.push({ name: "getEngineResults", arguments: { ...(financialScenario ? { scenario: financialScenario } : {}) } });
  if (/acao|prioridade|hoje|semana/.test(text)) calls.push({ name: "getActionCenter", arguments: {} });
  if (/caminho critico|marco|atrasando/.test(text)) calls.push({ name: "getCriticalPath", arguments: {} });
  if (!calls.length || /explique.*projeto|explique.*negocio|briefing completo|tese/.test(text)) calls.push({ name: "getProject", arguments: {} }, { name: "getEngineResults", arguments: { scenario: financialScenario ?? "base" } }, { name: "getScore", arguments: { scenario: financialScenario ?? "base" } }, { name: "getRedTeam", arguments: {} }, { name: "getReadiness", arguments: {} });
  return { task: calls.length > 2 ? "SYNTHESIS" : "ANALYSIS", calls: deduplicate(calls), responseMode: mode };
}

function deduplicate(calls: AIToolCallRequest[]) {
  const seen = new Set<string>();
  return calls.filter((call) => { const key = `${call.name}:${JSON.stringify(call.arguments)}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export const DEFAULT_AI_SUGGESTIONS = [
  ["MANAGEMENT", "Explique este projeto."], ["RISK", "Qual é o maior risco?"], ["COMMITTEE", "O que falta para aprovar?"],
  ["FINANCE", "Compare os cenários."], ["FINANCE", "E se o custo de obra subir 10%?"], ["LAND", "Quanto podemos pagar pelo terreno?"],
  ["URBAN", "Qual CA preciso para 1.300 unidades?"], ["COMMITTEE", "Prepare o Comitê."], ["DOCUMENTS", "Quais documentos faltam?"],
  ["DESIGN", "O que você mudaria neste projeto?"], ["DESIGN", "O quadro de áreas fecha?"], ["DESIGN", "Quais são as cinco maiores oportunidades?"],
].map(([category, prompt]) => ({ category, prompt }));
