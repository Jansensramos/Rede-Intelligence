"use client";

/**
 * Fase 9K.1 — rota `/assistente` (era a 25ª aba "ai", plano §A.5). O painel flutuante é a 9K.4;
 * nesta sprint o assistente vira uma rota real, mas continua ocupando a tela inteira como hoje.
 *
 * `onNavigate` recebia uma `LegacyViewKey` (ex.: "financial") e trocava a aba local. Agora resolve
 * a Grande Área correspondente (`findAreaForViewKey`, já existente desde a 9K.0) e navega para a
 * rota real — a IA continua "sugerindo", nunca troca de tela sozinha sem clique do usuário (plano §R).
 */
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RedeAIView } from "@/components/rede-ai-view";
import { findAreaForViewKey, type LegacyViewKey } from "@/domain/workspace/areas";
import type { AIBootstrapView } from "@/domain/ai";

export function AssistenteClient({ initialBootstrap, projectId }: { initialBootstrap: AIBootstrapView; projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const promptParam = searchParams.get("prompt") ?? undefined;

  useEffect(() => {
    if (!promptParam) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("prompt");
    window.history.replaceState({}, "", url.pathname + url.search);
  }, [promptParam]);

  function handleNavigate(module: string) {
    const area = findAreaForViewKey(module as LegacyViewKey);
    if (area) router.push(area.path);
  }

  return (
    <RedeAIView
      initialBootstrap={initialBootstrap}
      projectId={projectId}
      currentModule="ai"
      initialPrompt={promptParam}
      onPromptConsumed={() => {}}
      onNavigate={handleNavigate}
    />
  );
}
