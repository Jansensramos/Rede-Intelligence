"use client";

/**
 * Fase 9K.4A — bloco "O que você precisa saber para decidir" da Gestão Executiva. Puramente de
 * apresentação: toda a computação vive nas engines de `src/domain/executive-insights/engine.ts` e
 * na orquestração de `src/application/executive-insights/executive-insights-service.ts`. Este
 * componente só formata o que já veio calculado e, para as duas simulações (contratação e
 * desconto), chama as ações de servidor somente-leitura de `src/app/actions/executive-insights.ts`
 * — nenhuma delas persiste nada (ordem de serviço §9).
 */
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { AlertCircle, Banknote, Calculator, HandCoins, Percent, TrendingDown } from "lucide-react";
import { SectionTitle } from "@/components/ui";
import { simulateDiscountAction, simulateHiringAction } from "@/app/actions/executive-insights";
import type { DecisionAnswer, DecisionInsightsBundle, SimulableSalesUnit } from "@/application/executive-insights/executive-insights-service";
import type {
  BreakEvenCorporateResult,
  BreakEvenProjectResult,
  DiscountSimulationResult,
  FreeCashToInvestResult,
  HiringSimulationResult,
  RunwayScenarioResult,
  SalesContributionResult,
} from "@/domain/executive-insights/engine";
import type { AnswerStatus } from "@/domain/executive-insights/types";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;

const STATUS_LABELS: Record<Exclude<AnswerStatus, "OK">, string> = {
  SEM_DADOS: "SEM DADOS",
  SEM_EVIDENCIA: "SEM EVIDÊNCIA",
  NAO_APLICAVEL: "NÃO APLICÁVEL",
};

function StatusBadge({ status }: { status: AnswerStatus }) {
  if (status === "OK") return null;
  return <span className="ds-badge ds-badge-neutral">{STATUS_LABELS[status]}</span>;
}

function InsightCard({ answer, icon: Icon, children }: { answer: DecisionAnswer<unknown>; icon: typeof Calculator; children?: ReactNode }) {
  return (
    <article className="ds-insight-card">
      <header className="ds-insight-card-header">
        <span className="eyebrow">
          <Icon size={14} /> {answer.title}
        </span>
        <StatusBadge status={answer.status} />
      </header>
      <strong className="ds-insight-headline">{answer.headline}</strong>
      <p className="ds-insight-explanation">{answer.explanation}</p>
      {children}
      {answer.premises.length > 0 && (
        <details className="ds-insight-premises">
          <summary>Premissas usadas</summary>
          <ul>
            {answer.premises.map((premise, index) => (
              <li key={index}>{premise}</li>
            ))}
          </ul>
        </details>
      )}
      <footer className="ds-insight-footer">
        {answer.confidence && <span>Confiança: {answer.confidence}</span>}
        <span>Fonte: {answer.source}</span>
      </footer>
    </article>
  );
}

function RunwayCard({ answer }: { answer: DecisionAnswer<RunwayScenarioResult[]> }) {
  return (
    <InsightCard answer={answer} icon={TrendingDown}>
      {answer.data && (
        <ul className="ds-insight-scenario-list">
          {answer.data.map((scenario) => (
            <li key={scenario.scenario}>
              <span>{scenario.label}</span>
              <strong>{scenario.exceedsHorizon ? `> ${scenario.projectedRows.length} meses` : `${scenario.monthsOfRunway} mes(es)`}</strong>
            </li>
          ))}
        </ul>
      )}
    </InsightCard>
  );
}

function SalesContributionCard({ answer }: { answer: DecisionAnswer<SalesContributionResult> }) {
  return (
    <InsightCard answer={answer} icon={HandCoins}>
      {answer.data && (
        <ul className="ds-insight-scenario-list">
          <li>
            <span>VGV vendido</span>
            <strong>{currency.format(answer.data.grossVgv)}</strong>
          </li>
          <li>
            <span>Descontos + incentivos</span>
            <strong>-{currency.format(answer.data.discountsGranted + answer.data.incentivesGranted)}</strong>
          </li>
          <li>
            <span>Impostos (referência)</span>
            <strong>{answer.data.taxes.amount !== null ? `-${currency.format(answer.data.taxes.amount)}` : "sem evidência"}</strong>
          </li>
          <li>
            <span>Comissões</span>
            <strong>-{currency.format(answer.data.commissions.total)}</strong>
          </li>
          <li>
            <span>Custos desembolsados</span>
            <strong>-{currency.format(answer.data.costsIncurredToDate)}</strong>
          </li>
        </ul>
      )}
      {answer.data?.notes.map((note, index) => (
        <p key={index} className="ds-insight-explanation">
          {note}
        </p>
      ))}
    </InsightCard>
  );
}

function BreakEvenProjectCard({ answer }: { answer: DecisionAnswer<BreakEvenProjectResult> }) {
  return (
    <InsightCard answer={answer} icon={Percent}>
      {answer.data && (
        <ul className="ds-insight-scenario-list">
          <li>
            <span>Vendido / equilíbrio</span>
            <strong>{percentage(answer.data.progress)}</strong>
          </li>
          <li>
            <span>Unidades para o equilíbrio</span>
            <strong>{answer.data.breakEvenUnits}</strong>
          </li>
        </ul>
      )}
    </InsightCard>
  );
}

function BreakEvenCorporateCard({ answer }: { answer: DecisionAnswer<BreakEvenCorporateResult> }) {
  return (
    <InsightCard answer={answer} icon={Percent}>
      {answer.data && (
        <ul className="ds-insight-scenario-list">
          <li>
            <span>Vendido / equilíbrio (carteira)</span>
            <strong>{percentage(answer.data.progress)}</strong>
          </li>
          <li>
            <span>Empreendimentos incluídos</span>
            <strong>
              {answer.data.projectsIncluded} de {answer.data.projectsTotal}
            </strong>
          </li>
        </ul>
      )}
    </InsightCard>
  );
}

function FreeCashCard({ answer }: { answer: DecisionAnswer<FreeCashToInvestResult> }) {
  return <InsightCard answer={answer} icon={Banknote} />;
}

function HiringSimulationCard({ projectId }: { projectId: string }) {
  const [monthlyCost, setMonthlyCost] = useState("");
  const [result, setResult] = useState<DecisionAnswer<HiringSimulationResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = Number(monthlyCost);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Informe um custo mensal maior que zero.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const response = await simulateHiringAction(projectId, value);
      if (!response.ok) setError(response.error);
      else setResult(response.data);
    });
  }

  return (
    <article className="ds-insight-card">
      <header className="ds-insight-card-header">
        <span className="eyebrow">
          <Calculator size={14} /> Dá para contratar agora?
        </span>
      </header>
      <p className="ds-insight-explanation">Simulação somente — nenhuma pessoa ou folha é criada. Informe o custo mensal da posição para ver o impacto no fôlego de caixa.</p>
      <form onSubmit={onSubmit} className="ds-insight-sim-form">
        <input type="number" min="0" step="0.01" placeholder="Custo mensal (R$)" value={monthlyCost} onChange={(event) => setMonthlyCost(event.target.value)} />
        <button type="submit" className="button button-secondary" disabled={isPending}>
          {isPending ? "Simulando…" : "Simular"}
        </button>
      </form>
      {error && (
        <p className="ds-insight-explanation" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
      {result && (
        <>
          <strong className="ds-insight-headline">{result.headline}</strong>
          {result.data && (
            <ul className="ds-insight-scenario-list">
              <li>
                <span>Fôlego antes</span>
                <strong>{result.data.before.exceedsHorizon ? `> ${result.data.before.projectedRows.length} meses` : `${result.data.before.monthsOfRunway} mes(es)`}</strong>
              </li>
              <li>
                <span>Fôlego depois</span>
                <strong>{result.data.after.exceedsHorizon ? `> ${result.data.after.projectedRows.length} meses` : `${result.data.after.monthsOfRunway} mes(es)`}</strong>
              </li>
              <li>
                <span>Reserva mínima sugerida</span>
                <strong>{currency.format(result.data.reserveMinimum)}</strong>
              </li>
            </ul>
          )}
          {result.premises.length > 0 && (
            <details className="ds-insight-premises">
              <summary>Premissas usadas</summary>
              <ul>
                {result.premises.map((premise, index) => (
                  <li key={index}>{premise}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </article>
  );
}

function DiscountSimulationCard({ projectId, units }: { projectId: string; units: SimulableSalesUnit[] }) {
  const [salesUnitId, setSalesUnitId] = useState(units[0]?.id ?? "");
  const [proposedPrice, setProposedPrice] = useState("");
  const [result, setResult] = useState<DecisionAnswer<DiscountSimulationResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (units.length === 0) {
    return (
      <article className="ds-insight-card">
        <header className="ds-insight-card-header">
          <span className="eyebrow">
            <AlertCircle size={14} /> Esse desconto ainda faz sentido?
          </span>
        </header>
        <p className="ds-insight-explanation">Nenhuma unidade disponível com tabela de preço ativa para simular neste empreendimento.</p>
      </article>
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = Number(proposedPrice);
    if (!salesUnitId || !Number.isFinite(value) || value < 0) {
      setError("Selecione uma unidade e informe um preço proposto válido.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const response = await simulateDiscountAction(projectId, salesUnitId, value);
      if (!response.ok) setError(response.error);
      else setResult(response.data);
    });
  }

  return (
    <article className="ds-insight-card">
      <header className="ds-insight-card-header">
        <span className="eyebrow">
          <AlertCircle size={14} /> Esse desconto ainda faz sentido?
        </span>
      </header>
      <p className="ds-insight-explanation">Simulação por unidade — nenhuma proposta ou venda é criada/alterada.</p>
      <form onSubmit={onSubmit} className="ds-insight-sim-form">
        <select value={salesUnitId} onChange={(event) => setSalesUnitId(event.target.value)}>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.code} · {unit.typology} · {currency.format(unit.listPrice)}
            </option>
          ))}
        </select>
        <input type="number" min="0" step="0.01" placeholder="Preço proposto (R$)" value={proposedPrice} onChange={(event) => setProposedPrice(event.target.value)} />
        <button type="submit" className="button button-secondary" disabled={isPending}>
          {isPending ? "Simulando…" : "Simular"}
        </button>
      </form>
      {error && (
        <p className="ds-insight-explanation" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
      {result && (
        <>
          <strong className="ds-insight-headline">{result.headline}</strong>
          {result.data && (
            <ul className="ds-insight-scenario-list">
              <li>
                <span>Desconto</span>
                <strong>
                  {currency.format(result.data.discountAmount)} ({percentage(result.data.discountPercentage)})
                </strong>
              </li>
              <li>
                <span>Alçada necessária</span>
                <strong>{result.data.requiredApprovalRole ?? "sem política cadastrada"}</strong>
              </li>
            </ul>
          )}
          {result.premises.length > 0 && (
            <details className="ds-insight-premises">
              <summary>Premissas usadas</summary>
              <ul>
                {result.premises.map((premise, index) => (
                  <li key={index}>{premise}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </article>
  );
}

export function DecisionInsightsPanel({ insights, simulableUnits }: { insights: DecisionInsightsBundle; simulableUnits: SimulableSalesUnit[] }) {
  const hasAnyFinancialInsight = Boolean(insights.salesContribution || insights.runway || insights.breakEvenProject || insights.breakEvenCorporate || insights.freeCashToInvest);
  if (!hasAnyFinancialInsight && !insights.hiringSimulationAvailable && !insights.discountSimulationAvailable) return null;

  return (
    <section>
      <SectionTitle
        eyebrow="DECISÃO"
        title="O que você precisa saber para decidir"
        description="Engines determinísticas calculam a partir de dados reais já existentes — nunca um número inventado. Quando falta uma premissa, a resposta diz isso explicitamente em vez de estimar."
      />
      <div className="ds-insight-grid">
        {insights.salesContribution && <SalesContributionCard answer={insights.salesContribution} />}
        {insights.runway && <RunwayCard answer={insights.runway} />}
        {insights.breakEvenProject && <BreakEvenProjectCard answer={insights.breakEvenProject} />}
        {insights.breakEvenCorporate && <BreakEvenCorporateCard answer={insights.breakEvenCorporate} />}
        {insights.freeCashToInvest && <FreeCashCard answer={insights.freeCashToInvest} />}
        {insights.hiringSimulationAvailable && <HiringSimulationCard projectId={insights.projectId} />}
        {insights.discountSimulationAvailable && <DiscountSimulationCard projectId={insights.projectId} units={simulableUnits} />}
      </div>
    </section>
  );
}
