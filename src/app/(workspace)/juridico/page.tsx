import { requireAuthContext } from "@/application/auth/session";
import { getLegalWorkspace } from "@/application/legal/legal-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { LegalOperabilityPanel } from "@/components/legal-operability-panel";
import { LegalView } from "@/components/legal-view";
import { SectionTitle } from "@/components/ui";

/** Fase 10C.1 — Jurídico com operação humana sobre o domínio existente. */
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
      <LegalOperabilityPanel workspace={workspace} />
      <LegalView workspace={workspace} />
    </div>
  );
}
