import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { MARKET_PRODUCT_ENGINE_VERSION, decideProductScenarioSchema, type DecideProductScenarioInput } from "@/domain/market-product";
import { requireMarketProductCapability, type MarketProductContext } from "./market-area-service";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const OPEN_STATUSES = ["DRAFT", "UNDER_REVIEW", "RECOMMENDED"];

function snapshotOf(scenario: { totalUnits: number; totalPrivateAreaM2: Prisma.Decimal; averageUnitAreaM2: Prisma.Decimal; targetVgv: Prisma.Decimal; averagePricePerSqm: Prisma.Decimal; averageTicket: Prisma.Decimal; expectedVelocityUnitsMonth: Prisma.Decimal; estimatedSalesDurationMonths: number; confidenceLevel: string; engineResultsJson: unknown }) {
  return {
    totalUnits: scenario.totalUnits,
    totalPrivateAreaM2: Number(scenario.totalPrivateAreaM2),
    averageUnitAreaM2: Number(scenario.averageUnitAreaM2),
    targetVgv: Number(scenario.targetVgv),
    averagePricePerSqm: Number(scenario.averagePricePerSqm),
    averageTicket: Number(scenario.averageTicket),
    expectedVelocityUnitsMonth: Number(scenario.expectedVelocityUnitsMonth),
    estimatedSalesDurationMonths: scenario.estimatedSalesDurationMonths,
    confidenceLevel: scenario.confidenceLevel,
    engineResults: scenario.engineResultsJson,
  };
}

// Máquina de estados do cenário de produto (plano 9J, seção AL) — transições para APROVADO/
// REJEITADO exigem identificação do usuário, carimbo de data/hora e justificativa obrigatória.
// A Memória da Decisão (seção AM) é imutável: uma vez criada, nunca é editada, apenas lida.
export async function decideProductScenario(context: MarketProductContext, rawInput: DecideProductScenarioInput) {
  requireMarketProductCapability(context, "PRODUCT_APPROVE");
  const input = decideProductScenarioSchema.parse(rawInput);

  const scenario = await prisma.productScenario.findFirst({ where: { id: input.scenarioId, organizationId: context.organizationId } });
  if (!scenario) throw new Error("Cenário de produto não encontrado nesta organização.");
  if (!OPEN_STATUSES.includes(scenario.status)) throw new Error(`Cenário no status ${scenario.status} não pode receber uma nova decisão — crie uma nova versão.`);

  const recommendedSnapshot = snapshotOf(scenario);
  const overriddenTotalUnits = input.finalOverrides?.totalUnits ?? scenario.totalUnits;
  const overriddenAreaM2 = input.finalOverrides?.averageUnitAreaM2 ?? Number(scenario.averageUnitAreaM2);
  const overriddenTicket = input.finalOverrides?.averageTicket ?? Number(scenario.averageTicket);
  const approvedSnapshot = {
    ...recommendedSnapshot,
    totalUnits: overriddenTotalUnits,
    averageUnitAreaM2: overriddenAreaM2,
    averageTicket: overriddenTicket,
    targetVgv: overriddenTotalUnits * overriddenTicket,
  };
  const deltasJson = {
    totalUnitsDelta: approvedSnapshot.totalUnits - recommendedSnapshot.totalUnits,
    averageUnitAreaM2Delta: approvedSnapshot.averageUnitAreaM2 - recommendedSnapshot.averageUnitAreaM2,
    averageTicketDelta: approvedSnapshot.averageTicket - recommendedSnapshot.averageTicket,
    targetVgvDelta: approvedSnapshot.targetVgv - recommendedSnapshot.targetVgv,
  };

  const decisionPayload = { scenarioId: scenario.id, recommendedSnapshot, approvedSnapshot, deltasJson, decision: input.decision, decidedById: context.userId, decidedAt: new Date().toISOString() };

  const [record] = await prisma.$transaction([
    prisma.productDecisionRecord.create({
      data: {
        organizationId: context.organizationId,
        scenarioId: scenario.id,
        recommendedSnapshot: json(recommendedSnapshot),
        approvedSnapshot: json(approvedSnapshot),
        deltasJson: json(deltasJson),
        decision: input.decision,
        decisionRationale: input.decisionRationale,
        decidedById: context.userId,
        engineVersion: MARKET_PRODUCT_ENGINE_VERSION,
        checksum: checksum(decisionPayload),
      },
    }),
    prisma.productScenario.update({ where: { id: scenario.id }, data: { status: input.decision } }),
  ]);

  return record;
}

export async function listProductDecisions(context: Pick<MarketProductContext, "organizationId" | "role">, scenarioId: string) {
  requireMarketProductCapability(context, "PRODUCT_VIEW");
  return prisma.productDecisionRecord.findMany({ where: { organizationId: context.organizationId, scenarioId }, orderBy: { decidedAt: "desc" } });
}
