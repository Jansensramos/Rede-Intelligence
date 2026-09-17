import { requireAuthContext } from "@/application/auth/session";
import { getSalesWorkspace } from "@/application/sales/sales-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { SalesOperabilityPanel } from "@/components/sales-operability-panel";
import { SalesView } from "@/components/sales-view";
import { SectionTitle } from "@/components/ui";

export default async function ComercialPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getSalesWorkspace(authContext, context.project.id);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="COMERCIAL"
        title="Clientes, propostas, reservas e vendas"
        description="Conduza a operação comercial do empreendimento desde o primeiro contato até a formalização da venda e geração dos recebíveis."
      />
      <SalesOperabilityPanel workspace={workspace} />
      <SalesView workspace={workspace} />
    </div>
  );
}
