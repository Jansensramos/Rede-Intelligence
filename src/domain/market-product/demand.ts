// Decomposição de sinais de demanda (plano 9J, seção J) — nunca um score mágico de 0 a 100.
// Quatro dimensões explícitas: formação de famílias, acessibilidade econômica, pressão comercial
// observada e déficit habitacional/substituição de estoque.

export interface DemandSignalsInput {
  currentHouseholds: number;
  householdGrowthRateAnnual: number;
  affordableHouseholdsShare: number; // 0..1 — % de domicílios locais com renda para o ticket alvo
  competitorMonthlyVelocityUnits: number; // velocidade histórica observada (unidades/mês)
  annualNewUnitsLaunched: number;
}

export interface DemandSignalsResult {
  newHouseholdsPerYear: number;
  affordableHouseholdsShare: number;
  commercialVelocitySignalUnitsMonth: number;
  housingDeficitRatio: number | null; // novas famílias/ano ÷ unidades novas lançadas/ano
}

export function decomposeDemandSignals(input: DemandSignalsInput): DemandSignalsResult {
  const newHouseholdsPerYear = input.currentHouseholds * input.householdGrowthRateAnnual;
  return {
    newHouseholdsPerYear,
    affordableHouseholdsShare: Math.max(0, Math.min(1, input.affordableHouseholdsShare)),
    commercialVelocitySignalUnitsMonth: Math.max(0, input.competitorMonthlyVelocityUnits),
    housingDeficitRatio: input.annualNewUnitsLaunched > 0 ? newHouseholdsPerYear / input.annualNewUnitsLaunched : null,
  };
}
