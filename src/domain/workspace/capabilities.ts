import type { MembershipRole } from "@prisma/client";

/**
 * Capacidades transversais da experiência operacional (Fase 9K.0, plano §AD/§AN).
 * Distinto das capacidades por módulo já existentes (ex.: `people-performance/capabilities.ts`):
 * este conjunto cobre decisões de UI/navegação comuns a qualquer área (ver, editar, revisar,
 * aprovar, configurar integrações, ver dado confidencial), não regras de negócio de um domínio.
 * Nunca usar isto para esconder uma ação de mutação sem também validar no caso de uso do domínio —
 * este contrato é para a camada de apresentação decidir o que MOSTRAR, não a única barreira.
 */
export type WorkspaceCapability =
  | "WORKSPACE_VIEW"
  | "WORKSPACE_EDIT"
  | "WORKSPACE_REVIEW"
  | "WORKSPACE_APPROVE"
  | "INTEGRATIONS_CONFIGURE"
  | "CONFIDENTIAL_VIEW";

const roleCapabilities: Record<MembershipRole, ReadonlySet<WorkspaceCapability>> = {
  VIEWER: new Set(["WORKSPACE_VIEW"]),
  REVIEWER: new Set(["WORKSPACE_VIEW", "WORKSPACE_REVIEW"]),
  ANALYST: new Set(["WORKSPACE_VIEW", "WORKSPACE_EDIT"]),
  ADMIN: new Set(["WORKSPACE_VIEW", "WORKSPACE_EDIT", "WORKSPACE_REVIEW", "WORKSPACE_APPROVE", "INTEGRATIONS_CONFIGURE"]),
  OWNER: new Set(["WORKSPACE_VIEW", "WORKSPACE_EDIT", "WORKSPACE_REVIEW", "WORKSPACE_APPROVE", "INTEGRATIONS_CONFIGURE", "CONFIDENTIAL_VIEW"]),
};

export function hasWorkspaceCapability(role: MembershipRole, capability: WorkspaceCapability) {
  return roleCapabilities[role].has(capability);
}

export function assertWorkspaceCapability(role: MembershipRole, capability: WorkspaceCapability) {
  if (!hasWorkspaceCapability(role, capability)) throw new Error(`Seu perfil não possui a capacidade necessária: ${capability}.`);
}

/** Objeto plano e serializável — seguro para atravessar a fronteira servidor/cliente como prop. */
export type WorkspaceCapabilitySet = { role: MembershipRole } & Record<WorkspaceCapability, boolean>;

const ALL_CAPABILITIES: WorkspaceCapability[] = [
  "WORKSPACE_VIEW",
  "WORKSPACE_EDIT",
  "WORKSPACE_REVIEW",
  "WORKSPACE_APPROVE",
  "INTEGRATIONS_CONFIGURE",
  "CONFIDENTIAL_VIEW",
];

export function computeWorkspaceCapabilities(role: MembershipRole): WorkspaceCapabilitySet {
  const entries = ALL_CAPABILITIES.map((capability) => [capability, hasWorkspaceCapability(role, capability)] as const);
  return { role, ...Object.fromEntries(entries) } as WorkspaceCapabilitySet;
}
