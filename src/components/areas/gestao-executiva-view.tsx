"use client";

/**
 * Fase 9K.2 — Nova Visão Executiva (ordem de serviço §1/§2/§14). Substitui integralmente a antiga
 * "overview" (pilha de ~8 tabelas-resumo por módulo, sem priorização — ver histórico deste arquivo
 * na 9K.1) por uma leitura por exceção: o que precisa de atenção primeiro, KPIs essenciais depois,
 * "o que mudou" em seguida, desempenho por área, carteira (quando o contexto tiver mais de um
 * empreendimento) e, por fim, a proveniência/freshness dos dados (ordem de serviço §10/§14).
 *
 * Este componente é puramente de apresentação — toda a computação de severidade/materialidade,
 * consultas enxutas e regras de não-duplicação vivem em `src/application/executive/` e
 * `src/domain/workspace/exception-builders.ts`.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BadgeCheck, Building2, CircleDollarSign, ClipboardCheck, Gauge, HandCoins, Landmark, Lock, Scale, TrendingUp } from "lucide-react";
import { DataTable, EmptyState, MetricCard, SectionTitle, SeverityBadge, type DataTableColumn } from "@/components/ui";
import { SEVERITY_LABELS, type CanonicalSeverity } from "@/domain/workspace/severity";
import type { ExecutiveDomain, ExecutiveException } from "@/domain/workspace/exceptions";
import type { ExecutiveFreshnessEntry, ExecutiveProjectOverview, ExecutivePortfolioEntry, ExecutivePortfolioOverview } from "@/application/executive/executive-service";

const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;
const relativeTime = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
const compactCurrencyOrNoData = (value: number | null) => (value === null ? "Sem dados" : compactCurrency.format(value));

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return relativeTime.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relativeTime.format(-hours, "hour");
  return relativeTime.format(-Math.round(hours / 24), "day");
}

/**
 * Fechamento da 9K.2, gate 3 ("freshness real"): renderiza a semântica correta por `kind` — nunca
 * "Atualizado agora" quando o que se sabe de fato é "consultado agora" (ver
 * `src/domain/workspace/freshness.ts`). `suppressHydrationWarning` só no texto relativo
 * (`timeAgo`), que depende de `Date.now()` e por natureza diverge entre servidor e cliente — não é
 * supressão de um erro de marcação real.
 */
function FreshnessText({ entry }: { entry: ExecutiveFreshnessEntry }) {
  if (entry.kind === "source_updated") {
    return (
      <>
        atualizado <span suppressHydrationWarning>{timeAgo(entry.updatedAt!)}</span>
      </>
    );
  }
  if (entry.kind === "queried_now") {
    return (
      <>
        consultado <span suppressHydrationWarning>{timeAgo(entry.queriedAt!)}</span>
      </>
    );
  }
  return <>atualização da fonte indisponível</>;
}

/** Cartão "sem permissão" (gate 2 do fechamento): mostrado quando o backend nem consultou o domínio — nunca um valor fabricado, nunca um card escondido sem explicação. */
function RestrictedAreaCard({ label }: { label: string }) {
  return (
    <div className="ds-area-card ds-area-card-restricted">
      <span className="eyebrow">{label.toUpperCase()}</span>
      <strong style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Lock size={16} /> Sem permissão
      </strong>
      <small>Seu perfil não tem a capacidade de visualizar este domínio.</small>
    </div>
  );
}

const ATTENTION_ORDER: CanonicalSeverity[] = ["CRITICO", "DECISAO", "ACAO_NECESSARIA", "ATENCAO"];

/** Rótulos em português para enums técnicos exibidos nesta tela (critério de aceite: "interface 100% em português", inclusive rótulos técnicos). */
const SCHEDULE_STATUS_LABELS: Record<string, string> = { DRAFT: "Rascunho", UNDER_REVIEW: "Em revisão", APPROVED: "Aprovado", SUPERSEDED: "Substituído", CLOSED: "Encerrado" };
const BUDGET_STATUS_LABELS: Record<string, string> = { DRAFT: "Rascunho", UNDER_REVIEW: "Em revisão", APPROVED: "Aprovado", ARCHIVED: "Arquivado", OFFICIAL: "Oficial", SUPERSEDED: "Substituído", CLOSED: "Encerrado" };
const ACCOUNTING_STATUS_LABELS: Record<string, string> = { OPEN: "Aberto", UNDER_REVIEW: "Em revisão", CLOSED: "Fechado", REOPENED: "Reaberto", ADJUSTMENT: "Em ajuste" };
const translateStatus = (map: Record<string, string>, value: string | null) => (value === null ? null : (map[value] ?? value));

function ExceptionRow({ exception, onOpen }: { exception: ExecutiveException; onOpen: () => void }) {
  return (
    <button className="ds-exception-row" type="button" onClick={onOpen}>
      <SeverityBadge severity={exception.severity} />
      <span>
        <strong>{exception.title}</strong>
        <span className="ds-exception-row-summary">{exception.summary}</span>
      </span>
      <ArrowRight size={16} />
    </button>
  );
}

export function GestaoExecutivaView({ overview, portfolio }: { overview: ExecutiveProjectOverview; portfolio: ExecutivePortfolioOverview | null }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const { kpis } = overview;

  const visibleExceptions = expanded ? overview.exceptions : overview.exceptions.slice(0, 7);
  const decisions = useMemo(() => [...overview.exceptions, ...(portfolio?.scopeExceptions ?? [])].filter((item) => item.severity === "DECISAO"), [overview.exceptions, portfolio]);
  const isAuthorized = (domain: ExecutiveDomain) => overview.authorizedDomains.includes(domain);

  const portfolioColumns: DataTableColumn<ExecutivePortfolioEntry>[] = [
    { key: "project", header: "Empreendimento", priority: "essential", render: (row) => <strong>{row.project.name}</strong> },
    { key: "severity", header: "Severidade", priority: "essential", align: "left", render: (row) => <SeverityBadge severity={row.topSeverity} /> },
    { key: "exceptions", header: "Exceções", priority: "default", render: (row) => row.exceptionCount },
    { key: "vgv", header: "VGV vendido", priority: "default", render: (row) => compactCurrencyOrNoData(row.headline.vgvVendido) },
    { key: "overdue", header: "Financeiro vencido", priority: "default", render: (row) => compactCurrencyOrNoData(row.headline.overdueFinancialAmount) },
    { key: "cash", header: "Caixa", priority: "optional", render: (row) => compactCurrencyOrNoData(row.headline.cashPosition) },
  ];

  return (
    <div className="view-stack">
      <section className="ds-exec-header">
        <div>
          <span className="eyebrow">GESTÃO EXECUTIVA</span>
          <h1>{overview.project.name}</h1>
          <p>
            {[overview.project.companyName, overview.project.economicGroupName].filter(Boolean).join(" · ") || "Sem empresa/grupo vinculado"} · {overview.project.city}/{overview.project.state}
          </p>
        </div>
        <div className="ds-exec-summary">
          {ATTENTION_ORDER.filter((severity) => overview.attentionSummary[severity] > 0).map((severity) => (
            <SeverityBadge key={severity} severity={severity} label={`${overview.attentionSummary[severity]} ${SEVERITY_LABELS[severity].toLowerCase()}`} />
          ))}
          {overview.exceptions.length === 0 && <SeverityBadge severity="NORMAL" label="Nenhuma exceção aberta" />}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="PRIORIDADE" title="O que precisa da sua atenção agora" description="Consolidado dos módulos operacionais, ordenado por severidade e materialidade — não é uma segunda fonte de dado, cada item aponta para o registro original." />
        {overview.exceptions.length === 0 ? (
          <EmptyState icon={BadgeCheck} title="Nenhuma exceção relevante agora" description="Com os dados e a política de materialidade atuais da organização, nenhum item cruzou o limiar de atenção executiva." />
        ) : (
          <>
            <div className="ds-exception-list">
              {visibleExceptions.map((exception) => (
                <ExceptionRow key={exception.id} exception={exception} onOpen={() => router.push(exception.href)} />
              ))}
            </div>
            {overview.exceptions.length > 7 && (
              <button className="text-button" style={{ marginTop: 10 }} type="button" onClick={() => setExpanded((value) => !value)}>
                {expanded ? "Mostrar só as principais" : `Ver todas (${overview.exceptions.length})`} <ArrowRight size={15} />
              </button>
            )}
          </>
        )}
      </section>

      <section>
        <SectionTitle eyebrow="RESULTADOS" title="Principais indicadores" description="Poucos números que respondem a uma pergunta executiva — não é um inventário de tudo que existe no banco." />
        <div className="metrics-grid">
          {kpis.viability ? (
            <>
              <MetricCard label="VGV do estudo ativo" value={compactCurrency.format(kpis.viability.vgv)} meta={`Cenário ${kpis.viability.scenarioLabel}`} icon={Building2} />
              <MetricCard label="Margem sobre VGV" value={percentage(kpis.viability.marginOnVgv)} meta="Estudo de viabilidade ativo" tone={kpis.viability.marginOnVgv >= 0 ? "positive" : "negative"} icon={Gauge} />
              <MetricCard label="Exposição máxima de caixa" value={compactCurrency.format(kpis.viability.maximumCashExposure)} meta="Pico projetado pelo estudo" icon={TrendingUp} />
            </>
          ) : (
            <MetricCard label="Viabilidade" value="Sem estudo ativo" meta="Crie ou promova um estudo em Viabilidade" icon={Scale} />
          )}
          {kpis.commercial ? (
            <>
              <MetricCard label="Unidades vendidas / disponíveis" value={`${kpis.commercial.unitsSold} / ${kpis.commercial.unitsAvailable}`} meta={`${kpis.commercial.unitsTotal} unidade(s) no total`} icon={HandCoins} />
              <MetricCard label="VGV vendido (aprovado)" value={compactCurrency.format(kpis.commercial.vgvVendido)} meta="Vendas com status aprovado" icon={CircleDollarSign} />
            </>
          ) : (
            <MetricCard label="Comercial" value="Sem permissão" meta="Seu perfil não tem a capacidade Comercial" icon={Lock} />
          )}
          {kpis.financial ? (
            <>
              <MetricCard label="Caixa (contas da empresa)" value={kpis.financial.cashPosition === null ? "Sem dados" : compactCurrency.format(kpis.financial.cashPosition)} meta="Saldo agregado das contas bancárias" icon={Landmark} />
              <MetricCard
                label="Vencido (a pagar + a receber)"
                value={compactCurrency.format(kpis.financial.overduePayablesAmount + kpis.financial.overdueReceivablesAmount)}
                meta={`${kpis.financial.overduePayablesCount + kpis.financial.overdueReceivablesCount} parcela(s) em aberto`}
                tone={kpis.financial.overduePayablesAmount + kpis.financial.overdueReceivablesAmount > 0 ? "negative" : "positive"}
                icon={CircleDollarSign}
              />
            </>
          ) : (
            <MetricCard label="Financeiro" value="Sem permissão" meta="Seu perfil não tem a capacidade Financeiro" icon={Lock} />
          )}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="DESDE A ÚLTIMA JANELA" title={`O que mudou nos últimos ${overview.windowDays} dias`} description="Janela fixa e determinística — este contexto ainda não persiste 'última visita' por usuário (ver relatório de entrega da 9K.2)." />
        {overview.whatChanged.length === 0 ? (
          <EmptyState title="Nenhuma mudança relevante na janela" description={`Nenhuma venda, obrigação, conta ou licença nova nos últimos ${overview.windowDays} dias.`} />
        ) : (
          <div className="ds-whatchanged">
            {overview.whatChanged.map((item) => (
              <button key={item.id} className="ds-whatchanged-item" type="button" onClick={() => router.push(item.href)} style={{ textAlign: "left", cursor: "pointer" }}>
                <strong>{item.label}</strong>
                {item.detail}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle eyebrow="ÁREAS" title="Desempenho por área" description="Um recorte por módulo — abrir a área para o detalhamento completo." />
        <div className="ds-area-grid">
          {kpis.legal ? (
            <button className="ds-area-card" type="button" onClick={() => router.push("/juridico")}>
              <span className="eyebrow">JURÍDICO</span>
              <strong>{kpis.legal.obligationsAtRisk + kpis.legal.licensesAtRisk}</strong>
              <small>{kpis.legal.obligationsAtRisk} obrigação(ões) · {kpis.legal.licensesAtRisk} licença(s) em janela de atenção</small>
            </button>
          ) : (
            <RestrictedAreaCard label="Jurídico" />
          )}
          {kpis.procurement ? (
            <button className="ds-area-card" type="button" onClick={() => router.push("/suprimentos")}>
              <span className="eyebrow">SUPRIMENTOS</span>
              <strong>{kpis.procurement.criticalPurchases}</strong>
              <small>compra(s) crítica(s) · {kpis.procurement.pendingMeasurements} medição(ões) pendente(s)</small>
            </button>
          ) : (
            <RestrictedAreaCard label="Suprimentos" />
          )}
          <button className="ds-area-card" type="button" onClick={() => router.push("/engenharia-obra")}>
            <span className="eyebrow">OBRA / ENGENHARIA</span>
            <strong>{translateStatus(SCHEDULE_STATUS_LABELS, kpis.operations.scheduleStatus) ?? "Sem cronograma"}</strong>
            <small>Orçamento: {translateStatus(BUDGET_STATUS_LABELS, kpis.operations.budgetStatus) ?? "sem orçamento oficial"} · {kpis.operations.criticalVarianceCategories} categoria(s) com variação relevante</small>
          </button>
          {isAuthorized("accounting") ? (
            <button className="ds-area-card" type="button" onClick={() => router.push("/contabilidade-controladoria")}>
              <span className="eyebrow">CONTABILIDADE</span>
              <strong>{kpis.accounting ? (ACCOUNTING_STATUS_LABELS[kpis.accounting.status] ?? kpis.accounting.status) : "Sem dados"}</strong>
              <small>{kpis.accounting ? `Competência ${kpis.accounting.referenceMonth}` : "Nenhum período contábil aberto para esta empresa"}</small>
            </button>
          ) : (
            <RestrictedAreaCard label="Contabilidade" />
          )}
          {kpis.integrations ? (
            <button className="ds-area-card" type="button" onClick={() => router.push("/integracoes")}>
              <span className="eyebrow">INTEGRAÇÕES</span>
              <strong>{kpis.integrations.criticalInstallations + kpis.integrations.attentionInstallations}</strong>
              <small>{kpis.integrations.criticalInstallations} crítica(s) · {kpis.integrations.attentionInstallations} em atenção · {kpis.integrations.expiringCredentials} credencial(is) expirando</small>
            </button>
          ) : (
            <RestrictedAreaCard label="Integrações" />
          )}
        </div>
      </section>

      {decisions.length > 0 && (
        <section>
          <SectionTitle eyebrow="DECISÕES" title="Aguardando aprovação" description="Reaproveita o mecanismo de alçada já existente (ApprovalRequest) — a Gestão Executiva não cria um segundo fluxo de aprovação." action={<ClipboardCheck size={18} />} />
          <div className="ds-exception-list">
            {decisions.map((exception) => (
              <ExceptionRow key={exception.id} exception={exception} onOpen={() => router.push(exception.href)} />
            ))}
          </div>
        </section>
      )}

      {portfolio && (
        <section>
          <SectionTitle eyebrow="CARTEIRA" title={`Carteira — ${portfolio.scopeLabel}`} description="Ordenada por severidade e materialidade, não por ordem alfabética. Clique em um empreendimento para abrir sua leitura executiva." />
          <DataTable columns={portfolioColumns} rows={portfolio.entries} rowKey={(row) => row.project.id} onRowClick={(row) => router.push(row.href)} />
          {portfolio.scopeExceptions.filter((item) => item.severity !== "DECISAO").length > 0 && (
            <div style={{ marginTop: 14 }}>
              <SectionTitle eyebrow="CARTEIRA" title="Exceções em nível de grupo/organização" description="Ex.: integrações — instalações cobrem Grupo/Empresa/SPE/Empreendimento simultaneamente, nunca duplicadas por projeto." />
              <div className="ds-exception-list">
                {portfolio.scopeExceptions
                  .filter((item) => item.severity !== "DECISAO")
                  .map((exception) => (
                    <ExceptionRow key={exception.id} exception={exception} onOpen={() => router.push(exception.href)} />
                  ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section>
        <SectionTitle eyebrow="CONFIANÇA DO DADO" title="Atualização e fonte" description="Dados nativos REDE refletem o estado corrente do banco no momento da leitura; dados de conectores externos mostram a última sincronização conhecida." />
        <div className="ds-exec-freshness">
          {overview.freshness.map((entry) => (
            <span key={entry.domain}>
              <strong>{entry.label}:</strong> {entry.source} · <FreshnessText entry={entry} />
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
