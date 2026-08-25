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
  | "CONFIDENTIAL_VIEW"
  | "FINANCIAL_VIEW"
  | "LEGAL_VIEW"
  | "COMMERCIAL_VIEW"
  | "PROCUREMENT_VIEW";

/**
 * `FINANCIAL_VIEW`/`LEGAL_VIEW`/`COMMERCIAL_VIEW`/`PROCUREMENT_VIEW` (Fase 9K.2, gate 2 do
 * fechamento) — visibilidade por domínio na Gestão Executiva. Financeiro, Jurídico, Sales e
 * Suprimentos ainda não têm um sistema de capacidades de LEITURA próprio (ao contrário de
 * Contabilidade/`accounting/capabilities.ts` e Integrações/`integrations/capabilities.ts`, que já
 * existem e são reaproveitados diretamente por `executive-capabilities.ts`) — os `mutableRoles`/
 * `approvalRoles` de cada `*-service.ts` só gatam mutação, nunca leitura. Em vez de inventar um
 * sistema de permissão paralelo, esta extensão usa o MESMO mecanismo transversal já existente
 * (`MembershipRole` → `Set<WorkspaceCapability>`, computado por `computeWorkspaceCapabilities`) —
 * apenas com granularidade por domínio. `VIEWER` é o único papel sem estas 4 capacidades: é o
 * único ponto do RBAC atual sem nenhum outro sinal de confiança operacional (não aparece em
 * `mutableRoles`/`approvalRoles` de nenhum módulo), o que torna esta restrição consistente com o
 * resto do sistema em vez de arbitrária. Esta extensão gate SOMENTE a leitura executiva
 * transversal (Gestão Executiva) — as telas de módulo (`/financeiro`, `/juridico`, `/comercial`,
 * `/suprimentos`) continuam sem gate de leitura própria, isso é uma dívida pré-existente fora do
 * escopo desta sprint (ver relatório de fechamento).
 */
const roleCapabilities: Record<MembershipRole, ReadonlySet<WorkspaceCapability>> = {
  VIEWER: new Set(["WORKSPACE_VIEW"]),
  REVIEWER: new Set(["WORKSPACE_VIEW", "WORKSPACE_REVIEW", "FINANCIAL_VIEW", "LEGAL_VIEW", "COMMERCIAL_VIEW", "PROCUREMENT_VIEW"]),
  ANALYST: new Set(["WORKSPACE_VIEW", "WORKSPACE_EDIT", "FINANCIAL_VIEW", "LEGAL_VIEW", "COMMERCIAL_VIEW", "PROCUREMENT_VIEW"]),
  ADMIN: new Set(["WORKSPACE_VIEW", "WORKSPACE_EDIT", "WORKSPACE_REVIEW", "WORKSPACE_APPROVE", "INTEGRATIONS_CONFIGURE", "FINANCIAL_VIEW", "LEGAL_VIEW", "COMMERCIAL_VIEW", "PROCUREMENT_VIEW"]),
  OWNER: new Set(["WORKSPACE_VIEW", "WORKSPACE_EDIT", "WORKSPACE_REVIEW", "WORKSPACE_APPROVE", "INTEGRATIONS_CONFIGURE", "CONFIDENTIAL_VIEW", "FINANCIAL_VIEW", "LEGAL_VIEW", "COMMERCIAL_VIEW", "PROCUREMENT_VIEW"]),
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
  "FINANCIAL_VIEW",
  "LEGAL_VIEW",
  "COMMERCIAL_VIEW",
  "PROCUREMENT_VIEW",
];

export function computeWorkspaceCapabilities(role: MembershipRole): WorkspaceCapabilitySet {
  const entries = ALL_CAPABILITIES.map((capability) => [capability, hasWorkspaceCapability(role, capability)] as const);
  return { role, ...Object.fromEntries(entries) } as WorkspaceCapabilitySet;
}
