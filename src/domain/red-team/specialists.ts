import Decimal from "decimal.js";
import type { ScoreReason } from "@/domain/score";
import type {
  RedTeamAgentKey,
  RedTeamAgentResult,
  RedTeamEvidencePack,
  RedTeamFinding,
  RedTeamFindingType,
  RedTeamSeverity,
} from "./types";

export const RED_TEAM_AGENTS: Record<RedTeamAgentKey, string> = {
  FINANCE_FUNDING: "Financeiro & Funding",
  ENGINEERING_COST: "Engenharia & Custos",
  COMMERCIAL_MARKET: "Comercial & Mercado",
  LEGAL_STRUCTURING: "Jurídico & Estruturação",
  INVESTOR_CFO: "Investidor / CFO",
  DEVELOPER_OPERATOR: "Incorporador / Operador",
};

type DraftFinding = Omit<RedTeamFinding, "id" | "agent" | "status">;

function rule(pack: RedTeamEvidencePack, key: string): ScoreReason | undefined {
  return pack.score.dimensions.flatMap((dimension) => dimension.reasons).find((reason) => reason.ruleKey === key);
}

function missing(pack: RedTeamEvidencePack, key: string) {
  return pack.missingEvidence.find((item) => item.key === key)!;
}

function money(value: string | number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value));
}

function finding(
  category: string,
  type: RedTeamFindingType,
  severity: RedTeamSeverity,
  title: string,
  description: string,
  evidenceRefs: string[],
  implication: string,
  recommendedAction: string,
  confidence: DraftFinding["confidence"] = "HIGH",
): DraftFinding {
  return { category, type, severity, confidence, title, description, evidenceRefs, implication, recommendedAction };
}

function financeFindings(pack: RedTeamEvidencePack): DraftFinding[] {
  const result = pack.engineResult;
  const findings: DraftFinding[] = [];
  const exposure = new Decimal(result.metrics.maximumCashExposure);
  const limit = new Decimal(pack.assumptions.policy.maximumExposure);
  if (exposure.gt(limit)) {
    findings.push(finding("FINANCE", "POLICY_BREACH", "CRITICAL", "Exposição máxima incompatível com a política", `O Engine registra pico de ${money(exposure.toString())}, acima do limite de ${money(limit.toString())}.`, ["ENGINE.maximumCashExposure", "ENGINE.maximumExposureMonth", "POLICY.maximumExposure"], "A estrutura exige capital além do risco aceito e pode bloquear a decisão mesmo com ROI elevado.", `Redesenhar funding, recebimentos ou escalonamento até reduzir o pico em pelo menos ${money(exposure.minus(limit).toString())}.`));
  }
  const funding = rule(pack, "CAPITAL_FUNDING");
  if (funding && funding.score < 50) findings.push(finding("FUNDING", "RISK", "HIGH", "Funding sem folga operacional", `${funding.message} Valor observado: ${funding.actualValue}.`, ["SCORE_RULE.CAPITAL_FUNDING", "ASSUMPTION.financingLimit", "ENGINE.fundingNeed"], "Pequenos atrasos ou estouros de custo podem exigir capital não contratado.", "Obter term sheet vinculante com limite, condições de saque e reserva de liquidez compatíveis com o pico modelado."));
  const postKeys = rule(pack, "COMMERCIAL_POST_KEYS");
  if (postKeys && postKeys.score < 50) findings.push(finding("LIQUIDITY", "RISK", "HIGH", "Recuperação do capital concentrada após as chaves", `${postKeys.message} Valor observado: ${postKeys.actualValue}.`, ["SCORE_RULE.COMMERCIAL_POST_KEYS", "ENGINE.paybackMonth", "ENGINE.deliveryMonth"], "O capital permanece exposto por mais tempo e depende da execução comercial no fim do ciclo.", "Reestruturar condições de pagamento e validar repasse para antecipar caixa antes da entrega."));
  if (Number(result.metrics.roi ?? 0) * 100 >= Number(pack.assumptions.policy.minimumRoiRate)) findings.push(finding("RETURN", "OPPORTUNITY", "INFO", "Retorno do equity supera a política", "O ROI calculado atende à política, mas deve ser lido junto da exposição e do funding.", ["ENGINE.roi", "POLICY.minimumRoiRate", "SCORE.CAPITAL"], "O retorno é uma força econômica, sem neutralizar as restrições de capital.", "Preservar o retorno ao reestruturar a exposição, evitando reduzir artificialmente o equity.", "HIGH"));
  return findings;
}

function engineeringFindings(pack: RedTeamEvidencePack): DraftFinding[] {
  const findings: DraftFinding[] = [];
  const budget = missing(pack, "detailed_budget");
  if (budget) findings.push(finding("ENGINEERING", "MISSING_EVIDENCE", "HIGH", "Custo de obra sem orçamento detalhado anexado", "A premissa de custo por m² existe, mas não há orçamento para comprovar escopo e quantitativos.", [budget.evidenceRef, "ASSUMPTION.constructionCostPerM2", "ENGINE.constructionCost"], "Itens omitidos podem consumir margem e funding.", `Solicitar ${budget.requestedDocument.toLowerCase()} e reconciliar o total com o Engine.`));
  if (Number(pack.assumptions.contingencyRate) <= Number(pack.assumptions.policy.minimumContingencyRate)) findings.push(finding("ENGINEERING", "ASSUMPTION_CHALLENGE", "MEDIUM", "Contingência sem folga sobre o mínimo", `A contingência de ${pack.assumptions.contingencyRate}% coincide ou fica abaixo do mínimo de ${pack.assumptions.policy.minimumContingencyRate}%.`, ["ASSUMPTION.contingencyRate", "POLICY.minimumContingencyRate", "ENGINE.contingency"], "Qualquer risco não orçado pressiona diretamente a margem.", "Validar riscos de fundação, projetos, suprimentos e licenças antes de manter a contingência no piso."));
  const extreme = pack.sensitivity.stresses.find((stress) => stress.key === "EXTREME")!;
  if (Number(extreme.metrics.marginOnVgv) * 100 < Number(pack.assumptions.policy.minimumMarginRate)) findings.push(finding("ENGINEERING", "RISK", "HIGH", "Stress de custo e prazo elimina a margem de segurança", `No stress extremo, a margem cai para ${(Number(extreme.metrics.marginOnVgv) * 100).toFixed(1)}%.`, ["STRESS.EXTREME", "POLICY.minimumMarginRate", "SENSITIVITY.CONSTRUCTION_COST.WORST"], "O projeto depende de disciplina elevada de orçamento e prazo.", "Contratar orçamento executivo, cronograma físico-financeiro e plano de contingência antes da decisão de investimento."));
  const schedule = missing(pack, "construction_schedule");
  if (schedule) findings.push(finding("EXECUTION", "MISSING_EVIDENCE", "HIGH", "Cronograma de obra não comprovado", "A duração e a curva S são premissas do modelo sem cronograma físico-financeiro anexado.", [schedule.evidenceRef, "ASSUMPTION.constructionMonths", "TRACE.constructionCost"], "Atrasos alteram juros, exposição e geração de caixa.", `Solicitar ${schedule.requestedDocument.toLowerCase()} com marcos, desembolsos e caminho crítico.`));
  return findings;
}

function commercialFindings(pack: RedTeamEvidencePack): DraftFinding[] {
  const findings: DraftFinding[] = [];
  const market = missing(pack, "market_study");
  if (market) findings.push(finding("COMMERCIAL", "MISSING_EVIDENCE", "HIGH", "Preço e velocidade sem estudo de mercado", "Não há evidência externa anexada para sustentar preço e absorção.", [market.evidenceRef, "ASSUMPTION.unitPrice", "ASSUMPTION.salesVelocityUnitsMonth"], "Premissas comerciais podem estar corretas, mas permanecem não suportadas.", `Solicitar ${market.requestedDocument.toLowerCase()} com comparáveis, descontos e absorção mensal.`));
  const mostSensitive = pack.sensitivity.ranking[0];
  if (mostSensitive.scoreImpact >= 5) findings.push(finding("COMMERCIAL", "ASSUMPTION_CHALLENGE", "HIGH", `${mostSensitive.label} é a principal sensibilidade do Score`, `A pior variação testada reduz o Score em ${mostSensitive.scoreImpact} pontos.`, [`SENSITIVITY.${mostSensitive.variable}.WORST`, "SCORE.TOTAL"], "A decisão depende fortemente da execução dessa premissa.", `Criar plano de mitigação e evidência específica para ${mostSensitive.label.toLowerCase()} antes do lançamento.`));
  const inventory = rule(pack, "COMMERCIAL_INVENTORY");
  if (inventory && inventory.score < 50) findings.push(finding("COMMERCIAL", "RISK", "HIGH", "Estoque relevante permanece na entrega", `${inventory.message} Valor observado: ${inventory.actualValue}.`, ["SCORE_RULE.COMMERCIAL_INVENTORY", "ENGINE.salesEndMonth", "ENGINE.deliveryMonth"], "Estoque pronto aumenta carregamento, desconto e dependência de repasse.", "Recalibrar velocidade, preço e campanha para limitar estoque na entrega."));
  return findings;
}

function legalFindings(pack: RedTeamEvidencePack): DraftFinding[] {
  return [
    ["land_title", "Titularidade e ônus do terreno não comprovados", "Não é possível validar propriedade ou gravames sem matrícula.", "Obter matrícula atualizada e certidões antes de assumir obrigação sobre o terreno."],
    ["land_contract", "Estrutura de aquisição do terreno não documentada", "Preço, forma de pagamento, permuta e condições precedentes não podem ser auditados.", "Anexar contrato ou minuta e reconciliar todas as obrigações com o fluxo do Engine."],
    ["municipal_approval", "Aprovações e licenças sem evidência", "O prazo regulatório é premissa, mas não há documento de estágio ou condicionantes.", "Apresentar protocolo, diretrizes, aprovação e licenças disponíveis com respectivos prazos."],
  ].flatMap(([key, title, description, action]) => {
    const item = missing(pack, key);
    return item ? [finding("LEGAL", "MISSING_EVIDENCE", "HIGH", title, description, [item.evidenceRef, key === "municipal_approval" ? "ASSUMPTION.approvalMonths" : "ASSUMPTION.landPrice"], "A ausência impede conclusão jurídica específica e mantém risco de estruturação em aberto.", action)] : [];
  });
}

function investorFindings(pack: RedTeamEvidencePack): DraftFinding[] {
  const findings: DraftFinding[] = [];
  if (["FRAGILE", "CRITICAL"].includes(pack.score.classification)) findings.push(finding("INVESTMENT", "DECISION_BLOCKER", "HIGH", `REDE Score na classificação ${pack.score.classification}`, `O Score final é ${pack.score.totalScore}, com fragilidades que não são compensadas pelo retorno.`, ["SCORE.TOTAL", "SCORE.RETURN", "SCORE.CAPITAL", "SCORE.RESILIENCE"], "A alocação apresenta retorno, mas baixa proteção ao downside.", "Condicionar a decisão à remoção dos gates e à melhora mensurável de Capital e Resiliência."));
  for (const gate of pack.score.gates) findings.push(finding("INVESTMENT", "DECISION_BLOCKER", "CRITICAL", "Gate estrutural limita o Score", gate.reason, [`SCORE_GATE.${gate.key}`, "SCORE.TOTAL"], `O score não pode superar ${gate.maximumScore} enquanto o gate permanecer.`, "Recalcular uma nova versão somente após alterar a causa objetiva do gate."));
  const extreme = pack.sensitivity.stresses.find((stress) => stress.key === "EXTREME")!;
  if (Number(extreme.metrics.npv) < 0 || Number(extreme.metrics.profit) < 0) findings.push(finding("DOWNSIDE", "RISK", "CRITICAL", "Stress extremo destrói valor econômico", `O stress extremo produz VPL de ${money(extreme.metrics.npv)} e lucro de ${money(extreme.metrics.profit)}.`, ["STRESS.EXTREME", "ENGINE.npv", "ENGINE.profit"], "O downside possui assimetria suficiente para exigir reestruturação ou proteção adicional.", "Negociar terreno, obra e funding até que o downside definido deixe de produzir VPL ou lucro negativo."));
  return findings;
}

function operatorFindings(pack: RedTeamEvidencePack): DraftFinding[] {
  const findings: DraftFinding[] = [];
  const delay = pack.sensitivity.ranking.find((item) => item.variable === "SALES_START_DELAY")!;
  if (delay.scoreImpact >= 5) findings.push(finding("EXECUTION", "RISK", "HIGH", "Atraso comercial pressiona a executabilidade", `O atraso testado reduz o Score em até ${delay.scoreImpact} pontos.`, ["SENSITIVITY.SALES_START_DELAY.WORST", "ASSUMPTION.salesStartDelayMonths", "ENGINE.maximumCashExposure"], "A operação precisa iniciar vendas no prazo para não ampliar exposição e custo financeiro.", "Definir marcos de aprovação, pré-lançamento e gatilhos de contingência comercial."));
  const breakEven = pack.sensitivity.breakEvens.find((item) => item.key === "SALE_PRICE");
  if (breakEven?.status === "FOUND") findings.push(finding("MITIGATION", "OPPORTUNITY", "MEDIUM", "Existe folga determinística de preço, condicionada à execução", `O break-even indica redução máxima de ${(breakEven.value * 100).toFixed(1)}% antes de romper a margem mínima.`, ["BREAK_EVEN.SALE_PRICE", "ENGINE.marginOnVgv", "POLICY.minimumMarginRate"], "Há alavanca comercial, mas ela não resolve sozinha exposição ou ausência de evidências.", "Usar a folga apenas em plano de velocidade validado e recalcular o pico de exposição em nova versão."));
  const modelGap = pack.alerts.find((alert) => alert.id === "model-gaps");
  if (modelGap) findings.push(finding("GOVERNANCE", "RISK", "MEDIUM", "Riscos operacionais ainda não modelados", modelGap.evidence, ["ALERT.model-gaps", "SCORE.RESILIENCE"], "Distrato, inadimplência, inflação e condições do terreno podem alterar o resultado real.", "Adicionar evidências e premissas aprovadas para esses riscos antes da decisão final.", "HIGH"));
  return findings;
}

const specialistFunctions: Record<RedTeamAgentKey, (pack: RedTeamEvidencePack) => DraftFinding[]> = {
  FINANCE_FUNDING: financeFindings,
  ENGINEERING_COST: engineeringFindings,
  COMMERCIAL_MARKET: commercialFindings,
  LEGAL_STRUCTURING: legalFindings,
  INVESTOR_CFO: investorFindings,
  DEVELOPER_OPERATOR: operatorFindings,
};

export function executeDeterministicSpecialists(pack: RedTeamEvidencePack) {
  let sequence = 0;
  const findings: RedTeamFinding[] = [];
  const agents = (Object.keys(RED_TEAM_AGENTS) as RedTeamAgentKey[]).map((agent): RedTeamAgentResult => {
    const agentFindings = specialistFunctions[agent](pack).map((draft) => ({ ...draft, id: `RTF-${String(++sequence).padStart(3, "0")}`, agent, status: "OPEN" as const }));
    findings.push(...agentFindings);
    const high = agentFindings.filter((item) => item.severity === "HIGH" || item.severity === "CRITICAL").length;
    return {
      agent,
      label: RED_TEAM_AGENTS[agent],
      status: "COMPLETED",
      confidence: high ? "HIGH" : "MEDIUM",
      opinion: high ? `${high} fragilidades materiais exigem tratamento antes da decisão.` : "Não foram identificados bloqueadores determinísticos adicionais neste escopo.",
      questions: agentFindings.filter((item) => item.type === "MISSING_EVIDENCE").map((item) => `Qual evidência resolve: ${item.title}?`).slice(0, 5),
      findingIds: agentFindings.map((item) => item.id),
      providerUsed: false,
    };
  });
  return { agents, findings };
}
