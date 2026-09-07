"use server";
import { requireDomainActionContext } from "./authorization";
import { createFinancialInstallation, configureFinancialInstallation, enqueueFinancialOperation, listFinancialJobs, listFinancialEvidence, readFinancialEvidence, purgeFinancialEvidence, retryFinancialJob } from "@/application/integrations/financial-provider-service";
export async function createFinancialInstallationAction(input: { name: string; projectId: string; capability: "BANK" | "BUREAU" | "FUNDING"; retentionDays: number }) { return createFinancialInstallation(await requireDomainActionContext("INTEGRATIONS_READ"), input); }
export async function configureFinancialInstallationAction(id: string, config: unknown) { return configureFinancialInstallation(await requireDomainActionContext("INTEGRATIONS_READ"), id, config); }
export async function enqueueFinancialOperationAction(id: string, request: unknown) { return enqueueFinancialOperation(await requireDomainActionContext("INTEGRATIONS_READ"), id, request); }
export async function listFinancialJobsAction(id: string) { return listFinancialJobs(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
export async function listFinancialEvidenceAction(id: string) { return listFinancialEvidence(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
export async function readFinancialEvidenceAction(installationId: string, id: string) { return readFinancialEvidence(await requireDomainActionContext("INTEGRATIONS_READ"), installationId, id); }
export async function purgeFinancialEvidenceAction(id: string) { return purgeFinancialEvidence(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
export async function retryFinancialJobAction(id: string) { return retryFinancialJob(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
