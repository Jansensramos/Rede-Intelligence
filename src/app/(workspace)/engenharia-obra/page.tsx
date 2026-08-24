import { Suspense } from "react";
import { requireAuthContext } from "@/application/auth/session";
import { ensureDesignWorkspace } from "@/application/design/design-service";
import { getLatestProjectBudget } from "@/application/budget/budget-service";
import { getOperationsWorkspace } from "@/application/operations/operations-service";
import { getLatestStudyForProject } from "@/application/studies/study-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { EngenhariaObraWorkspace } from "@/components/areas/engenharia-obra-workspace";
import { Loading } from "@/components/ui";
import { calculateAllScenarios } from "@/domain/financial/engine";

/** Fase 9K.1 — área Engenharia e Obra: busca só Design, Orçamento e Operações (ordem de serviço §16). */
export default async function EngenhariaObraPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const projectId = context.project.id;

  const study = await getLatestStudyForProject(authContext.organizationId, projectId);
  const baseVgv = study ? calculateAllScenarios(study.assumptions).base.metrics.vgv : undefined;

  const [design, budget, operations] = await Promise.all([
    ensureDesignWorkspace(authContext, projectId),
    getLatestProjectBudget(authContext, projectId, baseVgv),
    getOperationsWorkspace(authContext, projectId),
  ]);

  return (
    <Suspense fallback={<Loading label="Carregando Engenharia e Obra…" />}>
      {/* Fechamento 9K.1: `key` por projeto — ver comentário em viabilidade/page.tsx. */}
      <EngenhariaObraWorkspace key={projectId} initialDesign={design} initialBudget={budget} operations={operations} />
    </Suspense>
  );
}
