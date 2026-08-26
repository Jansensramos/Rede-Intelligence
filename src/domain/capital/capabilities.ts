/**
 * Fase 9N §12 — RBAC de Capital & Funding.
 * Mesmo mecanismo transversal já usado por `accounting/capabilities.ts` e `integrations/capabilities.ts`:
 * `MembershipRole` → conjunto de capacidades, sem nenhuma tabela nova (zero migration). `CAPITAL_APPROVE`
 * é a única capacidade que autoriza a transição "proposta aprovada" → obrigação financeira real
 * (`ObligationOrigin.FUNDING`), então fica restrita a OWNER/ADMIN, no mesmo padrão de
 * `assertApprover` em `financial-ops`/`accounting`.
 */
import type { MembershipRole } from "@prisma/client";

export type CapitalCapability =
  | "CAPITAL_VIEW"
  | "CAPITAL_PROPOSAL_MANAGE"
  | "CAPITAL_SCENARIO_SIMULATE"
  | "CAPITAL_APPROVE"
  | "CAPITAL_COVENANT_MANAGE"
  | "CAPITAL_CONDITION_MANAGE";

const readOnly: CapitalCapability[] = ["CAPITAL_VIEW"];
const matrix: Record<MembershipRole, CapitalCapability[]> = {
  OWNER: ["CAPITAL_VIEW", "CAPITAL_PROPOSAL_MANAGE", "CAPITAL_SCENARIO_SIMULATE", "CAPITAL_APPROVE", "CAPITAL_COVENANT_MANAGE", "CAPITAL_CONDITION_MANAGE"],
  ADMIN: ["CAPITAL_VIEW", "CAPITAL_PROPOSAL_MANAGE", "CAPITAL_SCENARIO_SIMULATE", "CAPITAL_APPROVE", "CAPITAL_COVENANT_MANAGE", "CAPITAL_CONDITION_MANAGE"],
  ANALYST: ["CAPITAL_VIEW", "CAPITAL_PROPOSAL_MANAGE", "CAPITAL_SCENARIO_SIMULATE", "CAPITAL_CONDITION_MANAGE"],
  REVIEWER: ["CAPITAL_VIEW", "CAPITAL_SCENARIO_SIMULATE", "CAPITAL_COVENANT_MANAGE", "CAPITAL_CONDITION_MANAGE"],
  VIEWER: readOnly,
};

export function hasCapitalCapability(role: MembershipRole, capability: CapitalCapability) {
  return matrix[role].includes(capability);
}

export function assertCapitalCapability(role: MembershipRole, capability: CapitalCapability) {
  if (!hasCapitalCapability(role, capability)) throw new Error(`A função ${role} não possui a capacidade ${capability}.`);
}
