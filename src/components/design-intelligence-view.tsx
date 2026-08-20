"use client";
/* eslint-disable @next/next/no-img-element -- authenticated private design files bypass the public Next image optimizer */

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  FileBox,
  FileDown,
  FileSearch,
  Filter,
  Gauge,
  GitCompareArrows,
  Layers3,
  Maximize2,
  MessageSquarePlus,
  MousePointer2,
  PackagePlus,
  Pin,
  Plus,
  Ruler,
  ScanSearch,
  Sparkles,
  Target,
  Upload,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  calibrateDesignSheetAction,
  createDesignAlternativeAction,
  createManualDesignFindingAction,
  createDesignRevisionAction,
  generateDesignReviewReportAction,
  uploadDesignFileAction,
} from "@/app/actions/design";
import type { DesignEvidence, DesignWorkspaceView } from "@/domain/design";
import { BimViewer } from "./bim-viewer";

type DesignTab = "dashboard" | "viewer" | "findings" | "value" | "diff";
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const metricLabels: Record<string, string> = {
  TOTAL_BUILT_AREA_M2: "Área construída",
  PRIVATE_AREA_M2: "Área privativa",
  PRIVATE_TOTAL_RATE: "Eficiência privativa",
  CIRCULATION_TOTAL_RATE: "Circulação / total",
  CORE_TOTAL_RATE: "Core / total",
  UNIT_COUNT: "Unidades detectadas",
  PARKING_SPACES: "Vagas",
  FLOOR_AREA_RATIO: "Coeficiente de aproveitamento",
};

function formatMetric(value: number | null, unit: string) {
  if (value === null) return "—";
  if (unit === "ratio") return `${number.format(value * 100)}%`;
  if (unit === "m2") return `${number.format(value)} m²`;
  if (unit === "spaces") return `${number.format(value)} vagas`;
  if (unit === "units") return `${number.format(value)} un.`;
  return `${number.format(value)} ${unit}`;
}

function confidenceLabel(value: string) {
  return value === "NOT_VERIFIED" ? "NÃO VERIFICADO" : value;
}

function severityTone(value: string) {
  return value === "CRITICAL" || value === "HIGH" ? "critical" : value === "MEDIUM" ? "warning" : "neutral";
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "positive" | "warning" | "critical" | "neutral" }) {
  return <span className={`design-pill design-pill-${tone}`}>{children}</span>;
}

function DesignMetricCard({ label, value, meta, icon: Icon, tone = "neutral" }: { label: string; value: string; meta: string; icon: typeof Gauge; tone?: "positive" | "warning" | "critical" | "neutral" }) {
  return <article className={`design-metric design-metric-${tone}`}><div><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><small>{meta}</small></article>;
}

function EvidenceList({ evidence }: { evidence: DesignEvidence[] }) {
  return <div className="design-evidence-list">{evidence.map((item) => <div key={item.ref}><CheckCircle2 size={13} /><span><strong>{item.label}</strong><small>{item.ref} · {item.method} · {confidenceLabel(item.confidence)}</small></span></div>)}</div>;
}

export function DesignIntelligenceView({ initialWorkspace, onWorkspaceChange, onAskAI }: { initialWorkspace: DesignWorkspaceView; onWorkspaceChange: (workspace: DesignWorkspaceView) => void; onAskAI: (prompt: string) => void }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [tab, setTab] = useState<DesignTab>("dashboard");
  const [selectedFileId, setSelectedFileId] = useState(initialWorkspace?.files?.[0]?.id ?? "");
  const [selectedSheetId, setSelectedSheetId] = useState(initialWorkspace?.files?.[0]?.sheets?.[0]?.id ?? "");
  const [selectedFindingId, setSelectedFindingId] = useState(initialWorkspace?.findings?.[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [alternativeOpen, setAlternativeOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [draftRegion, setDraftRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedFile = workspace?.files?.find((file) => file.id === selectedFileId) ?? workspace?.files?.[0];
  const selectedSheet = selectedFile?.sheets?.find((sheet) => sheet.id === selectedSheetId) ?? selectedFile?.sheets?.[0];
  const selectedFinding = workspace?.findings?.find((finding) => finding.id === selectedFindingId) ?? workspace?.findings?.[0];
  const keyMetrics = useMemo(() => workspace.metrics.filter((metric) => Object.hasOwn(metricLabels, metric.name)), [workspace.metrics]);
  const privateEfficiency = workspace.metrics.find((metric) => metric.name === "PRIVATE_TOTAL_RATE");

  function replaceWorkspace(next: DesignWorkspaceView) {
    setWorkspace(next);
    onWorkspaceChange(next);
    if (!selectedFileId && next.files[0]) setSelectedFileId(next.files[0].id);
  }

  async function submitUpload(formData: FormData) {
    setBusy(true); setError("");
    formData.set("packageId", workspace.package.id);
    formData.set("revisionId", workspace.revision.id);
    const response = await uploadDesignFileAction(formData);
    setBusy(false);
    if (!response.ok) { setError(response.error); return; }
    replaceWorkspace(response.data); setUploadOpen(false); setTab("viewer");
    const uploaded = response.data.files[0];
    if (uploaded) { setSelectedFileId(uploaded.id); setSelectedSheetId(uploaded.sheets[0]?.id ?? ""); }
  }

  async function submitCalibration(formData: FormData) {
    if (!selectedSheet) return;
    setBusy(true); setError("");
    const response = await calibrateDesignSheetAction({ sheetId: selectedSheet.id, pixelDistance: Number(formData.get("pixelDistance")), realDistance: Number(formData.get("realDistance")), unit: String(formData.get("unit")) as "mm" | "cm" | "m", pointA: { x: 0.2, y: 0.5 }, pointB: { x: 0.8, y: 0.5 } });
    setBusy(false);
    if (!response.ok) { setError(response.error); return; }
    replaceWorkspace(response.data); setCalibrateOpen(false);
  }

  async function submitFinding(formData: FormData) {
    if (!selectedFile || !selectedSheet || !draftRegion) return;
    setBusy(true); setError("");
    const response = await createManualDesignFindingAction({ packageId: workspace.package.id, revisionId: workspace.revision.id, fileId: selectedFile.id, sheetId: selectedSheet.id, discipline: selectedFile.discipline, category: "HUMAN_REVIEW", type: "OTHER", severity: String(formData.get("severity")), title: String(formData.get("title")), description: String(formData.get("description")), recommendation: String(formData.get("recommendation")), region: draftRegion });
    setBusy(false);
    if (!response.ok) { setError(response.error); return; }
    replaceWorkspace(response.data); setDraftRegion(null); setAnnotating(false); setTab("findings");
  }

  async function submitAlternative(formData: FormData) {
    setBusy(true); setError("");
    const numeric = (name: string) => { const value = String(formData.get(name) ?? "").trim(); return value ? Number(value) : undefined; };
    const response = await createDesignAlternativeAction({ packageId: workspace.package.id, revisionId: workspace.revision.id, name: String(formData.get("name")), description: String(formData.get("description")), changes: { builtAreaM2: numeric("builtAreaM2"), privateAreaM2: numeric("privateAreaM2"), units: numeric("units"), parkingSpaces: numeric("parkingSpaces"), constructionMonths: numeric("constructionMonths") } });
    setBusy(false);
    if (!response.ok) { setError(response.error); return; }
    replaceWorkspace(response.data); setAlternativeOpen(false); setTab("diff");
  }

  async function submitRevision(formData: FormData) {
    setBusy(true); setError("");
    const response = await createDesignRevisionAction({ packageId: workspace.package.id, label: String(formData.get("label")), description: String(formData.get("description") ?? "") });
    setBusy(false);
    if (!response.ok) { setError(response.error); return; }
    replaceWorkspace(response.data); setSelectedFileId(""); setSelectedSheetId(""); setRevisionOpen(false); setUploadOpen(true);
  }

  async function downloadReport() {
    setBusy(true); setError("");
    const response = await generateDesignReviewReportAction(workspace.package.id);
    setBusy(false);
    if (!response.ok) { setError(response.error); return; }
    const binary = atob(response.data.contentBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: response.data.mimeType }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = response.data.fileName; anchor.click(); URL.revokeObjectURL(url);
  }

  function captureRegion(event: React.MouseEvent<HTMLDivElement>) {
    if (!annotating) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(0.94, (event.clientX - box.left) / box.width - 0.03));
    const y = Math.max(0, Math.min(0.94, (event.clientY - box.top) / box.height - 0.03));
    setDraftRegion({ x, y, width: 0.06, height: 0.06 });
  }

  const tabs: Array<{ key: DesignTab; label: string; icon: typeof Gauge; count?: number }> = [
    { key: "dashboard", label: "Visão geral", icon: Gauge },
    { key: "viewer", label: "Pranchas e Modelo BIM", icon: Layers3, count: workspace.files.length },
    { key: "findings", label: "Apontamentos", icon: Pin, count: workspace.summary.openFindings },
    { key: "value", label: "Engenharia de Valor", icon: WandSparkles, count: workspace.opportunities.length },
    { key: "diff", label: "Alternativas e Comparação", icon: GitCompareArrows, count: workspace.alternatives.length },
  ];

  return <div className="design-module">
    <header className="design-hero">
      <div><span className="eyebrow">REDE DESIGN INTELLIGENCE · {workspace.package.template.replaceAll("_", " ")}</span><h2>{workspace.package.name}</h2><p>{workspace.revision.label} · revisão versionada · análise preliminar com proveniência</p></div>
      <div className="design-hero-actions"><button className="button button-secondary" onClick={() => setRevisionOpen(true)}><GitCompareArrows size={15} /> Nova revisão</button><button className="button button-secondary" disabled={busy} onClick={downloadReport}><FileDown size={15} /> Design Review Report</button><button className="button button-secondary" onClick={() => onAskAI("Analise este projeto e apresente os findings com evidências.")}><Sparkles size={15} /> Analisar com REDE AI</button><button className="button button-primary" onClick={() => setUploadOpen(true)}><Upload size={15} /> Enviar projetos</button></div>
    </header>

    <div className="design-status-strip">
      <span><i className={`design-status-dot ${workspace.package.status === "READY" ? "ready" : "partial"}`} />{workspace.package.status.replaceAll("_", " ")}</span>
      <span>REVISION <strong>{workspace.revision.versionNumber.toString().padStart(2, "0")}</strong></span>
      <span>PREFLIGHT <StatusPill tone={workspace.package.preflightStatus === "READY" ? "positive" : workspace.package.preflightStatus === "NOT_READY" ? "critical" : "warning"}>{workspace.package.preflightStatus.replaceAll("_", " ")}</StatusPill></span>
      <span>DATA QUALITY <strong>{workspace.files.some((file) => file.type === "IFC") ? "MEDIUM" : "LIMITED"}</strong></span>
    </div>

    <nav className="design-tabs">{tabs.map((item) => <button key={item.key} className={tab === item.key ? "is-active" : ""} onClick={() => setTab(item.key)}><item.icon size={15} />{item.label}{item.count !== undefined && <b>{item.count}</b>}</button>)}</nav>
    {error && <div className="design-error"><AlertTriangle size={16} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}

    {tab === "dashboard" && <div className="design-dashboard">
      <section className="design-metric-grid">
        <DesignMetricCard label="Design readiness" value={workspace.package.preflightStatus === "READY" ? "Pronto" : "Com limitações"} meta={`${workspace.package.limitations.length} ressalva(s) registrada(s)`} icon={Target} tone={workspace.package.preflightStatus === "READY" ? "positive" : "warning"} />
        <DesignMetricCard label="Eficiência" value={privateEfficiency ? formatMetric(privateEfficiency.value, privateEfficiency.unit) : "Não verificada"} meta={privateEfficiency ? `${privateEfficiency.origin} · ${confidenceLabel(privateEfficiency.confidence)}` : "Aguardando área total + privativa"} icon={Gauge} tone={privateEfficiency && privateEfficiency.value >= .75 ? "positive" : "warning"} />
        <DesignMetricCard label="Findings abertos" value={String(workspace.summary.openFindings)} meta={`${workspace.summary.criticalFindings} crítico(s)`} icon={AlertTriangle} tone={workspace.summary.criticalFindings ? "critical" : workspace.summary.openFindings ? "warning" : "positive"} />
        <DesignMetricCard label="Design drift" value={workspace.summary.designDriftRate === null ? "Não verificado" : `${number.format(Math.abs(workspace.summary.designDriftRate) * 100)}%`} meta="Baseline × current design" icon={GitCompareArrows} tone={workspace.summary.designDriftRate !== null && Math.abs(workspace.summary.designDriftRate) > .05 ? "critical" : "neutral"} />
        <DesignMetricCard label="VE quantificadas" value={String(workspace.summary.quantifiedOpportunities)} meta={`${workspace.opportunities.length} oportunidade(s) total`} icon={CircleDollarSign} tone={workspace.summary.quantifiedOpportunities ? "positive" : "neutral"} />
      </section>

      <section className="design-two-column">
        <article className="design-panel"><header><div><span className="eyebrow">DESIGN SCORECARD</span><h3>Diagnóstico por dimensão</h3></div><small>Não é o REDE Score</small></header><div className="design-scorecard">{workspace.scorecard.map((dimension) => <div key={dimension.key}><span className={`design-score-state ${dimension.status.toLowerCase()}`} /><div><strong>{dimension.label}</strong><small>{dimension.explanation}</small></div><b>{dimension.value === null ? "—" : dimension.key === "AREA_EFFICIENCY" ? `${number.format(dimension.value * 100)}%` : number.format(dimension.value)}</b></div>)}</div></article>
        <article className="design-panel"><header><div><span className="eyebrow">AREA RECONCILIATION</span><h3>Métricas e origem</h3></div><FileSearch size={19} /></header><div className="design-metric-table">{keyMetrics.slice(0, 7).map((metric) => <div key={metric.id}><span><strong>{metricLabels[metric.name] ?? metric.name}</strong><small>{metric.origin} · {confidenceLabel(metric.confidence)}</small></span><b>{formatMetric(metric.value, metric.unit)}</b></div>)}</div></article>
      </section>

      <section className="design-three-column">
        <article className="design-panel"><header><div><span className="eyebrow">PRINCIPAIS INSIGHTS</span><h3>Leitura executiva</h3></div></header><ol className="design-insights">{workspace.insights.map((insight, index) => <li key={insight}><b>{index + 1}</b><span>{insight}</span></li>)}</ol><button className="design-link" onClick={() => onAskAI("O que você mudaria neste projeto? Cite evidências e limitações.")}>O que você mudaria?<ArrowRight size={14} /></button></article>
        <article className="design-panel"><header><div><span className="eyebrow">TOP FINDINGS</span><h3>Prioridades da revisão</h3></div><button className="icon-button" onClick={() => setTab("findings")}><Filter size={15} /></button></header><div className="design-compact-list">{workspace.findings.slice(0, 5).map((finding) => <button key={finding.id} onClick={() => { setSelectedFindingId(finding.id); setTab("findings"); }}><span className={`design-severity ${severityTone(finding.severity)}`}>{finding.severity}</span><span><strong>{finding.title}</strong><small>{finding.discipline} · {confidenceLabel(finding.confidence)}</small></span><ChevronRight size={14} /></button>)}</div></article>
        <article className="design-panel"><header><div><span className="eyebrow">TOP OPORTUNIDADES</span><h3>Value × effort</h3></div></header><div className="design-opportunity-mini">{workspace.opportunities.slice(0, 5).map((opportunity) => <div key={opportunity.id}><span className={`effort-${opportunity.effort.toLowerCase()}`}>{opportunity.effort}</span><span><strong>{opportunity.title}</strong><small>{opportunity.costImpact === null ? "Impacto ainda não quantificado" : `Potencial: ${currency.format(opportunity.costImpact)}`}</small></span></div>)}</div><button className="design-link" onClick={() => setTab("value")}>Abrir matriz Value × Effort<ArrowRight size={14} /></button></article>
      </section>

      {workspace.package.limitations.length > 0 && <section className="design-limitations"><AlertTriangle size={18} /><div><strong>Limitações declaradas desta revisão</strong>{workspace.package.limitations.map((item) => <p key={item}>{item}</p>)}</div></section>}
    </div>}

    {tab === "viewer" && <div className="design-viewer-shell">
      <aside className="design-file-browser"><header><span>ARQUIVOS</span><button className="icon-button" onClick={() => setUploadOpen(true)}><Plus size={15} /></button></header>{workspace.files.length === 0 ? <div className="design-empty-small"><FileBox size={26} /><p>Envie PDF, imagem, IFC, DXF ou tabela para navegar.</p></div> : workspace.files.map((file) => <div className="design-file-group" key={file.id}><button className={selectedFile?.id === file.id ? "is-active" : ""} onClick={() => { setSelectedFileId(file.id); setSelectedSheetId(file.sheets[0]?.id ?? ""); }}><span className={`file-type file-${file.type.toLowerCase()}`}>{file.type}</span><span><strong>{file.name}</strong><small>{file.discipline} · {file.processingStatus}</small></span><ChevronRight size={13} /></button>{selectedFile?.id === file.id && file.sheets.map((sheet) => <button className={`design-sheet-link ${selectedSheet?.id === sheet.id ? "is-active" : ""}`} key={sheet.id} onClick={() => setSelectedSheetId(sheet.id)}><span>{sheet.pageNumber.toString().padStart(2, "0")}</span><small>{sheet.sheetNumber ?? sheet.title ?? `Prancha ${sheet.pageNumber}`}</small></button>)}</div>)}</aside>
      <section className="design-canvas-column"><header className="design-viewer-toolbar"><div><strong>{selectedFile?.name ?? "Nenhum arquivo selecionado"}</strong><small>{selectedSheet ? `Página ${selectedSheet.pageNumber} · escala ${selectedSheet.scaleConfidence}` : selectedFile?.type === "IFC" ? "Modelo BIM" : ""}</small></div><div><button onClick={() => setZoom(Math.max(.6, zoom - .1))}><ZoomOut size={15} /></button><span>{number.format(zoom * 100)}%</span><button onClick={() => setZoom(Math.min(2, zoom + .1))}><ZoomIn size={15} /></button><button onClick={() => setZoom(1)}><Maximize2 size={15} /></button><button className={annotating ? "is-active" : ""} onClick={() => { setAnnotating(!annotating); setDraftRegion(null); }}><MessageSquarePlus size={15} /> Finding</button><button onClick={() => setCalibrateOpen(true)} disabled={!selectedSheet}><Ruler size={15} /> Calibrar</button></div></header>
        <div className={`design-canvas ${annotating ? "is-annotating" : ""}`} onClick={captureRegion}>
          {!selectedFile && <div className="design-empty-view"><ScanSearch size={42} /><h3>Selecione ou envie um projeto</h3><p>O sistema nunca mede pranchas sem escala confiável.</p><button className="button button-primary" onClick={() => setUploadOpen(true)}><Upload size={15} /> Enviar arquivo</button></div>}
          {selectedFile?.type === "PDF" && <object key={`${selectedFile.id}-${selectedSheet?.pageNumber}`} data={`/api/design/files/${selectedFile.id}#page=${selectedSheet?.pageNumber ?? 1}&toolbar=0`} type="application/pdf" className="design-document" style={{ transform: `scale(${zoom})` }}><a href={`/api/design/files/${selectedFile.id}`} target="_blank">Abrir PDF</a></object>}
          {selectedFile && ["PNG", "JPG", "JPEG", "WEBP"].includes(selectedFile.type) && <img className="design-document design-image" src={`/api/design/files/${selectedFile.id}`} alt={selectedFile.name} style={{ transform: `scale(${zoom})` }} />}
          {selectedFile?.type === "IFC" && <BimViewer workspace={workspace.bim} />}
          {selectedFile && !["PDF", "PNG", "JPG", "JPEG", "WEBP", "IFC"].includes(selectedFile.type) && <div className="design-empty-view"><FileBox size={42} /><h3>{selectedFile.type} processado como dados</h3><p>Consulte metadados e limitações no painel lateral.</p></div>}
          <div className={`design-markup-layer ${annotating ? "capture" : ""}`}>{workspace.findings.filter((finding) => !selectedSheet || finding.sheetId === selectedSheet.id).map((finding) => { const region = finding.evidence.find((item) => item.region)?.region; return region ? <button key={finding.id} className={`design-pin pin-${severityTone(finding.severity)}`} style={{ left: `${(region.x + region.width / 2) * 100}%`, top: `${(region.y + region.height / 2) * 100}%` }} onClick={(event) => { event.stopPropagation(); setSelectedFindingId(finding.id); setTab("findings"); }} title={finding.title}><Pin size={13} /></button> : null; })}{draftRegion && <span className="design-draft-region" style={{ left: `${draftRegion.x * 100}%`, top: `${draftRegion.y * 100}%`, width: `${draftRegion.width * 100}%`, height: `${draftRegion.height * 100}%` }} />}</div>
        </div>
      </section>
      <aside className="design-context-panel"><header><span>CONTEXTO</span><StatusPill tone={selectedSheet?.scaleConfidence === "CONFIRMED" ? "positive" : "warning"}>{selectedSheet?.scaleConfidence ?? selectedFile?.status ?? "—"}</StatusPill></header>{draftRegion ? <form action={submitFinding} className="design-side-form"><span className="eyebrow">NOVO FINDING</span><label>Título<input name="title" required minLength={3} placeholder="Descreva o problema" /></label><label>Severidade<select name="severity" defaultValue="MEDIUM"><option>INFO</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label><label>Descrição<textarea name="description" required placeholder="O que foi observado?" /></label><label>Recomendação<textarea name="recommendation" required placeholder="Próxima ação sugerida" /></label><button className="button button-primary" disabled={busy}>{busy ? "Salvando…" : "Criar finding"}</button></form> : <><div className="design-context-block"><span>DISCIPLINA</span><strong>{selectedFile?.discipline ?? "—"}</strong></div><div className="design-context-block"><span>PROCESSAMENTO</span><strong>{selectedFile?.processingStatus ?? "—"}</strong><small>{String(selectedFile?.metadata?.adapter ?? "")}</small></div><div className="design-context-block"><span>LIMITAÇÕES</span>{Array.isArray(selectedFile?.metadata?.limitations) ? selectedFile.metadata.limitations.map((item) => <small key={String(item)}>{String(item)}</small>) : <small>Selecione um arquivo para consultar.</small>}</div><button className="button button-secondary design-context-ai" onClick={() => onAskAI(selectedSheet ? `Analise esta prancha: ${selectedFile?.name}, página ${selectedSheet.pageNumber}.` : `Analise este arquivo: ${selectedFile?.name}.`)}><Sparkles size={15} /> Analisar esta prancha</button></>}</aside>
    </div>}

    {tab === "findings" && <div className="design-findings-layout"><section className="design-finding-register"><header><div><span className="eyebrow">ISSUE REGISTER</span><h3>{workspace.findings.length} findings nesta revisão</h3></div><button className="button button-secondary" onClick={() => { setTab("viewer"); setAnnotating(true); }}><Pin size={14} /> Criar na prancha</button></header><div className="design-filter-row"><StatusPill>{workspace.summary.openFindings} OPEN</StatusPill><StatusPill tone="critical">{workspace.findings.filter((item) => ["CRITICAL", "HIGH"].includes(item.severity)).length} HIGH / CRITICAL</StatusPill><button><Filter size={13} /> Disciplina</button><button><Target size={13} /> Status</button></div><div className="design-finding-table">{workspace.findings.map((finding) => <button key={finding.id} className={selectedFinding?.id === finding.id ? "is-active" : ""} onClick={() => setSelectedFindingId(finding.id)}><span className={`design-severity ${severityTone(finding.severity)}`}>{finding.severity}</span><span><strong>{finding.title}</strong><small>{finding.type.replaceAll("_", " ")} · {finding.discipline} · {finding.status}</small></span><span>{confidenceLabel(finding.confidence)}</span><ChevronRight size={14} /></button>)}</div></section>{selectedFinding && <aside className="design-finding-detail"><header><div><StatusPill tone={severityTone(selectedFinding.severity) as "critical" | "warning" | "neutral"}>{selectedFinding.severity}</StatusPill><StatusPill>{selectedFinding.status}</StatusPill></div><button className="icon-button" onClick={() => setSelectedFindingId("")}><X size={15} /></button></header><span className="eyebrow">{selectedFinding.discipline} · {selectedFinding.type.replaceAll("_", " ")}</span><h3>{selectedFinding.title}</h3><section><h4>Condição observada</h4><p>{selectedFinding.description}</p></section><section><h4>Implicação</h4><p>{selectedFinding.implication}</p></section><section><h4>Recomendação</h4><p>{selectedFinding.recommendation}</p></section><section><h4>Evidências</h4><EvidenceList evidence={selectedFinding.evidence} /></section><div className="design-professional-note"><AlertTriangle size={15} /><span>Verificação preliminar. Requer validação técnica do responsável profissional.</span></div>{selectedFinding.sheetId && <button className="button button-secondary" onClick={() => { setSelectedFileId(selectedFinding.fileId ?? ""); setSelectedSheetId(selectedFinding.sheetId ?? ""); setTab("viewer"); }}><MousePointer2 size={14} /> Localizar na prancha</button>}</aside>}</div>}

    {tab === "value" && <div className="design-value-view"><header className="design-section-header"><div><span className="eyebrow">REDE VALUE ENGINEERING</span><h3>Valor, esforço e confiança</h3><p>Impacto econômico só aparece quando existe premissa de custo ou receita rastreável.</p></div><button className="button button-primary" onClick={() => setAlternativeOpen(true)}><Plus size={15} /> Criar alternativa</button></header><div className="design-value-matrix"><div className="matrix-label value">MAIOR VALOR</div><div className="matrix-label effort">MAIOR ESFORÇO →</div>{workspace.opportunities.map((opportunity, index) => <button key={opportunity.id} className={`matrix-card effort-${opportunity.effort.toLowerCase()}`} style={{ gridColumn: opportunity.effort === "LOW" ? 1 : opportunity.effort === "MEDIUM" ? 2 : 3, gridRow: Math.min(3, index + 1) }}><span>{opportunity.category.replaceAll("_", " ")}</span><strong>{opportunity.title}</strong><small>{opportunity.costImpact === null ? "Impacto ainda não quantificado" : `${currency.format(opportunity.costImpact)} potencial`}</small><div><StatusPill>{opportunity.confidence}</StatusPill><StatusPill>{opportunity.effort} EFFORT</StatusPill></div></button>)}</div><div className="design-opportunity-register">{workspace.opportunities.map((opportunity, index) => <article key={opportunity.id}><b>{String(index + 1).padStart(2, "0")}</b><div><span className="eyebrow">{opportunity.category.replaceAll("_", " ")}</span><h3>{opportunity.title}</h3><p>{opportunity.proposedCondition}</p><small>{opportunity.riskImpact}</small></div><div><strong>{opportunity.costImpact === null ? "—" : currency.format(opportunity.costImpact)}</strong><small>{opportunity.costImpact === null ? "não quantificado" : "potencial calculado"}</small><button className="button button-secondary" onClick={() => setAlternativeOpen(true)}>Simular <ArrowRight size={13} /></button></div></article>)}</div></div>}

    {tab === "diff" && <div className="design-alternatives"><header className="design-section-header"><div><span className="eyebrow">DESIGN DIFF · SANDBOX · ENGINE · SCORE</span><h3>Revisões e alternativas</h3><p>Histórico preservado; deltas financeiros são calculados pelo REDE Engine.</p></div><div className="design-hero-actions"><button className="button button-secondary" onClick={() => setRevisionOpen(true)}><GitCompareArrows size={15} /> Nova revisão</button><button className="button button-primary" onClick={() => setAlternativeOpen(true)}><PackagePlus size={15} /> Nova hipótese</button></div></header><section className="design-panel design-revision-history"><header><div><span className="eyebrow">REVISION HISTORY</span><h3>{workspace.revisions.length} revisão(ões) preservada(s)</h3></div></header><div className="design-revision-strip">{[...workspace.revisions].reverse().map((revision) => <div key={revision.id} className={revision.id === workspace.revision.id ? "is-current" : ""}><b>V{revision.versionNumber}</b><span><strong>{revision.label}</strong><small>{revision.status} · {new Date(revision.createdAt).toLocaleDateString("pt-BR")}</small></span></div>)}</div>{workspace.revisionDiff.length > 0 && <div className="design-diff-table"><div><strong>Métrica</strong><strong>Anterior</strong><strong>Atual</strong><strong>Delta</strong><strong>Status</strong></div>{workspace.revisionDiff.filter((item) => item.kind !== "UNCHANGED").map((item) => <div key={item.name}><span>{metricLabels[item.name] ?? item.name}</span><span>{item.from === null ? "—" : formatMetric(item.from, item.unit)}</span><span>{item.to === null ? "—" : formatMetric(item.to, item.unit)}</span><span>{item.delta === null ? "—" : `${item.delta > 0 ? "+" : ""}${formatMetric(item.delta, item.unit)}`}</span><StatusPill tone={item.kind === "REMOVED" ? "warning" : "neutral"}>{item.kind}</StatusPill></div>)}</div>}</section>{workspace.alternatives.length === 0 ? <div className="design-empty-card"><GitCompareArrows size={36} /><h3>Nenhuma alternativa calculada</h3><p>Crie uma hipótese de área, produto ou prazo para comparar pelo Engine e REDE Score.</p><button className="button button-primary" onClick={() => setAlternativeOpen(true)}>Criar Design Alternative</button></div> : <div className="design-alternative-grid"><article className="design-alternative-card original"><span className="eyebrow">ORIGINAL · {workspace.revision.label}</span><h3>Projeto corrente</h3><p>Baseline da revisão oficial. Nenhuma alteração aplicada.</p><StatusPill tone="positive">CURRENT DESIGN</StatusPill></article>{workspace.alternatives.map((alternative) => { const score = alternative.scoreImpact as { before?: number; after?: number; delta?: number } | null; return <article className="design-alternative-card" key={alternative.id}><span className="eyebrow">{alternative.status}</span><h3>{alternative.name}</h3><p>{alternative.description}</p><div className="alternative-changes">{Object.entries(alternative.changes).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => <span key={key}><small>{key}</small><strong>{String(value)}</strong></span>)}</div>{score && <div className="alternative-score"><span>REDE SCORE</span><strong>{score.before ?? "—"} <ArrowRight size={15} /> {score.after ?? "—"}</strong><small>{Number(score.delta ?? 0) >= 0 ? "+" : ""}{number.format(Number(score.delta ?? 0))} pts</small></div>}<StatusPill>{alternative.status}</StatusPill></article>; })}</div>}</div>}

    {uploadOpen && <div className="design-modal-backdrop"><form action={submitUpload} className="design-modal"><header><div><span className="eyebrow">PROJECT PACKAGE · {workspace.revision.label}</span><h3>Enviar arquivo de projeto</h3></div><button type="button" className="icon-button" onClick={() => setUploadOpen(false)}><X size={17} /></button></header><button type="button" className="design-dropzone" onClick={() => fileInput.current?.click()}><Upload size={30} /><strong>Selecionar PDF, imagem, IFC, DXF ou dados</strong><small>Validação de extensão, MIME, assinatura e limite de 250 MB</small><input ref={fileInput} type="file" name="file" required hidden onChange={(event) => event.currentTarget.files?.[0] && setError("")} /></button><label>Disciplina<select name="discipline" defaultValue="ARCHITECTURE"><option>ARCHITECTURE</option><option>URBANISM</option><option>STRUCTURAL</option><option>FOUNDATION</option><option>ELECTRICAL</option><option>PLUMBING</option><option>HVAC</option><option>FIRE</option><option>ACCESSIBILITY</option><option>PARKING</option><option>BIM</option><option>COST</option><option>OTHER</option></select></label><label>Revisão<input name="revision" defaultValue="04" required /></label><div className="design-format-grid">{workspace.supportedFormats.map((format) => <div key={format.extension}><strong>{format.extension}</strong><StatusPill tone={format.support === "SUPPORTED" ? "positive" : format.support === "CONVERSION_REQUIRED" ? "warning" : "neutral"}>{format.support}</StatusPill><small>{format.note}</small></div>)}</div><button className="button button-primary" disabled={busy}>{busy ? "Validando e processando…" : "Enviar e processar"}</button></form></div>}

    {calibrateOpen && <div className="design-modal-backdrop"><form action={submitCalibration} className="design-modal design-modal-small"><header><div><span className="eyebrow">MANUAL SCALE CALIBRATION</span><h3>Confirmar escala da prancha</h3></div><button type="button" className="icon-button" onClick={() => setCalibrateOpen(false)}><X size={17} /></button></header><div className="design-calibration-visual"><Ruler size={25} /><span><i /><i /></span><small>Dois pontos de referência</small></div><label>Distância medida na tela (px)<input name="pixelDistance" type="number" min="1" step="0.01" required defaultValue="600" /></label><div className="design-inline-fields"><label>Distância real<input name="realDistance" type="number" min="0.001" step="0.001" required defaultValue="10" /></label><label>Unidade<select name="unit" defaultValue="m"><option value="m">metros</option><option value="cm">centímetros</option><option value="mm">milímetros</option></select></label></div><div className="design-professional-note"><AlertTriangle size={15} /><span>A calibração será registrada como USER_PROVIDED e CONFIRMED, com autor e data.</span></div><button className="button button-primary" disabled={busy}>{busy ? "Calibrando…" : "Confirmar calibração"}</button></form></div>}

    {alternativeOpen && <div className="design-modal-backdrop"><form action={submitAlternative} className="design-modal"><header><div><span className="eyebrow">DESIGN SANDBOX</span><h3>Criar alternativa e enviar delta ao Engine</h3></div><button type="button" className="icon-button" onClick={() => setAlternativeOpen(false)}><X size={17} /></button></header><label>Nome da alternativa<input name="name" required minLength={3} placeholder="Alternativa A · circulação otimizada" /></label><label>Descrição<textarea name="description" required minLength={3} placeholder="Hipótese a ser testada; o projeto oficial não será alterado." /></label><div className="design-alternative-fields"><label>Área construída total (m²)<input name="builtAreaM2" type="number" step="0.01" placeholder="Ex.: 17690" /></label><label>Área privativa total (m²)<input name="privateAreaM2" type="number" step="0.01" placeholder="Ex.: 14150" /></label><label>Unidades<input name="units" type="number" step="1" placeholder="Ex.: 314" /></label><label>Vagas<input name="parkingSpaces" type="number" step="1" placeholder="Ex.: 210" /></label><label>Prazo de obra (meses)<input name="constructionMonths" type="number" step="1" placeholder="Ex.: 30" /></label></div><div className="design-flow"><span>DESIGN DELTA</span><ArrowRight size={14} /><span>REDE ENGINE</span><ArrowRight size={14} /><span>REDE SCORE</span></div><button className="button button-primary" disabled={busy}>{busy ? "Calculando Engine e Score…" : "Calcular alternativa"}</button></form></div>}
    {revisionOpen && <div className="design-modal-backdrop"><form action={submitRevision} className="design-modal design-modal-small"><header><div><span className="eyebrow">REVISION CONTROL</span><h3>Criar nova revisão</h3></div><button type="button" className="icon-button" onClick={() => setRevisionOpen(false)}><X size={17} /></button></header><div className="design-professional-note"><GitCompareArrows size={15} /><span>{workspace.revision.label} será preservada. A nova revisão começará vazia e só ficará pronta após processamento.</span></div><label>Identificação<input name="label" required minLength={3} defaultValue={`PROJECT V${workspace.revision.versionNumber + 1} · Rev ${String(workspace.revision.versionNumber + 4).padStart(2, "0")}`} /></label><label>Descrição<textarea name="description" placeholder="Motivo da emissão / escopo da revisão" /></label><button className="button button-primary" disabled={busy}>{busy ? "Criando…" : "Criar e enviar arquivos"}</button></form></div>}
  </div>;
}
