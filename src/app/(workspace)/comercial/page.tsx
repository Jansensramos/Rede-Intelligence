import { requireAuthContext } from "@/application/auth/session";
import { getSalesWorkspace } from "@/application/sales/sales-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { SalesOperabilityPanel } from "@/components/sales-operability-panel";
import { CommercialLifecycleOperabilityPanel } from "@/components/commercial-lifecycle-operability-panel";
import { SalesView } from "@/components/sales-view";
import { SectionTitle } from "@/components/ui";
import { hasProtectedApprovalCapability, hasProtectedWriteCapability } from "@/domain/auth/write-capabilities";

export default async function ComercialPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getSalesWorkspace(authContext, context.project.id);
  const canWrite = hasProtectedWriteCapability(authContext.role, "COMMERCIAL_WRITE");
  const canApprove = hasProtectedApprovalCapability(authContext.role, "COMMERCIAL_APPROVE");

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="COMERCIAL"
        title="Clientes, propostas, reservas e vendas"
        description="Conduza a operação comercial do empreendimento desde o primeiro contato até a formalização da venda e geração dos recebíveis."
      />
      <SalesOperabilityPanel workspace={workspace} canWrite={canWrite} canApprove={canApprove} />
      <CommercialLifecycleOperabilityPanel workspace={workspace} canWrite={canWrite} canApprove={canApprove} />
      <SalesView workspace={workspace} canWrite={canWrite} canApprove={canApprove} />
    </div>
  );
}
