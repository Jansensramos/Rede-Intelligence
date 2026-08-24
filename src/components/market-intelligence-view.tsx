"use client";

import { useState } from "react";
import { AlertTriangle, Building2, Coins, Landmark, MapPinned, Radar, ShieldQuestion, TrendingUp, Users } from "lucide-react";
import type { MarketProductWorkspaceView } from "@/application/market-product";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlPrecise = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const confidenceLabel: Record<string, string> = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };
const stageLabel: Record<string, string> = { BREVE_LANCAMENTO: "Breve lançamento", LANCAMENTO: "Lançamento", EM_OBRAS: "Em obras", PRONTO_NOVO: "Pronto novo", PRONTO_USADO: "Pronto usado" };
const standardLabel: Record<string, string> = { ECONOMICO_MCMV: "Econômico (MCMV)", MEDIO_BAIXO: "Médio-baixo", MEDIO: "Médio", MEDIO_ALTO: "Médio-alto", ALTO: "Alto", LUXO: "Luxo" };

type Area = "visao" | "demografia" | "renda" | "concorrentes" | "precos" | "fontes";
const areas: { key: Area; label: string }[] = [
  { key: "visao", label: "Visão Geral" },
  { key: "demografia", label: "Demografia" },
  { key: "renda", label: "Renda e Capacidade" },
  { key: "concorrentes", label: "Oferta e Concorrentes" },
  { key: "precos", label: "Preços e Absorção" },
  { key: "fontes", label: "Fontes e Qualidade" },
];

function ConfidenceBadge({ level }: { level: string }) {
  return <span className={`status-pill ${level === "HIGH" ? "positive-value" : level === "LOW" ? "negative-value" : ""}`}>Nível de Confiança: {confidenceLabel[level] ?? level}</span>;
}

// Nenhum conector real 9H para IBGE/Prospecta existe ainda: sempre que a visão contiver dado
// sintético de demonstração, isso precisa ficar visível antes de qualquer número — nunca pode ser
// confundido com coleta real de mercado.
function DemoDataBanner() {
  return (
    <div className="model-note">
      <AlertTriangle size={20} />
      <div>
        <strong>Dados de demonstração</strong>
        <p>Concorrentes, demografia, renda e preços desta área foram gerados para fins de demonstração (seed START BUTANTÃ) — não são coleta real de mercado. Nenhum conector IBGE/Prospecta/portal está ativo nesta fase.</p>
      </div>
    </div>
  );
}

export function MarketIntelligenceView({ workspace }: { workspace: MarketProductWorkspaceView }) {
  const [area, setArea] = useState<Area>("visao");
  const { marketArea, overview } = workspace;

  if (!marketArea || !overview) {
    return (
      <div className="empty-state">
        <MapPinned size={18} /> Nenhuma área de mercado configurada para esta organização ainda. Execute o seed demonstrativo ou cadastre uma área de influência com um perfil que possua a capacidade de gerenciar dados de mercado.
      </div>
    );
  }

  const eligibleCompetitors = overview.competitors.filter((item) => item.eligible);
  const ineligibleCompetitors = overview.competitors.filter((item) => !item.eligible);

  return (
    <div className="view-stack">
      <div className="scenario-switch" aria-label="Áreas de Inteligência de Mercado">
        {areas.map((item) => <button key={item.key} className={area === item.key ? "is-active" : ""} onClick={() => setArea(item.key)}>{item.label}</button>)}
      </div>

      {overview.isDemoData && <DemoDataBanner />}

      {area === "visao" && <>
        <section className="metrics-grid">
          <article className="metric-card"><div><span>Preço médio da região</span><Coins size={17} /></div><strong>{overview.priceStats.median > 0 ? `${brlPrecise.format(overview.priceStats.median)}/m²` : "—"}</strong><small>Mediana entre concorrentes elegíveis</small></article>
          <article className="metric-card"><div><span>Velocidade média de vendas</span><TrendingUp size={17} /></div><strong>{number.format(overview.aggregateMonthlyVelocityUnits)} un./mês</strong><small>VSO agregado: {pct.format(overview.aggregateVsoPercentage)}</small></article>
          <article className="metric-card"><div><span>Meses de estoque da região</span><Building2 size={17} /></div><strong>{overview.monthsOfStockRegion !== null ? number.format(overview.monthsOfStockRegion) : "—"}</strong><small>Duração estimada do estoque ativo</small></article>
          <article className="metric-card"><div><span>Concorrentes elegíveis</span><Radar size={17} /></div><strong>{eligibleCompetitors.length}</strong><small>de {overview.competitors.length} identificados na área</small></article>
        </section>
        <div className={overview.confidence.level === "LOW" ? "model-note" : "model-note"}>
          <ShieldQuestion size={20} />
          <div>
            <strong>{marketArea.name}</strong>
            <p>Raio de {marketArea.radiusMeters ?? "—"} m em {marketArea.neighborhood ?? marketArea.city}, {marketArea.city}/{marketArea.state}. <ConfidenceBadge level={overview.confidence.level} /></p>
          </div>
        </div>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">DECOMPOSIÇÃO DO NÍVEL DE CONFIANÇA</span><h2>Fatores que sustentam (ou não) a amostra de mercado</h2></div></div>
          <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Fator</th><th>Peso</th><th>Aderência</th><th>Observação</th></tr></thead><tbody>
            {overview.confidence.factors.map((factor) => <tr key={factor.key}><td><strong>{factor.key}</strong></td><td>{pct.format(factor.weight)}</td><td>{pct.format(factor.score)}</td><td>{factor.note}</td></tr>)}
          </tbody></table></div>
        </article>
      </>}

      {area === "demografia" && <>
        {!overview.demographics && <div className="model-note"><Users size={20} /><div><strong>Sem observação demográfica</strong><p>Nenhum registro de demografia foi ingerido para esta área de mercado.</p></div></div>}
        {overview.demographics && <section className="metrics-grid">
          <article className="metric-card"><div><span>População total</span><Users size={17} /></div><strong>{number.format(overview.demographics.totalPopulation)}</strong><small>Ano-base {overview.demographics.referenceYear} · {overview.demographics.sourceProvider}</small></article>
          <article className="metric-card"><div><span>Domicílios</span></div><strong>{number.format(overview.demographics.totalHouseholds)}</strong><small>{number.format(overview.demographics.personsPerHousehold)} moradores/domicílio em média</small></article>
          <article className="metric-card"><div><span>Crescimento populacional</span></div><strong>{overview.demographics.annualGrowthRate !== null ? pct.format(overview.demographics.annualGrowthRate) : "—"}</strong><small>Taxa anual estimada</small></article>
          <article className="metric-card"><div><span>Taxa de urbanização</span></div><strong>{overview.demographics.urbanizationRate !== null ? pct.format(overview.demographics.urbanizationRate) : "—"}</strong><small>População em área urbana</small></article>
        </section>}
      </>}

      {area === "renda" && <>
        <section className="metrics-grid">
          <article className="metric-card"><div><span>Renda domiciliar mediana</span><Landmark size={17} /></div><strong>{overview.income ? brl.format(Number(overview.income.medianHouseholdIncome)) : "—"}</strong><small>{overview.income ? `Ano-base ${overview.income.referenceYear} · ${overview.income.sourceProvider}` : "Sem observação de renda"}</small></article>
          <article className="metric-card"><div><span>Prestação máxima suportável</span></div><strong>{brl.format(overview.affordability.maxInstallment)}</strong><small>Comprometimento máximo de renda parametrizado</small></article>
          <article className="metric-card"><div><span>Financiamento suportável</span></div><strong>{brl.format(overview.affordability.financeableAmount)}</strong><small>Projeção de capacidade de financiamento</small></article>
          <article className="metric-card"><div><span>Ticket suportável estimado</span></div><strong>{brl.format(overview.affordability.affordableTicket)}</strong><small>Fronteira de acessibilidade econômica local</small></article>
          <article className="metric-card"><div><span>Área máxima suportável</span></div><strong>{number.format(overview.affordability.affordableAreaM2)} m²</strong><small>Ao preço médio observado na região</small></article>
        </section>
        <div className="model-note"><ShieldQuestion size={20} /><div><strong>Capacidade de Pagamento e Compra — nunca uma oferta de crédito real</strong><p>O sistema projeta a fronteira de acessibilidade econômica da população local a partir de parâmetros versionados; nunca substitui a análise de crédito individual de um banco.</p></div></div>
      </>}

      {area === "concorrentes" && <>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">CONCORRENTES ELEGÍVEIS PARA COMPARATIVO DIRETO</span><h2>Oferta e Concorrentes</h2></div></div>
          <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Empreendimento</th><th>Padrão</th><th>Estágio</th><th>Distância</th><th>Similaridade</th><th>Preço médio/m²</th><th>Velocidade</th><th>Origem</th></tr></thead><tbody>
            {eligibleCompetitors.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{standardLabel[item.standard] ?? item.standard}</td><td>{stageLabel[item.stage] ?? item.stage}</td><td>{number.format(item.distanceMeters)} m</td><td>{pct.format(item.similarityScore)}</td><td>{item.averagePricePerSqm !== null ? `${brlPrecise.format(item.averagePricePerSqm)}/m²` : "—"}</td><td>{item.monthlyVelocityUnits !== null ? `${number.format(item.monthlyVelocityUnits)} un./mês` : "—"}</td><td>{item.isDemo ? <span className="status-pill">Demonstração</span> : "Cadastro manual"}</td></tr>)}
            {eligibleCompetitors.length === 0 && <tr><td colSpan={8}>Nenhum concorrente elegível identificado na área de influência.</td></tr>}
          </tbody></table></div>
        </article>
        {ineligibleCompetitors.length > 0 && <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">GATE DE CONCORRÊNCIA</span><h2>Identificados, mas fora do comparativo direto</h2></div></div>
          <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Empreendimento</th><th>Padrão</th><th>Motivo</th></tr></thead><tbody>
            {ineligibleCompetitors.map((item) => <tr key={item.id}><td>{item.name}</td><td>{standardLabel[item.standard] ?? item.standard}</td><td>{item.eligibilityReason}</td></tr>)}
          </tbody></table></div>
        </article>}
      </>}

      {area === "precos" && <>
        <section className="metrics-grid">
          <article className="metric-card"><div><span>Preço mediano</span></div><strong>{overview.priceStats.median > 0 ? `${brlPrecise.format(overview.priceStats.median)}/m²` : "—"}</strong><small>Amostra de {overview.priceStats.sampleSize} observação(ões)</small></article>
          <article className="metric-card"><div><span>Faixa P25 – P75</span></div><strong>{overview.priceStats.sampleSize > 0 ? `${brlPrecise.format(overview.priceStats.p25)} – ${brlPrecise.format(overview.priceStats.p75)}` : "—"}</strong><small>Intervalo interquartil por m²</small></article>
          <article className="metric-card"><div><span>Dispersão (CV)</span></div><strong>{pct.format(overview.priceStats.coefficientOfVariation)}</strong><small>{overview.priceStats.coefficientOfVariation > 0.35 ? "Acima do limite — confiança rebaixada" : "Dentro do limite de 35%"}</small></article>
          <article className="metric-card"><div><span>VSO agregado</span></div><strong>{pct.format(overview.aggregateVsoPercentage)}</strong><small>Vendas sobre oferta na área</small></article>
        </section>
        {overview.launches.length > 0 && <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">HISTÓRICO DE LANÇAMENTOS</span><h2>Curva de velocidade nos primeiros meses</h2></div></div>
          <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Data</th><th>VGV lançado</th><th>Unidades ofertadas</th><th>Preço/m² no lançamento</th></tr></thead><tbody>
            {overview.launches.map((item) => <tr key={item.id}><td>{new Date(item.launchDate).toLocaleDateString("pt-BR")}</td><td>{brl.format(Number(item.launchedVgv))}</td><td>{item.unitsOffered}</td><td>{brlPrecise.format(Number(item.averagePricePerSqmAtLaunch))}/m²</td></tr>)}
          </tbody></table></div>
        </article>}
      </>}

      {area === "fontes" && <>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">PROVENIÊNCIA</span><h2>Rastreabilidade das observações de mercado</h2></div></div>
          <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Empreendimento</th><th>Nível de Confiança da Fonte</th><th>Classificação da Origem</th></tr></thead><tbody>
            {overview.competitors.map((item) => <tr key={item.id}><td>{item.name}</td><td><ConfidenceBadge level={item.similarityScore >= 0.7 ? "HIGH" : item.similarityScore >= 0.4 ? "MEDIUM" : "LOW"} /></td><td>{item.isDemo ? "Dado sintético de demonstração — não é fonte externa real" : "Cadastro manual"}</td></tr>)}
          </tbody></table></div>
        </article>
        {overview.priceStats.coefficientOfVariation > 0.35 && <div className="model-note"><AlertTriangle size={20} /><div><strong>Alerta de qualidade — MQ-01</strong><p>Dispersão de preços acima de 35% na amostra elegível; revisão manual recomendada antes de decisões de produto.</p></div></div>}
      </>}
    </div>
  );
}
