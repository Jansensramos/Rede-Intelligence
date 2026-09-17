import type { MembershipRole } from "@prisma/client";

export type ProtectedWriteCapability =
  | "VIABILITY_WRITE"
  | "MARKET_PRODUCT_WRITE"
  | "ENGINEERING_WRITE"
  | "PROCUREMENT_WRITE"
  | "FINANCIAL_WRITE"
  | "CAPITAL_WRITE"
  | "COMMERCIAL_WRITE"
  | "LEGAL_WRITE"
  | "PEOPLE_WRITE"
  | "ACCOUNTING_WRITE"
  | "INTEGRATIONS_WRITE"
  | "DATA_INTELLIGENCE_WRITE"
  | "OPERATIONS_WRITE"
  | "CLOSURE_WRITE";

export type ProtectedApprovalCapability =
  | "ENGINEERING_APPROVE"
  | "PROCUREMENT_APPROVE"
  | "FINANCIAL_APPROVE"
  | "CAPITAL_APPROVE"
  | "COMMERCIAL_APPROVE"
  | "LEGAL_APPROVE"
  | "PEOPLE_APPROVE"
  | "ACCOUNTING_APPROVE"
  | "OPERATIONS_APPROVE"
  | "CLOSURE_APPROVE";

const writeCapabilities = new Set<ProtectedWriteCapability>([
  "VIABILITY_WRITE", "MARKET_PRODUCT_WRITE", "ENGINEERING_WRITE", "PROCUREMENT_WRITE", "FINANCIAL_WRITE",
  "CAPITAL_WRITE", "COMMERCIAL_WRITE", "LEGAL_WRITE", "PEOPLE_WRITE", "ACCOUNTING_WRITE", "INTEGRATIONS_WRITE",
  "DATA_INTELLIGENCE_WRITE", "OPERATIONS_WRITE", "CLOSURE_WRITE",
]);

const approvalCapabilities = new Set<ProtectedApprovalCapability>([
  "ENGINEERING_APPROVE", "PROCUREMENT_APPROVE", "FINANCIAL_APPROVE", "CAPITAL_APPROVE", "COMMERCIAL_APPROVE",
  "LEGAL_APPROVE", "PEOPLE_APPROVE", "ACCOUNTING_APPROVE", "OPERATIONS_APPROVE", "CLOSURE_APPROVE",
]);

const writeMatrix: Record<MembershipRole, ReadonlySet<ProtectedWriteCapability>> = {
  OWNER: writeCapabilities,
  ADMIN: writeCapabilities,
  ANALYST: writeCapabilities,
  REVIEWER: new Set(),
  VIEWER: new Set(),
};

const approvalMatrix: Record<MembershipRole, ReadonlySet<ProtectedApprovalCapability>> = {
  OWNER: approvalCapabilities,
  ADMIN: approvalCapabilities,
  ANALYST: new Set(),
  REVIEWER: new Set(),
  VIEWER: new Set(),
};

export class WriteAccessDeniedError extends Error {
  readonly name = "WriteAccessDeniedError";
  constructor() { super("Seu perfil não possui permissão para alterar estes dados."); }
}

export class ApprovalAccessDeniedError extends Error {
  readonly name = "ApprovalAccessDeniedError";
  constructor() { super("Seu perfil não possui alçada para aprovar esta operação."); }
}

export function assertProtectedWriteCapability(role: MembershipRole, capability: ProtectedWriteCapability) {
  if (!writeMatrix[role].has(capability)) throw new WriteAccessDeniedError();
}

export function assertProtectedApprovalCapability(role: MembershipRole, capability: ProtectedApprovalCapability) {
  if (!approvalMatrix[role].has(capability)) throw new ApprovalAccessDeniedError();
}
