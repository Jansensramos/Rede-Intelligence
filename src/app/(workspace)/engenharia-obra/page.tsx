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

  // Fechamento 9K.1 (revisão): só o orçamento depende do estudo (via `baseVgv`) — Design e
  // Operações não dependem de nada aqui além do projectId, então não há razão para esperar o
  // estudo terminar antes de disparar as três buscas. Antes, o `await` do estudo bloqueava as
  // outras duas desnecessariamente, serializando 3 round-trips independentes ao banco.
  const [study, design, operations] = await Promise.all([
    getLatestStudyForProject(authContext.organizationId, projectId),
    ensureDesignWorkspace(authContext, projectId),
    getOperationsWorkspace(authContext, projectId),
  ]);
  const baseVgv = study ? calculateAllScenarios(study.assumptions).base.metrics.vgv : undefined;
  const budget = await getLatestProjectBudget(authContext, projectId, baseVgv);

  return (
    <Suspense fallback={<Loading label="Carregando Engenharia e Obra…" />}>
      {/* Fechamento 9K.1: `key` por projeto — ver comentário em viabilidade/page.tsx. */}
      <EngenhariaObraWorkspace key={projectId} initialDesign={design} initialBudget={budget} operations={operations} />
    </Suspense>
  );
}
