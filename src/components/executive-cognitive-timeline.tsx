"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  History,
  LoaderCircle,
  PlugZap,
  ShieldCheck,
} from "lucide-react";
import {
  getCognitiveLearningReportAction,
  getCognitiveProductionReadinessAction,
  getCognitiveReviewAction,
  listCognitiveReviewHistoryAction,
} from "@/app/actions/cognitive";
import type { InvestmentCommitteeReport, LearningReport } from "@/application/cognitive";

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

type ReadinessCheck = {
  key: string;
  label: string;
  status: "READY" | "WAITING_DATA" | "EXTERNAL_DEPENDENCY";
  detail: string;
};

type Readiness = {
  provider: string;
  cognitiveRuns: number;
  humanDecisions: number;
  evaluatedForecasts: number;
  activeConnectors: number;
  closure: { status: string; version: number } | null;
  checks: ReadinessCheck[];
};

export function ExecutiveCognitiveTimeline({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [learning, setLearning] = useState<{ report: LearningReport; observations: number; lastCalculatedAt: string | null } | null>(null);
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
      const [historyResponse, readinessResponse, learningResponse] = await Promise.all([
        listCognitiveReviewHistoryAction({ projectId }),
        getCognitiveProductionReadinessAction({ projectId }),
        getCognitiveLearningReportAction({ projectId }),
      ]);
      if (!active) return;

      if (historyResponse.ok) setItems(historyResponse.data as HistoryItem[]);
      else setError(historyResponse.error);

      if (readinessResponse.ok) setReadiness(readinessResponse.data as Readiness);
      else setError((current) => current || readinessResponse.error);

      if (learningResponse.ok) {
        setLearning({
          report: learningResponse.data.report,
          observations: learningResponse.data.observations,
          lastCalculatedAt: learningResponse.data.lastCalculatedAt,
        });
      } else {
        setError((current) => current || learningResponse.error);
      }
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
    <div className="executive-cognitive-stack">
      <section className="executive-phase-readiness" aria-label="Situação operacional">
        <header>
          <div>
            <span className="eyebrow">SITUAÇÃO OPERACIONAL</span>
            <h3><Activity size={18} /> O que já está pronto</h3>
            <p>Visão objetiva do que está disponível, do que aguarda dados e do que depende de integrações externas.</p>
          </div>
          <div className="executive-readiness-summary">
            <strong>{readiness?.checks.filter((item) => item.status === "READY").length ?? 0}</strong>
            <span>de {readiness?.checks.length ?? 6} prontos</span>
          </div>
        </header>

        {readiness ? (
          <div className="executive-readiness-grid">
            {readiness.checks.map((check) => (
              <article key={check.key} className={`status-${check.status.toLowerCase()}`}>
                <div>
                  {check.status === "READY" ? <CheckCircle2 size={15} /> : check.status === "EXTERNAL_DEPENDENCY" ? <PlugZap size={15} /> : <CircleDot size={15} />}
                  <strong>{check.label}</strong>
                </div>
                <p>{check.detail}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="executive-cognitive-empty">
            <LoaderCircle size={16} className="spin" />
            Carregando prontidão...
          </div>
        )}
      </section>

      <section className="executive-learning-loop" aria-label="Aprendizado com resultados">
        <header>
          <div>
            <span className="eyebrow">APRENDIZADO COM RESULTADOS</span>
            <h3><BrainCircuit size={18} /> Previsto × realizado</h3>
            <p>Compara o que foi previsto com o que realmente aconteceu para melhorar a qualidade das próximas análises.</p>
          </div>
          <div className="executive-cognitive-count">
            <Activity size={15} />
            <strong>{learning?.observations ?? 0}</strong>
            <span>observações</span>
          </div>
        </header>

        {learning && learning.report.metrics.length > 0 ? (
          <>
            <div className="executive-learning-grid">
              {learning.report.metrics.slice(0, 8).map((metric) => (
                <article key={metric.metric}>
                  <span>{metric.metric}</span>
                  <strong>{metric.sampleSize} amostra(s)</strong>
                  <p>Erro médio absoluto: {formatNumber(metric.meanAbsoluteError)}</p>
                  <p>Viés médio: {formatNumber(metric.meanBias)}</p>
                </article>
              ))}
            </div>
            {learning.report.recommendations.length > 0 && (
              <div className="executive-learning-recommendations">
                {learning.report.recommendations.slice(0, 5).map((item) => <p key={item}>{item}</p>)}
                <small>Alteração automática de política: bloqueada.</small>
              </div>
            )}
          </>
        ) : (
          <div className="executive-cognitive-empty">
            O aprendizado com resultados está disponível e aguardando avaliações reais de previsto × realizado.
          </div>
        )}
      </section>

      <section className="executive-cognitive-timeline" aria-label="Registro de decisões">
        <header>
          <div>
            <span className="eyebrow">REGISTRO DE DECISÕES</span>
            <h3><BrainCircuit size={18} /> Histórico de decisões</h3>
            <p>Histórico das análises realizadas e das decisões registradas para este empreendimento.</p>
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
          <div className="executive-cognitive-empty">Nenhuma análise registrada para este empreendimento.</div>
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
                <span>Recomendação estruturada</span>
                <strong>{dispositionLabel(selected.report.proposal.disposition)}</strong>
                <p>{selected.report.proposal.executiveSummary}</p>
              </div>
              <div>
                <span>Decisão registrada</span>
                <strong>{selected.humanDecision ? decisionLabel(selected.humanDecision) : "Pendente"}</strong>
                <p>
                  {selected.humanDecision
                    ? `${selected.decidedBy ?? "Usuário"} · ${selected.decidedAt ? formatDate(selected.decidedAt) : ""}`
                    : "Aguardando decisão humana."}
                </p>
                {selected.decisionNote && <small>{selected.decisionNote}</small>}
              </div>
              <div>
                <span>Revisão crítica</span>
                <strong>{selected.report.challenges.length} questionamentos</strong>
                <p>{selected.report.challenges.filter((item) => item.severity === "CRITICAL").length} críticos.</p>
              </div>
            </div>
          </article>
        )}
      </section>
    </div>
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(value);
}
