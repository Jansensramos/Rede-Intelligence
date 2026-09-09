"use server";
import { requireDomainActionContext } from "./authorization";
import { attestLocalOnboarding } from "@/application/release/local-readiness-service";
export async function attestLocalOnboardingAction(input: unknown) {
  const context = await requireDomainActionContext("HELP_READ");
  try { await attestLocalOnboarding(context, input); return { ok: true, message: "Confirmação local registrada. Produção permanece pendente." }; }
  catch { return { ok: false, message: "Não foi possível confirmar. Confira seu acesso e conclua os registros e etapas anteriores." }; }
}
