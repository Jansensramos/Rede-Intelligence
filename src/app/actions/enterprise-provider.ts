"use server";
import { requireDomainActionContext } from "./authorization";
import { createEnterpriseInstallation, configureEnterpriseInstallation, bindEnterpriseEntity, enqueueEnterpriseSync, listEnterpriseJobs, listEnterpriseBindings, listEnterpriseEvidence, readEnterpriseEvidence, reviewEnterpriseEvidence, listEnterpriseQuarantine, readEnterpriseQuarantine, retryEnterpriseJob, purgeEnterpriseEvidence, type CreateEnterpriseInstallation } from "@/application/integrations/enterprise-provider-service";
export async function createEnterpriseInstallationAction(input: CreateEnterpriseInstallation) { return createEnterpriseInstallation(await requireDomainActionContext("INTEGRATIONS_READ"), input); }
export async function configureEnterpriseInstallationAction(id: string, config: unknown) { return configureEnterpriseInstallation(await requireDomainActionContext("INTEGRATIONS_READ"), id, config); }
export async function bindEnterpriseEntityAction(id: string, input: unknown) { return bindEnterpriseEntity(await requireDomainActionContext("INTEGRATIONS_READ"), id, input); }
export async function enqueueEnterpriseSyncAction(id: string, input: unknown) { return enqueueEnterpriseSync(await requireDomainActionContext("INTEGRATIONS_READ"), id, input); }
export async function listEnterpriseJobsAction(id: string) { return listEnterpriseJobs(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
export async function listEnterpriseBindingsAction(id: string) { return listEnterpriseBindings(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
export async function listEnterpriseEvidenceAction(id: string) { return listEnterpriseEvidence(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
export async function readEnterpriseEvidenceAction(installationId: string, id: string) { return readEnterpriseEvidence(await requireDomainActionContext("INTEGRATIONS_READ"), installationId, id); }
export async function reviewEnterpriseEvidenceAction(installationId: string, id: string, decision: "PROPOSE_REVISION" | "REJECT") { return reviewEnterpriseEvidence(await requireDomainActionContext("INTEGRATIONS_READ"), installationId, id, decision); }
export async function listEnterpriseQuarantineAction(id: string) { return listEnterpriseQuarantine(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
export async function readEnterpriseQuarantineAction(installationId: string, id: string) { return readEnterpriseQuarantine(await requireDomainActionContext("INTEGRATIONS_READ"), installationId, id); }
export async function retryEnterpriseJobAction(id: string) { return retryEnterpriseJob(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
export async function purgeEnterpriseEvidenceAction(id: string) { return purgeEnterpriseEvidence(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
