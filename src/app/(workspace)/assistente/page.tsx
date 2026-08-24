import { Suspense } from "react";
import { requireAuthContext } from "@/application/auth/session";
import { getAIBootstrap } from "@/application/ai/ai-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { AssistenteClient } from "@/components/areas/assistente-client";
import { Loading } from "@/components/ui";

/** Fase 9K.1 — rota `/assistente` (transversal, ordem de serviço §6): mesmo projectId do OperationalContext. */
export default async function AssistentePage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const bootstrap = await getAIBootstrap(authContext, context.project.id, "ai");

  return (
    <Suspense fallback={<Loading label="Carregando REDE AI…" />}>
      {/* Fechamento 9K.1: `key` por projeto — sem isso, `RedeAIView` (`useState(initialBootstrap)`)
          preserva a conversa/projeto ANTERIOR depois de uma troca de contexto seguida de
          `router.refresh()`. Ver comentário completo em viabilidade/page.tsx e o relatório de
          fechamento (QA "REDE AI preservando projectId"). */}
      <AssistenteClient key={context.project.id} initialBootstrap={bootstrap} projectId={context.project.id} />
    </Suspense>
  );
}
