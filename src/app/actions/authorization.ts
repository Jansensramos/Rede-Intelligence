import { requireAuthContext } from "@/application/auth/session";
import { assertProtectedReadCapability, type ProtectedReadCapability } from "@/domain/auth/read-capabilities";
import {
  assertProtectedApprovalCapability,
  assertProtectedWriteCapability,
  type ProtectedApprovalCapability,
  type ProtectedWriteCapability,
} from "@/domain/auth/write-capabilities";

/** Gate de leitura: autenticação e capability de domínio. */
export async function requireDomainActionContext(capability: ProtectedReadCapability) {
  const context = await requireAuthContext();
  assertProtectedReadCapability(context.role, capability);
  return context;
}

/** Gate explícito de mutação humana — nunca autoriza VIEWER/REVIEWER a gravar só porque conseguem ler. */
export async function requireDomainWriteContext(readCapability: ProtectedReadCapability, writeCapability: ProtectedWriteCapability) {
  const context = await requireDomainActionContext(readCapability);
  assertProtectedWriteCapability(context.role, writeCapability);
  return context;
}

/** Gate explícito de alçada para aprovações materiais. Regras mais restritivas continuam no service. */
export async function requireDomainApprovalContext(readCapability: ProtectedReadCapability, approvalCapability: ProtectedApprovalCapability) {
  const context = await requireDomainActionContext(readCapability);
  assertProtectedApprovalCapability(context.role, approvalCapability);
  return context;
}
