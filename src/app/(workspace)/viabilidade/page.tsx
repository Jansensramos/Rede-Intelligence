import { Suspense } from "react";
import { requireAuthContext } from "@/application/auth/session";
import { getLatestStudyForProject } from "@/application/studies/study-service";
import { getLatestLandStudyForProject } from "@/application/land/land-service";
import { ensureInvestmentCase } from "@/application/investment/investment-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { ViabilidadeWorkspace } from "@/components/areas/viabilidade-workspace";
import { Loading } from "@/components/ui";

/**
 * Fase 9K.1 — área Viabilidade: busca só Estudo, Terreno e Investment Case (ordem de serviço §16).
 * Design/Orçamento/Financeiro/Suprimentos/Jurídico/Comercial/Pessoas/Contabilidade/Integrações/
 * Dados/Mercado vivem nas próprias áreas — nenhum deles é buscado aqui.
 */
export default async function ViabilidadePage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const projectId = context.project.id;

  const initialStudy = await getLatestStudyForProject(authContext.organizationId, projectId);
  if (!initialStudy) throw new Error("Este empreendimento ainda não tem um estudo ativo. Crie um estudo (\"Novo estudo\", nesta área) ou execute o seed.");

  // Fechamento 9K.1 (revisão pós-fechamento): escopado por projeto (`getLatestLandStudyForProject`),
  // nunca "o terreno mais recente da organização" — evita mostrar o terreno de outro projeto da
  // mesma organização. `initialLand` pode ser `null` (projeto sem Land Asset vinculado ainda); a
  // aba Terreno trata isso como estado vazio, não como erro (ver ViabilidadeWorkspace).
  const [initialLand, initialInvestment] = await Promise.all([
    getLatestLandStudyForProject(authContext.organizationId, projectId),
    ensureInvestmentCase(authContext, projectId),
  ]);

  return (
    <Suspense fallback={<Loading label="Carregando Viabilidade…" />}>
      {/* Fechamento 9K.1: `key={projectId}` força remount ao trocar de empreendimento — sem isso,
          `useState(initialStudy)`/`useState(initialLand)`/`useState(initialInvestment)` preservam o
          projeto ANTERIOR depois de um `router.refresh()` (React só usa o valor inicial no primeiro
          mount; props novas não re-sincronizam state derivado). Ver relatório de fechamento da 9K.1. */}
      <ViabilidadeWorkspace key={projectId} initialStudy={initialStudy} initialLand={initialLand} initialInvestment={initialInvestment} />
    </Suspense>
  );
}
