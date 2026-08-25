import { requireAuthContext } from "@/application/auth/session";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { getActionCenterOverview } from "@/application/actions/action-service";
import { CentralDeAcoesView } from "@/components/areas/central-acoes-view";

/**
 * Fase 9K.3 — Central de Ações (ordem de serviço §4). Mesmo empreendimento ativo do contexto
 * operacional (9K.0/9K.1) usado pela Gestão Executiva — nunca uma segunda resolução de contexto.
 */
export default async function AcoesPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;

  const overview = await getActionCenterOverview(authContext, {
    id: context.project.id,
    name: context.project.name,
    city: context.project.city,
    state: context.project.state,
    companyId: context.company?.id ?? null,
    companyName: context.company?.name ?? null,
    economicGroupId: context.economicGroup?.id ?? null,
    economicGroupName: context.economicGroup?.name ?? null,
  });

  return <CentralDeAcoesView overview={overview} currentUserId={authContext.userId} />;
}
