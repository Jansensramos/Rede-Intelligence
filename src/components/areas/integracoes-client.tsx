"use client";

import { useState } from "react";
import { IntegrationsView } from "@/components/integrations-view";
import type { IntegrationsWorkspaceView } from "@/application/integrations/integrations-service";

/** Fase 9K.1 — wrapper client mínimo: `IntegrationsView` já muda o próprio workspace localmente após mutações. */
export function IntegracoesClient({ initialWorkspace, projectId }: { initialWorkspace: IntegrationsWorkspaceView; projectId: string }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  return <IntegrationsView initialWorkspace={workspace} projectId={projectId} onWorkspaceChange={setWorkspace} />;
}
