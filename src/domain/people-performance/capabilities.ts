import type { MembershipRole } from "@prisma/client";

export type PeopleCapability =
  | "PEOPLE_READ"
  | "PEOPLE_MANAGE"
  | "COMPENSATION_READ"
  | "COMPENSATION_MANAGE"
  | "ALLOCATION_MANAGE"
  | "EFFICIENCY_ANALYZE"
  | "ROOT_CAUSE_MANAGE"
  | "ACTION_APPROVE"
  | "ACTION_VERIFY"
  | "INCENTIVE_SIMULATE"
  | "INCENTIVE_APPROVE";

const roleCapabilities: Record<MembershipRole, ReadonlySet<PeopleCapability>> = {
  VIEWER: new Set(["PEOPLE_READ"]),
  REVIEWER: new Set(["PEOPLE_READ", "ACTION_VERIFY"]),
  ANALYST: new Set(["PEOPLE_READ", "PEOPLE_MANAGE", "ALLOCATION_MANAGE", "EFFICIENCY_ANALYZE", "ROOT_CAUSE_MANAGE", "INCENTIVE_SIMULATE"]),
  ADMIN: new Set(["PEOPLE_READ", "PEOPLE_MANAGE", "COMPENSATION_READ", "COMPENSATION_MANAGE", "ALLOCATION_MANAGE", "EFFICIENCY_ANALYZE", "ROOT_CAUSE_MANAGE", "ACTION_APPROVE", "ACTION_VERIFY", "INCENTIVE_SIMULATE", "INCENTIVE_APPROVE"]),
  OWNER: new Set(["PEOPLE_READ", "PEOPLE_MANAGE", "COMPENSATION_READ", "COMPENSATION_MANAGE", "ALLOCATION_MANAGE", "EFFICIENCY_ANALYZE", "ROOT_CAUSE_MANAGE", "ACTION_APPROVE", "ACTION_VERIFY", "INCENTIVE_SIMULATE", "INCENTIVE_APPROVE"]),
};

export function hasPeopleCapability(role: MembershipRole, capability: PeopleCapability) {
  return roleCapabilities[role].has(capability);
}

export function assertPeopleCapability(role: MembershipRole, capability: PeopleCapability) {
  if (!hasPeopleCapability(role, capability)) throw new Error(`Seu perfil não possui a capacidade necessária: ${capability}.`);
}

