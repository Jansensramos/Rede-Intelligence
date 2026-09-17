import { requireAuthContext } from "@/application/auth/session";
import { getSalesWorkspace } from "@/application/sales/sales-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { SalesOperabilityPanel } from "@/components/sales-operability-panel";
import { SalesView } from "@/components/sales-view";
import { SectionTitle } from "@/components/ui";

/** Fase 10C.1 — Comercial com operação humana sobre o domínio existente. */
export default async function ComercialPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getSalesWorkspace(authContext, context.project.id);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="VENDAS, CLIENTES E RECEBÍVEIS"
        title="Unidade → Tabela → Proposta → Reserva → Venda → Contrato → Recebíveis"
        description="Estoque, preço, comissão, entrega e pós-venda conectados ao Financeiro sem financeiro paralelo nem dupla contagem."
      />
      <SalesOperabilityPanel workspace={workspace} />
      <SalesView workspace={workspace} />
    </div>
  );
}
