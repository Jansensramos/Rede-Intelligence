import { requireAuthContext } from "@/application/auth/session";
import { getPeoplePerformanceWorkspace } from "@/application/people-performance/people-performance-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { PeoplePerformanceView } from "@/components/people-performance-view";
import { SectionTitle } from "@/components/ui";

/** Fase 9K.1 — área Pessoas: rota real, busca só o workspace de Pessoas (ordem de serviço §16). */
export default async function PessoasPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getPeoplePerformanceWorkspace(authContext, context.project.id);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="PESSOAS, ADMINISTRAÇÃO E EFICIÊNCIA"
        title="Estrutura → Capacidade → Desempenho → Causa-raiz → Ação"
        description="Leitura integrada ao orçamento, cronograma, medições e realizado, com remuneração restrita e economia somente quando validada."
      />
      <PeoplePerformanceView workspace={workspace} />
    </div>
  );
}
