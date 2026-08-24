// Solver determinístico de mix de tipologias e geração dos 3 cenários obrigatórios de produto
// (plano 9J, seções X, Y, Z, AB, AH). Nunca uma recomendação monolítica única: sempre Conservador,
// Base (Recomendado) e Potencial, ancorados em evidência de mercado — sem ML opaco ou números
// mágicos, cada passo é auditável no rationale retornado.

import { TYPOLOGY_CATALOG, findTypologyByCode, typologyMidpointAreaM2 } from "./typologies";
import type { ProductScenarioKind } from "./types";

export interface MixShapeLine {
  typologyCode: string;
  share: number; // fração do total de unidades, 0..1
}

export interface ScenarioArchetype {
  kind: ProductScenarioKind;
  label: string;
  priceMultiplier: number; // aplicado sobre a mediana de preço/m² dos concorrentes elegíveis
  velocityMultiplier: number; // aplicado sobre a velocidade média observada dos concorrentes
  mixShape: MixShapeLine[];
}

// Arquétipos de mix (plano 9J, seção AH — tabela ilustrativa de comparação de cenários). As
// proporções refletem estratégias distintas de risco/retorno; preço e velocidade multiplicam a
// evidência real de mercado, nunca substituem-na por um número fixo.
export const SCENARIO_ARCHETYPES: readonly ScenarioArchetype[] = [
  {
    kind: "CONSERVATIVE",
    label: "Cenário Conservador",
    priceMultiplier: 0.93,
    velocityMultiplier: 1.35,
    mixShape: [
      { typologyCode: "2_DORMITORIES_COMPACT", share: 0.8 },
      { typologyCode: "1_DORMITORY", share: 0.2 },
    ],
  },
  {
    kind: "BASE",
    label: "Cenário Base (Recomendado)",
    priceMultiplier: 1.0,
    velocityMultiplier: 1.0,
    mixShape: [
      { typologyCode: "2_DORMITORIES_COMPACT", share: 0.6 },
      { typologyCode: "3_DORMITORIES_SUITE", share: 0.3 },
      { typologyCode: "STUDIO", share: 0.1 },
    ],
  },
  {
    kind: "AGGRESSIVE",
    label: "Cenário Potencial",
    priceMultiplier: 1.07,
    velocityMultiplier: 0.7,
    mixShape: [
      { typologyCode: "2_DORMITORIES_SUITE", share: 0.5 },
      { typologyCode: "3_DORMITORIES_SUITE", share: 0.3 },
      { typologyCode: "STUDIO", share: 0.2 },
    ],
  },
] as const;

const CATALOG_MAX_AREA = Math.max(...TYPOLOGY_CATALOG.map((band) => band.maxAreaM2));

export interface MixSolverInput {
  maximumComputableAreaM2: number;
  targetEfficiencyRate: number; // área privativa / área computável, ex.: 0.82
  medianCompetitorPricePerSqm: number;
  competitorVelocityUnitsMonth: number;
  affordableAreaM2: number; // teto suave de área por acessibilidade econômica local
}

export interface ProductScenarioMixLineDraft {
  typologyCode: string;
  name: string;
  bedrooms: number;
  suites: number;
  bathrooms: number;
  parkingSpaces: number;
  privateAreaM2: number;
  unitCount: number;
  mixPercentage: number;
  targetPricePerSqm: number;
  targetUnitPrice: number;
  expectedMonthlySales: number;
}

export interface ProductScenarioDraft {
  kind: ProductScenarioKind;
  name: string;
  totalUnits: number;
  totalPrivateAreaM2: number;
  averageUnitAreaM2: number;
  targetVgv: number;
  averagePricePerSqm: number;
  averageTicket: number;
  expectedVelocityUnitsMonth: number;
  estimatedSalesDurationMonths: number;
  mixLines: ProductScenarioMixLineDraft[];
  mixRationale: string;
  areaRationale: string;
  priceRationale: string;
}

// Área por tipologia = ponto médio da faixa do catálogo, com teto suave de 60% acima da área
// suportável pela renda mediana local (perfis de maior renda ampliam a margem de financiamento,
// mas o produto nunca ignora completamente a capacidade de pagamento da região).
function resolveUnitAreaM2(typologyCode: string, affordableAreaM2: number): number {
  const band = findTypologyByCode(typologyCode);
  const midpoint = typologyMidpointAreaM2(band);
  const affordabilityCeiling = affordableAreaM2 * 1.6;
  const capped = Math.min(midpoint, Math.max(band.minAreaM2, affordabilityCeiling));
  return Math.max(band.minAreaM2, Math.min(band.maxAreaM2, capped));
}

// Unidades menores comandam prêmio de preço por m² — prática de mercado observada e documentada
// no rationale, nunca aplicada silenciosamente.
function pricePremiumForArea(unitAreaM2: number): number {
  return 1 + 0.1 * (1 - unitAreaM2 / CATALOG_MAX_AREA);
}

export function generateProductScenario(archetype: ScenarioArchetype, input: MixSolverInput): ProductScenarioDraft {
  const linesWithArea = archetype.mixShape.map((line) => {
    const band = findTypologyByCode(line.typologyCode);
    const privateAreaM2 = resolveUnitAreaM2(line.typologyCode, input.affordableAreaM2);
    return { band, share: line.share, privateAreaM2 };
  });

  const weightedAverageArea = linesWithArea.reduce((sum, line) => sum + line.privateAreaM2 * line.share, 0);
  const totalPrivateAreaBudget = input.maximumComputableAreaM2 * input.targetEfficiencyRate;
  const totalUnits = Math.max(1, Math.floor(totalPrivateAreaBudget / weightedAverageArea));

  const basePricePerSqm = input.medianCompetitorPricePerSqm * archetype.priceMultiplier;

  let allocatedUnits = 0;
  const mixLines: ProductScenarioMixLineDraft[] = linesWithArea.map((line, index) => {
    const isLast = index === linesWithArea.length - 1;
    const unitCount = isLast ? totalUnits - allocatedUnits : Math.round(totalUnits * line.share);
    allocatedUnits += unitCount;
    const targetPricePerSqm = basePricePerSqm * pricePremiumForArea(line.privateAreaM2);
    const targetUnitPrice = targetPricePerSqm * line.privateAreaM2;
    return {
      typologyCode: line.band.code,
      name: line.band.label,
      bedrooms: line.band.bedrooms,
      suites: line.band.suites,
      bathrooms: Math.max(1, line.band.suites + (line.band.bedrooms > line.band.suites ? 1 : 0)),
      parkingSpaces: line.band.defaultParkingSpaces,
      privateAreaM2: Math.round(line.privateAreaM2 * 100) / 100,
      unitCount: Math.max(0, unitCount),
      mixPercentage: totalUnits > 0 ? unitCount / totalUnits : 0,
      targetPricePerSqm: Math.round(targetPricePerSqm * 100) / 100,
      targetUnitPrice: Math.round(targetUnitPrice * 100) / 100,
      expectedMonthlySales: Math.round(input.competitorVelocityUnitsMonth * archetype.velocityMultiplier * line.share * 100) / 100,
    };
  });

  const totalPrivateAreaM2 = mixLines.reduce((sum, line) => sum + line.unitCount * line.privateAreaM2, 0);
  const targetVgv = mixLines.reduce((sum, line) => sum + line.unitCount * line.targetUnitPrice, 0);
  const averagePricePerSqm = totalPrivateAreaM2 > 0 ? targetVgv / totalPrivateAreaM2 : 0;
  const averageTicket = totalUnits > 0 ? targetVgv / totalUnits : 0;
  const expectedVelocityUnitsMonth = Math.max(0.1, input.competitorVelocityUnitsMonth * archetype.velocityMultiplier);
  const estimatedSalesDurationMonths = Math.ceil(totalUnits / expectedVelocityUnitsMonth);

  return {
    kind: archetype.kind,
    name: archetype.label,
    totalUnits,
    totalPrivateAreaM2: Math.round(totalPrivateAreaM2 * 100) / 100,
    averageUnitAreaM2: Math.round((totalPrivateAreaM2 / totalUnits) * 100) / 100,
    targetVgv: Math.round(targetVgv * 100) / 100,
    averagePricePerSqm: Math.round(averagePricePerSqm * 100) / 100,
    averageTicket: Math.round(averageTicket * 100) / 100,
    expectedVelocityUnitsMonth: Math.round(expectedVelocityUnitsMonth * 100) / 100,
    estimatedSalesDurationMonths,
    mixLines,
    mixRationale: `Mix de ${mixLines.length} tipologia(s) formulado a partir da estratégia "${archetype.label}", com ${(archetype.velocityMultiplier * 100).toFixed(0)}% da velocidade mediana observada nos concorrentes elegíveis.`,
    areaRationale: `Metragens ancoradas no ponto médio de cada faixa do catálogo padronizado, com teto suave de 60% acima da área suportável pela renda mediana local (${input.affordableAreaM2.toFixed(1)} m²).`,
    priceRationale: `Preço por m² formado a partir da mediana dos concorrentes elegíveis (R$ ${input.medianCompetitorPricePerSqm.toFixed(2)}/m²) ajustada por ${((archetype.priceMultiplier - 1) * 100).toFixed(1)}% conforme a estratégia do cenário, com prêmio adicional para unidades menores.`,
  };
}

// Gera sempre os 3 cenários obrigatórios (plano 9J, seção AH.1 — regra inviolável de mínimo 3
// cenários comparáveis).
export function generateProductScenarios(input: MixSolverInput): ProductScenarioDraft[] {
  return SCENARIO_ARCHETYPES.map((archetype) => generateProductScenario(archetype, input));
}
