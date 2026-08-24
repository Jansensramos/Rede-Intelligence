import type { MembershipRole } from "@prisma/client";

export type DataIntelligenceCapability =
  | "DATA_VIEW"
  | "DATA_CONTRACT_MANAGE"
  | "ANALYTICS_REPROCESS"
  | "METRIC_MANAGE"
  | "METRIC_APPROVE"
  | "BENCHMARK_VIEW"
  | "BENCHMARK_MANAGE"
  | "DATA_QUALITY_VIEW"
  | "DATA_QUALITY_MANAGE"
  | "DATASET_EXPORT"
  | "AUTOBUDGET_VIEW"
  | "AUTOBUDGET_BUILD"
  | "AUTOBUDGET_REVIEW"
  | "AUTOBUDGET_APPROVE";

const readOnly: DataIntelligenceCapability[] = ["DATA_VIEW", "BENCHMARK_VIEW", "DATA_QUALITY_VIEW", "AUTOBUDGET_VIEW"];
const full: DataIntelligenceCapability[] = [
  "DATA_VIEW", "DATA_CONTRACT_MANAGE", "ANALYTICS_REPROCESS", "METRIC_MANAGE", "METRIC_APPROVE",
  "BENCHMARK_VIEW", "BENCHMARK_MANAGE", "DATA_QUALITY_VIEW", "DATA_QUALITY_MANAGE", "DATASET_EXPORT",
  "AUTOBUDGET_VIEW", "AUTOBUDGET_BUILD", "AUTOBUDGET_REVIEW", "AUTOBUDGET_APPROVE",
];

// Segregação intencional: ANALYST constrói (contratos, fatos, métricas, benchmark, proposta de
// Orçamento Inteligente) mas não aprova métrica nem revisa/aprova proposta; REVIEWER revisa e
// aprova mas não constrói — evita que quem propõe também valide a própria proposta.
const matrix: Record<MembershipRole, DataIntelligenceCapability[]> = {
  OWNER: full,
  ADMIN: full,
  ANALYST: ["DATA_VIEW", "DATA_CONTRACT_MANAGE", "ANALYTICS_REPROCESS", "METRIC_MANAGE", "BENCHMARK_VIEW", "BENCHMARK_MANAGE", "DATA_QUALITY_VIEW", "DATA_QUALITY_MANAGE", "AUTOBUDGET_VIEW", "AUTOBUDGET_BUILD"],
  REVIEWER: ["DATA_VIEW", "BENCHMARK_VIEW", "DATA_QUALITY_VIEW", "DATA_QUALITY_MANAGE", "METRIC_APPROVE", "AUTOBUDGET_VIEW", "AUTOBUDGET_REVIEW", "AUTOBUDGET_APPROVE"],
  VIEWER: readOnly,
};

export function hasDataIntelligenceCapability(role: MembershipRole, capability: DataIntelligenceCapability) {
  return matrix[role].includes(capability);
}

export function assertDataIntelligenceCapability(role: MembershipRole, capability: DataIntelligenceCapability) {
  if (!hasDataIntelligenceCapability(role, capability)) throw new Error(`A função ${role} não possui a capacidade ${capability}.`);
}
