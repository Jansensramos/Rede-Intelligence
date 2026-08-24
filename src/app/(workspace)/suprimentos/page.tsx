import { requireAuthContext } from "@/application/auth/session";
import { getProcurementWorkspace } from "@/application/procurement/procurement-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { ProcurementView } from "@/components/procurement-view";
import { SectionTitle } from "@/components/ui";

/** Fase 9K.1 — área Suprimentos: rota real, busca só o workspace de Suprimentos (ordem de serviço §16). */
export default async function SuprimentosPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getProcurementWorkspace(authContext, context.project.id);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="SUPRIMENTOS, CONTRATOS E MEDIÇÕES"
        title="Do planejamento à execução contratual"
        description="Necessidade → requisição → cotação → contrato → medição → obrigação, sem dupla contagem."
      />
      <ProcurementView workspace={workspace} />
    </div>
  );
}
