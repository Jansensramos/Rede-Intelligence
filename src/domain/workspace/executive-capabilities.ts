/**
 * Gate de capacidade por domínio na Gestão Executiva (Fase 9K.2, fechamento — gate 2).
 *
 * Regra: "o backend/read model da Gestão Executiva só pode consultar e retornar domínios que o
 * usuário está autorizado a visualizar" — não é suficiente esconder o card no frontend. Este
 * módulo é a ÚNICA porta de decisão "posso ver o domínio X" usada por
 * `src/application/executive/executive-service.ts`: quando `canViewExecutiveDomain` devolve
 * `false`, o serviço nunca chama a consulta daquele domínio (nem gera exceção, nem preenche o
 * bloco de KPI correspondente) — ver `EXECUTIVE_DOMAIN_LABELS` para os rótulos usados na UI.
 *
 * Reaproveita o RBAC já existente, sem sistema paralelo:
 *  - Contabilidade e Integrações já têm capacidade de leitura própria
 *    (`accounting/capabilities.ts` → `ACCOUNTING_VIEW`, `integrations/capabilities.ts` →
 *    `INTEGRATION_VIEW`) — este módulo delega diretamente a elas.
 *  - Financeiro/Jurídico/Comercial/Suprimentos ainda não tinham capacidade de LEITURA própria
 *    (só mutação, via `mutableRoles`/`approvalRoles` de cada `*-service.ts`) — o fechamento da
 *    9K.2 estendeu o conjunto transversal já existente (`src/domain/workspace/capabilities.ts`)
 *    com `FINANCIAL_VIEW`/`LEGAL_VIEW`/`COMMERCIAL_VIEW`/`PROCUREMENT_VIEW`, mesmo mecanismo
 *    (`MembershipRole` → `Set<WorkspaceCapability>`), não um sistema novo.
 *  - Decisões/Aprovações usam `WORKSPACE_APPROVE` (hoje OWNER/ADMIN) — o mesmo "gestor/admin"
 *    citado no fechamento como quem sempre vê a visão completa.
 *  - Viabilidade e Obra/Engenharia continuam sem gate de leitura (mesma política de hoje das
 *    telas de módulo correspondentes — `getLatestStudyForProject`/`getOperationsWorkspace` não
 *    recebem `role`), documentado explicitamente, não esquecido.
 */
import type { MembershipRole } from "@prisma/client";
import { hasAccountingCapability } from "@/domain/accounting/capabilities";
import { hasIntegrationCapability } from "@/domain/integrations/capabilities";
import { hasCapitalCapability } from "@/domain/capital/capabilities";
import { hasWorkspaceCapability } from "./capabilities";
import type { ExecutiveDomain } from "./exceptions";

export function canViewExecutiveDomain(role: MembershipRole, domain: ExecutiveDomain): boolean {
  switch (domain) {
    case "financial":
      return hasWorkspaceCapability(role, "FINANCIAL_VIEW");
    case "legal":
      return hasWorkspaceCapability(role, "LEGAL_VIEW");
    case "sales":
      return hasWorkspaceCapability(role, "COMMERCIAL_VIEW");
    case "procurement":
      return hasWorkspaceCapability(role, "PROCUREMENT_VIEW");
    case "accounting":
      return hasAccountingCapability(role, "ACCOUNTING_VIEW");
    case "integrations":
      return hasIntegrationCapability(role, "INTEGRATION_VIEW");
    case "capital":
      return hasCapitalCapability(role, "CAPITAL_VIEW");
    case "approvals":
      return hasWorkspaceCapability(role, "WORKSPACE_APPROVE");
    case "viability":
    case "operations":
      return true;
  }
}

/** Todos os domínios cobertos pela Gestão Executiva, na ordem em que aparecem na tela. */
export const ALL_EXECUTIVE_DOMAINS: ExecutiveDomain[] = ["viability", "sales", "financial", "capital", "procurement", "operations", "legal", "accounting", "integrations", "approvals"];

/** Subconjunto de domínios que o papel pode ver — usado para decidir quais consultas disparar. */
export function authorizedExecutiveDomains(role: MembershipRole): Set<ExecutiveDomain> {
  return new Set(ALL_EXECUTIVE_DOMAINS.filter((domain) => canViewExecutiveDomain(role, domain)));
}

export const EXECUTIVE_DOMAIN_LABELS: Record<ExecutiveDomain, string> = {
  viability: "Viabilidade",
  sales: "Comercial",
  financial: "Financeiro",
  capital: "Capital e Financiamento",
  procurement: "Suprimentos",
  operations: "Obra/Engenharia",
  legal: "Jurídico",
  accounting: "Contabilidade",
  integrations: "Integrações",
  approvals: "Decisões",
};
