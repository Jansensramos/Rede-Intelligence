import { requireAuthContext } from "@/application/auth/session";
import { assertProtectedReadCapability, type ProtectedReadCapability } from "@/domain/auth/read-capabilities";

/** Gate comum para Server Actions: autenticação primeiro, capability de domínio imediatamente depois. */
export async function requireDomainActionContext(capability: ProtectedReadCapability) {
  const context = await requireAuthContext();
  assertProtectedReadCapability(context.role, capability);
  return context;
}
