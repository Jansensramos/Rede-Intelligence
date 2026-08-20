"use client";

import { useState, useEffect } from "react";
import { Sparkles, Send, AlertTriangle, MessageSquare } from "lucide-react";
import type { AIBootstrapView } from "@/domain/ai";

interface RedeAIViewProps {
  initialBootstrap?: AIBootstrapView;
  currentModule?: string;
  initialPrompt?: string;
  onPromptConsumed?: () => void;
  onNavigate?: (module: string) => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export function RedeAIView({ initialBootstrap, currentModule, initialPrompt, onPromptConsumed, onNavigate }: RedeAIViewProps) {
  const [bootstrap, setBootstrap] = useState<AIBootstrapView | null>(initialBootstrap ?? null);
  const [activeId, setActiveId] = useState<string>(initialBootstrap?.activeConversation?.id ?? "");
  const [draft, setDraft] = useState("");
  const [liveText, setLiveText] = useState("");
  const [progress, setProgress] = useState<{ label: string; status: string }[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>(initialBootstrap?.conversations ?? []);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialPrompt && activeId) {
      setDraft(initialPrompt);
      handleSubmit(initialPrompt);
      onPromptConsumed?.();
    }
  }, [initialPrompt, activeId, onPromptConsumed]);

  const activeConversation = conversations.find((c) => c?.id === activeId) ?? (conversations?.[0] ?? null);
  const messages = activeConversation?.messages ?? [];

  function createNewConversation() {
    const newId = `conv-${Date.now()}`;
    const newConv: Conversation = {
      id: newId,
      title: "Nova conversa",
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setConversations([newConv, ...conversations]);
    setActiveId(newId);
  }

  async function handleSubmit(prompt?: string) {
    const text = prompt ?? draft;
    if (!text.trim() || !activeId) return;

    setDraft("");
    setLiveText("Processando...");
    setError("");

    try {
      // Mock AI response for demo
      const userMsg: Message = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date(),
      };

      const assistantMsg: Message = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: "Esta é uma resposta simulada do REDE AI. Em produção, o motor de IA processaria o prompt e geraria uma resposta estruturada com evidências.",
        timestamp: new Date(),
      };

      setConversations(
        conversations.map((conv) =>
          conv?.id === activeId ? { ...conv, messages: [...(conv?.messages ?? []), userMsg, assistantMsg], updatedAt: new Date() } : conv
        )
      );

      setLiveText("");
    } catch (err) {
      setError(`Erro ao processar prompt: ${String(err)}`);
      setLiveText("");
    }
  }

  if (!bootstrap) {
    return (
      <div className="view-stack">
        <section className="panel">
          <div className="placeholder-message">
            <AlertTriangle size={32} />
            <h3>REDE AI não inicializado</h3>
            <p>Falha ao carregar o bootstrap do AI. Por favor, recarregue a página.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="ai-workspace">
      <aside className="ai-sidebar">
        <header className="ai-sidebar-header">
          <div>
            <Sparkles size={20} />
            <h2>REDE AI</h2>
          </div>
          <button className="button button-primary" onClick={createNewConversation} title="Nova conversa">
            +
          </button>
        </header>

        <div className="conversations-list">
          {conversations.length === 0 ? (
            <div className="empty-state">
              <MessageSquare size={18} />
              <small>Nenhuma conversa iniciada</small>
            </div>
          ) : (
            (conversations ?? []).map((conv) => (
              <button
                key={conv?.id ?? Math.random()}
                className={`conversation-item ${activeId === conv?.id ? "is-active" : ""}`}
                onClick={() => setActiveId(conv?.id ?? "")}
              >
                <span>{conv?.title ?? "—"}</span>
                <small>{conv?.updatedAt ? new Date(conv.updatedAt).toLocaleDateString("pt-BR") : "—"}</small>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="ai-main">
        <header className="ai-header">
          <div>
            <span className="eyebrow">REDE COPILOTO · CONTEXTO ESTRUTURADO</span>
            <h2>{activeConversation?.title ?? "Selecione uma conversa"}</h2>
            <p>Módulo ativo: {currentModule ?? "geral"}</p>
          </div>
        </header>

        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <Sparkles size={36} />
              <h3>Comece uma conversa</h3>
              <p>Faça perguntas sobre o projeto, análises ou recomendações estruturadas.</p>
            </div>
          ) : (
            <div className="messages-list">
              {(messages ?? []).map((msg) => (
                <div key={msg?.id ?? Math.random()} className={`message ${msg?.role ?? "user"}`}>
                  <div className="message-avatar">{msg?.role === "user" ? "📋" : "🤖"}</div>
                  <div className="message-content">
                    <p>{msg?.content ?? "—"}</p>
                    <small>{msg?.timestamp ? new Date(msg.timestamp).toLocaleTimeString("pt-BR") : "—"}</small>
                  </div>
                </div>
              ))}
            </div>
          )}

          {liveText && (
            <div className="message assistant">
              <div className="message-avatar">🤖</div>
              <div className="message-content">
                <p className="live-text">{liveText}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="message error">
              <AlertTriangle size={16} />
              <p>{error}</p>
            </div>
          )}
        </div>

        <footer className="ai-footer">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
            className="ai-input-form"
          >
            <div className="input-wrapper">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                placeholder="Pergunte sobre este projeto, análises ou estrutura..."
                rows={3}
                disabled={!activeId || liveText !== ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.ctrlKey) {
                    void handleSubmit();
                  }
                }}
              />
              <button type="submit" className="send-button" disabled={!draft.trim() || !activeId || liveText !== ""} title="Enviar (Ctrl+Enter)">
                <Send size={18} />
              </button>
            </div>
            <small>Use Ctrl+Enter para enviar rapidamente</small>
          </form>
        </footer>
      </main>
    </div>
  );
}
