import { AlertTriangle, Check, Gauge, ShieldAlert, TrendingDown } from "lucide-react";
import type { RedeScoreResult, ScoreClassification, ScoreDimensionKey } from "@/domain/score";
import type { BreakEvenResult, SensitivityResult, VariationUnit } from "@/domain/sensitivity";

const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const classificationLabels: Record<ScoreClassification, string> = {
  EXCELLENT: "Excelente",
  ATTRACTIVE: "Atrativo",
  ATTENTION: "Atenção",
  FRAGILE: "Frágil",
  CRITICAL: "Crítico",
};

const dimensionLabels: Record<ScoreDimensionKey, string> = {
  RETURN: "Retorno",
  CAPITAL: "Capital e funding",
  COMMERCIAL: "Comercial",
  COST: "Custos",
  RESILIENCE: "Resiliência",
  EXECUTION: "Execução",
};

function variation(value: number, unit: VariationUnit) {
  const prefix = value > 0 ? "+" : "";
  if (unit === "RATE") return `${prefix}${number.format(value * 100)}%`;
  if (unit === "PERCENTAGE_POINTS") return `${prefix}${number.format(value)} p.p.`;
  return `${prefix}${number.format(value)} meses`;
}

function breakEvenValue(item: BreakEvenResult) {
  if (item.status === "BASE_FAILS_POLICY") return "Base já fora da política";
  const suffix = item.status === "NOT_REACHED" ? "+" : "";
  return item.unit === "RATE" ? `${number.format(item.value * 100)}%${suffix}` : `${number.format(item.value)} meses${suffix}`;
}

export function SensitivityView({ sensitivity, score, scoreScenarioLabel }: { sensitivity: SensitivityResult; score: RedeScoreResult; scoreScenarioLabel: string }) {
  const maxImpact = Math.max(...sensitivity.ranking.map((item) => item.scoreImpact), 1);
  const worstCases = [...sensitivity.cases]
    .filter((item) => item.variation !== 0)
    .sort((left, right) => left.score - right.score || Number(left.metrics.npv) - Number(right.metrics.npv))
    .slice(0, 8);

  return (
    <div className="view-stack">
      <header className="section-title">
        <div><span className="eyebrow">{sensitivity.configVersion}</span><h2>Sensibilidade, stress e REDE Score</h2><p>A matriz de sensibilidade usa sempre o cenário Base; o Score destacado acompanha o cenário {scoreScenarioLabel} selecionado.</p></div>
      </header>

      <section className="sensitivity-hero">
        <article className={`score-hero score-${score.classification.toLowerCase()}`}>
          <div className="score-ring" style={{ background: `conic-gradient(var(--score-color) 0 ${score.totalScore * 3.6}deg, #dcd7ca ${score.totalScore * 3.6}deg 360deg)` }}><span>{score.totalScore}</span></div>
          <div><span className="eyebrow">REDE SCORE · {scoreScenarioLabel.toUpperCase()}</span><h3>{classificationLabels[score.classification]}</h3><p>Bruto {number.format(score.rawScore)} · após penalidades {number.format(score.scoreAfterPenalties)}</p></div>
        </article>
        <article className="panel resilience-card"><TrendingDown size={20} /><div><span>PIOR PERDA DE MARGEM</span><strong>{number.format(sensitivity.resilience.worstMarginLossPoints)} p.p.</strong></div><small>{sensitivity.resilience.stressPolicyBreaks}/{sensitivity.resilience.totalStressCases} stresses rompem políticas</small></article>
        <article className="panel resilience-card"><ShieldAlert size={20} /><div><span>PRESSÃO DE EXPOSIÇÃO</span><strong>{number.format(sensitivity.resilience.worstExposureIncreaseRate * 100)}%</strong></div><small>{sensitivity.resilience.criticalStressCount} stresses com lucro ou VPL negativo</small></article>
      </section>

      <section className="panel score-explain-panel">
        <div className="panel-heading"><div><span className="eyebrow">EXPLICABILIDADE</span><h2>Seis dimensões ponderadas</h2></div><span className="version-chip">{score.policyVersion}</span></div>
        <div className="score-dimensions">{score.dimensions.map((dimension) => <article key={dimension.key}><header><span>{dimensionLabels[dimension.key]}</span><strong>{number.format(dimension.score)}</strong></header><div className="score-bar"><i style={{ width: `${dimension.score}%` }} /></div><small>Peso {number.format(dimension.weight * 100)}% · contribuição {number.format(dimension.weightedScore)}</small></article>)}</div>
        <div className="score-evidence-grid">
          <div><strong>Forças</strong>{score.explanation.strengths.length ? score.explanation.strengths.map((item) => <p key={item}><Check size={13} />{item}</p>) : <p>Sem forças classificadas acima de 75 pontos.</p>}</div>
          <div><strong>Vulnerabilidades</strong>{score.explanation.weaknesses.length ? score.explanation.weaknesses.map((item) => <p key={item}><AlertTriangle size={13} />{item}</p>) : <p>Sem regras abaixo de 50 pontos.</p>}</div>
          <div><strong>Gates e penalidades</strong>{[...score.gates.map((item) => item.reason), ...score.penalties.map((item) => `${item.reason} (-${item.points})`)].map((item) => <p key={item}><Gauge size={13} />{item}</p>)}{!score.gates.length && !score.penalties.length && <p>Nenhum gate ou penalidade acionado.</p>}</div>
        </div>
      </section>

      <section className="sensitivity-main-grid">
        <article className="panel tornado-panel">
          <div className="panel-heading"><div><span className="eyebrow">RANKING DE IMPACTO</span><h2>Variáveis mais sensíveis</h2></div></div>
          <div className="tornado-list">{sensitivity.ranking.map((item, index) => <div key={item.variable}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.label}</strong><div><i style={{ width: `${Math.max(3, (item.scoreImpact / maxImpact) * 100)}%` }} /></div><b>-{number.format(item.scoreImpact)} pts</b></div>)}</div>
        </article>
        <article className="panel break-even-panel">
          <div className="panel-heading"><div><span className="eyebrow">BREAK-EVEN DE POLÍTICA</span><h2>Folgas calculadas</h2></div></div>
          <div className="break-even-list">{sensitivity.breakEvens.map((item) => <div key={item.key}><span>{item.label}</span><strong>{breakEvenValue(item)}</strong><small>{item.status === "FOUND" ? "limite encontrado" : item.status === "NOT_REACHED" ? "não atingido na faixa testada" : "sem folga no caso base"}</small></div>)}</div>
        </article>
      </section>

      <section className="stress-grid">{sensitivity.stresses.map((stress) => <article className={`stress-card stress-${stress.key.toLowerCase()}`} key={stress.key}><header><span>{stress.label}</span><strong>{stress.score}</strong><small>{classificationLabels[stress.classification]}</small></header><div className="stress-adjustments">{stress.adjustments.map((item) => <span key={item.variable}>{item.label} {variation(item.variation, item.variationUnit)}</span>)}</div><dl><div><dt>Margem</dt><dd>{number.format(Number(stress.metrics.marginOnVgv) * 100)}%</dd></div><div><dt>VPL</dt><dd>{compactCurrency.format(Number(stress.metrics.npv))}</dd></div><div><dt>Exposição</dt><dd>{compactCurrency.format(Number(stress.metrics.maximumCashExposure))}</dd></div></dl><footer>{stress.violatedPolicies.length ? `${stress.violatedPolicies.length} políticas rompidas · ${stress.recommendationLabel}` : stress.recommendationLabel}</footer></article>)}</section>

      <section className="panel isolated-panel">
        <div className="panel-heading"><div><span className="eyebrow">PIORES CASOS ISOLADOS</span><h2>Efeito de uma variável por vez</h2></div></div>
        <div className="isolated-table"><div className="isolated-row isolated-head"><span>Variável</span><span>Variação</span><span>Score</span><span>Margem</span><span>VPL</span><span>Políticas</span></div>{worstCases.map((item) => <div className="isolated-row" key={`${item.variable}:${item.variation}`}><strong>{item.label}</strong><span>{variation(item.variation, item.variationUnit)}</span><b>{item.score} <small>({item.scoreDelta > 0 ? "+" : ""}{item.scoreDelta})</small></b><span>{number.format(Number(item.metrics.marginOnVgv) * 100)}%</span><span>{compactCurrency.format(Number(item.metrics.npv))}</span><span className={item.policyViolations.length ? "negative-value" : "positive-value"}>{item.policyViolations.length || "OK"}</span></div>)}</div>
      </section>
    </div>
  );
}
