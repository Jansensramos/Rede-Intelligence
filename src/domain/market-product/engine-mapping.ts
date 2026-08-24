import type { ProjectAssumptions } from "@/domain/financial/types";

// Fluxo direto sem duplicação de motor (plano 9J, seção AO) — mapeamento determinístico do
// cenário de produto para as premissas do REDE Engine (src/domain/financial/engine.ts).

export interface ProductScenarioEngineInput {
  totalUnits: number;
  averageUnitAreaM2: number;
  averageTicket: number;
  expectedVelocityUnitsMonth: number;
}

export function mapProductScenarioToAssumptions(scenario: ProductScenarioEngineInput, baseAssumptions: ProjectAssumptions): ProjectAssumptions {
  return {
    ...baseAssumptions,
    units: scenario.totalUnits,
    privateAreaPerUnitM2: scenario.averageUnitAreaM2.toFixed(2),
    unitPrice: scenario.averageTicket.toFixed(2),
    salesVelocityUnitsMonth: scenario.expectedVelocityUnitsMonth.toFixed(2),
  };
}
