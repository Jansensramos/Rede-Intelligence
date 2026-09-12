import type { MembershipRole } from "@prisma/client";

export const INTERNAL_REQUEST_PATH_HEADER = "x-rede-request-path";

export type ProtectedReadCapability =
  | "EXECUTIVE_READ"
  | "VIABILITY_READ"
  | "MARKET_PRODUCT_READ"
  | "ENGINEERING_READ"
  | "PROCUREMENT_READ"
  | "FINANCIAL_READ"
  | "CAPITAL_READ"
  | "COMMERCIAL_READ"
  | "LEGAL_READ"
  | "PEOPLE_READ"
  | "ACCOUNTING_READ"
  | "INTEGRATIONS_READ"
  | "DATA_INTELLIGENCE_READ"
  | "ACTIONS_READ"
  | "OPERATIONS_READ"
  | "AI_READ"
  | "ECOSYSTEM_READ"
  | "HELP_READ"
  | "CLOSURE_READ";

export const ALL_PROTECTED_READ_CAPABILITIES: ProtectedReadCapability[] = [
  "EXECUTIVE_READ", "VIABILITY_READ", "MARKET_PRODUCT_READ", "ENGINEERING_READ", "PROCUREMENT_READ",
  "FINANCIAL_READ", "CAPITAL_READ", "COMMERCIAL_READ", "LEGAL_READ", "PEOPLE_READ", "ACCOUNTING_READ",
  "INTEGRATIONS_READ", "DATA_INTELLIGENCE_READ", "ACTIONS_READ", "OPERATIONS_READ", "AI_READ", "ECOSYSTEM_READ", "HELP_READ",
  "CLOSURE_READ",
];

const viewerCapabilities = new Set<ProtectedReadCapability>(["VIABILITY_READ", "MARKET_PRODUCT_READ", "ECOSYSTEM_READ", "HELP_READ"]);
const fullCapabilities = new Set(ALL_PROTECTED_READ_CAPABILITIES);
const matrix: Record<MembershipRole, ReadonlySet<ProtectedReadCapability>> = {
  OWNER: fullCapabilities,
  ADMIN: fullCapabilities,
  ANALYST: fullCapabilities,
  REVIEWER: fullCapabilities,
  VIEWER: viewerCapabilities,
};

export class ReadAccessDeniedError extends Error {
  readonly name = "ReadAccessDeniedError";
  constructor() { super("Seu perfil não possui acesso a estes dados."); }
}

export function hasProtectedReadCapability(role: MembershipRole, capability: ProtectedReadCapability) {
  return matrix[role].has(capability);
}

export function assertProtectedReadCapability(role: MembershipRole, capability: ProtectedReadCapability) {
  if (!hasProtectedReadCapability(role, capability)) throw new ReadAccessDeniedError();
}

export function isReadAccessDeniedError(error: unknown): error is ReadAccessDeniedError {
  return error instanceof ReadAccessDeniedError;
}

const routeCapabilities: Array<[string, ProtectedReadCapability]> = [
  ["/executivo", "EXECUTIVE_READ"],
  ["/viabilidade", "VIABILITY_READ"],
  ["/mercado-produto", "MARKET_PRODUCT_READ"],
  ["/engenharia-obra", "ENGINEERING_READ"],
  ["/suprimentos", "PROCUREMENT_READ"],
  ["/financeiro", "FINANCIAL_READ"],
  ["/capital-funding", "CAPITAL_READ"],
  ["/comercial", "COMMERCIAL_READ"],
  ["/juridico", "LEGAL_READ"],
  ["/pessoas", "PEOPLE_READ"],
  ["/contabilidade-controladoria", "ACCOUNTING_READ"],
  ["/integracoes", "INTEGRATIONS_READ"],
  ["/inteligencia-dados", "DATA_INTELLIGENCE_READ"],
  ["/acoes", "ACTIONS_READ"],
  ["/rotina", "OPERATIONS_READ"],
  ["/assistente", "AI_READ"],
  ["/asset", "ECOSYSTEM_READ"],
  ["/academy", "ECOSYSTEM_READ"],
  ["/ajuda", "HELP_READ"],
];

export function protectedReadCapabilityForPath(pathname: string) {
  return routeCapabilities.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1];
}

export function canAccessWorkspacePath(role: MembershipRole, pathname: string) {
  const capability = protectedReadCapabilityForPath(pathname);
  return capability ? hasProtectedReadCapability(role, capability) : false;
}

export function defaultWorkspacePathForRole(role: MembershipRole) {
  return hasProtectedReadCapability(role, "EXECUTIVE_READ") ? "/executivo" : "/viabilidade";
}

const legacyWorkspaceCapabilities: ProtectedReadCapability[] = [
  "EXECUTIVE_READ", "ENGINEERING_READ", "PROCUREMENT_READ", "FINANCIAL_READ", "COMMERCIAL_READ",
  "LEGAL_READ", "PEOPLE_READ", "ACCOUNTING_READ", "INTEGRATIONS_READ", "DATA_INTELLIGENCE_READ", "AI_READ",
];

export function assertLegacyWorkspaceRead(role: MembershipRole) {
  for (const capability of legacyWorkspaceCapabilities) assertProtectedReadCapability(role, capability);
}
