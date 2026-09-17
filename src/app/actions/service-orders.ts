"use server";

import { revalidatePath } from "next/cache";
import { requireDomainApprovalContext, requireDomainWriteContext } from "./authorization";
import {
  createServiceOrder,
  linkMeasurementToServiceOrder,
  transitionServiceOrder,
  type CreateServiceOrderInput,
  type ServiceOrderStatus,
} from "@/application/procurement/service-order-service";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const message = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação.";

async function run<T>(op: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await op();
    revalidatePath("/suprimentos");
    revalidatePath("/engenharia-obra");
    revalidatePath("/financeiro");
    revalidatePath("/executivo");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function createServiceOrderAction(input: CreateServiceOrderInput) {
  const context = await requireDomainWriteContext("PROCUREMENT_READ", "PROCUREMENT_WRITE");
  return run(() => createServiceOrder(context, input));
}

export async function transitionServiceOrderAction(serviceOrderId: string, to: ServiceOrderStatus, reason?: string) {
  const context = to === "APPROVED"
    ? await requireDomainApprovalContext("PROCUREMENT_READ", "PROCUREMENT_APPROVE")
    : await requireDomainWriteContext("PROCUREMENT_READ", "PROCUREMENT_WRITE");
  return run(() => transitionServiceOrder(context, serviceOrderId, to, reason));
}

export async function linkMeasurementToServiceOrderAction(measurementId: string, serviceOrderId: string) {
  const context = await requireDomainWriteContext("PROCUREMENT_READ", "PROCUREMENT_WRITE");
  return run(() => linkMeasurementToServiceOrder(context, measurementId, serviceOrderId));
}
