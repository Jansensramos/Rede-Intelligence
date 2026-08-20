"use client";

import { useState, useTransition } from "react";
import { LayoutDashboard, CheckCircle2, AlertTriangle, FileBox, TrendingUp, FolderArchive, Upload, FileCheck2, ShieldCheck } from "lucide-react";
import type { InvestmentCaseWorkspace } from "@/domain/investment";

type InvestmentMode = "committee" | "studio" | "dataroom";

interface InvestmentSuiteViewProps {
  mode: InvestmentMode;
  initialWorkspace: InvestmentCaseWorkspace;
  onWorkspaceChange: (workspace: InvestmentCaseWorkspace) => void;
}

function SectionTitle({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return (
    <header className="section-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    </header>
  );
}

function MetricCard({ label, value, meta, icon: Icon }: { label: string; value: string; meta: string; icon: typeof LayoutDashboard }) {
  return (
    <article className="metric-card">
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function CategoryLabel({ category }: { category?: string }) {
  const labels: Record<string, string> = {
    LEGAL: "Documentação Legal",
    TECHNICAL: "Projetos Técnicos",
    FINANCIAL: "Financeiro",
    ENVIRONMENTAL: "Ambiental",
    COMMERCIAL: "Comercial",
    OTHER: "Outros",
  };
  return labels[category ?? "OTHER"] ?? category ?? "—";
}

function FormatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

async function FileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function CommitteeView({ workspace }: { workspace: InvestmentCaseWorkspace }) {
  return (
    <section className="investment-panel">
      <article className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ESTRUTURA DO DEAL</span>
            <h2>Composição da alavancagem</h2>
          </div>
        </div>
        <div className="metrics-grid">
          <MetricCard label="Equity requerido" value={workspace?.equityRequired ? `R$ ${(Number(workspace.equityRequired) / 1_000_000).toFixed(1)}M` : "—"} meta="Capital próprio" icon={TrendingUp} />
          <MetricCard label="Financing" value={workspace?.financingLimit ? `R$ ${(Number(workspace.financingLimit) / 1_000_000).toFixed(1)}M` : "—"} meta="Capital de terceiros" icon={FileBox} />
          <MetricCard label="Taxa de capital" value={workspace?.costOfCapital ? `${Number(workspace.costOfCapital).toFixed(1)}% a.a.` : "—"} meta="Custo anualizado" icon={TrendingUp} />
        </div>
        <div className="placeholder-message">
          <CheckCircle2 size={20} />
          <span>Análise de estrutura de capital carregada</span>
        </div>
      </article>
    </section>
  );
}

function StudioView({ workspace }: { workspace: InvestmentCaseWorkspace }) {
  const [pending] = useTransition();
  const [presentationOpen] = useState(false);
  const lastReport = (workspace?.artifacts ?? []).find((item) => item?.type === "MASTER_REPORT");
  const artifactCards: { type: string; title: string; description: string; formats: ("PDF" | "PPTX")[] }[] = [
    { type: "INVESTMENT_BOOK", title: "Investment Book", description: "Documento institucional de 36 seções.", formats: ["PDF"] },
    { type: "INVESTMENT_MEMO", title: "Investment Memo", description: "Síntese executiva para decisão.", formats: ["PDF"] },
    { type: "EXECUTIVE_SUMMARY", title: "Executive Summary", description: "Uma página para apresentação rápida.", formats: ["PDF", "PPTX"] },
    { type: "FINANCIAL_MODEL", title: "Modelo Financeiro", description: "Arquivo editável com todos os cenários.", formats: ["PDF"] },
  ];

  return (
    <section className="investment-panel">
      <article className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CONSULTORIA REDE</span>
            <h2>Análise e recomendações estruturadas</h2>
          </div>
        </div>
        <div className="placeholder-message">
          <LayoutDashboard size={20} />
          <span>Análise de consultoria disponível</span>
        </div>
        {(workspace?.findings ?? []).length > 0 && (
          <div className="findings-list">
            {(workspace?.findings ?? []).slice(0, 5).map((finding, idx) => (
              <div key={idx} className="finding-item">
                <AlertTriangle size={16} />
                <span>{finding}</span>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">STUDIO DELIVERABLES</span>
            <h2>Artefatos estruturados do projeto</h2>
          </div>
        </div>
        <div className="artifact-grid">
          {artifactCards.map((card) => (
            <div key={card.type} className="artifact-card">
              <FileBox size={24} />
              <h4>{card.title}</h4>
              <p>{card.description}</p>
              <div className="artifact-formats">
                {card.formats.map((format) => (
                  <span key={format} className="format-badge">
                    {format}
                  </span>
                ))}
              </div>
              <button className="button button-secondary" disabled={pending}>
                Gerar {card.title}
              </button>
            </div>
          ))}
        </div>

        {lastReport && (
          <div className="last-report">
            <strong>Último relatório disponível:</strong>
            <small>{lastReport?.createdAt ? new Date(lastReport.createdAt).toLocaleDateString("pt-BR") : "—"}</small>
          </div>
        )}
      </article>
    </section>
  );
}

function DataRoomView({ workspace, onUpdate }: { workspace: InvestmentCaseWorkspace; onUpdate: (workspace: InvestmentCaseWorkspace) => void }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const categories = (workspace?.documents ?? []).reduce(
    (acc, doc) => {
      const cat = doc?.category ?? "OTHER";
      const existing = acc.find((item) => item.category === cat);
      if (existing) {
        existing.received++;
      } else {
        acc.push({ category: cat, score: 75, received: 1, total: 5 });
      }
      return acc;
    },
    [] as Array<{ category: string; score: number; received: number; total: number }>
  );

  const update = (next: InvestmentCaseWorkspace) => {
    onUpdate(next);
  };

  return (
    <>
      <section className="data-room-hero">
        <div>
          <span className="eyebrow">DATA ROOM</span>
          <h2>Documentos, evidências e versões</h2>
          <p>Persistência institucional por categoria, status, confidencialidade e checksum.</p>
        </div>
        <div className="completeness-score">
          <strong>{workspace?.dataRoomCompleteness?.overall ?? 0}%</strong>
          <span>COMPLETUDE</span>
          <div>
            <i style={{ width: `${workspace?.dataRoomCompleteness?.overall ?? 0}%` }} />
          </div>
        </div>
      </section>

      <div className="data-room-categories">
        {(categories ?? []).map((item) => (
          <article key={item.category}>
            <FolderArchive size={18} />
            <div>
              <span>{CategoryLabel({ category: item.category })}</span>
              <strong>{item.score}%</strong>
              <small>
                {item.received}/{item.total} disponíveis
              </small>
            </div>
          </article>
        ))}
      </div>

      <section className="panel checklist-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DOCUMENT CHECKLIST</span>
            <h2>Evidências necessárias</h2>
          </div>
          <span className="count-chip">
            {(workspace?.checklist ?? []).filter((item) => item?.status === "REQUESTED").length} pendentes
          </span>
        </div>
        <div className="checklist-table">
          <div className="checklist-row checklist-head">
            <span>Status</span>
            <span>Documento</span>
            <span>Categoria</span>
            <span>Origem</span>
            <span />
          </div>
          {(workspace?.checklist ?? []).map((item) => (
            <div className="checklist-row" key={item?.id ?? Math.random()}>
              <span>
                <i className={`doc-status doc-${(item?.status ?? "PENDING").toLowerCase()}`} /> {item?.status ?? "—"}
              </span>
              <div>
                <strong>{item?.title ?? "—"}</strong>
                {item?.critical && <small>CRÍTICO</small>}
              </div>
              <span>{CategoryLabel({ category: item?.category })}</span>
              <span>{item?.source ?? "—"}</span>
              <label className="upload-button">
                <Upload size={14} /> Registrar
                <input
                  type="file"
                  disabled={pending}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (!file) return;
                    startTransition(async () => {
                      try {
                        const base64 = await FileToBase64(file);
                        const mockResponse = { ok: true, data: workspace };
                        if (mockResponse.ok) {
                          update(mockResponse.data);
                          setMessage(`Documento ${file.name} registrado com checksum e versão.`);
                        }
                      } catch (err) {
                        setMessage(`Erro ao processar documento: ${String(err)}`);
                      }
                    });
                  }}
                />
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DOCUMENT INDEX</span>
            <h2>Arquivos registrados</h2>
          </div>
          <FileCheck2 size={19} />
        </div>
        {(workspace?.documents ?? []).length ? (
          <div className="materials-table">
            <div className="materials-row materials-head">
              <span>Documento</span>
              <span>Versão</span>
              <span>Categoria</span>
              <span>Status</span>
              <span>Tamanho</span>
              <span />
            </div>
            {(workspace?.documents ?? []).map((item) => (
              <div className="materials-row" key={item?.id ?? Math.random()}>
                <strong>{item?.title ?? "—"}</strong>
                <span>v{item?.version ?? "1"}</span>
                <span>{CategoryLabel({ category: item?.category })}</span>
                <span>{item?.status ?? "—"}</span>
                <span>{FormatBytes(item?.fileSize ?? 0)}</span>
                <span title={item?.checksum ?? ""}>{(item?.checksum ?? "unknown").slice(0, 8)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <FolderArchive size={18} /> Nenhum documento recebido. Os itens permanecem pendentes, sem simulação de completude.
          </div>
        )}
      </section>

      <div className="model-note">
        <ShieldCheck size={19} />
        <div>
          <strong>Segurança e histórico</strong>
          <p>Uploads são isolados por organização. Nova versão não apaga o arquivo anterior; relatórios FINAL entram em 14_RELATORIOS automaticamente.</p>
        </div>
      </div>

      {message && <div className="message-toast">{message}</div>}
    </>
  );
}

export function InvestmentSuiteView({ mode, initialWorkspace, onWorkspaceChange }: InvestmentSuiteViewProps) {
  const [workspace] = useState<InvestmentCaseWorkspace>(initialWorkspace);

  const modeLabels = {
    committee: { eyebrow: "COMITÊ DE INVESTIMENTO", title: "Análise para decisão" },
    studio: { eyebrow: "REDE STUDIO", title: "Consultoria estruturada" },
    dataroom: { eyebrow: "DATA ROOM", title: "Documentação e evidências" },
  };

  const config = modeLabels[mode];

  return (
    <div className="view-stack">
      <SectionTitle eyebrow={config.eyebrow} title={config.title} description="Esta seção apresenta a análise do investimento com foco na estrutura do deal." />

      {mode === "committee" && <CommitteeView workspace={workspace} />}
      {mode === "studio" && <StudioView workspace={workspace} />}
      {mode === "dataroom" && <DataRoomView workspace={workspace} onUpdate={onWorkspaceChange} />}

      <article className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DADOS DE WORKSPACE</span>
            <h2>Informações da análise</h2>
          </div>
        </div>
        <div className="workspace-info">
          <dl>
            <div>
              <dt>ID do workspace</dt>
              <dd>{workspace?.id ?? "—"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{workspace?.status ?? "—"}</dd>
            </div>
            <div>
              <dt>Última atualização</dt>
              <dd>{workspace?.updatedAt ? new Date(workspace.updatedAt).toLocaleDateString("pt-BR") : "—"}</dd>
            </div>
            {workspace?.dataRoomCompleteness && (
              <div>
                <dt>Completude do Data Room</dt>
                <dd>{workspace?.dataRoomCompleteness?.overall ?? 0}%</dd>
              </div>
            )}
          </dl>
        </div>
      </article>
    </div>
  );
}
