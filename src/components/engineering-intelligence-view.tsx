"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BadgeCheck, Calculator, FileCheck2, GitCompareArrows, Ruler, WalletCards } from "lucide-react";
import styles from "./sales-operability-panel.module.css";
import type { EngineeringWorkspaceView } from "@/application/engineering/engineering-service";
import {
  appendSmartBudgetLineReviewAction,
  approveSmartBudgetProposalAction,
  createEngineeringOpinionAction,
  createEngineeringOpinionVersionAction,
  createSmartBudgetProposalAction,
  decideEngineeringOpinionAction,
  decideEngineeringOpinionItemAction,
  rejectSmartBudgetProposalAction,
  submitEngineeringOpinionAction,
  submitSmartBudgetProposalAction,
  updateEngineeringOpinionDraftAction,
} from "@/app/actions/engineering";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const labels: Record<string, string> = { DRAFT: "Rascunho", UNDER_REVIEW: "Em revisão", REVIEW: "Em revisão", VALIDATED: "Validado", APPROVED: "Aprovado", REJECTED: "Rejeitado", SUPERSEDED: "Substituído", PENDING: "Pendente", REVISION_REQUESTED: "Revisão solicitada", ACCEPTED: "Aceito", ADJUSTED: "Ajustado", INFO: "Informativa", LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta", CRITICAL: "Crítica", VALIDATED_PRICE: "Preço validado", COMPARABLE_HISTORICAL_PRICE: "Histórico comparável", ESTIMATED_PRICE: "Estimado", NO_EVIDENCE: "Sem evidência", MANUAL: "Levantamento manual", IFC_PROPERTY: "Propriedade IFC", GEOMETRY_DERIVED: "Geometria BIM", REVIEWED: "Revisado", ACTIVE: "Ativa", DEPRECATED: "Descontinuada", TOPOGRAPHY: "Topografia", SOIL_INVESTIGATION: "Investigação geotécnica", SOIL: "Solo", FOUNDATIONS: "Fundações", RETAINING_STRUCTURES: "Estruturas de contenção", DRAINAGE: "Drenagem", STRUCTURE: "Estrutura", WATERPROOFING: "Impermeabilização", INSTALLATIONS: "Instalações", CONSTRUCTION_LOGISTICS: "Logística de obra", ACCESS: "Acessos", NEIGHBORS: "Vizinhança", INTERFERENCES: "Interferências", SAFETY: "Segurança", CONSTRUCTION_METHOD: "Método construtivo", SCHEDULE_RISK: "Risco de prazo", COST_RISK: "Risco de custo", OTHER: "Outro" };
type Area = "visao" | "parecer" | "fontes" | "orcamento" | "ciclo" | "valor";
const areas: Array<{ key: Area; label: string }> = [{ key: "visao", label: "Visão geral" }, { key: "parecer", label: "Parecer Técnico" }, { key: "fontes", label: "BIM, quantitativos e composições" }, { key: "orcamento", label: "Orçamento Inteligente e revisões" }, { key: "ciclo", label: "Orçado x executado" }, { key: "valor", label: "Engenharia de Valor" }];

export function EngineeringIntelligenceView({ workspace }: { workspace: EngineeringWorkspaceView }) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [opinionOpen, setOpinionOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [editingOpinion, setEditingOpinion] = useState<{ id: string; title: string; summary: string } | null>(null);
  const [lineReview, setLineReview] = useState<{ lineId: string; mode: "ADJUSTED" | "REVISION_REQUESTED"; currentPrice: number } | null>(null);
  const [rejectProposalId, setRejectProposalId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const requested = search.get("e") as Area | null;
  const area = areas.some((item) => item.key === requested) ? requested! : "visao";
  const act = (operation: () => Promise<{ ok: boolean; error?: string }>, success = "Operação concluída.") => startTransition(async () => { setFeedback(null); const result = await operation(); if (!result.ok) setFeedback({ type: "error", text: result.error ?? "Não foi possível concluir." }); else { setFeedback({ type: "success", text: success }); router.refresh(); } });
  const setArea = (next: Area) => router.replace(`/engenharia-obra?f=engenharia&e=${next}`, { scroll: false });

  function createOpinion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const condition = String(data.get("condition") ?? "").trim();
    const risk = String(data.get("risk") ?? "").trim();
    const recommendation = String(data.get("recommendation") ?? "").trim();
    const topic = String(data.get("topic") ?? "OTHER") as "OTHER" | "FOUNDATIONS" | "STRUCTURE" | "DRAINAGE" | "INSTALLATIONS" | "CONSTRUCTION_METHOD" | "SCHEDULE_RISK" | "COST_RISK";
    const severity = String(data.get("severity") ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    if (!title || !condition || !risk) return setFeedback({ type: "error", text: "Preencha título, condição observada e risco." });
    act(() => createEngineeringOpinionAction({
      projectId: workspace.projectId,
      code: "PT-" + Date.now().toString().slice(-6),
      title,
      summary: String(data.get("summary") ?? "").trim() || null,
      items: [{
        topic, observedCondition: condition, risk, severity,
        impact: {
          cost: String(data.get("costImpact") ?? "").trim() || "A avaliar",
          schedule: String(data.get("scheduleImpact") ?? "").trim() || "A avaliar",
          method: String(data.get("methodImpact") ?? "").trim() || "A avaliar",
          risk, viability: String(data.get("viabilityImpact") ?? "").trim() || "A avaliar",
        },
        recommendation: recommendation || "Submeter à validação do responsável técnico.",
        sourceType: "USER_PROVIDED", confidence: "LOW", referenceDate: new Date(),
      }],
    }), "Parecer Técnico criado.");
    setOpinionOpen(false);
  }

  function createProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const approved = workspace.quantities.filter((item) => item.status === "APPROVED");
    if (!approved.length) return setFeedback({ type: "error", text: "Não há quantitativos aprovados para compor a proposta." });
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const rationale = String(data.get("rationale") ?? "").trim();
    if (!name) return setFeedback({ type: "error", text: "Informe o nome da proposta." });
    act(() => createSmartBudgetProposalAction({
      projectId: workspace.projectId, name,
      rationale: rationale || "Proposta determinística baseada nos quantitativos aprovados e evidências disponíveis.",
      sourceBudgetId: workspace.approvedBudget?.id ?? null,
      lines: approved.map((quantity) => ({
        economicItemId: quantity.economicItemId, bimQuantityMappingId: quantity.id,
        compositionId: workspace.compositions.find((item) => item.economicItemId === quantity.economicItemId && item.status === "ACTIVE")?.id ?? null,
        priceObservationId: workspace.prices.find((item) => item.mappedEconomicItemId === quantity.economicItemId)?.id ?? null, evidenceRequired: true,
      })),
    }), "Proposta de Orçamento Inteligente criada.");
    setProposalOpen(false);
  }

  function updateOpinion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingOpinion) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const summary = String(data.get("summary") ?? "").trim();
    if (!title) return setFeedback({ type: "error", text: "Informe o título do parecer." });
    act(() => updateEngineeringOpinionDraftAction(editingOpinion.id, { title, summary: summary || null }), "Parecer Técnico atualizado.");
    setEditingOpinion(null);
  }

  function submitLineReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lineReview) return;
    const data = new FormData(event.currentTarget);
    const justification = String(data.get("justification") ?? "").trim();
    if (!justification) return setFeedback({ type: "error", text: "Informe a justificativa." });
    if (lineReview.mode === "ADJUSTED") {
      const revisedUnitCost = Number(String(data.get("revisedUnitCost") ?? "").replace(",", "."));
      if (!Number.isFinite(revisedUnitCost) || revisedUnitCost < 0) return setFeedback({ type: "error", text: "Informe um preço unitário válido." });
      act(() => appendSmartBudgetLineReviewAction({ lineId: lineReview.lineId, decision: "ADJUSTED", revisedUnitCost, justification }), "Linha ajustada pelo revisor.");
    } else {
      act(() => appendSmartBudgetLineReviewAction({ lineId: lineReview.lineId, decision: "REVISION_REQUESTED", justification }), "Revisão solicitada para a linha.");
    }
    setLineReview(null);
  }

  function rejectProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectProposalId) return;
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    if (!reason) return setFeedback({ type: "error", text: "Informe o motivo da rejeição." });
    act(() => rejectSmartBudgetProposalAction(rejectProposalId, reason), "Proposta rejeitada.");
    setRejectProposalId(null);
  }

  return <div className="view-stack">
    {feedback && <div className={feedback.type === "error" ? styles.error : styles.success}>{feedback.text}</div>}

    {editingOpinion && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setEditingOpinion(null); }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Editar Parecer Técnico">
        <div className={styles.modalHeader}><div><h3>Editar Parecer Técnico</h3><p>Somente título e resumo do rascunho podem ser alterados nesta etapa.</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setEditingOpinion(null)}>×</button></div>
        <form className={styles.form} onSubmit={updateOpinion}><div className={styles.formGrid}>
          <div className={`${styles.field} ${styles.fieldFull}`}><label>Título</label><input name="title" defaultValue={editingOpinion.title} required autoFocus /></div>
          <div className={`${styles.field} ${styles.fieldFull}`}><label>Resumo</label><textarea name="summary" rows={4} defaultValue={editingOpinion.summary} /></div>
        </div><div className={styles.modalActions}><button type="button" className="button button-secondary" onClick={() => setEditingOpinion(null)} disabled={pending}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>Salvar alterações</button></div></form>
      </div>
    </div>}

    {lineReview && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setLineReview(null); }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Revisar linha do orçamento">
        <div className={styles.modalHeader}><div><h3>{lineReview.mode === "ADJUSTED" ? "Ajustar preço unitário" : "Solicitar revisão da linha"}</h3><p>A decisão e a justificativa ficam registradas na trilha de revisão.</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setLineReview(null)}>×</button></div>
        <form className={styles.form} onSubmit={submitLineReview}><div className={styles.formGrid}>
          {lineReview.mode === "ADJUSTED" && <div className={styles.field}><label>Novo preço unitário</label><input name="revisedUnitCost" type="number" min="0" step="0.01" defaultValue={lineReview.currentPrice} required autoFocus /></div>}
          <div className={`${styles.field} ${styles.fieldFull}`}><label>Justificativa</label><textarea name="justification" rows={4} required autoFocus={lineReview.mode !== "ADJUSTED"} /></div>
        </div><div className={styles.modalActions}><button type="button" className="button button-secondary" onClick={() => setLineReview(null)} disabled={pending}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>Registrar revisão</button></div></form>
      </div>
    </div>}

    {rejectProposalId && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setRejectProposalId(null); }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Rejeitar proposta de orçamento">
        <div className={styles.modalHeader}><div><h3>Rejeitar proposta</h3><p>Registre o motivo para manter a decisão rastreável.</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setRejectProposalId(null)}>×</button></div>
        <form className={styles.form} onSubmit={rejectProposal}><div className={styles.formGrid}><div className={`${styles.field} ${styles.fieldFull}`}><label>Motivo</label><textarea name="reason" rows={4} required autoFocus /></div></div><div className={styles.modalActions}><button type="button" className="button button-secondary" onClick={() => setRejectProposalId(null)} disabled={pending}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>Rejeitar proposta</button></div></form>
      </div>
    </div>}

    {opinionOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setOpinionOpen(false); }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Novo Parecer Técnico">
        <div className={styles.modalHeader}><div><h3>Novo Parecer Técnico</h3><p>Registre a condição observada, o risco, os impactos e a recomendação para revisão técnica.</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setOpinionOpen(false)} aria-label="Fechar">×</button></div>
        <form className={styles.form} onSubmit={createOpinion}>
          <div className={styles.formGrid}>
            <div className={styles.field}><label>Título</label><input name="title" required autoFocus placeholder="Ex.: Parecer de fundações — Bloco A" /></div>
            <div className={styles.field}><label>Tema</label><select name="topic" defaultValue="OTHER"><option value="FOUNDATIONS">Fundações</option><option value="STRUCTURE">Estrutura</option><option value="DRAINAGE">Drenagem</option><option value="INSTALLATIONS">Instalações</option><option value="CONSTRUCTION_METHOD">Método construtivo</option><option value="SCHEDULE_RISK">Risco de prazo</option><option value="COST_RISK">Risco de custo</option><option value="OTHER">Outro</option></select></div>
            <div className={styles.field}><label>Severidade</label><select name="severity" defaultValue="MEDIUM"><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></div>
            <div className={`${styles.field} ${styles.fieldFull}`}><label>Resumo</label><textarea name="summary" rows={2} placeholder="Síntese executiva do parecer" /></div>
            <div className={`${styles.field} ${styles.fieldFull}`}><label>Condição técnica observada</label><textarea name="condition" rows={3} required /></div>
            <div className={`${styles.field} ${styles.fieldFull}`}><label>Risco identificado</label><textarea name="risk" rows={3} required /></div>
            <div className={styles.field}><label>Impacto de custo</label><input name="costImpact" placeholder="Ex.: + R$ 180 mil" /></div>
            <div className={styles.field}><label>Impacto de prazo</label><input name="scheduleImpact" placeholder="Ex.: + 15 dias" /></div>
            <div className={styles.field}><label>Impacto no método</label><input name="methodImpact" placeholder="Ex.: revisar contenção" /></div>
            <div className={styles.field}><label>Impacto na viabilidade</label><input name="viabilityImpact" placeholder="Ex.: sem impacto relevante" /></div>
            <div className={`${styles.field} ${styles.fieldFull}`}><label>Recomendação</label><textarea name="recommendation" rows={3} placeholder="Ação técnica recomendada" /></div>
          </div>
          <div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setOpinionOpen(false)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? "Salvando..." : "Criar parecer"}</button></div>
        </form>
      </div>
    </div>}

    {proposalOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setProposalOpen(false); }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Nova proposta de Orçamento Inteligente">
        <div className={styles.modalHeader}><div><h3>Gerar proposta de Orçamento Inteligente</h3><p>Serão usados os quantitativos aprovados e as evidências disponíveis de composição e preço.</p></div><button className={styles.closeButton} type="button" disabled={pending} onClick={() => setProposalOpen(false)} aria-label="Fechar">×</button></div>
        <form className={styles.form} onSubmit={createProposal}>
          <div className={styles.formGrid}>
            <div className={styles.field}><label>Nome</label><input name="name" defaultValue="Orçamento Inteligente" required autoFocus /></div>
            <div className={styles.field}><label>Quantitativos aprovados</label><input value={workspace.quantities.filter((item) => item.status === "APPROVED").length} readOnly /></div>
            <div className={`${styles.field} ${styles.fieldFull}`}><label>Justificativa</label><textarea name="rationale" rows={4} defaultValue="Proposta determinística baseada nos quantitativos aprovados e evidências disponíveis." /></div>
          </div>
          <div className={styles.modalActions}><button type="button" className="button button-secondary" disabled={pending} onClick={() => setProposalOpen(false)}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending || workspace.quantities.every((item) => item.status !== "APPROVED")}>{pending ? "Gerando..." : "Gerar proposta"}</button></div>
        </form>
      </div>
    </div>}

    <div className="scenario-switch" aria-label="Funções de Engenharia e Orçamento">{areas.map((item) => <button type="button" key={item.key} className={area === item.key ? "is-active" : ""} onClick={() => setArea(item.key)}>{item.label}</button>)}</div>
    {area === "visao" && <>
      <section className="metrics-grid">
        <article className="metric-card"><div><span>Orçamento aprovado</span><WalletCards size={17} /></div><strong>{brl.format(workspace.summary.budgeted)}</strong><small>Versão 9A vigente</small></article>
        <article className="metric-card"><div><span>Contratado</span><FileCheck2 size={17} /></div><strong>{brl.format(workspace.summary.contracted)}</strong><small>Compromissos ativos e aprovados</small></article>
        <article className="metric-card"><div><span>Medido</span><Ruler size={17} /></div><strong>{brl.format(workspace.summary.measured)}</strong><small>Execução certificada</small></article>
        <article className="metric-card"><div><span>Realizado</span><BadgeCheck size={17} /></div><strong>{brl.format(workspace.summary.realized)}</strong><small>Pagamentos processados ou conciliados</small></article>
        <article className="metric-card"><div><span>Itens sem evidência</span><AlertTriangle size={17} /></div><strong>{workspace.summary.noEvidence}</strong><small>Bloqueiam aprovação quando obrigatórios</small></article>
        <article className="metric-card"><div><span>Revisões pendentes</span><Calculator size={17} /></div><strong>{workspace.summary.pendingReviews}</strong><small>Decisão humana obrigatória</small></article>
      </section>
      <div className="model-note"><BadgeCheck size={20} /><div><strong>Uma única cadeia econômica</strong><p>Parecer → quantitativo → composição → preço → proposta → revisão humana → nova versão do Orçamento 9A. A Base Operacional não é alterada.</p></div></div>
    </>}
    {area === "parecer" && <div className="view-stack">
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">RESPONSABILIDADE TÉCNICA E RASTREABILIDADE</span><h2>Pareceres Técnicos</h2></div>{workspace.capabilities.editOpinion && <button className="button button-primary" type="button" disabled={pending} onClick={() => setOpinionOpen(true)}>Novo parecer</button>}</div>
        {workspace.opinions.length === 0 ? <div className="empty-state">Nenhum Parecer Técnico registrado.</div> : workspace.opinions.map((opinion) => <div className="model-note" key={opinion.id}><FileCheck2 size={20} /><div style={{ width: "100%" }}><strong>{opinion.code} · {opinion.title} · v{opinion.version}</strong><p>{opinion.summary ?? "Sem resumo."} · <span className="status-pill">{labels[opinion.status] ?? opinion.status}</span></p><div className="scenario-table"><div className="table-row table-head"><span>Tema</span><span>Condição e risco</span><span>Impactos</span><span>Severidade</span><span>Validação</span></div>{opinion.items.map((item) => <div className="table-row" key={item.id}><strong>{labels[item.topic] ?? item.topic.replaceAll("_", " ")}</strong><span>{item.observedCondition}<small>{item.risk}</small></span><span>{Object.values(item.impact as Record<string, string>).filter(Boolean).join(" · ")}</span><span className={item.severity === "CRITICAL" ? "negative-value" : ""}>{labels[item.severity] ?? item.severity}</span><span>{labels[item.validationStatus] ?? item.validationStatus}{workspace.capabilities.validateOpinion && opinion.status === "UNDER_REVIEW" && item.validationStatus === "PENDING" && <><button className="button button-secondary" disabled={pending} onClick={() => act(() => decideEngineeringOpinionItemAction(item.id, "VALIDATED"))}>Validar</button><button className="button button-secondary" disabled={pending} onClick={() => act(() => decideEngineeringOpinionItemAction(item.id, "REVISION_REQUESTED"))}>Solicitar revisão</button></>}</span></div>)}</div><div className="panel-actions">{workspace.capabilities.editOpinion && opinion.status === "DRAFT" && <><button className="button button-secondary" disabled={pending} onClick={() => setEditingOpinion({ id: opinion.id, title: opinion.title, summary: opinion.summary ?? "" })}>Editar rascunho</button><button className="button button-primary" disabled={pending} onClick={() => act(() => submitEngineeringOpinionAction(opinion.id))}>Enviar para revisão</button></>}{workspace.capabilities.validateOpinion && opinion.status === "UNDER_REVIEW" && <><button className="button button-primary" disabled={pending} onClick={() => act(() => decideEngineeringOpinionAction(opinion.id, "VALIDATED"))}>Validar parecer</button><button className="button button-secondary" disabled={pending} onClick={() => act(() => decideEngineeringOpinionAction(opinion.id, "REJECTED"))}>Rejeitar</button></>}{workspace.capabilities.editOpinion && ["VALIDATED", "REJECTED"].includes(opinion.status) && <button className="button button-secondary" disabled={pending} onClick={() => act(() => createEngineeringOpinionVersionAction(opinion.id))}>Criar nova versão</button>}</div></div></div>)}</article>
      <div className="model-note"><AlertTriangle size={20} /><div><strong>Validação profissional, não emissão automática</strong><p>O sistema registra o parecer e suas evidências; não gera ART/CREA nem substitui responsabilidade técnica legal.</p></div></div>
    </div>}
    {area === "fontes" && <div className="view-stack">
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">FASE 8 + REDE DATA</span><h2>Quantitativos BIM e levantamentos</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Elemento</th><th>Item EAP</th><th>Quantidade</th><th>Origem</th><th>Revisão BIM</th><th>Confiança</th><th>Situação</th></tr></thead><tbody>{workspace.quantities.map((item) => <tr key={item.id}><td><strong>{item.bimElement.name ?? item.ifcClassification}</strong><small>{item.bimElement.storey ?? "Sem pavimento"}</small></td><td>{item.economicItem.code} · {item.economicItem.description}</td><td>{number.format(Number(item.quantity))} {item.unit}</td><td>{labels[item.extractionMethod] ?? item.extractionMethod}</td><td>{item.bimElement.model.revisionId}</td><td>{labels[item.confidenceLevel] ?? item.confidenceLevel}</td><td>{labels[item.status] ?? item.status}</td></tr>)}</tbody></table></div></article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">RECEITA TÉCNICA VERSIONADA</span><h2>Composições</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Composição</th><th>Saída</th><th>Materiais / mão de obra / equipamentos</th><th>Fonte</th><th>Situação</th></tr></thead><tbody>{workspace.compositions.map((item) => <tr key={item.id}><td><strong>{item.key} · v{item.version}</strong><small>{item.name}</small></td><td>{item.outputDescription} / {item.outputUnit}</td><td>{item.items.map((part) => `${part.description}: ${number.format(Number(part.coefficient))} ${part.unit}${Number(part.wastageRate) ? ` (+${number.format(Number(part.wastageRate) * 100)}% perdas)` : ""}`).join(" · ") || "Sem itens"}</td><td>{item.source}</td><td>{labels[item.status] ?? item.status}</td></tr>)}</tbody></table></div></article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">PREÇO, REGIÃO, DATA E PROVENIÊNCIA</span><h2>Inteligência de Preços</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Item</th><th>Preço</th><th>Região</th><th>Data-base</th><th>Fornecedor</th><th>Fonte</th><th>Confiança</th></tr></thead><tbody>{workspace.prices.map((item) => <tr key={item.id}><td>{item.itemCode ?? "—"} · {item.itemDescription}</td><td>{brl.format(Number(item.price))}/{item.unit ?? "un."}</td><td>{item.region ?? "—"}</td><td>{new Date(item.observedAt).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td><td>{item.supplierName ?? "—"}</td><td>{item.sourceProvider}</td><td>{item.confidence == null ? "Não informada" : `${number.format(Number(item.confidence) * 100)}%`}</td></tr>)}</tbody></table></div></article>
    </div>}
    {area === "orcamento" && <div className="view-stack"><article className="panel"><div className="panel-heading"><div><span className="eyebrow">QUANTIDADE × PREÇO NORMALIZADO · COMPOSIÇÃO E SNAPSHOT</span><h2>Orçamento Inteligente</h2></div>{workspace.capabilities.buildBudget && <button className="button button-primary" disabled={pending} onClick={() => setProposalOpen(true)}>Gerar proposta</button>}</div>{workspace.proposals.length === 0 ? <div className="empty-state">Nenhuma proposta calculada.</div> : workspace.proposals.map((proposal) => <div key={proposal.id} className="model-note"><Calculator size={20} /><div style={{ width: "100%" }}><strong>{proposal.name} · v{proposal.version}</strong><p>{proposal.rationale} · <span className="status-pill">{labels[proposal.status] ?? proposal.status}</span></p><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Item</th><th>Quantidade</th><th>Composição</th><th>Preço unitário</th><th>Total</th><th>Evidência</th><th>Confiança</th><th>Última revisão</th><th>Ação</th></tr></thead><tbody>{proposal.lines.map((line) => { const review = line.reviews[0]; return <tr key={line.id}><td>{line.economicItem?.code ?? "—"} · {line.description}</td><td>{number.format(Number(line.quantity))} {line.unit}</td><td>{line.composition ? `${line.composition.key} v${line.composition.version}` : "Não informada"}</td><td>{brl.format(Number(line.suggestedUnitCost))}</td><td>{brl.format(Number(line.suggestedTotalCost))}</td><td className={line.evidenceStatus === "NO_EVIDENCE" ? "negative-value" : ""}>{labels[line.evidenceStatus]}</td><td>{labels[line.confidenceLevel]}</td><td>{review ? `${labels[review.decision]} · r${review.revisionNumber}` : "Pendente"}</td><td>{workspace.capabilities.reviewBudget && proposal.status === "REVIEW" && <><button className="button button-secondary" disabled={pending} onClick={() => act(() => appendSmartBudgetLineReviewAction({ lineId: line.id, decision: "ACCEPTED", justification: "Valores e evidências conferidos pelo revisor." }))}>Aceitar</button><button className="button button-secondary" disabled={pending} onClick={() => setLineReview({ lineId: line.id, mode: "ADJUSTED", currentPrice: Number(review?.revisedUnitCost ?? line.suggestedUnitCost) })}>Ajustar</button><button className="button button-secondary" disabled={pending} onClick={() => setLineReview({ lineId: line.id, mode: "REVISION_REQUESTED", currentPrice: Number(review?.revisedUnitCost ?? line.suggestedUnitCost) })}>Revisar</button></>}</td></tr>; })}</tbody></table></div><div className="panel-actions">{workspace.capabilities.buildBudget && proposal.status === "DRAFT" && <button className="button button-primary" disabled={pending} onClick={() => act(() => submitSmartBudgetProposalAction(proposal.id))}>Enviar para revisão</button>}{workspace.capabilities.approveBudget && proposal.status === "REVIEW" && <><button className="button button-primary" disabled={pending} onClick={() => act(() => approveSmartBudgetProposalAction(proposal.id))}>Aprovar e criar versão 9A</button><button className="button button-secondary" disabled={pending} onClick={() => setRejectProposalId(proposal.id)}>Rejeitar proposta</button></>}</div></div></div>)}</article></div>}
    {area === "ciclo" && <article className="panel"><div className="panel-heading"><div><span className="eyebrow">PERSPECTIVAS DO MESMO CICLO · SEM DUPLA CONTAGEM</span><h2>Previsto x contratado x medido x realizado</h2></div></div><div className="data-table-scroll"><table className="data-table"><thead><tr><th>Item EAP</th><th>Orçado</th><th>Contratado</th><th>Medido</th><th>Realizado</th><th>Δ O×C</th><th>Δ C×M</th><th>Δ M×R</th><th>Projeção final</th></tr></thead><tbody>{workspace.cycle.map((row) => <tr key={row.economicItemId}><td><strong>{row.code}</strong><small>{row.description}</small></td><td>{brl.format(row.budgeted)}</td><td>{brl.format(row.contracted)}</td><td>{brl.format(row.measured)}</td><td>{brl.format(row.realized)}</td><td>{brl.format(row.deltaBudgetContracted)}</td><td>{brl.format(row.deltaContractedMeasured)}</td><td>{brl.format(row.deltaMeasuredRealized)}</td><td>{row.finalProjected == null ? "Sem evidência" : brl.format(row.finalProjected)}</td></tr>)}</tbody></table></div></article>}
    {area === "valor" && <div className="view-stack">{workspace.valueEngineering.length === 0 ? <div className="empty-state">Nenhum cenário comparativo registrado.</div> : workspace.valueEngineering.map((group, index) => <article className="panel" key={index}><div className="panel-heading"><div><span className="eyebrow">HUMANO DECIDE · SEGURANÇA NÃO É AUTOMATIZADA</span><h2>Alternativas e oportunidades</h2></div></div>{group.opportunities.map((item) => <div className="model-note" key={item.id}><GitCompareArrows size={20} /><div><strong>{item.title}</strong><p>{item.currentCondition} → {item.proposedCondition} · custo {item.costImpact == null ? "não avaliado" : brl.format(Number(item.costImpact))} · prazo {item.scheduleImpactMonths ?? "—"} meses · risco {item.riskImpact}</p></div></div>)}<div className="scenario-table"><div className="table-row table-head"><span>Alternativa</span><span>Custo</span><span>Prazo</span><span>Risco</span><span>Impacto técnico</span></div>{group.alternatives.map((item) => <div className="table-row" key={item.id}><strong>{item.name}</strong><span>{item.cost == null ? "Não avaliado" : brl.format(item.cost)}</span><span>{item.scheduleMonths == null ? "Não avaliado" : `${item.scheduleMonths} meses`}</span><span>{item.risk}</span><span>{item.technicalImpact}</span></div>)}</div></article>)}</div>}
  </div>;
}
