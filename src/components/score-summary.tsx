import { ArrowRight, ShieldCheck } from "lucide-react";
import type { RedeScoreResult, ScoreClassification } from "@/domain/score";

const classificationLabels: Record<ScoreClassification, string> = {
  EXCELLENT: "Excelente",
  ATTRACTIVE: "Atrativo",
  ATTENTION: "Atenção",
  FRAGILE: "Frágil",
  CRITICAL: "Crítico",
};

export function ScoreSummary({ score, onOpen }: { score: RedeScoreResult; onOpen: () => void }) {
  const tone = score.classification.toLowerCase();
  return (
    <article className={`score-summary score-${tone}`}>
      <div className="score-ring" style={{ background: `conic-gradient(var(--score-color) 0 ${score.totalScore * 3.6}deg, #dcd7ca ${score.totalScore * 3.6}deg 360deg)` }}>
        <span>{score.totalScore}</span>
      </div>
      <div className="score-summary-main">
        <span className="eyebrow">REDE SCORE · {score.policyVersion}</span>
        <h3>{classificationLabels[score.classification]}</h3>
        <p>{score.explanation.strengths[0] ?? score.explanation.weaknesses[0] ?? "Leitura institucional calculada e versionada."}</p>
        <button onClick={onOpen}>Abrir explicabilidade <ArrowRight size={14} /></button>
      </div>
      <div className="score-summary-foot">
        <ShieldCheck size={14} />
        <span>{score.gates.length} gates · {score.penalties.length} penalidades</span>
      </div>
    </article>
  );
}
