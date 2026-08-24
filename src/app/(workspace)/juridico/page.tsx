import { requireAuthContext } from "@/application/auth/session";
import { getLegalWorkspace } from "@/application/legal/legal-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { LegalView } from "@/components/legal-view";
import { SectionTitle } from "@/components/ui";

/** Fase 9K.1 — área Jurídico: rota real, busca só o workspace Jurídico (ordem de serviço §16). */
export default async function JuridicoPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getLegalWorkspace(authContext, context.project.id);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="JURÍDICO, DILIGÊNCIA E OBRIGAÇÕES"
        title="Central Jurídica do Empreendimento"
        description="Imóvel, evidências, riscos, licenças, prazos e impactos conectados à decisão, ao cronograma e ao Financeiro."
      />
      <LegalView workspace={workspace} />
    </div>
  );
}
