import { requireAuthContext } from "@/application/auth/session";
import { getProcurementOperabilityMetadata } from "@/application/procurement/procurement-operability-service";
import { getProcurementWorkspace } from "@/application/procurement/procurement-service";
import { getServiceOrders } from "@/application/procurement/service-order-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { ProcurementContractOperabilityPanel } from "@/components/procurement-contract-operability-panel";
import { ProcurementOperabilityPanel } from "@/components/procurement-operability-panel";
import { ProcurementView } from "@/components/procurement-view";
import { ServiceOrderOperabilityPanel } from "@/components/service-order-operability-panel";
import { SectionTitle } from "@/components/ui";

export default async function SuprimentosPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const [workspace, operability, serviceOrders] = await Promise.all([
    getProcurementWorkspace(authContext, context.project.id),
    getProcurementOperabilityMetadata(authContext, context.project.id),
    getServiceOrders(authContext, context.project.id),
  ]);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="SUPRIMENTOS E CONTRATAÇÃO"
        title="Da necessidade de compra à medição aprovada"
        description="Planeje a compra, compare propostas, formalize o compromisso, autorize a execução por ordem de serviço e acompanhe a medição até a obrigação financeira."
      />
      <ProcurementOperabilityPanel workspace={workspace} operability={operability} />
      <ProcurementContractOperabilityPanel workspace={workspace} operability={operability} />
      <ServiceOrderOperabilityPanel projectId={context.project.id} operability={operability} serviceOrders={serviceOrders} />
      <ProcurementView workspace={workspace} />
    </div>
  );
}
