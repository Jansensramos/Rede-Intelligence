"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/application/auth/session";
import { decideIntegrationConflict, getIntegrationsWorkspace, reprocessQuarantineItem, runConnectorSync } from "@/application/integrations/integrations-service";
import { MockGoogleDriveConnector } from "@/domain/integrations";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const message = (error: unknown) => (error instanceof Error ? error.message : "Não foi possível concluir a operação de integrações.");

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    revalidatePath("/");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function refreshIntegrationsWorkspaceAction(projectId: string) {
  const context = await requireAuthContext();
  return run(() => getIntegrationsWorkspace(context, projectId));
}

export async function resolveIntegrationConflictAction(projectId: string, conflictId: string, decision: "APPLY_EXTERNAL" | "KEEP_LOCAL", notes?: string) {
  const context = await requireAuthContext();
  return run(async () => {
    await decideIntegrationConflict(context, conflictId, { decision, notes });
    return getIntegrationsWorkspace(context, projectId);
  });
}

export async function reprocessQuarantineItemAction(projectId: string, quarantineId: string, discard: boolean, notes?: string) {
  const context = await requireAuthContext();
  return run(async () => {
    await reprocessQuarantineItem(context, quarantineId, { discard, notes });
    return getIntegrationsWorkspace(context, projectId);
  });
}

/** Demonstração de "Sincronizar agora": só o mock do Google Drive tem execução manual nesta fase. */
export async function syncMockDriveInstallationAction(projectId: string, installationId: string) {
  const context = await requireAuthContext();
  return run(async () => {
    const files = [
      { externalId: "drive-file-memorial", versionId: "v1", name: "Memorial descritivo — START BUTANTÃ.pdf", mimeType: "application/pdf", size: 812_400, webUrl: "https://drive.example.com/file/drive-file-memorial", checksum: `manual-sync-${Date.now()}`, modifiedAt: new Date() },
    ];
    await runConnectorSync(context, installationId, { mode: "MANUAL", capability: "DOCUMENTS", connector: new MockGoogleDriveConnector(files) });
    return getIntegrationsWorkspace(context, projectId);
  });
}
