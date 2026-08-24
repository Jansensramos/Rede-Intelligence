import { requireAuthContext } from "@/application/auth/session";
import { getIntegrationsWorkspace } from "@/application/integrations/integrations-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { IntegracoesClient } from "@/components/areas/integracoes-client";
import { SectionTitle } from "@/components/ui";

/** Fase 9K.1 — área Integrações: rota real, busca só o workspace de Integrações (ordem de serviço §16). */
export default async function IntegracoesPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getIntegrationsWorkspace(authContext, context.project.id);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="CENTRAL DE INTEGRAÇÕES"
        title="Conectores, sincronização e proveniência"
        description="Grupo, empresa, SPE e empreendimento em uma visão só: quem é o dono do dado, de onde veio, quando foi atualizado e se está em conflito."
      />
      {/* Fechamento 9K.1: `key` por projeto — ver comentário em viabilidade/page.tsx. */}
      <IntegracoesClient key={context.project.id} initialWorkspace={workspace} projectId={context.project.id} />
    </div>
  );
}
