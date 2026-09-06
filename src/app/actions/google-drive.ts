"use server";

import { requireDomainActionContext } from "./authorization";
import { createGoogleDriveInstallation, configureGoogleDriveInstallation, googleDriveProviderForInstallation, getGoogleDriveConfiguration } from "@/application/integrations/google-drive-service";
import { assertIntegrationCapability } from "@/domain/integrations";
import { enqueueJob } from "@/application/integrations/job-runner";

export async function createGoogleDriveInstallationAction(input: { name: string; projectId: string; driveId: string; folderId?: string }) {
  const context = await requireDomainActionContext("INTEGRATIONS_READ");
  return createGoogleDriveInstallation(context, input);
}
export async function configureGoogleDriveInstallationAction(installationId: string, configuration: { mode: "DISABLED" | "MOCK" | "REAL"; driveId: string; folderId?: string }) {
  const context = await requireDomainActionContext("INTEGRATIONS_READ");
  return configureGoogleDriveInstallation(context, installationId, configuration);
}
export async function getGoogleDriveConfigurationAction(installationId: string) {
  const context = await requireDomainActionContext("INTEGRATIONS_READ");
  return getGoogleDriveConfiguration(context, installationId);
}
export async function syncGoogleDriveInstallationAction(installationId: string) {
  const context = await requireDomainActionContext("INTEGRATIONS_READ");
  assertIntegrationCapability(context.role, "INTEGRATION_SYNC");
  // This resolves configuration and the vault only, without calling the provider.
  await googleDriveProviderForInstallation(context, installationId);
  const job = await enqueueJob({ organizationId: context.organizationId, installationId, jobType: "SYNC_INSTALLATION", payload: { capability: "DOCUMENTS" } });
  return { id: job.id, status: job.status };
}
