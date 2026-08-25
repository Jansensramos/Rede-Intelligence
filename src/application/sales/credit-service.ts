/**
 * Fechamento Comercial 360 — Crédito (Fase 9K.4, plano §5/§7). `CreditBureauProvider` é a única
 * interface que este arquivo conhece (mesmo princípio de `signature-service.ts`). Resultado nunca
 * decide a venda sozinho — só alimenta `CreditBureauConsultation.result`, lido pela política/
 * alçada já existente (9C) e pela Central de Ações (item G).
 */
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { mockCreditBureauProvider } from "@/infrastructure/adapters/credit/mock-credit-bureau-provider";
import { maskTaxId } from "@/domain/sales/contract-closing";
import type { CreditBureauProvider } from "@/domain/sales/credit-bureau-provider";

const mutableRoles = new Set(["OWNER", "ADMIN", "ANALYST"]);
const json = (value: unknown) => value as Prisma.InputJsonValue;
/** Política de retenção padrão (item 7, LGPD) — placeholder documentado; job de expurgo automático fica para uma fase futura, esta coluna só prepara o corte. */
const DEFAULT_RETENTION_DAYS = 180;

function assertMutable(context: Pick<AuthContext, "role">) {
  if (!mutableRoles.has(context.role)) throw new Error("Seu perfil não pode alterar dados comerciais.");
}
const audit = (context: Pick<AuthContext, "organizationId" | "userId">, projectId: string | null, action: string, entityType: string, entityId: string, after?: unknown) => ({
  organizationId: context.organizationId, userId: context.userId, projectId, action, entityType, entityId, after: after === undefined ? undefined : json(after),
});

function providerFor(code: string): CreditBureauProvider {
  if (code === "MOCK") return mockCreditBureauProvider;
  throw new Error(`Provider de crédito "${code}" ainda não tem adapter real habilitado nesta fase — apenas MOCK está disponível.`);
}

export async function requestCreditConsultation(context: AuthContext, input: {
  customerId: string; proposalId?: string; purpose?: "SALE_PROPOSAL_ANALYSIS" | "CONTRACT_RENEWAL" | "OTHER"; provider?: "MOCK" | "SERASA_EXPERIAN";
}) {
  assertMutable(context);
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, organizationId: context.organizationId } });
  if (!customer) throw new Error("Cliente não encontrado nesta organização.");
  if (!customer.taxId) throw new Error("Cliente sem CPF/CNPJ cadastrado — cadastre o documento antes de consultar o crédito.");
  let projectId: string | null = null;
  if (input.proposalId) {
    const proposal = await prisma.salesProposal.findFirst({ where: { id: input.proposalId, organizationId: context.organizationId, customerId: customer.id } });
    if (!proposal) throw new Error("Proposta não encontrada para este cliente nesta organização.");
    projectId = proposal.projectId;
  }

  const cpfMasked = maskTaxId(customer.taxId);
  const providerCode = input.provider ?? "MOCK";
  const consultation = await prisma.creditBureauConsultation.create({ data: {
    organizationId: context.organizationId, projectId, customerId: customer.id, proposalId: input.proposalId ?? null,
    provider: providerCode, purpose: input.purpose ?? "SALE_PROPOSAL_ANALYSIS", cpfMasked, requestedById: context.userId,
    retentionUntil: new Date(Date.now() + DEFAULT_RETENTION_DAYS * 86_400_000),
  } });

  try {
    const provider = providerFor(providerCode);
    const result = await provider.consult({ organizationId: context.organizationId, customerId: customer.id, taxId: customer.taxId });
    const completed = await prisma.creditBureauConsultation.update({ where: { id: consultation.id }, data: {
      status: "COMPLETED", score: result.score, findingsSummary: result.findingsSummary ? json(result.findingsSummary) : undefined, result: result.result, externalReference: result.externalReference, completedAt: new Date(),
    } });
    await prisma.auditLog.create({ data: audit(context, projectId, "CREDIT_BUREAU_CONSULTATION_COMPLETED", "CreditBureauConsultation", completed.id, { customerId: customer.id, cpfMasked, result: result.result }) });
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar o bureau de crédito.";
    const failed = await prisma.creditBureauConsultation.update({ where: { id: consultation.id }, data: { status: "ERROR", errorMessage: message } });
    await prisma.auditLog.create({ data: audit(context, projectId, "CREDIT_BUREAU_CONSULTATION_FAILED", "CreditBureauConsultation", failed.id, { customerId: customer.id, message }) });
    return failed;
  }
}

export async function listCreditConsultations(context: Pick<AuthContext, "organizationId">, customerId: string) {
  return prisma.creditBureauConsultation.findMany({ where: { organizationId: context.organizationId, customerId }, orderBy: { requestedAt: "desc" } });
}
