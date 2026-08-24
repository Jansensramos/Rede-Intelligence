"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, Bookmark, Bot, Check, ChevronRight, CircleStop, Download, FileSearch, Plus, Send, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { confirmAIActionAction, createAIConversationAction, exportAIConversationAction, refreshAIBootstrapAction, requestMessagePromotionAction, saveAIFeedbackAction, saveAIInsightAction, updateAIResponseModeAction } from "@/app/actions/ai";
import type { AIBootstrapView, AIMessageView, AIResponseEvidenceInput, AIStructuredBlock } from "@/domain/ai";

interface RedeAIViewProps {
  initialBootstrap: AIBootstrapView;
  /** Fase 9K.0 (fechamento, gate 3): mesmo projectId do OperationalContext da tela — nunca resolvido de novo aqui. */
  projectId: string;
  currentModule: string;
  initialPrompt?: string;
  onPromptConsumed?: () => void;
  onNavigate: (module: string) => void;
}

export function RedeAIView({ initialBootstrap, projectId, currentModule, initialPrompt, onPromptConsumed, onNavigate }: RedeAIViewProps) {
  const [bootstrap, setBootstrap] = useState(initialBootstrap);
  const [activeId, setActiveId] = useState(initialBootstrap.activeConversation.id);
  const [draft, setDraft] = useState("");
  const [liveText, setLiveText] = useState("");
  const [progress, setProgress] = useState<{ label: string; status: string }[]>([]);
  const [error, setError] = useState("");
  const [evidence, setEvidence] = useState<AIResponseEvidenceInput | null>(null);
  const [pending, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const active = useMemo(() => bootstrap.conversations.find((item) => item.id === activeId) ?? bootstrap.activeConversation, [bootstrap, activeId]);

  useEffect(() => { if (initialPrompt) { setDraft(initialPrompt); onPromptConsumed?.(); } }, [initialPrompt, onPromptConsumed]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [active.messages.length, liveText, progress.length]);

  async function refresh(preferredId = activeId) {
    const response = await refreshAIBootstrapAction(projectId, currentModule);
    if (response.ok) { setBootstrap(response.data); if (response.data.conversations.some((item) => item.id === preferredId)) setActiveId(preferredId); else setActiveId(response.data.activeConversation.id); }
  }

  async function createConversation() {
    const response = await createAIConversationAction(projectId, currentModule);
    if (!response.ok) { setError(response.error); return; }
    await refresh(response.data.id);
  }

  async function submit(question = draft) {
    const value = question.trim();
    if (!value || abortRef.current) return;
    setDraft(""); setError(""); setLiveText(""); setProgress([{ label: "Iniciando análise…", status: "RUNNING" }]);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: active.id, question: value, currentModule }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(response.status === 401 ? "Sessão expirada." : "Não foi possível iniciar a análise.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value: chunk } = await reader.read(); if (done) break; buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const item = JSON.parse(line) as { type: string; data: unknown };
          if (item.type === "progress") setProgress((current) => [...current.filter((entry) => entry.label !== (item.data as { label: string }).label), item.data as { label: string; status: string }]);
          if (item.type === "tool") { const tool = item.data as { name: string; status: string }; setProgress((current) => [...current, { label: toolLabel(tool.name), status: tool.status }]); }
          if (item.type === "delta") setLiveText((current) => current + String(item.data));
          if (item.type === "error") throw new Error((item.data as { message: string }).message);
        }
      }
      await refresh(active.id);
    } catch (cause) { if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Não foi possível concluir esta análise."); }
    finally { abortRef.current = null; setLiveText(""); setProgress([]); }
  }

  function stop() { abortRef.current?.abort(); abortRef.current = null; setProgress([]); setLiveText(""); setError("Geração interrompida. A execução iniciada permanece registrada na auditoria."); }

  async function confirmAction(actionId: string, decision: "CONFIRM" | "CANCEL") {
    const response = await confirmAIActionAction(actionId, decision); if (!response.ok) setError(response.error); await refresh(active.id);
  }

  async function exportConversation() {
    const response = await exportAIConversationAction(active.id); if (!response.ok) { setError(response.error); return; }
    const bytes = Uint8Array.from(atob(response.data.content), (character) => character.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: response.data.mimeType })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = response.data.fileName; anchor.click(); URL.revokeObjectURL(url);
  }

  async function changeResponseMode(mode: "EXECUTIVE" | "DETAILED" | "TECHNICAL") {
    const response = await updateAIResponseModeAction(active.id, mode);
    if (!response.ok) setError(response.error); else await refresh(active.id);
  }

  return <section className="ai-shell" aria-label="REDE AI">
    <aside className="ai-history">
      <div className="ai-history-head"><div><span className="eyebrow">CONVERSAS</span><strong>Histórico contextual</strong></div><button onClick={() => void createConversation()} aria-label="Nova conversa"><Plus size={16} /></button></div>
      <div className="ai-conversation-list">{bootstrap.conversations.map((conversation) => <button key={conversation.id} className={conversation.id === active.id ? "is-active" : ""} onClick={() => setActiveId(conversation.id)}><span>{conversation.title}</span><small>v{conversation.context.studyVersionNumber} · {conversation.context.financialScenario}{conversation.stale ? " · desatualizada" : ""}</small></button>)}</div>
      <div className="ai-usage"><span>USO DO MÊS</span><strong>{bootstrap.usage.calls} chamadas</strong><small>{bootstrap.usage.inputTokens + bootstrap.usage.outputTokens} tokens · US$ {bootstrap.usage.estimatedCost.toFixed(4)}</small></div>
    </aside>

    <div className="ai-main">
      <header className="ai-hero"><div className="ai-mark"><Sparkles size={19} /></div><div><span className="eyebrow">COPILOTO DE DECISÃO</span><h2>REDE AI</h2><p>Pergunte qualquer coisa sobre este empreendimento.</p></div><span className={`ai-status status-${bootstrap.status.toLowerCase()}`}><i /> {bootstrap.status}</span></header>
      <div className="ai-context-bar" aria-label="Contexto ativo"><ContextItem label="Projeto" value={bootstrap.contextLabels.projectName} /><ContextItem label="StudyVersion" value={`v${active.context.studyVersionNumber}`} /><ContextItem label="Financeiro" value={active.context.financialScenario.toUpperCase()} /><ContextItem label="Urbanístico" value={active.context.urbanScenarioType ?? "N/D"} /><ContextItem label="Investment Case" value={bootstrap.contextLabels.investmentCaseTitle} /></div>
      {active.stale && <div className="ai-stale"><AlertTriangle size={16} /><span>Esta conversa foi iniciada usando uma versão anterior. Mensagens antigas preservam o contexto original.</span><button onClick={() => void submit("Atualize explicitamente o contexto para a última versão disponível.")}>ATUALIZAR CONTEXTO</button></div>}
      <div className="ai-thread" role="log" aria-live="polite">
        {!active.messages.length && <AIWelcome suggestions={bootstrap.suggestions} onSelect={(prompt) => void submit(prompt)} />}
        {active.messages.map((message) => <AIMessageCard key={message.id} message={message} onEvidence={setEvidence} onNavigate={onNavigate} onRefresh={() => refresh(active.id)} onError={setError} />)}
        {progress.length > 0 && <div className="ai-progress-card">{progress.slice(-8).map((item, index) => <div key={`${item.label}-${index}`}><span className={item.status === "COMPLETED" ? "done" : "running"}>{item.status === "COMPLETED" ? <Check size={13} /> : <i />}</span>{item.label}</div>)}</div>}
        {liveText && <article className="ai-message assistant streaming"><div className="message-role"><Bot size={15} /> REDE AI</div><p>{liveText}</p></article>}
        {active.pendingActions.filter((item) => item.status === "PENDING_CONFIRMATION").map((action) => <article className="ai-action-preview" key={action.id}><span className="eyebrow">AÇÃO PROPOSTA</span><h3>{String(action.preview.title ?? action.actionType)}</h3><dl>{Object.entries(action.preview).filter(([key]) => !["title", "requiresConfirmation"].includes(key)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl><div><button className="button button-secondary" onClick={() => void confirmAction(action.id, "CANCEL")}>Cancelar</button><button className="button button-primary" onClick={() => void confirmAction(action.id, "CONFIRM")}>Confirmar</button></div></article>)}
        {error && <div className="ai-error"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar erro"><X size={14} /></button></div>}
        <div ref={endRef} />
      </div>
      <footer className="ai-composer"><div className="ai-suggestion-row">{bootstrap.suggestions.slice(0, 4).map((item) => <button key={item.prompt} onClick={() => setDraft(item.prompt)}>{item.prompt}</button>)}</div><div className="ai-input-wrap"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder="Pergunte, compare ou simule…" rows={2} aria-label="Pergunte ao REDE AI" disabled={Boolean(abortRef.current)} />{abortRef.current ? <button className="ai-stop" onClick={stop} aria-label="Interromper geração"><CircleStop size={19} /></button> : <button className="ai-send" onClick={() => void submit()} disabled={!draft.trim()} aria-label="Enviar pergunta"><Send size={18} /></button>}</div><div className="ai-composer-meta"><label>Modo <select value={active.responseMode} onChange={(event) => void changeResponseMode(event.target.value as "EXECUTIVE" | "DETAILED" | "TECHNICAL")} aria-label="Modo de resposta"><option value="EXECUTIVE">Executivo</option><option value="DETAILED">Detalhado</option><option value="TECHNICAL">Técnico</option></select></label><span>Números críticos vêm dos módulos determinísticos.</span><button onClick={() => startTransition(() => { void exportConversation(); })} disabled={pending}><Download size={13} /> Exportar conversa</button></div></footer>
    </div>

    <aside className="ai-context-panel"><span className="eyebrow">FONTES ATIVAS</span><h3>Contexto de decisão</h3><div className="ai-context-summary"><Summary label="Snapshot" value={`v${active.context.studyVersionNumber}`} /><Summary label="Financeiro" value={active.context.financialScenario.toUpperCase()} /><Summary label="Urbanístico" value={active.context.urbanScenarioType ?? "Não selecionado"} /><Summary label="Status AI" value={bootstrap.status} /></div><div className="ai-security-note"><ShieldCheck size={17} /><div><strong>Structured data first</strong><p>Engine, Score, Red Team, Land e Comitê permanecem como fonte de verdade.</p></div></div><div className="ai-prompt-library"><span>PROMPT LIBRARY</span>{bootstrap.suggestions.slice(4).map((item) => <button key={item.prompt} onClick={() => setDraft(item.prompt)}><span>{item.category}</span>{item.prompt}<ChevronRight size={13} /></button>)}</div></aside>
    {evidence && <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(null)} />}
  </section>;
}

function ContextItem({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong title={value}>{value}</strong></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function toolLabel(name: string) { return ({ getEngineResults: "Consultando Engine…", getScore: "Consultando Score…", getScoreExplanation: "Explicando Score…", getRedTeam: "Consultando Red Team…", runEngineSimulation: "Calculando simulação…", runReverseZoningSolver: "Executando Reverse Solver…", preflightMasterReport: "Executando preflight…", searchInternalEvidence: "Buscando evidências…" } as Record<string, string>)[name] ?? `Consultando ${name}…`; }

function AIWelcome({ suggestions, onSelect }: { suggestions: AIBootstrapView["suggestions"]; onSelect: (prompt: string) => void }) { return <div className="ai-welcome"><div className="ai-welcome-icon"><Sparkles size={22} /></div><h3>O empreendimento inteiro, em uma conversa fundamentada.</h3><p>Consulte métricas, fontes, riscos, documentos e decisões. Simulações são sempre identificadas e isoladas.</p><div>{suggestions.slice(0, 8).map((item) => <button key={item.prompt} onClick={() => onSelect(item.prompt)}><span>{item.category}</span>{item.prompt}<ArrowRight size={14} /></button>)}</div></div>; }

function AIMessageCard({ message, onEvidence, onNavigate, onRefresh, onError }: { message: AIMessageView; onEvidence: (source: AIResponseEvidenceInput) => void; onNavigate: (module: string) => void; onRefresh: () => Promise<void>; onError: (error: string) => void }) {
  const assistant = message.role === "ASSISTANT";
  async function promote(type: "ACTION" | "RISK" | "CONDITION" | "COMMITTEE_QUESTION") { const response = await requestMessagePromotionAction(message.id, type); if (!response.ok) onError(response.error); await onRefresh(); }
  return <article className={`ai-message ${assistant ? "assistant" : "user"}`}><div className="message-role">{assistant ? <><Bot size={15} /> REDE AI</> : "VOCÊ"}<time>{new Date(message.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time></div><div className="ai-message-content">{message.content.split("\n").map((part, index) => part ? <p key={index}>{part}</p> : <br key={index} />)}</div>{message.structuredContent.length > 0 && <div className="ai-structured-grid">{message.structuredContent.map((block, index) => <StructuredBlock key={index} block={block} onNavigate={onNavigate} />)}</div>}{message.evidence.length > 0 && <div className="evidence-chips">{message.evidence.slice(0, 12).map((source) => <button key={source.evidenceRef} onClick={() => onEvidence(source)}><FileSearch size={12} />{source.label}</button>)}</div>}{assistant && <div className="ai-message-actions"><button onClick={() => void saveAIFeedbackAction(message.id, "POSITIVE")} aria-label="Resposta útil"><ThumbsUp size={13} /></button><button onClick={() => void saveAIFeedbackAction(message.id, "NEGATIVE", "Resposta incorreta")} aria-label="Resposta incorreta"><ThumbsDown size={13} /></button><button onClick={() => void saveAIInsightAction(message.id, message.content.slice(0, 80))}><Bookmark size={13} /> Salvar insight</button><span /><button onClick={() => void promote("ACTION")}>→ Ação</button><button onClick={() => void promote("RISK")}>→ Risco</button><button onClick={() => void promote("CONDITION")}>→ Condição</button><button onClick={() => void promote("COMMITTEE_QUESTION")}>→ Pergunta IC</button></div>}</article>;
}

function StructuredBlock({ block, onNavigate }: { block: AIStructuredBlock; onNavigate: (module: string) => void }) {
  if (block.type === "metric") return <div className={`ai-metric tone-${block.tone ?? "neutral"}`}><span>{block.title}</span><strong>{block.value}</strong>{block.delta && <small>{block.delta}</small>}</div>;
  if (block.type === "warning") return <div className={`ai-inline-warning severity-${block.severity.toLowerCase()}`}><AlertTriangle size={15} /><div><strong>{block.title}</strong><p>{block.content}</p></div></div>;
  if (block.type === "action" || block.type === "risk") return <div className="ai-inline-action"><span>{block.type === "risk" ? block.severity : block.priority}</span><strong>{block.title}</strong><p>{block.type === "risk" ? block.action : block.description}</p><small>{block.status}</small></div>;
  if (block.type === "comparison") return <div className="ai-comparison"><strong>{block.title}</strong><div className="ai-table-scroll"><table><thead><tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div></div>;
  if (block.type === "simulation") return <div className="ai-simulation"><span>SIMULAÇÃO — NÃO OFICIAL</span><h4>{block.title}</h4><div className="ai-table-scroll"><table><thead><tr><th>Métrica</th><th>Base</th><th>Simulado</th><th>Delta</th></tr></thead><tbody>{block.metrics.map((item) => <tr key={item.label}><td>{item.label}</td><td>{item.base}</td><td>{item.simulated}</td><td>{item.delta}</td></tr>)}</tbody></table></div><small>{block.disclaimer}</small></div>;
  if (block.type === "deep_link") return <button className="ai-deep-link" onClick={() => onNavigate(block.module)}>{block.label}<ArrowRight size={14} /></button>;
  return null;
}

function EvidenceDrawer({ evidence, onClose }: { evidence: AIResponseEvidenceInput; onClose: () => void }) { return <div className="ai-drawer-backdrop" role="presentation" onClick={onClose}><aside className="ai-evidence-drawer" role="dialog" aria-modal="true" aria-label="Origem da informação" onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">COMO CHEGAMOS A ESSA RESPOSTA?</span><h3>{evidence.label}</h3></div><button onClick={onClose} aria-label="Fechar detalhe"><X size={17} /></button></header><dl><div><dt>Valor</dt><dd>{evidence.value ?? "N/D"}</dd></div><div><dt>Módulo</dt><dd>{evidence.sourceType}</dd></div><div><dt>Entidade</dt><dd>{evidence.entityType}</dd></div><div><dt>Versão</dt><dd>{evidence.version ?? "N/D"}</dd></div><div><dt>Cenário</dt><dd>{evidence.scenario ?? "N/D"}</dd></div><div><dt>Localização</dt><dd>{evidence.location ?? "Registro estruturado"}</dd></div><div><dt>Confidence</dt><dd>{evidence.confidence}</dd></div><div><dt>Evidence ref</dt><dd className="break-anywhere">{evidence.evidenceRef}</dd></div></dl>{Boolean(evidence.metadata?.untrustedEvidence) && <div className="ai-security-note"><ShieldCheck size={16} /><span>Conteúdo tratado como UNTRUSTED EVIDENCE.</span></div>}</aside></div>; }
