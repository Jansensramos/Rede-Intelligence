import { requireAuthContext } from "@/application/auth/session";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { getActionCenterOverview } from "@/application/actions/action-service";
import { MinhaRotinaView } from "@/components/areas/minha-rotina-view";

/**
 * Fase 9K.3 — Minha Rotina (ordem de serviço §5, "O que eu preciso fazer hoje?"). Reaproveita a
 * mesma leitura da Central de Ações (`getActionCenterOverview`) — a diferença é só a composição em
 * `buildMyRoutineBuckets` (domínio, sem I/O), nunca uma segunda consulta redundante.
 */
export default async function RotinaPage() {
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

  return <MinhaRotinaView overview={overview} currentUserId={authContext.userId} currentUserRole={authContext.role} />;
}
