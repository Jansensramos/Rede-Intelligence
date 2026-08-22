export type ConflictPolicyType = "EXTERNAL_WINS" | "REDE_WINS" | "NEWEST_WINS" | "MANUAL_REVIEW" | "FIELD_OWNER_WINS" | "MERGE_BY_RULE";
export type ConflictDecision = "NO_CONFLICT" | "APPLY_EXTERNAL" | "KEEP_LOCAL" | "NEEDS_REVIEW";

export interface ConflictInput {
  localValue: unknown;
  externalValue: unknown;
  localUpdatedAt?: Date | null;
  externalUpdatedAt?: Date | null;
}

/**
 * Resolução pura de conflito de campo. Nunca sobrescreve silenciosamente: qualquer
 * política sem sinal determinístico suficiente (relógio ausente, regra de merge,
 * revisão manual ou ownership por campo) retorna NEEDS_REVIEW em vez de aplicar.
 */
export function resolveConflict(policy: ConflictPolicyType, input: ConflictInput): ConflictDecision {
  if (JSON.stringify(input.localValue) === JSON.stringify(input.externalValue)) return "NO_CONFLICT";
  switch (policy) {
    case "EXTERNAL_WINS":
      return "APPLY_EXTERNAL";
    case "REDE_WINS":
      return "KEEP_LOCAL";
    case "NEWEST_WINS": {
      if (!input.localUpdatedAt || !input.externalUpdatedAt) return "NEEDS_REVIEW";
      return input.externalUpdatedAt.getTime() > input.localUpdatedAt.getTime() ? "APPLY_EXTERNAL" : "KEEP_LOCAL";
    }
    case "MANUAL_REVIEW":
    case "FIELD_OWNER_WINS":
    case "MERGE_BY_RULE":
    default:
      return "NEEDS_REVIEW";
  }
}
