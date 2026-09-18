"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History as HistoryIcon,
  LoaderCircle,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  getCognitiveReviewAction,
  listCognitiveReviewHistoryAction,
  recordCognitiveDecisionAction,
  runCognitiveReviewAction,
} from "@/app/actions/cognitive";
import type {
  AutopilotRecommendation,
  InvestmentCommitteeReport,
} from "@/application/cognitive";

interface CognitiveCommitteePanelProps {
  conversationId: string;
  projectId: string;
}

type HumanDecision = "ACCEPTED" | "HOLD" | "REWORK_REQUESTED";

type HistoryItem = {
  reviewId: string;
  conversationId: string;
  objective: string;
  disposition: string;
  challengeCount: number;
  criticalCount: number;
  createdAt: string;
  createdBy: string;
  decision: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
};

export function CognitiveCommitteePanel({
  conversationId,
  projectId,
}: CognitiveCommitteePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [objective, setObjective] = useState(
    "Avaliar se o empreendimento pode avançar para a próxima etapa com base nas evidências atuais.",
  );
  const [report, setReport] = useState<InvestmentCommitteeReport | null>(null);
  const [recommendations, setRecommendations] = useState<AutopilotRecommendation[]>([]);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [humanDecision, setHumanDecision] = useState<HumanDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const criticalChallenges = useMemo(
    () => report?.challenges.filter((item) => item.severity === "CRITICAL").length ?? 0,
    [report],
  );

  async function refreshHistory() {
    const response = await listCognitiveReviewHistoryAction({ projectId });
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setHistory(response.data as HistoryItem[]);
  }

  function runReview() {
    setError("");
    startTransition(async () => {
      const response = await runCognitiveReviewAction({
        conversationId,
        projectId,
        objective,
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setReport(response.data.report);
      setRecommendations(response.data.recommendations);
      setReviewId(response.data.reviewId);
      setHumanDecision(null);
      setDecisionNote("");
      setExpanded(true);
      if (historyOpen) await refreshHistory();
    });
  }

  function recordDecision(decision: HumanDecision) {
    if (!reviewId) return;
    setError("");
    startTransition(async () => {
      const response = await recordCognitiveDecisionAction({
        reviewId,
        conversationId,
        projectId,
        decision,
        note: decisionNote,
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setHumanDecision(response.data.decision);
      if (historyOpen) await refreshHistory();
    });
  }

  function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history.length === 0) {
      setError("");
      startTransition(refreshHistory);
    }
  }

  function openHistoricalReview(item: HistoryItem) {
    setError("");
    startTransition(async () => {
      const response = await getCognitiveReviewAction({
        reviewId: item.reviewId,
        projectId,
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }

      setObjective(response.data.objective);
      setReviewId(response.data.reviewId);
      setReport(response.data.report as unknown as InvestmentCommitteeReport);
      setRecommendations(response.data.recommendations as unknown as AutopilotRecommendation[]);
      setHumanDecision(
        isHumanDecision(response.data.humanDecision)
          ? response.data.humanDecision
          : null,
      );
      setDecisionNote(response.data.decisionNote);
      setExpanded(true);
    });
  }

  return (
    <section className="cognitive-panel" aria-label="Comitê cognitivo">
      <div className="cognitive-panel-head">
        <div>
          <span className="eyebrow">COMITÊ COGNITIVO</span>
          <h3><BrainCircuit size={18} /> Análise multidisciplinar</h3>
          <p>Agentes especializados analisam as evidências disponíveis, o Red Team contesta as conclusões e a decisão final permanece humana.</p>
        </div>
        <div className="cognitive-panel-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={runReview}
            disabled={pending}
          >
            {pending ? <LoaderCircle size={15} className="spin" /> : <Users size={15} />}
            Executar comitê
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={toggleHistory}
            disabled={pending}
            aria-expanded={historyOpen}
          >
            <HistoryIcon size={15} />
            Histórico
          </button>
          {report && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              {expanded ? "Recolher" : "Ver análise"}
            </button>
          )}
        </div>
      </div>

      <label className="cognitive-objective">
        <span>Objetivo da rodada</span>
        <textarea
          rows={2}
          value={objective}
          maxLength={600}
          onChange={(event) => setObjective(event.target.value)}
          disabled={pending}
        />
      </label>

      {error && (
        <div className="cognitive-error">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      {historyOpen && (
        <article className="cognitive-history">
          <header>
            <div>
              <HistoryIcon size={16} />
              <strong>Histórico do empreendimento</strong>
            </div>
            <small>Últimas 20 rodadas auditadas</small>
          </header>
          {pending && history.length === 0 ? (
            <div className="cognitive-history-empty">
              <LoaderCircle size={15} className="spin" />
              Carregando histórico...
            </div>
          ) : history.length === 0 ? (
            <div className="cognitive-history-empty">Nenhuma rodada cognitiva registrada.</div>
          ) : (
            <div className="cognitive-history-list">
              {history.map((item) => (
                <button
                  type="button"
                  key={item.reviewId}
                  className={item.reviewId === reviewId ? "is-active" : undefined}
                  onClick={() => openHistoricalReview(item)}
                  disabled={pending}
                >
                  <div className="cognitive-history-main">
                    <strong>{item.objective}</strong>
                    <span>{formatDateTime(item.createdAt)} · {item.createdBy}</span>
                  </div>
                  <div className="cognitive-history-metrics">
                    <span>{dispositionText(item.disposition)}</span>
                    <span>{item.challengeCount} questionamentos</span>
                    {item.criticalCount > 0 && <span>{item.criticalCount} críticos</span>}
                  </div>
                  <div className="cognitive-history-decision">
                    {item.decision
                      ? `${humanDecisionText(item.decision)} · ${item.decidedBy ?? "usuário"}`
                      : "Decisão humana pendente"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </article>
      )}

      {report && (
        <div className="cognitive-summary-row">
          <Summary label="Agentes" value={String(report.agents.length)} />
          <Summary label="Questionamentos" value={String(report.challenges.length)} />
          <Summary label="Críticos" value={String(criticalChallenges)} />
          <Summary
            label="Status"
            value={humanDecision ? humanDecisionLabel(humanDecision) : "Decisão humana pendente"}
          />
        </div>
      )}

      {report && expanded && (
        <div className="cognitive-details">
          <article className="cognitive-decision-card">
            <header>
              <ShieldCheck size={17} />
              <div>
                <span>PROPOSTA DO DECISION ENGINE</span>
                <strong>{dispositionLabel(report.proposal.disposition)}</strong>
              </div>
            </header>
            <p>{report.proposal.executiveSummary}</p>
            <div className="cognitive-alternatives">
              {report.proposal.alternatives.map((item) => (
                <div key={item.id}>
                  <strong>{item.label}</strong>
                  <p>{item.rationale}</p>
                  <small>{item.requiredControls.join(" · ")}</small>
                </div>
              ))}
            </div>
          </article>

          <div className="cognitive-agent-grid">
            {report.agents.map((agent) => (
              <article key={agent.agentId}>
                <header>
                  <BrainCircuit size={15} />
                  <strong>{agentLabel(agent.agentId)}</strong>
                </header>
                <p>{agent.focus}</p>
                <dl>
                  <div><dt>Evidências</dt><dd>{agent.evidence.length}</dd></div>
                  <div><dt>Conclusões</dt><dd>{agent.findings.length}</dd></div>
                  <div><dt>Recusas</dt><dd>{agent.refusedTools.length}</dd></div>
                </dl>
                {agent.findings.slice(0, 3).map((finding) => (
                  <div className="cognitive-finding" key={finding.id}>
                    <CheckCircle2 size={13} />
                    <span>{finding.statement}</span>
                  </div>
                ))}
              </article>
            ))}
          </div>

          {report.challenges.length > 0 && (
            <article className="cognitive-challenges">
              <header>
                <AlertTriangle size={16} />
                <strong>Red Team 2.0</strong>
              </header>
              {report.challenges.map((challenge) => (
                <div key={challenge.id} className={`severity-${challenge.severity.toLowerCase()}`}>
                  <span>{challenge.severity}</span>
                  <p>{challenge.message}</p>
                </div>
              ))}
            </article>
          )}

          {recommendations.length > 0 && (
            <article className="cognitive-autopilot">
              <header>
                <BrainCircuit size={16} />
                <strong>Autopilot · recomendações</strong>
              </header>
              {recommendations.map((item) => (
                <div key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.rationale}</p>
                  <small>{item.requiresHumanApproval ? "Requer aprovação humana" : "Somente recomendação"}</small>
                </div>
              ))}
            </article>
          )}

          <article className="cognitive-human-decision">
            <header>
              <ShieldCheck size={16} />
              <div>
                <strong>Decisão humana</strong>
                <p>A REDE registra sua decisão sobre esta rodada sem alterar automaticamente o empreendimento.</p>
              </div>
            </header>
            {humanDecision ? (
              <div className="cognitive-decision-recorded">
                <CheckCircle2 size={16} />
                <strong>{humanDecisionLabel(humanDecision)}</strong>
                {decisionNote && <span>{decisionNote}</span>}
              </div>
            ) : (
              <>
                <label>
                  <span>Observação opcional</span>
                  <textarea
                    rows={2}
                    maxLength={800}
                    value={decisionNote}
                    onChange={(event) => setDecisionNote(event.target.value)}
                    disabled={pending}
                    placeholder="Contexto, condição ou motivo da decisão."
                  />
                </label>
                <div className="cognitive-human-actions">
                  <button type="button" className="button button-primary" disabled={pending} onClick={() => recordDecision("ACCEPTED")}>
                    Aceitar proposta
                  </button>
                  <button type="button" className="button button-secondary" disabled={pending} onClick={() => recordDecision("HOLD")}>
                    Manter em análise
                  </button>
                  <button type="button" className="button button-secondary" disabled={pending} onClick={() => recordDecision("REWORK_REQUESTED")}>
                    Solicitar reanálise
                  </button>
                </div>
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function dispositionLabel(value: InvestmentCommitteeReport["proposal"]["disposition"]) {
  if (value === "PROCEED_WITH_CONTROLS") return "Prosseguir com controles";
  if (value === "HOLD_FOR_EVIDENCE") return "Aguardar evidências";
  return "Refazer a análise";
}

function dispositionText(value: string) {
  if (value === "PROCEED_WITH_CONTROLS") return "Prosseguir com controles";
  if (value === "HOLD_FOR_EVIDENCE") return "Aguardar evidências";
  if (value === "REWORK_ANALYSIS") return "Refazer análise";
  return "Proposta registrada";
}

function agentLabel(value: InvestmentCommitteeReport["agents"][number]["agentId"]) {
  return ({
    CFO: "CFO",
    ENGINEERING: "Engenharia",
    COMMERCIAL: "Comercial",
    LEGAL: "Jurídico",
    MARKET: "Mercado",
    INVESTOR: "Investidor",
    INCORPORATOR: "Incorporador",
  } as const)[value];
}

function isHumanDecision(value: string | null): value is HumanDecision {
  return value === "ACCEPTED" || value === "HOLD" || value === "REWORK_REQUESTED";
}

function humanDecisionLabel(value: HumanDecision) {
  if (value === "ACCEPTED") return "Proposta aceita";
  if (value === "HOLD") return "Mantida em análise";
  return "Reanálise solicitada";
}

function humanDecisionText(value: string) {
  return isHumanDecision(value) ? humanDecisionLabel(value) : "Decisão registrada";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
