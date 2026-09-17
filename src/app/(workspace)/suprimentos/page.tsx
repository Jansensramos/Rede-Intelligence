import { requireAuthContext } from "@/application/auth/session";
import { getContractControl, getServiceOrderMeasurementAvailability } from "@/application/procurement/contract-control-service";
import { getProcurementOperabilityMetadata } from "@/application/procurement/procurement-operability-service";
import { getProcurementWorkspace } from "@/application/procurement/procurement-service";
import { getServiceOrders } from "@/application/procurement/service-order-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { Contract360MeasurementPanel } from "@/components/contract-360-measurement-panel";
import { ProcurementContractOperabilityPanel } from "@/components/procurement-contract-operability-panel";
import { ProcurementOperabilityPanel } from "@/components/procurement-operability-panel";
import { ProcurementView } from "@/components/procurement-view";
import { ServiceOrderOperabilityPanel } from "@/components/service-order-operability-panel";
import { SectionTitle } from "@/components/ui";

export default async function SuprimentosPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const [workspace, operability, serviceOrders, contractControl, serviceOrderMeasurements] = await Promise.all([
    getProcurementWorkspace(authContext, context.project.id),
    getProcurementOperabilityMetadata(authContext, context.project.id),
    getServiceOrders(authContext, context.project.id),
    getContractControl(authContext, context.project.id),
    getServiceOrderMeasurementAvailability(authContext, context.project.id),
  ]);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="SUPRIMENTOS E CONTRATAÇÃO"
        title="Da necessidade de compra ao pagamento"
        description="Planeje a compra, compare propostas, formalize o compromisso, autorize a execução por ordem de serviço e acompanhe medição, obrigação e pagamento."
      />
      <ProcurementOperabilityPanel workspace={workspace} operability={operability} />
      <ProcurementContractOperabilityPanel workspace={workspace} operability={operability} />
      <ServiceOrderOperabilityPanel projectId={context.project.id} operability={operability} serviceOrders={serviceOrders} />
      <Contract360MeasurementPanel workspace={workspace} contracts={contractControl} serviceOrders={serviceOrderMeasurements} />
      <ProcurementView workspace={workspace} />
    </div>
  );
}