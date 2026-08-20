"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Building2,
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

type DesignTab = "dashboard" | "viewer" | "findings" | "value" | "diff";
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const metricLabels = {
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

export function DesignIntelligenceView({ initialWorkspace, onWorkspaceChange, onAskAI }: { initialWorkspace: any; onWorkspaceChange: (workspace: any) => void; onAskAI: (prompt: string) => void }) {
  const [workspace, setWorkspace] = useState(initialWorkspace ?? {});
  const [tab, setTab] = useState<DesignTab>("dashboard");
  const [selectedFileId, setSelectedFileId] = useState((initialWorkspace?.files?.[0]?.id) ?? "");
  const [selectedSheetId, setSelectedSheetId] = useState((initialWorkspace?.files?.[0]?.sheets?.[0]?.id) ?? "");
  const [selectedFindingId, setSelectedFindingId] = useState((initialWorkspace?.findings?.[0]?.id) ?? "");
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

  const selectedFile = (workspace?.files ?? []).find((file: any) => file?.id === selectedFileId) ?? (workspace?.files?.[0] ?? null);
  const selectedSheet = (selectedFile?.sheets ?? []).find((sheet: any) => sheet?.id === selectedSheetId) ?? (selectedFile?.sheets?.[0] ?? null);
  const selectedFinding = (workspace?.findings ?? []).find((finding: any) => finding?.id === selectedFindingId) ?? (workspace?.findings?.[0] ?? null);
  const keyMetrics = useMemo(() => (workspace?.metrics ?? []).filter((metric: any) => Object.hasOwn(metricLabels, metric?.name)) ?? [], [workspace?.metrics]);
  const privateEfficiency = (workspace?.metrics ?? []).find((metric: any) => metric?.name === "PRIVATE_TOTAL_RATE");

  function replaceWorkspace(next: any) {
    setWorkspace(next);
    onWorkspaceChange(next);
    if (!selectedFileId && (next?.files?.[0])) setSelectedFileId(next.files[0].id);
  }

  const tabs = [
    { key: "dashboard" as const, label: "Overview", icon: Gauge, count: undefined },
    { key: "viewer" as const, label: "Pranchas & BIM", icon: Layers3, count: workspace?.files?.length ?? 0 },
    { key: "findings" as const, label: "Findings", icon: Pin, count: workspace?.summary?.openFindings ?? 0 },
    { key: "value" as const, label: "Value Engineering", icon: WandSparkles, count: workspace?.opportunities?.length ?? 0 },
    { key: "diff" as const, label: "Alternativas & Diff", icon: GitCompareArrows, count: (workspace?.alternatives ?? []).length },
  ];

  return (
    <div className="design-module">
      <header className="design-hero">
        <div>
          <span className="eyebrow">REDE DESIGN INTELLIGENCE · {(workspace?.package?.template ?? "—").replaceAll("_", " ")}</span>
          <h2>{workspace?.package?.name ?? "—"}</h2>
          <p>{workspace?.revision?.label ?? "—"} · revisão versionada · análise preliminar com proveniência</p>
        </div>
        <div className="design-hero-actions">
          <button className="button button-secondary" onClick={() => setRevisionOpen(true)}><GitCompareArrows size={15} /> Nova revisão</button>
          <button className="button button-secondary" disabled={busy}><FileDown size={15} /> Design Review Report</button>
          <button className="button button-secondary" onClick={() => onAskAI("Analise este projeto e apresente os findings com evidências.")}><Sparkles size={15} /> Analisar com REDE AI</button>
          <button className="button button-primary" onClick={() => setUploadOpen(true)}><Upload size={15} /> Enviar projetos</button>
        </div>
      </header>

      <div className="design-status-strip">
        <span><i className={`design-status-dot ${(workspace?.package?.status ?? "") === "READY" ? "ready" : "partial"}`} />{(workspace?.package?.status ?? "—").replaceAll("_", " ")}</span>
        <span>REVISION <strong>{((workspace?.revision?.versionNumber ?? 0).toString()).padStart(2, "0")}</strong></span>
        <span>PREFLIGHT <StatusPill tone={(workspace?.package?.preflightStatus ?? "") === "READY" ? "positive" : (workspace?.package?.preflightStatus ?? "") === "NOT_READY" ? "critical" : "warning"}>{(workspace?.package?.preflightStatus ?? "—").replaceAll("_", " ")}</StatusPill></span>
        <span>DATA QUALITY <strong>{(workspace?.files ?? []).some((file: any) => file?.type === "IFC") ? "MEDIUM" : "LIMITED"}</strong></span>
      </div>

      <nav className="design-tabs">{tabs.map((item) => <button key={item.key} className={tab === item.key ? "is-active" : ""} onClick={() => setTab(item.key)}><item.icon size={15} />{item.label}{item.count !== undefined && <b>{item.count}</b>}</button>)}</nav>
      {error && <div className="design-error"><AlertTriangle size={16} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}

      {tab === "dashboard" && (
        <div className="design-dashboard">
          <section className="design-metric-grid">
            <DesignMetricCard label="Design readiness" value={(workspace?.package?.preflightStatus ?? "") === "READY" ? "Pronto" : "Com limitações"} meta={`${(workspace?.package?.limitations ?? []).length} ressalva(s) registrada(s)`} icon={Target} tone={(workspace?.package?.preflightStatus ?? "") === "READY" ? "positive" : "warning"} />
            <DesignMetricCard label="Eficiência" value={privateEfficiency ? formatMetric(privateEfficiency?.value, privateEfficiency?.unit) : "Não verificada"} meta={privateEfficiency ? `${privateEfficiency?.origin} · ${confidenceLabel(privateEfficiency?.confidence ?? "")}` : "Aguardando área total + privativa"} icon={Gauge} tone={privateEfficiency && (privateEfficiency?.value ?? 0) >= 0.75 ? "positive" : "warning"} />
            <DesignMetricCard label="Findings abertos" value={String(workspace?.summary?.openFindings ?? 0)} meta={`${workspace?.summary?.criticalFindings ?? 0} crítico(s)`} icon={AlertTriangle} tone={workspace?.summary?.criticalFindings ? "critical" : workspace?.summary?.openFindings ? "warning" : "positive"} />
            <DesignMetricCard label="Design drift" value={(workspace?.summary?.designDriftRate ?? null) === null ? "Não verificado" : `${number.format(Math.abs(workspace?.summary?.designDriftRate ?? 0) * 100)}%`} meta="Baseline × current design" icon={GitCompareArrows} tone={(workspace?.summary?.designDriftRate ?? null) !== null && Math.abs(workspace?.summary?.designDriftRate ?? 0) > 0.05 ? "critical" : "neutral"} />
            <DesignMetricCard label="VE quantificadas" value={String(workspace?.summary?.quantifiedOpportunities ?? 0)} meta={`${(workspace?.opportunities ?? []).length} oportunidade(s) total`} icon={CircleDollarSign} tone={workspace?.summary?.quantifiedOpportunities ? "positive" : "neutral"} />
          </section>

          <section className="design-two-column">
            <article className="design-panel">
              <header><div><span className="eyebrow">DESIGN SCORECARD</span><h3>Diagnóstico por dimensão</h3></div><small>Não é o REDE Score</small></header>
              <div className="design-scorecard">
                {((workspace?.scorecard ?? []) as any[]).map((dimension: any) => (
                  <div key={dimension?.key ?? Math.random()}>
                    <span className={`design-score-state ${(dimension?.status ?? "").toLowerCase()}`} />
                    <div><strong>{dimension?.label ?? "—"}</strong><small>{dimension?.explanation ?? "—"}</small></div>
                    <b>{(dimension?.value ?? null) === null ? "—" : dimension?.key === "AREA_EFFICIENCY" ? `${number.format((dimension?.value ?? 0) * 100)}%` : number.format(dimension?.value ?? 0)}</b>
                  </div>
                ))}
              </div>
            </article>
            <article className="design-panel">
              <header><div><span className="eyebrow">AREA RECONCILIATION</span><h3>Métricas e origem</h3></div><FileSearch size={19} /></header>
              <div className="design-metric-table">
                {(keyMetrics ?? []).slice(0, 7).map((metric: any) => (
                  <div key={metric?.id ?? Math.random()}>
                    <span><strong>{(metricLabels as any)[metric?.name ?? ""] ?? metric?.name ?? "—"}</strong><small>{metric?.origin ?? "—"} · {confidenceLabel(metric?.confidence ?? "")}</small></span>
                    <b>{formatMetric(metric?.value ?? null, metric?.unit ?? "")}</b>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <div className="design-placeholder"><AlertTriangle size={32} /><p>Seções adicionais (Insights, Findings, Oportunidades) carregando...</p></div>
        </div>
      )}

      {tab === "viewer" && (
        <div className="design-viewer-placeholder">
          <AlertTriangle size={32} />
          <h3>Visualizador de Pranchas</h3>
          <p>Upload de arquivos de projeto disponível.</p>
          <button className="button button-primary" onClick={() => setUploadOpen(true)}><Upload size={15} /> Enviar arquivo</button>
        </div>
      )}

      {tab === "findings" && (
        <div className="design-placeholder">
          <AlertTriangle size={32} />
          <p>Registro de Findings - {(workspace?.findings ?? []).length} items</p>
        </div>
      )}

      {tab === "value" && (
        <div className="design-placeholder">
          <AlertTriangle size={32} />
          <p>Value Engineering - {(workspace?.opportunities ?? []).length} oportunidades</p>
        </div>
      )}

      {tab === "diff" && (
        <div className="design-placeholder">
          <AlertTriangle size={32} />
          <p>Alternativas & Diff - {(workspace?.alternatives ?? []).length} alternativas</p>
        </div>
      )}
    </div>
  );
}
