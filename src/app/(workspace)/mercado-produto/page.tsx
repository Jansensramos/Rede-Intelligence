import { Suspense } from "react";
import { requireAuthContext } from "@/application/auth/session";
import { buildMarketProductWorkspaceView, getMarketProductWorkspace } from "@/application/market-product";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { MercadoProdutoWorkspace } from "@/components/areas/mercado-produto-workspace";
import { Loading } from "@/components/ui";

/** Fase 9K.1 — área Mercado e Produto: rota real, busca só o workspace de Mercado/Produto (ordem de serviço §16). */
export default async function MercadoProdutoPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getMarketProductWorkspace(authContext, context.project.id);
  const view = buildMarketProductWorkspaceView(workspace);

  return (
    <Suspense fallback={<Loading label="Carregando Mercado e Produto…" />}>
      {/* Fechamento 9K.1: `key` por projeto — ver comentário em viabilidade/page.tsx. */}
      <MercadoProdutoWorkspace key={context.project.id} initialWorkspace={view} role={authContext.role} />
    </Suspense>
  );
}
