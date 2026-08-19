"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileText,
  FolderArchive,
  Gavel,
  LoaderCircle,
  Maximize2,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import {
  addInvestmentConditionAction,
  createDecisionSandboxAction,
  downloadArtifactAction,
  generateMasterReportAction,
  generateStudioArtifactAction,
  preflightMasterReportAction,
  promoteDecisionSandboxAction,
  recordCommitteeDecisionAction,
  registerProjectDocumentAction,
  submitReviewRoundAction,
  verifyInvestmentConditionAction,
} from "@/app/actions/investment";
import type {
  AudienceProfile,
  InvestmentCaseWorkspace,
  MasterReportConfig,
  MasterReportLevel,
  MasterReportPreflight,
  StudioArtifactType,
} from "@/domain/investment";

type SuiteView = "committee" | "studio" | "dataroom";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const percent = (value: string | null) => value === null ? "N/D" : `${(Number(value) * 100).toFixed(1)}%`;

export function InvestmentSuiteView({ mode, initialWorkspace, onWorkspaceChange }: { mode: SuiteView; initialWorkspace: InvestmentCaseWorkspace; onWorkspaceChange?: (workspace: InvestmentCaseWorkspace) => void }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [message, setMessage] = useState<string | null>(null);
  const update = (next: InvestmentCaseWorkspace) => { setWorkspace(next); onWorkspaceChange?.(next); };
  return (
    <div className="view-stack investment-suite">
      {message && <div className="suite-message"><CheckCircle2 size={16} /><span>{message}</span><button onClick={() => setMessage(null)}><X size={14} /></button></div>}
      {mode === "committee" && <CommitteeView workspace={workspace} update={update} setMessage={setMessage} />}
      {mode === "studio" && <StudioView workspace={workspace} update={update} setMessage={setMessage} />}
      {mode === "dataroom" && <DataRoomView workspace={workspace} update={update} setMessage={setMessage} />}
    </div>
  );
}

function CommitteeView({ workspace, update, setMessage }: { workspace: InvestmentCaseWorkspace; update: (value: InvestmentCaseWorkspace) => void; setMessage: (value: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [showDecision, setShowDecision] = useState(false);
  const [showCondition, setShowCondition] = useState(false);
  const result = workspace.bundle.engineResults.base;
  const score = workspace.bundle.scores.base;
  const latestDecision = workspace.decisions.at(-1);
  const redTeam = workspace.bundle.redTeam?.conclusion;
  const openBlockers = workspace.conditions.filter((item) => item.isBlocker && !["VERIFIED", "WAIVED", "CLOSED"].includes(item.status));
  const priorities = [...workspace.issues.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status)).slice(0, 4), ...openBlockers.slice(0, 2).map((item) => ({ id: item.id, title: item.title, status: "BLOCKED" as const, priority: item.priority, ownerName: item.ownerName, dueDate: item.dueDate, nextAction: item.evidenceRequired }))].slice(0, 5);

  function submitRound() {
    startTransition(async () => {
      const response = await submitReviewRoundAction(workspace.id);
      if (response.ok) { update(response.data); setMessage("Investment Case submetido ao comitê com snapshot preservado."); } else setMessage(response.error);
    });
  }

  return (
    <>
      <section className="command-hero">
        <div><span className="eyebrow">EXECUTIVE COMMAND CENTER</span><h2>{workspace.title}</h2><p>Governança, risco e decisão sobre o Snapshot v{workspace.bundle.studyVersionNumber}.</p></div>
        <div className="command-actions"><button className="button button-secondary" onClick={() => setShowCondition(true)}><Plus size={15} /> Condicionante</button><button className="button button-primary" onClick={() => setShowDecision(true)}><Gavel size={16} /> Registrar decisão</button></div>
      </section>

      <section className="position-grid">
        <PositionCard label="ENGINE" value={enginePosition(result.metrics.marginOnVgv, result.metrics.maximumCashExposure, workspace)} detail={`Margem ${percent(result.metrics.marginOnVgv)} · VPL ${money.format(Number(result.metrics.npv))}`} tone={Number(result.metrics.marginOnVgv) * 100 >= Number(workspace.bundle.assumptions.policy.minimumMarginRate) ? "positive" : "critical"} />
        <PositionCard label="REDE SCORE" value={`${score.totalScore.toFixed(1)} · ${score.classification}`} detail={`${score.gates.length} gates · ${score.penalties.length} penalidades`} tone={score.totalScore >= 75 ? "positive" : score.totalScore >= 55 ? "warning" : "critical"} />
        <PositionCard label="RED TEAM" value={redTeam?.decision ?? "NÃO EXECUTADO"} detail={redTeam?.dominantRisk ?? "Nenhuma conclusão vinculada"} tone={redTeam?.decision === "ADVANCE" ? "positive" : "warning"} />
        <PositionCard label="COMITÊ" value={latestDecision?.decision ?? "PENDENTE"} detail={latestDecision ? `Round ${latestDecision.roundNumber} · confiança ${latestDecision.confidence}` : `Round ${workspace.rounds.at(-1)?.roundNumber ?? 1} em ${workspace.rounds.at(-1)?.status ?? "DRAFT"}`} tone={latestDecision?.decision === "APPROVE" ? "positive" : latestDecision ? "warning" : "neutral"} />
      </section>

      <section className="case-health-grid">
        <article className="panel health-panel"><div className="panel-heading"><div><span className="eyebrow">INVESTMENT CASE HEALTH</span><h2>{workspace.readiness.score}% · {readinessLabel(workspace.readiness.label)}</h2></div><div className={`health-ring ${workspace.readiness.score >= 75 ? "good" : "attention"}`} style={{ "--health": workspace.readiness.score } as React.CSSProperties}><strong>{workspace.readiness.score}</strong></div></div><div className="readiness-bars">{workspace.readiness.dimensions.map((item) => <div key={item.key}><span>{item.key}</span><div><i style={{ width: `${item.score}%` }} /></div><b>{item.score}</b></div>)}</div></article>
        <article className="panel priority-panel"><div className="panel-heading"><div><span className="eyebrow">ACTION CENTER</span><h2>Prioridades executivas</h2></div><span className="count-chip">{priorities.length} abertas</span></div>{priorities.length ? <div className="priority-list">{priorities.map((item, index) => <div key={`${item.id}-${index}`}><span className={`priority-dot priority-${item.priority.toLowerCase()}`} /> <div><strong>{item.title}</strong><small>{item.nextAction}</small></div><ChevronRight size={15} /></div>)}</div> : <div className="empty-state"><Check size={18} /> Nenhuma prioridade aberta.</div>}</article>
      </section>

      <section className="panel approval-panel"><div className="panel-heading"><div><span className="eyebrow">WHAT CHANGES THE DECISION?</span><h2>Caminho objetivo para aprovação</h2></div><button className="button button-secondary" disabled={pending || workspace.rounds.at(-1)?.status !== "DRAFT"} onClick={submitRound}>{pending ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />} Submeter round</button></div><div className="approval-path">{workspace.approvalPath.slice(0, 10).map((item) => <div key={item.id} className={item.resolved ? "resolved" : item.blocker ? "blocker" : "pending"}><span>{item.resolved ? <Check size={14} /> : <AlertTriangle size={14} />}</span><div><strong>{item.title}</strong><small>{item.source} · meta {item.target}</small></div><b>{item.resolved ? "ATENDIDA" : item.blocker ? "BLOCKER" : "PENDENTE"}</b></div>)}</div></section>

      <DecisionSandboxPanel workspace={workspace} update={update} setMessage={setMessage} />

      <section className="two-column-suite">
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">REVIEW ROUNDS</span><h2>Histórico imutável</h2></div></div><div className="timeline-list">{workspace.rounds.map((round) => <div key={round.id}><span>{round.roundNumber}</span><div><strong>Round {round.roundNumber}</strong><small>Bundle {round.bundleId.slice(-8)} · {round.status}</small></div><b>{round.decidedAt ? new Date(round.decidedAt).toLocaleDateString("pt-BR") : "ABERTO"}</b></div>)}</div></article>
        <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CONDIÇÕES PRECEDENTES</span><h2>Condicionantes</h2></div><span className="count-chip">{openBlockers.length} blockers</span></div><div className="condition-list">{workspace.conditions.length ? workspace.conditions.map((item) => <div key={item.id}><span className={`priority-dot priority-${item.priority.toLowerCase()}`} /><div><strong>{item.title}</strong><small>{item.status} · {item.evidenceRequired}</small></div>{item.status !== "VERIFIED" && <button onClick={() => startTransition(async () => { const response = await verifyInvestmentConditionAction(workspace.id, item.id); if (response.ok) { update(response.data); setMessage("Condicionante verificada com trilha de auditoria."); } else setMessage(response.error); })}><ShieldCheck size={14} /> Verificar</button>}</div>) : <div className="empty-state">Nenhuma condicionante registrada.</div>}</div></article>
      </section>
      {showDecision && <DecisionDialog workspace={workspace} onClose={() => setShowDecision(false)} onSaved={(next) => { update(next); setShowDecision(false); setMessage("Decisão registrada sem sobrescrever o histórico anterior."); }} />}
      {showCondition && <ConditionDialog workspace={workspace} onClose={() => setShowCondition(false)} onSaved={(next) => { update(next); setShowCondition(false); setMessage("Condicionante vinculada ao Data Room."); }} />}
    </>
  );
}

function DecisionSandboxPanel({ workspace, update, setMessage }: { workspace: InvestmentCaseWorkspace; update: (value: InvestmentCaseWorkspace) => void; setMessage: (value: string) => void }) {
  const [pending, startTransition] = useTransition();
  const base = workspace.bundle.assumptions;
  return <section className="panel sandbox-panel"><div className="panel-heading"><div><span className="eyebrow">DECISION SANDBOX</span><h2>Simular sem alterar o caso oficial</h2></div><span className="count-chip">{workspace.sandboxes.length} simulações</span></div><form className="sandbox-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); startTransition(async () => { const response = await createDecisionSandboxAction(workspace.id, String(data.get("name")), { unitPrice: String(data.get("unitPrice")), constructionCostPerM2: String(data.get("constructionCostPerM2")), approvalMonths: Number(data.get("approvalMonths")) }); if (response.ok) { update(response.data); setMessage("Simulação calculada em sandbox. O caso oficial não foi alterado."); } else setMessage(response.error); }); }}><label>Nome<input name="name" defaultValue="Estrutura otimizada" required /></label><label>Preço por unidade<input name="unitPrice" type="number" step="1000" defaultValue={base.unitPrice} required /></label><label>Custo de obra / m²<input name="constructionCostPerM2" type="number" step="50" defaultValue={base.constructionCostPerM2} required /></label><label>Aprovação (meses)<input name="approvalMonths" type="number" min="0" defaultValue={base.approvalMonths} required /></label><button className="button button-secondary" disabled={pending}>{pending ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />} Simular</button></form>{workspace.sandboxes.length > 0 && <div className="sandbox-results">{workspace.sandboxes.slice(0, 4).map((item) => <div key={item.id}><div><strong>{item.name}</strong><small>{item.status} · {Object.keys(item.changes).join(", ")}</small></div><span>{item.output ? `VPL ${money.format(Number(item.output.metrics.npv))} · Margem ${percent(item.output.metrics.marginOnVgv)}` : "Não calculado"}</span>{item.status === "CALCULATED" && <button disabled={pending} onClick={() => startTransition(async () => { const response = await promoteDecisionSandboxAction(workspace.id, item.id); if (response.ok) { update(response.data); setMessage("Simulação promovida a uma nova StudyVersion e novo review round."); } else setMessage(response.error); })}><RefreshCw size={13} /> Promover</button>}</div>)}</div>}</section>;
}

function PositionCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "positive" | "warning" | "critical" | "neutral" }) {
  return <article className={`position-card position-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function DecisionDialog({ workspace, onClose, onSaved }: { workspace: InvestmentCaseWorkspace; onClose: () => void; onSaved: (workspace: InvestmentCaseWorkspace) => void }) {
  const [pending, startTransition] = useTransition();
  return <div className="suite-dialog-backdrop"><form className="suite-dialog" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); startTransition(async () => { const response = await recordCommitteeDecisionAction({ investmentCaseId: workspace.id, decision: data.get("decision") as "APPROVE", confidence: data.get("confidence") as "MEDIUM", rationale: String(data.get("rationale")), dominantRisk: String(data.get("dominantRisk")), recommendedAction: String(data.get("recommendedAction")) }); if (response.ok) onSaved(response.data); }); }}><header><div><span className="eyebrow">INVESTMENT COMMITTEE</span><h2>Registrar decisão</h2></div><button type="button" onClick={onClose}><X size={18} /></button></header><label>Decisão<select name="decision" defaultValue="APPROVE_WITH_CONDITIONS"><option value="APPROVE">Aprovar</option><option value="APPROVE_WITH_CONDITIONS">Aprovar com condições</option><option value="RESTRUCTURE">Reestruturar</option><option value="ON_HOLD">Colocar em espera</option><option value="REJECT">Rejeitar</option></select></label><label>Confiança<select name="confidence" defaultValue="MEDIUM"><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option></select></label><label>Racional<textarea name="rationale" required defaultValue="Decisão condicionada às evidências e ações registradas no caso." /></label><label>Risco dominante<input name="dominantRisk" required defaultValue={workspace.bundle.redTeam?.conclusion.dominantRisk ?? "Validação das premissas críticas"} /></label><label>Ação recomendada<input name="recommendedAction" required defaultValue="Executar as condicionantes e retornar em nova rodada." /></label><footer><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={pending}>{pending && <LoaderCircle className="spin" size={15} />} Confirmar decisão</button></footer></form></div>;
}

function ConditionDialog({ workspace, onClose, onSaved }: { workspace: InvestmentCaseWorkspace; onClose: () => void; onSaved: (workspace: InvestmentCaseWorkspace) => void }) {
  const [pending, startTransition] = useTransition();
  return <div className="suite-dialog-backdrop"><form className="suite-dialog" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); startTransition(async () => { const response = await addInvestmentConditionAction({ investmentCaseId: workspace.id, title: String(data.get("title")), description: String(data.get("description")), category: String(data.get("category")), priority: data.get("priority") as "HIGH", isBlocker: data.get("isBlocker") === "on", evidenceRequired: String(data.get("evidenceRequired")) }); if (response.ok) onSaved(response.data); }); }}><header><div><span className="eyebrow">GOVERNANÇA</span><h2>Nova condicionante</h2></div><button type="button" onClick={onClose}><X size={18} /></button></header><label>Título<input name="title" required placeholder="Ex.: Validar orçamento executivo" /></label><label>Descrição<textarea name="description" required placeholder="Resultado esperado e critério de aceite" /></label><div className="dialog-row"><label>Categoria<select name="category" defaultValue="FINANCIAL"><option>FINANCIAL</option><option>URBAN</option><option>LEGAL</option><option>ENGINEERING</option><option>COMMERCIAL</option><option>FUNDING</option><option>ENVIRONMENTAL</option></select></label><label>Prioridade<select name="priority" defaultValue="HIGH"><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label></div><label>Evidência exigida<input name="evidenceRequired" required placeholder="Documento ou validação necessária" /></label><label className="checkbox-label"><input type="checkbox" name="isBlocker" /> Bloqueia a decisão enquanto estiver aberta</label><footer><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={pending}>Criar condicionante</button></footer></form></div>;
}

function StudioView({ workspace, update, setMessage }: { workspace: InvestmentCaseWorkspace; update: (value: InvestmentCaseWorkspace) => void; setMessage: (value: string) => void }) {
  const [level, setLevel] = useState<MasterReportLevel>("COMPLETE");
  const [audience, setAudience] = useState<AudienceProfile>("INTERNAL");
  const [preflight, setPreflight] = useState<{ config: MasterReportConfig; preflight: MasterReportPreflight } | null>(null);
  const [pending, startTransition] = useTransition();
  const [presentationOpen, setPresentationOpen] = useState(false);
  const lastReport = workspace.artifacts.find((item) => item.type === "MASTER_REPORT");
  const artifactCards: { type: Exclude<StudioArtifactType, "MASTER_REPORT">; title: string; description: string; formats: ("PDF" | "PPTX")[] }[] = [
    { type: "INVESTMENT_BOOK", title: "Investment Book", description: "Documento institucional de 36 seções.", formats: ["PDF"] },
    { type: "INVESTMENT_MEMO", title: "Investment Memo", description: "Síntese executiva para decisão.", formats: ["PDF"] },
    { type: "INVESTOR_DECK", title: "Investor Deck", description: "Apresentação de investidores.", formats: ["PPTX", "PDF"] },
    { type: "URBAN_CASE", title: "Urban Transformation Case", description: "AS-IS, TO-BE, impactos e roadmap.", formats: ["PDF", "PPTX"] },
    { type: "ONE_PAGE", title: "One Page", description: "O caso em uma única página.", formats: ["PDF"] },
    { type: "FINANCIER_PACK", title: "Financier Pack", description: "Capital, exposição, stress e documentação.", formats: ["PDF"] },
  ];

  function runPreflight() {
    startTransition(async () => { const response = await preflightMasterReportAction(workspace.id, level, audience); if (response.ok) { setPreflight(response.data); setMessage(`Preflight concluído: ${response.data.preflight.status}.`); } else setMessage(response.error); });
  }

  function generateMaster(final: boolean) {
    if (!preflight) return runPreflight();
    startTransition(async () => { const response = await generateMasterReportAction(workspace.id, { ...preflight.config, watermark: final ? "FINAL" : "DRAFT" }, final); if (response.ok) { update(response.data.workspace); setMessage(`Dossiê ${final ? "FINAL" : "DRAFT"} concluído: ${response.data.pageCount} páginas · ${response.data.reportId}.`); } else setMessage(response.error); });
  }

  return <>
    <section className="studio-hero"><div><span className="eyebrow">REDE MASTER REPORT</span><h2>Dossiê Completo REDE</h2><p>Todo o empreendimento em um PDF institucional, auditável, versionado e vinculado ao snapshot.</p><div className="report-flow"><span>SNAPSHOT</span><ArrowRight size={14} /><span>REPORT MODEL</span><ArrowRight size={14} /><span>PDF</span><ArrowRight size={14} /><span>DATA ROOM</span></div></div><div className="studio-hero-actions"><button className="button button-primary master-button" disabled={pending} onClick={() => generateMaster(false)}>{pending ? <LoaderCircle className="spin" size={18} /> : <BookOpen size={18} />} GERAR DOSSIÊ COMPLETO</button>{lastReport && <small>Último: v{lastReport.version} · Snapshot v{workspace.bundle.studyVersionNumber} · {lastReport.pageCount ?? "—"} páginas</small>}</div></section>

    <section className="panel report-config"><div className="panel-heading"><div><span className="eyebrow">REPORT CONFIGURATION</span><h2>Configuração e preflight</h2></div><span className={`status-chip status-${preflight?.preflight.status.toLowerCase() ?? "pending"}`}>{preflight?.preflight.status ?? "NÃO VALIDADO"}</span></div><div className="config-grid"><label>Nível<select value={level} onChange={(event) => { setLevel(event.target.value as MasterReportLevel); setPreflight(null); }}><option value="EXECUTIVE">Executive · 20–40 páginas</option><option value="COMPLETE">Complete · 60–150 páginas</option><option value="FULL_DOSSIER">Full Dossier · sem limite artificial</option><option value="CUSTOM">Custom</option></select></label><label>Público<select value={audience} onChange={(event) => { setAudience(event.target.value as AudienceProfile); setPreflight(null); }}><option value="INTERNAL">Internal</option><option value="INVESTMENT_COMMITTEE">Investment Committee</option><option value="INVESTOR">Investor</option><option value="FINANCIER">Financier</option><option value="MUNICIPALITY">Municipality</option><option value="LANDOWNER">Landowner</option><option value="BOARD">Board</option></select></label><div className="config-summary"><span>Snapshot</span><strong>Study v{workspace.bundle.studyVersionNumber} · Land v{workspace.bundle.landVersionNumber ?? "—"}</strong></div><div className="config-summary"><span>Cenários</span><strong>Conservador · Base · Agressivo</strong></div></div><div className="preflight-actions"><button className="button button-secondary" disabled={pending} onClick={runPreflight}><ClipboardCheck size={15} /> Executar preflight</button><button className="button button-secondary" disabled={!preflight?.preflight.canGenerateDraft || pending} onClick={() => generateMaster(false)}>Gerar DRAFT</button><button className="button button-primary" disabled={!preflight?.preflight.canGenerateFinal || pending} onClick={() => generateMaster(true)}><ShieldCheck size={15} /> Gerar FINAL</button></div>{preflight && <div className="preflight-result"><div className="report-readiness"><span>REPORT READINESS</span><strong>{preflight.preflight.readiness.score}%</strong><div><i style={{ width: `${preflight.preflight.readiness.score}%` }} /></div></div><div className="preflight-issues">{preflight.preflight.issues.length ? preflight.preflight.issues.map((item) => <div key={item.code} className={item.severity.toLowerCase()}><AlertTriangle size={14} /><span><strong>{item.area}</strong> · {item.message}</span></div>) : <div className="ready"><Check size={14} /> Nenhum alerta de preflight.</div>}</div></div>}</section>

    <section><div className="suite-section-heading"><div><span className="eyebrow">TEMPLATE ENGINE</span><h2>Materiais do Studio</h2></div><button className="button button-secondary" onClick={() => setPresentationOpen(true)}><Maximize2 size={15} /> Presentation Mode</button></div><div className="artifact-template-grid">{artifactCards.map((item) => <article key={item.type}><div className="artifact-icon"><FileText size={21} /></div><h3>{item.title}</h3><p>{item.description}</p><footer>{item.formats.map((format) => <button key={format} disabled={pending} onClick={() => startTransition(async () => { const response = await generateStudioArtifactAction({ investmentCaseId: workspace.id, type: item.type, audience, format }); if (response.ok) { update(response.data.workspace); setMessage(`${item.title} gerado: ${response.data.pagesOrSlides} páginas/slides.`); } else setMessage(response.error); })}>{format}</button>)}</footer></article>)}</div></section>

    <section className="panel materials-panel"><div className="panel-heading"><div><span className="eyebrow">MATERIALS GENERATED</span><h2>Registro de artefatos</h2></div><Archive size={19} /></div>{workspace.artifacts.length ? <div className="materials-table"><div className="materials-row materials-head"><span>Material</span><span>Versão</span><span>Snapshot</span><span>Status</span><span>Páginas</span><span /></div>{workspace.artifacts.map((item) => <div className="materials-row" key={item.id}><strong>{artifactLabel(item.type)}</strong><span>v{item.version}</span><span>{item.sourceOutdated ? "DESATUALIZADO" : `v${workspace.bundle.studyVersionNumber}`}</span><span className={`artifact-status artifact-${item.status.toLowerCase()}`}>{item.status}</span><span>{item.pageCount ?? "—"}</span><button onClick={() => startTransition(async () => { const response = await downloadArtifactAction(item.id); if (response.ok) downloadBase64(response.data.fileName, response.data.mimeType, response.data.contentBase64); else setMessage(response.error); })}><Download size={15} /></button></div>)}</div> : <div className="empty-state"><FileText size={18} /> Nenhum material gerado.</div>}</section>
    {presentationOpen && <PresentationMode workspace={workspace} onClose={() => setPresentationOpen(false)} />}
  </>;
}

function DataRoomView({ workspace, update, setMessage }: { workspace: InvestmentCaseWorkspace; update: (value: InvestmentCaseWorkspace) => void; setMessage: (value: string) => void }) {
  const [pending, startTransition] = useTransition();
  const categories = workspace.dataRoomCompleteness.categories;
  return <>
    <section className="data-room-hero"><div><span className="eyebrow">DATA ROOM</span><h2>Documentos, evidências e versões</h2><p>Persistência institucional por categoria, status, confidencialidade e checksum.</p></div><div className="completeness-score"><strong>{workspace.dataRoomCompleteness.overall}%</strong><span>COMPLETUDE</span><div><i style={{ width: `${workspace.dataRoomCompleteness.overall}%` }} /></div></div></section>
    <div className="data-room-categories">{categories.map((item) => <article key={item.category}><FolderArchive size={18} /><div><span>{categoryLabel(item.category)}</span><strong>{item.score}%</strong><small>{item.received}/{item.total} disponíveis</small></div></article>)}</div>
    <section className="panel checklist-panel"><div className="panel-heading"><div><span className="eyebrow">DOCUMENT CHECKLIST</span><h2>Evidências necessárias</h2></div><span className="count-chip">{workspace.checklist.filter((item) => item.status === "REQUESTED").length} pendentes</span></div><div className="checklist-table"><div className="checklist-row checklist-head"><span>Status</span><span>Documento</span><span>Categoria</span><span>Origem</span><span /></div>{workspace.checklist.map((item) => <div className="checklist-row" key={item.id}><span><i className={`doc-status doc-${item.status.toLowerCase()}`} /> {item.status}</span><div><strong>{item.title}</strong>{item.critical && <small>CRÍTICO</small>}</div><span>{categoryLabel(item.category)}</span><span>{item.source}</span><label className="upload-button"><Upload size={14} /> Registrar<input type="file" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; startTransition(async () => { const base64 = await fileToBase64(file); const response = await registerProjectDocumentAction({ investmentCaseId: workspace.id, checklistItemId: item.id, category: item.category, title: item.title, fileName: file.name, mimeType: file.type || "application/octet-stream", contentBase64: base64, confidentiality: "CONFIDENTIAL", source: "USER_UPLOAD" }); if (response.ok) { update(response.data); setMessage(`Documento ${file.name} registrado com checksum e versão.`); } else setMessage(response.error); }); }} /></label></div>)}</div></section>
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">DOCUMENT INDEX</span><h2>Arquivos registrados</h2></div><FileCheck2 size={19} /></div>{workspace.documents.length ? <div className="materials-table"><div className="materials-row materials-head"><span>Documento</span><span>Versão</span><span>Categoria</span><span>Status</span><span>Tamanho</span><span /></div>{workspace.documents.map((item) => <div className="materials-row" key={item.id}><strong>{item.title}</strong><span>v{item.version}</span><span>{categoryLabel(item.category)}</span><span>{item.status}</span><span>{formatBytes(item.fileSize)}</span><span title={item.checksum}>{item.checksum.slice(0, 8)}</span></div>)}</div> : <div className="empty-state"><FolderArchive size={18} /> Nenhum documento recebido. Os itens permanecem pendentes, sem simulação de completude.</div>}</section>
    <div className="model-note"><ShieldCheck size={19} /><div><strong>Segurança e histórico</strong><p>Uploads são isolados por organização. Nova versão não apaga o arquivo anterior; relatórios FINAL entram em 14_RELATORIOS automaticamente.</p></div></div>
  </>;
}

function PresentationMode({ workspace, onClose }: { workspace: InvestmentCaseWorkspace; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const result = workspace.bundle.engineResults.base;
  const pages = useMemo(() => [
    { eyebrow: "INVESTMENT CASE", title: workspace.bundle.project.name, body: `${workspace.bundle.project.city}/${workspace.bundle.project.state} · Snapshot v${workspace.bundle.studyVersionNumber}` },
    { eyebrow: "DECISÃO", title: workspace.decisions.at(-1)?.decision ?? "DECISÃO PENDENTE", body: workspace.decisions.at(-1)?.rationale ?? "Caso ainda não deliberado pelo Comitê de Investimento." },
    { eyebrow: "ECONOMIA", title: money.format(Number(result.metrics.vgv)), body: `Margem ${percent(result.metrics.marginOnVgv)} · ROI ${percent(result.metrics.roi)} · VPL ${money.format(Number(result.metrics.npv))}` },
    { eyebrow: "RISCO", title: workspace.bundle.redTeam?.conclusion.dominantRisk ?? "Red Team não vinculado", body: `${workspace.readiness.blockers.length} blockers · readiness ${workspace.readiness.score}%` },
    { eyebrow: "PRÓXIMO GATE", title: workspace.approvalPath.find((item) => !item.resolved)?.title ?? "Caminho atendido", body: workspace.approvalPath.find((item) => !item.resolved)?.target ?? "Sem pendências registradas." },
  ], [workspace, result]);
  const current = pages[page];
  return <div className="presentation-overlay" tabIndex={0} onKeyDown={(event) => { if (event.key === "ArrowRight") setPage((value) => Math.min(pages.length - 1, value + 1)); if (event.key === "ArrowLeft") setPage((value) => Math.max(0, value - 1)); if (event.key === "Escape") onClose(); }} autoFocus><header><span>REDE INTELLIGENCE · PRESENTATION MODE</span><button onClick={onClose}><X size={21} /></button></header><main><span>{current.eyebrow}</span><h1>{current.title}</h1><p>{current.body}</p></main><footer><button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>{page + 1} / {pages.length}</span><button disabled={page === pages.length - 1} onClick={() => setPage((value) => value + 1)}>Próximo</button></footer></div>;
}

function enginePosition(margin: string, exposure: string, workspace: InvestmentCaseWorkspace) {
  const pass = Number(margin) * 100 >= Number(workspace.bundle.assumptions.policy.minimumMarginRate) && Number(exposure) <= Number(workspace.bundle.assumptions.policy.maximumExposure);
  return pass ? "ATENDE À POLÍTICA" : "FORA DA POLÍTICA";
}

function readinessLabel(label: string) { return label === "READY" ? "PRONTO" : label === "PARTIALLY_READY" ? "PARCIALMENTE PRONTO" : "NÃO PRONTO"; }
function categoryLabel(value: string) { return value.replace(/^\d+_/, "").replaceAll("_", " "); }
function artifactLabel(value: string) { return value.replaceAll("_", " "); }
function formatBytes(value: number) { return value > 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : `${Math.ceil(value / 1_000)} KB`; }

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function downloadBase64(fileName: string, mimeType: string, content: string) {
  const anchor = document.createElement("a");
  anchor.href = `data:${mimeType};base64,${content}`;
  anchor.download = fileName;
  anchor.click();
}
