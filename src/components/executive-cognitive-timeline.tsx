"use client";

import { useEffect, useState, useTransition } from "react";
import { BrainCircuit, History, LoaderCircle, ShieldCheck } from "lucide-react";
import { getCognitiveReviewAction, listCognitiveReviewHistoryAction } from "@/app/actions/cognitive";
import type { InvestmentCommitteeReport } from "@/application/cognitive";

type HistoryItem = {
  reviewId: string;
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

export function ExecutiveCognitiveTimeline({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selected, setSelected] = useState<{
    objective: string;
    report: InvestmentCommitteeReport;
    humanDecision: string | null;
    decisionNote: string;
    createdAt: string;
    createdBy: string;
    decidedAt: string | null;
    decidedBy: string | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    startTransition(async () => {
      const response = await listCognitiveReviewHistoryAction({ projectId });
      if (!active) return;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setItems(response.data as HistoryItem[]);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  function openReview(reviewId: string) {
    setError("");
    startTransition(async () => {
      const response = await getCognitiveReviewAction({ reviewId, projectId });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setSelected({
        objective: response.data.objective,
        report: response.data.report as unknown as InvestmentCommitteeReport,
        humanDecision: response.data.humanDecision,
        decisionNote: response.data.decisionNote,
        createdAt: response.data.createdAt,
        createdBy: response.data.createdBy,
        decidedAt: response.data.decidedAt,
        decidedBy: response.data.decidedBy,
      });
    });
  }

  return (
    <section className="executive-cognitive-timeline" aria-label="Governança cognitiva">
      <header>
        <div>
          <span className="eyebrow">GOVERNANÇA COGNITIVA</span>
          <h3><BrainCircuit size={18} /> Linha do tempo de decisões</h3>
          <p>Rodadas do Comitê Cognitivo e decisões humanas registradas para este empreendimento.</p>
        </div>
        <div className="executive-cognitive-count">
          <History size={15} />
          <strong>{items.length}</strong>
          <span>rodadas</span>
        </div>
      </header>

      {error && <div className="cognitive-error">{error}</div>}

      {pending && items.length === 0 ? (
        <div className="executive-cognitive-empty"><LoaderCircle size={16} className="spin" /> Carregando histórico...</div>
      ) : items.length === 0 ? (
        <div className="executive-cognitive-empty">Nenhuma rodada cognitiva registrada para este empreendimento.</div>
      ) : (
        <div className="executive-cognitive-list">
          {items.slice(0, 8).map((item) => (
            <button type="button" key={item.reviewId} onClick={() => openReview(item.reviewId)} disabled={pending}>
              <div className="executive-cognitive-date">{formatDate(item.createdAt)}</div>
              <div className="executive-cognitive-main">
                <strong>{item.objective}</strong>
                <span>{item.createdBy} · {dispositionLabel(item.disposition)}</span>
              </div>
              <div className="executive-cognitive-badges">
                <span>{item.challengeCount} questionamentos</span>
                {item.criticalCount > 0 && <span>{item.criticalCount} críticos</span>}
              </div>
              <div className="executive-cognitive-status">
                <ShieldCheck size={13} />
                <span>{decisionLabel(item.decision)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <article className="executive-cognitive-detail">
          <header>
            <div>
              <strong>{selected.objective}</strong>
              <span>{formatDate(selected.createdAt)} · {selected.createdBy}</span>
            </div>
            <span>{decisionLabel(selected.humanDecision)}</span>
          </header>
          <div className="executive-cognitive-detail-grid">
            <div>
              <span>Proposta do Decision Engine</span>
              <strong>{dispositionLabel(selected.report.proposal.disposition)}</strong>
              <p>{selected.report.proposal.executiveSummary}</p>
            </div>
            <div>
              <span>Governança</span>
              <strong>{selected.humanDecision ? decisionLabel(selected.humanDecision) : "Pendente"}</strong>
              <p>
                {selected.humanDecision
                  ? `${selected.decidedBy ?? "Usuário"} · ${selected.decidedAt ? formatDate(selected.decidedAt) : ""}`
                  : "Aguardando decisão humana."}
              </p>
              {selected.decisionNote && <small>{selected.decisionNote}</small>}
            </div>
            <div>
              <span>Red Team</span>
              <strong>{selected.report.challenges.length} questionamentos</strong>
              <p>{selected.report.challenges.filter((item) => item.severity === "CRITICAL").length} críticos.</p>
            </div>
          </div>
        </article>
      )}
    </section>
  );
}

function dispositionLabel(value: string) {
  if (value === "PROCEED_WITH_CONTROLS") return "Prosseguir com controles";
  if (value === "HOLD_FOR_EVIDENCE") return "Aguardar evidências";
  if (value === "REWORK_ANALYSIS") return "Refazer análise";
  return "Proposta registrada";
}

function decisionLabel(value: string | null) {
  if (value === "ACCEPTED") return "Proposta aceita";
  if (value === "HOLD") return "Mantida em análise";
  if (value === "REWORK_REQUESTED") return "Reanálise solicitada";
  return "Decisão pendente";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
