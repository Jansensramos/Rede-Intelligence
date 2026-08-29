import type { MembershipRole } from "@prisma/client";

export type LaunchIntelligenceCapability = "VIEW" | "OBSERVATION_MANAGE" | "SCENARIO_CREATE" | "TRIGGER_MANAGE" | "DECIDE";

const matrix: Record<MembershipRole, LaunchIntelligenceCapability[]> = {
  OWNER: ["VIEW", "OBSERVATION_MANAGE", "SCENARIO_CREATE", "TRIGGER_MANAGE", "DECIDE"],
  ADMIN: ["VIEW", "OBSERVATION_MANAGE", "SCENARIO_CREATE", "TRIGGER_MANAGE", "DECIDE"],
  ANALYST: ["VIEW", "OBSERVATION_MANAGE", "SCENARIO_CREATE"],
  REVIEWER: ["VIEW", "DECIDE"],
  VIEWER: ["VIEW"],
};

export function hasLaunchIntelligenceCapability(role: MembershipRole, capability: LaunchIntelligenceCapability) {
  return matrix[role].includes(capability);
}

export function assertLaunchIntelligenceCapability(role: MembershipRole, capability: LaunchIntelligenceCapability) {
  if (!hasLaunchIntelligenceCapability(role, capability)) throw new Error("Seu perfil não possui autorização para esta operação de Inteligência de Lançamento.");
}
