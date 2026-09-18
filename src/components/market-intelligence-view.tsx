"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, Building2, Coins, Landmark, MapPinned, Radar, ShieldQuestion, TrendingUp, Users } from "lucide-react";
import type { MarketProductWorkspaceView } from "@/application/market-product";
import {
  registerMarketDevelopmentAction,
  registerMarketInventorySnapshotAction,
  registerMarketPriceObservationAction,
} from "@/app/actions/market-product";

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

export function MarketIntelligenceView({ workspace, canManage, onChange }: { workspace: MarketProductWorkspaceView; canManage: boolean; onChange: (workspace: MarketProductWorkspaceView) => void }) {
  const [area, setArea] = useState<Area>("visao");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showCompetitorForm, setShowCompetitorForm] = useState(false);
  const [showPriceForm, setShowPriceForm] = useState(false);
  const [showInventoryForm, setShowInventoryForm] = useState(false);
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


  const provenance = (sourceProvider: string, referenceDate: string) => ({
    sourceProvider,
    collectedAt: new Date().toISOString(),
    referenceDate,
    collectionMethod: "MANUAL_FIELD_SURVEY" as const,
    confidenceLevel: "MEDIUM" as const,
    dataLicense: "COMMERCIAL_INTERNAL_USE" as const,
    evidenceChecksum: "",
    isDemo: false,
  });

  async function run(action: () => Promise<{ ok: true; data: MarketProductWorkspaceView } | { ok: false; error: string }>, success: string) {
    setBusy(true);
    setFeedback(null);
    const response = await action();
    setBusy(false);
    if (!response.ok) return setFeedback(response.error);
    onChange(response.data);
    setFeedback(success);
  }

  function submitCompetitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!marketArea) return;
    const data = new FormData(event.currentTarget);
    const referenceDate = String(data.get("referenceDate") || new Date().toISOString().slice(0, 10));
    void run(() => registerMarketDevelopmentAction({
      marketAreaId: marketArea.id,
      name: String(data.get("name")),
      developerName: String(data.get("developerName") || "") || undefined,
      builderName: String(data.get("builderName") || "") || undefined,
      address: String(data.get("address")),
      neighborhood: String(data.get("neighborhood")),
      city: String(data.get("city")),
      state: String(data.get("state")).toUpperCase(),
      latitude: Number(data.get("latitude")),
      longitude: Number(data.get("longitude")),
      stage: String(data.get("stage")) as "BREVE_LANCAMENTO" | "LANCAMENTO" | "EM_OBRAS" | "PRONTO_NOVO" | "PRONTO_USADO",
      standard: String(data.get("standard")) as "ECONOMICO_MCMV" | "MEDIO_BAIXO" | "MEDIO" | "MEDIO_ALTO" | "ALTO" | "LUXO",
      totalTowers: Number(data.get("totalTowers") || 1),
      totalFloors: data.get("totalFloors") ? Number(data.get("totalFloors")) : undefined,
      totalUnits: Number(data.get("totalUnits")),
      provenance: provenance(String(data.get("sourceProvider")), referenceDate),
    }), "Concorrente cadastrado com proveniência.");
    setShowCompetitorForm(false);
  }

  function submitPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const observedAt = String(data.get("observedAt"));
    void run(() => registerMarketPriceObservationAction({
      developmentId: String(data.get("developmentId")),
      typologyDescription: String(data.get("typologyDescription")),
      bedrooms: Number(data.get("bedrooms")),
      suites: Number(data.get("suites") || 0),
      bathrooms: Number(data.get("bathrooms") || 1),
      parkingSpaces: Number(data.get("parkingSpaces") || 1),
      privateAreaM2: Number(data.get("privateAreaM2")),
      totalPrice: Number(data.get("totalPrice")),
      priceType: String(data.get("priceType")) as "LIST_PRICE" | "ADVERTISED" | "NEGOTIATED" | "TRANSACTED_REGISTRY" | "REDE_ACTUAL_SALE",
      observedAt,
      provenance: provenance(String(data.get("sourceProvider")), observedAt),
    }), "Preço observado registrado.");
    setShowPriceForm(false);
  }

  function submitInventory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const asOfDate = String(data.get("asOfDate"));
    void run(() => registerMarketInventorySnapshotAction({
      developmentId: String(data.get("developmentId")),
      asOfDate,
      totalUnits: Number(data.get("totalUnits")),
      availableUnits: Number(data.get("availableUnits")),
      soldUnits: Number(data.get("soldUnits")),
      reservedUnits: Number(data.get("reservedUnits") || 0),
      provenance: provenance(String(data.get("sourceProvider")), asOfDate),
    }), "Estoque observado registrado.");
    setShowInventoryForm(false);
  }

  return (
    <div className="view-stack">
      <div className="scenario-switch" aria-label="Áreas de Inteligência de Mercado">
        {areas.map((item) => <button key={item.key} className={area === item.key ? "is-active" : ""} onClick={() => setArea(item.key)}>{item.label}</button>)}
      </div>

      {overview.isDemoData && <DemoDataBanner />}
      {feedback && <div className="model-note"><AlertTriangle size={20} /><div><strong>Atualização de mercado</strong><p>{feedback}</p></div></div>}

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
          <div className="panel-heading"><div><span className="eyebrow">CONCORRENTES ELEGÍVEIS PARA COMPARATIVO DIRETO</span><h2>Oferta e Concorrentes</h2></div>{canManage && <button className="button button-primary" disabled={busy} onClick={() => setShowCompetitorForm((value) => !value)}>{showCompetitorForm ? "Fechar cadastro" : "Cadastrar concorrente"}</button>}</div>
          {showCompetitorForm && <form className="form-grid" onSubmit={submitCompetitor}>
            <label>Empreendimento<input name="name" required /></label>
            <label>Incorporadora<input name="developerName" /></label>
            <label>Construtora<input name="builderName" /></label>
            <label>Endereço<input name="address" required /></label>
            <label>Bairro<input name="neighborhood" defaultValue={marketArea.neighborhood ?? ""} required /></label>
            <label>Cidade<input name="city" defaultValue={marketArea.city} required /></label>
            <label>UF<input name="state" defaultValue={marketArea.state} maxLength={2} required /></label>
            <label>Latitude<input name="latitude" type="number" step="any" required /></label>
            <label>Longitude<input name="longitude" type="number" step="any" required /></label>
            <label>Estágio<select name="stage" defaultValue="LANCAMENTO"><option value="BREVE_LANCAMENTO">Breve lançamento</option><option value="LANCAMENTO">Lançamento</option><option value="EM_OBRAS">Em obras</option><option value="PRONTO_NOVO">Pronto novo</option><option value="PRONTO_USADO">Pronto usado</option></select></label>
            <label>Padrão<select name="standard" defaultValue="MEDIO"><option value="ECONOMICO_MCMV">Econômico (MCMV)</option><option value="MEDIO_BAIXO">Médio-baixo</option><option value="MEDIO">Médio</option><option value="MEDIO_ALTO">Médio-alto</option><option value="ALTO">Alto</option><option value="LUXO">Luxo</option></select></label>
            <label>Torres<input name="totalTowers" type="number" min="1" defaultValue="1" required /></label>
            <label>Pavimentos<input name="totalFloors" type="number" min="1" /></label>
            <label>Total de unidades<input name="totalUnits" type="number" min="1" required /></label>
            <label>Fonte<input name="sourceProvider" placeholder="Ex.: pesquisa de campo" required /></label>
            <label>Data de referência<input name="referenceDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
            <div className="form-actions"><button className="button button-primary" disabled={busy} type="submit">{busy ? "Salvando..." : "Salvar concorrente"}</button></div>
          </form>}
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
        {canManage && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">COLETA MANUAL RASTREÁVEL</span><h2>Preço e estoque observados</h2><p>Cadastros manuais preservam data, fonte e histórico; nunca sobrescrevem uma observação anterior.</p></div><div className="panel-actions"><button className="button button-secondary" disabled={busy} onClick={() => setShowPriceForm((value) => !value)}>{showPriceForm ? "Fechar preço" : "Registrar preço"}</button><button className="button button-secondary" disabled={busy} onClick={() => setShowInventoryForm((value) => !value)}>{showInventoryForm ? "Fechar estoque" : "Registrar estoque"}</button></div></div>
          {showPriceForm && <form className="form-grid" onSubmit={submitPrice}>
            <label>Concorrente<select name="developmentId" required>{overview.competitors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Tipologia<input name="typologyDescription" placeholder="Ex.: 2 dormitórios" required /></label>
            <label>Dormitórios<input name="bedrooms" type="number" min="0" defaultValue="2" required /></label>
            <label>Suítes<input name="suites" type="number" min="0" defaultValue="0" /></label>
            <label>Banheiros<input name="bathrooms" type="number" min="1" defaultValue="1" /></label>
            <label>Vagas<input name="parkingSpaces" type="number" min="0" defaultValue="1" /></label>
            <label>Área privativa (m²)<input name="privateAreaM2" type="number" min="10" step="0.01" required /></label>
            <label>Preço total<input name="totalPrice" type="number" min="1" step="0.01" required /></label>
            <label>Tipo de preço<select name="priceType" defaultValue="ADVERTISED"><option value="LIST_PRICE">Tabela</option><option value="ADVERTISED">Anunciado</option><option value="NEGOTIATED">Negociado</option><option value="TRANSACTED_REGISTRY">Transação registrada</option><option value="REDE_ACTUAL_SALE">Venda real REDE</option></select></label>
            <label>Data observada<input name="observedAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
            <label>Fonte<input name="sourceProvider" required /></label>
            <div className="form-actions"><button className="button button-primary" disabled={busy || overview.competitors.length === 0} type="submit">Registrar preço</button></div>
          </form>}
          {showInventoryForm && <form className="form-grid" onSubmit={submitInventory}>
            <label>Concorrente<select name="developmentId" required>{overview.competitors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Data-base<input name="asOfDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
            <label>Total de unidades<input name="totalUnits" type="number" min="0" required /></label>
            <label>Disponíveis<input name="availableUnits" type="number" min="0" required /></label>
            <label>Vendidas<input name="soldUnits" type="number" min="0" required /></label>
            <label>Reservadas<input name="reservedUnits" type="number" min="0" defaultValue="0" /></label>
            <label>Fonte<input name="sourceProvider" required /></label>
            <div className="form-actions"><button className="button button-primary" disabled={busy || overview.competitors.length === 0} type="submit">Registrar estoque</button></div>
          </form>}
        </article>}
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
