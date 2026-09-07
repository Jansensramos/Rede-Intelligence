"use server";
import { requireDomainActionContext } from "./authorization";
import { createEmailInstallation, configureEmailInstallation, enqueueEmail, listEmailJobs, retryEmailJob } from "@/application/integrations/transactional-email-service";
export async function createEmailInstallationAction(name: string) { return createEmailInstallation(await requireDomainActionContext("INTEGRATIONS_READ"), name); }
export async function configureEmailInstallationAction(id: string, config: unknown) { return configureEmailInstallation(await requireDomainActionContext("INTEGRATIONS_READ"), id, config); }
export async function enqueueEmailAction(id: string, input: unknown) { return enqueueEmail(await requireDomainActionContext("INTEGRATIONS_READ"), id, input); }
export async function listEmailJobsAction(id: string) { return listEmailJobs(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
export async function retryEmailJobAction(id: string) { return retryEmailJob(await requireDomainActionContext("INTEGRATIONS_READ"), id); }
