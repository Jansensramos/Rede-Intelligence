"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, FileQuestion, Gavel, Landmark, Scale, ShieldAlert, Wrench } from "lucide-react";
import type { RedTeamAgentKey, RedTeamFinding, RedTeamReport, RedTeamSeverity } from "@/domain/red-team";

const decisionLabels: Record<RedTeamReport["conclusion"]["decision"], string> = {
  ADVANCE: "Avançar",
  ADVANCE_WITH_CONDITIONS: "Avançar com condições",
  RESTRUCTURE: "Reestruturar",
  DO_NOT_ADVANCE: "Não avançar",
  INSUFFICIENT_EVIDENCE: "Evidência insuficiente",
};

const confidenceLabels = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" } as const;
const agentIcons: Record<RedTeamAgentKey, typeof Scale> = {
  FINANCE_FUNDING: Landmark,
  ENGINEERING_COST: Wrench,
  COMMERCIAL_MARKET: Scale,
  LEGAL_STRUCTURING: Gavel,
  INVESTOR_CFO: ShieldAlert,
  DEVELOPER_OPERATOR: Check,
};

const severityRank: Record<RedTeamSeverity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const severityLabels: Record<RedTeamSeverity, string> = { INFO: "Info", LOW: "Baixo", MEDIUM: "Médio", HIGH: "Alto", CRITICAL: "Crítico" };

function FindingCard({ finding }: { finding: RedTeamFinding }) {
  return (
    <article className={`red-finding severity-${finding.severity.toLowerCase()}`}>
      <header><span>{finding.type.replaceAll("_", " ")}</span><b>{severityLabels[finding.severity]}</b></header>
      <h3>{finding.title}</h3>
      <p>{finding.description}</p>
      <div><strong>Implicação</strong><p>{finding.implication}</p></div>
      <div className="finding-recommendation"><strong>Ação recomendada</strong><p>{finding.recommendedAction}</p></div>
      <footer>{finding.evidenceRefs.map((ref) => <code key={ref}>{ref}</code>)}</footer>
    </article>
  );
}

export function RedTeamSummary({ report, onOpen }: { report: RedTeamReport | null; onOpen: () => void }) {
  if (!report) return (
    <article className="red-team-summary red-team-pending"><ShieldAlert size={21} /><div><span className="eyebrow">REDE RED TEAM</span><h3>Auditoria ainda não executada</h3><p>Crie uma nova versão para gerar a auditoria adversarial determinística.</p></div></article>
  );
  const critical = report.findings.filter((finding) => finding.severity === "CRITICAL").length;
  return (
    <article className={`red-team-summary decision-${report.conclusion.decision.toLowerCase()}`}>
      <ShieldAlert size={22} />
      <div><span className="eyebrow">REDE RED TEAM · {report.redTeamVersion}</span><h3>{decisionLabels[report.conclusion.decision]}</h3><p>{report.conclusion.dominantRisk}</p></div>
      <div className="red-team-summary-count"><strong>{critical}</strong><span>blockers críticos</span></div>
      <button onClick={onOpen}>Abrir auditoria <ArrowRight size={14} /></button>
    </article>
  );
}

export function RedTeamView({ report }: { report: RedTeamReport | null }) {
  const [selectedAgent, setSelectedAgent] = useState<RedTeamAgentKey>("FINANCE_FUNDING");
  const findings = useMemo(() => report ? [...report.findings].sort((left, right) => severityRank[right.severity] - severityRank[left.severity]) : [], [report]);
  if (!report) return (
    <div className="view-stack"><header className="section-title"><div><span className="eyebrow">REDE RED TEAM</span><h2>Auditoria adversarial</h2><p>Esta versão ainda não possui execução Red Team persistida.</p></div></header><div className="model-note"><ShieldAlert size={20} /><div><strong>Red Team indisponível para este snapshot</strong><p>Salve uma nova versão para executar as validações determinísticas.</p></div></div></div>
  );
  const critical = findings.filter((finding) => finding.severity === "CRITICAL").length;
  const high = findings.filter((finding) => finding.severity === "HIGH").length;
  const selected = report.agents.find((agent) => agent.agent === selectedAgent)!;
  const selectedFindings = findings.filter((finding) => finding.agent === selectedAgent);
  const topFindings = report.conclusion.topFindingIds.map((id) => report.findings.find((finding) => finding.id === id)).filter(Boolean) as RedTeamFinding[];
  const blockers = report.conclusion.decisionBlockerIds.map((id) => report.findings.find((finding) => finding.id === id)).filter(Boolean) as RedTeamFinding[];

  return (
    <div className="view-stack">
      <header className="section-title"><div><span className="eyebrow">{report.redTeamVersion}</span><h2>Auditoria adversarial</h2><p>Seis perspectivas confrontam o mesmo snapshot; números continuam governados pelo Engine.</p></div></header>

      {!report.provider.configured && <div className="red-team-ai-note"><ShieldAlert size={17} /><div><strong>Red Team AI não configurado.</strong><span>As validações determinísticas, cross-reviews e síntese continuam disponíveis.</span></div></div>}

      <section className="red-team-hero">
        <article className={`red-decision decision-${report.conclusion.decision.toLowerCase()}`}><span>DECISÃO DO CHAIR</span><strong>{decisionLabels[report.conclusion.decision]}</strong><p>{report.conclusion.executiveSummary}</p></article>
        <article><span>CONFIANÇA</span><strong>{confidenceLabels[report.conclusion.confidence]}</strong><p>{report.conclusion.enginePosition}</p></article>
        <article><span>STATUS DA AUDITORIA</span><strong>{report.agents.length} especialistas</strong><p>{findings.length} findings · {critical} críticos · {high} altos</p></article>
        <article><span>RISCO DOMINANTE</span><strong>{report.conclusion.dominantRisk}</strong><p>{report.conclusion.residualRisk}</p></article>
      </section>

      <section className="panel red-specialists-panel">
        <div className="panel-heading"><div><span className="eyebrow">ESPECIALISTAS</span><h2>Pareceres independentes</h2></div><span className="version-chip">{report.promptVersion}</span></div>
        <div className="red-agent-grid">{report.agents.map((agent) => { const Icon = agentIcons[agent.agent]; const count = report.findings.filter((finding) => finding.agent === agent.agent).length; return <button key={agent.agent} className={selectedAgent === agent.agent ? "is-selected" : ""} onClick={() => setSelectedAgent(agent.agent)}><Icon size={19} /><span><strong>{agent.label}</strong><small>{count} findings · {confidenceLabels[agent.confidence]}</small></span><ArrowRight size={14} /></button>; })}</div>
        <div className="red-agent-detail"><header><div><span className="eyebrow">PARECER · {selected.label.toUpperCase()}</span><h3>{selected.opinion}</h3></div><span>{selected.status}</span></header>{selected.questions.length > 0 && <div className="red-agent-questions"><strong>Perguntas em aberto</strong>{selected.questions.map((question) => <p key={question}><FileQuestion size={13} />{question}</p>)}</div>}<div className="red-finding-grid">{selectedFindings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}</div></div>
      </section>

      <section className="red-two-column">
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">TOP FINDINGS</span><h2>Fragilidades prioritárias</h2></div></div><div className="red-compact-findings">{topFindings.map((finding) => <div key={finding.id}><span className={`severity-dot severity-${finding.severity.toLowerCase()}`} /><div><strong>{finding.title}</strong><small>{finding.recommendedAction}</small></div><b>{severityLabels[finding.severity]}</b></div>)}</div></article>
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">DECISION BLOCKERS</span><h2>Condições que impedem avanço</h2></div></div><div className="red-blocker-list">{blockers.map((finding) => <div key={finding.id}><AlertTriangle size={15} /><span><strong>{finding.title}</strong><small>{finding.implication}</small></span></div>)}{!blockers.length && <p>Nenhum blocker objetivo.</p>}</div></article>
      </section>

      <section className="red-two-column">
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">EVIDÊNCIAS AUSENTES</span><h2>Diligências solicitadas</h2></div><strong className="panel-total">{report.evidenceRequests.length}</strong></div><div className="evidence-request-list">{report.evidenceRequests.map((request) => <div key={request.id}><FileQuestion size={15} /><span><strong>{request.requestedDocument}</strong><small>{request.reason}</small></span><b>{request.priority}</b></div>)}</div></article>
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">DIVERGÊNCIAS</span><h2>Onde os especialistas discordam</h2></div><strong className="panel-total">{report.disagreements.length}</strong></div><div className="disagreement-list">{report.disagreements.map((item) => <div key={item.id}><strong>{item.description}</strong><p>{item.resolution}</p><span>{item.agents.join(" × ")} · {item.status}</span></div>)}{!report.disagreements.length && <p>Nenhuma divergência material registrada.</p>}</div></article>
      </section>

      <section className="panel decision-change-panel">
        <div className="panel-heading"><div><span className="eyebrow">WHAT WOULD CHANGE THE DECISION?</span><h2>O que mudaria nossa decisão</h2></div></div>
        <div className="decision-change-list">{report.conclusion.whatWouldChangeDecision.map((item, index) => <article key={item.key}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.action}</strong><p>{item.target}</p><footer>{item.evidenceRefs.map((ref) => <code key={ref}>{ref}</code>)}</footer></div></article>)}</div>
      </section>

      <section className="panel priority-actions"><div className="panel-heading"><div><span className="eyebrow">PLANO DE AÇÃO</span><h2>Cinco ações prioritárias</h2></div></div><ol>{report.conclusion.requiredActions.map((action) => <li key={action}>{action}</li>)}</ol></section>
    </div>
  );
}
