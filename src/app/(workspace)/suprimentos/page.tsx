import { requireAuthContext } from "@/application/auth/session";
import { getProcurementOperabilityMetadata } from "@/application/procurement/procurement-operability-service";
import { getProcurementWorkspace } from "@/application/procurement/procurement-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { ProcurementContractOperabilityPanel } from "@/components/procurement-contract-operability-panel";
import { ProcurementOperabilityPanel } from "@/components/procurement-operability-panel";
import { ProcurementView } from "@/components/procurement-view";
import { SectionTitle } from "@/components/ui";

export default async function SuprimentosPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const [workspace, operability] = await Promise.all([
    getProcurementWorkspace(authContext, context.project.id),
    getProcurementOperabilityMetadata(authContext, context.project.id),
  ]);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="SUPRIMENTOS E CONTRATAÇÃO"
        title="Da necessidade de compra à medição aprovada"
        description="Planeje a compra, compare propostas, formalize o compromisso e acompanhe a execução até a geração da obrigação financeira."
      />
      <ProcurementOperabilityPanel workspace={workspace} operability={operability} />
      <ProcurementContractOperabilityPanel workspace={workspace} operability={operability} />
      <ProcurementView workspace={workspace} />
    </div>
  );
}
