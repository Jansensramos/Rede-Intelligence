"use server";

import { revalidatePath } from "next/cache";
import { requireDomainActionContext } from "./authorization";
import {
  createEmploymentRelationship,
  createWorkAllocation,
  recordRelationshipCost,
} from "@/application/people-performance/people-performance-service";
import { assertProtectedWriteCapability } from "@/domain/auth/write-capabilities";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível concluir a operação de Pessoas.";

async function run<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = JSON.parse(JSON.stringify(await operation())) as T;
    revalidatePath("/pessoas");
    revalidatePath("/acoes");
    revalidatePath("/executivo");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function createEmploymentRelationshipAction(
  input: Parameters<typeof createEmploymentRelationship>[1],
) {
  const context = await requireDomainActionContext("PEOPLE_READ");
  assertProtectedWriteCapability(context.role, "PEOPLE_WRITE");
  return run(() => createEmploymentRelationship(context, input));
}

export async function createWorkAllocationAction(
  input: Parameters<typeof createWorkAllocation>[1],
) {
  const context = await requireDomainActionContext("PEOPLE_READ");
  assertProtectedWriteCapability(context.role, "PEOPLE_WRITE");
  return run(() => createWorkAllocation(context, input));
}

export async function recordRelationshipCostAction(
  input: Parameters<typeof recordRelationshipCost>[1],
) {
  const context = await requireDomainActionContext("PEOPLE_READ");
  assertProtectedWriteCapability(context.role, "PEOPLE_WRITE");
  return run(() => recordRelationshipCost(context, input));
}
