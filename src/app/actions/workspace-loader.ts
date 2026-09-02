"use server";

/**
 * Carregamento sob demanda dos workspaces "pesados" (Fase 9K.0, plano §2 "Desmontar o bootstrap
 * monolítico" e §AS "Performance").
 *
 * Antes: `src/app/page.tsx` buscava os 15 workspaces do projeto inteiro em um único
 * `Promise.all` a cada carregamento da página, mesmo que o usuário só fosse abrir uma aba.
 *
 * Depois: `page.tsx` busca só o estudo, o Investment Case, o terreno e os workspaces que a Visão
 * Executiva atual (aba "overview") de fato lê (Pessoas, Contabilidade, Integrações, Inteligência
 * de Dados, Mercado/Produto). Os módulos que a Visão Executiva não usa — Design/BIM, Orçamento +
 * Operações, Financeiro, Suprimentos, Jurídico, Comercial e REDE AI — só são buscados quando o
 * usuário abre a aba correspondente, através das funções abaixo, chamadas por
 * `src/components/intelligence-workspace.tsx`.
 *
 * Cada função aqui é só uma casca fina de autenticação + chamada ao serviço de aplicação que já
 * existia; nenhuma lógica de domínio nova, nenhuma nova fonte de verdade.
 */

import type { Prisma } from "@prisma/client";
import { requireAuthContext } from "@/application/auth/session";
import { ensureDesignWorkspace } from "@/application/design/design-service";
import { getLatestProjectBudget } from "@/application/budget/budget-service";
import { getOperationsWorkspace } from "@/application/operations/operations-service";
import { getFinancialWorkspace } from "@/application/financial-ops/financial-service";
import { getProcurementWorkspace } from "@/application/procurement/procurement-service";
import { getLegalWorkspace } from "@/application/legal/legal-service";
import { getSalesWorkspace } from "@/application/sales/sales-service";
import { assertProtectedReadCapability } from "@/domain/auth/read-capabilities";

export type WorkspaceLoaderResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toResult<T>(promise: Promise<T>, fallbackError: string): Promise<WorkspaceLoaderResult<T>> {
  return promise
    .then((data) => ({ ok: true as const, data }))
    .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : fallbackError }));
}

export async function loadDesignWorkspaceAction(projectId: string) {
  const context = await requireAuthContext();
  assertProtectedReadCapability(context.role, "ENGINEERING_READ");
  return toResult(ensureDesignWorkspace(context, projectId), "Não foi possível carregar Design Intelligence.");
}

export async function loadBudgetAreaAction(projectId: string, baseVgv?: Prisma.Decimal.Value) {
  const context = await requireAuthContext();
  assertProtectedReadCapability(context.role, "ENGINEERING_READ");
  return toResult(
    Promise.all([getLatestProjectBudget(context, projectId, baseVgv), getOperationsWorkspace(context, projectId)]).then(
      ([budget, operations]) => ({ budget, operations }),
    ),
    "Não foi possível carregar Orçamento e Operações.",
  );
}

export async function loadFinancialWorkspaceAction(projectId: string) {
  const context = await requireAuthContext();
  assertProtectedReadCapability(context.role, "FINANCIAL_READ");
  return toResult(getFinancialWorkspace(context, projectId), "Não foi possível carregar o Financeiro.");
}

export async function loadProcurementWorkspaceAction(projectId: string) {
  const context = await requireAuthContext();
  assertProtectedReadCapability(context.role, "PROCUREMENT_READ");
  return toResult(getProcurementWorkspace(context, projectId), "Não foi possível carregar Suprimentos.");
}

export async function loadLegalWorkspaceAction(projectId: string) {
  const context = await requireAuthContext();
  assertProtectedReadCapability(context.role, "LEGAL_READ");
  return toResult(getLegalWorkspace(context, projectId), "Não foi possível carregar o Jurídico.");
}

export async function loadSalesWorkspaceAction(projectId: string) {
  const context = await requireAuthContext();
  assertProtectedReadCapability(context.role, "COMMERCIAL_READ");
  return toResult(getSalesWorkspace(context, projectId), "Não foi possível carregar Vendas e Recebíveis.");
}

// A "ai" não tem uma função aqui: o bootstrap do REDE AI já tinha uma server action própria em
// `src/app/actions/ai.ts` (`refreshAIBootstrapAction`), usada também pelo painel para recarregar
// a conversa depois da primeira vez. Ter duas ações fazendo a mesma chamada a `getAIBootstrap`
// (uma aqui, outra em `ai.ts`) arriscava as duas divergirem sobre qual `projectId` usar — exatamente
// o tipo de segunda resolução independente que o fechamento da 9K.0 (gate 3) veio eliminar. A
// carga sob demanda da aba REDE AI em `intelligence-workspace.tsx` reusa `refreshAIBootstrapAction`.
