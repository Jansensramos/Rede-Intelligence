import type { MembershipRole } from "@prisma/client";

export type IntegrationCapability =
  | "INTEGRATION_VIEW" | "INTEGRATION_CONFIGURE" | "INTEGRATION_SYNC" | "INTEGRATION_RETRY"
  | "INTEGRATION_CREDENTIALS" | "INTEGRATION_APPROVE" | "INTEGRATION_AUDIT" | "INTEGRATION_EXPORT" | "INTEGRATION_API_MANAGE";

const readOnly: IntegrationCapability[] = ["INTEGRATION_VIEW", "INTEGRATION_AUDIT"];
const matrix: Record<MembershipRole, IntegrationCapability[]> = {
  OWNER: ["INTEGRATION_VIEW", "INTEGRATION_CONFIGURE", "INTEGRATION_SYNC", "INTEGRATION_RETRY", "INTEGRATION_CREDENTIALS", "INTEGRATION_APPROVE", "INTEGRATION_AUDIT", "INTEGRATION_EXPORT", "INTEGRATION_API_MANAGE"],
  ADMIN: ["INTEGRATION_VIEW", "INTEGRATION_CONFIGURE", "INTEGRATION_SYNC", "INTEGRATION_RETRY", "INTEGRATION_CREDENTIALS", "INTEGRATION_APPROVE", "INTEGRATION_AUDIT", "INTEGRATION_EXPORT"],
  ANALYST: ["INTEGRATION_VIEW", "INTEGRATION_CONFIGURE", "INTEGRATION_SYNC", "INTEGRATION_RETRY", "INTEGRATION_AUDIT"],
  REVIEWER: ["INTEGRATION_VIEW", "INTEGRATION_APPROVE", "INTEGRATION_AUDIT"],
  VIEWER: readOnly,
};

export function hasIntegrationCapability(role: MembershipRole, capability: IntegrationCapability) {
  return matrix[role].includes(capability);
}

export function assertIntegrationCapability(role: MembershipRole, capability: IntegrationCapability) {
  if (!hasIntegrationCapability(role, capability)) throw new Error(`A função ${role} não possui a capacidade ${capability}.`);
}
