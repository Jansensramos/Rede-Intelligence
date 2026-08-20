/**
 * Budget Engine - Domain Logic
 * Cálculos puros de orçamento sem dependências externas
 */

export interface BudgetLineItemInput {
  phase: string;
  category: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
}

export interface BudgetLineItem extends BudgetLineItemInput {
  totalCost: number;
}

export interface CategoryTotal {
  category: string;
  totalCost: number;
  percentage: number;
}

export interface PhaseTotal {
  phase: string;
  totalCost: number;
  percentage: number;
  items: BudgetLineItem[];
}

export interface BudgetSummary {
  totalBudget: number;
  categoryTotals: CategoryTotal[];
  phaseTotals: PhaseTotal[];
  vgv?: number;
  margin?: number;
  marginPercentage?: number;
}

export function calculateLineItemTotal(
  quantity: number,
  unitCost: number
): number {
  return Number((quantity * unitCost).toFixed(2));
}

export function calculateCategoryTotals(
  items: BudgetLineItem[]
): CategoryTotal[] {
  const categoryMap = new Map<string, number>();

  items.forEach((item) => {
    const current = categoryMap.get(item.category) || 0;
    categoryMap.set(item.category, current + item.totalCost);
  });

  const totalBudget = Array.from(categoryMap.values()).reduce(
    (sum, val) => sum + val,
    0
  );

  return Array.from(categoryMap.entries()).map(([category, total]) => ({
    category,
    totalCost: Number(total.toFixed(2)),
    percentage: totalBudget > 0 ? (total / totalBudget) * 100 : 0,
  }));
}

export function calculatePhaseTotals(
  items: BudgetLineItem[]
): PhaseTotal[] {
  const phaseMap = new Map<string, BudgetLineItem[]>();

  items.forEach((item) => {
    if (!phaseMap.has(item.phase)) {
      phaseMap.set(item.phase, []);
    }
    phaseMap.get(item.phase)!.push(item);
  });

  const totalBudget = items.reduce((sum, item) => sum + item.totalCost, 0);

  const phaseTotals = Array.from(phaseMap.entries()).map(([phase, items]) => {
    const phaseTotal = items.reduce((sum, item) => sum + item.totalCost, 0);
    return {
      phase,
      totalCost: Number(phaseTotal.toFixed(2)),
      percentage: totalBudget > 0 ? (phaseTotal / totalBudget) * 100 : 0,
      items,
    };
  });

  const phaseOrder = [
    "LAND_PREP",
    "FOUNDATION",
    "STRUCTURE",
    "MASONRY",
    "MEP",
    "FINISHING",
    "DELIVERY",
  ];

  return phaseTotals.sort((a, b) => {
    const indexA = phaseOrder.indexOf(a.phase);
    const indexB = phaseOrder.indexOf(b.phase);
    return (indexA >= 0 ? indexA : 999) - (indexB >= 0 ? indexB : 999);
  });
}

export function calculateBudgetSummary(
  items: BudgetLineItem[],
  vgv?: number
): BudgetSummary {
  const totalBudget = items.reduce((sum, item) => sum + item.totalCost, 0);
  const categoryTotals = calculateCategoryTotals(items);
  const phaseTotals = calculatePhaseTotals(items);

  const summary: BudgetSummary = {
    totalBudget: Number(totalBudget.toFixed(2)),
    categoryTotals,
    phaseTotals,
  };

  if (vgv && vgv > 0) {
    const margin = vgv - totalBudget;
    summary.vgv = vgv;
    summary.margin = Number(margin.toFixed(2));
    summary.marginPercentage = Number(((margin / vgv) * 100).toFixed(2));
  }

  return summary;
}

export function validateBudget(
  items: BudgetLineItem[],
  vgv: number,
  minMarginPercentage: number = 25
): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (items.length === 0) {
    errors.push("Orçamento deve ter pelo menos uma linha de custo");
    return { valid: false, errors };
  }

  const totalBudget = items.reduce((sum, item) => sum + item.totalCost, 0);

  if (totalBudget > vgv) {
    errors.push(`Custos (R$ ${totalBudget.toFixed(2)}) excedem VGV (R$ ${vgv.toFixed(2)})`);
  }

  const margin = vgv - totalBudget;
  const marginPercentage = (margin / vgv) * 100;

  if (marginPercentage < minMarginPercentage) {
    errors.push(
      `Margin ${marginPercentage.toFixed(2)}% abaixo do mínimo ${minMarginPercentage}%`
    );
  }

  items.forEach((item, index) => {
    if (item.quantity <= 0) {
      errors.push(`Item ${index + 1}: Quantidade deve ser > 0`);
    }
    if (item.unitCost < 0) {
      errors.push(`Item ${index + 1}: Custo unitário não pode ser negativo`);
    }
    if (!item.description || item.description.trim() === "") {
      errors.push(`Item ${index + 1}: Descrição é obrigatória`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

export const COLINAS_MOOCA_BUDGET: BudgetLineItemInput[] = [
  { phase: "FOUNDATION", category: "CONSTRUCTION", description: "Escavação + Fundação", quantity: 2500, unit: "m²", unitCost: 336 },
  { phase: "STRUCTURE", category: "CONSTRUCTION", description: "Pilares + Vigas (Estrutura)", quantity: 2800, unit: "m²", unitCost: 600 },
  { phase: "MASONRY", category: "CONSTRUCTION", description: "Vedação + Blocos", quantity: 2100, unit: "m²", unitCost: 280 },
  { phase: "FINISHING", category: "CONSTRUCTION", description: "Acabamento Interno", quantity: 2000, unit: "m²", unitCost: 504 },
  { phase: "MEP", category: "CONSTRUCTION", description: "Instalações MEP", quantity: 2800, unit: "m²", unitCost: 300 },
  { phase: "LAND_PREP", category: "LAND", description: "Aquisição de Terreno", quantity: 1, unit: "lote", unitCost: 2000000 },
  { phase: "LAND_PREP", category: "LAND", description: "ITBI (Imposto Transferência)", quantity: 1, unit: "lote", unitCost: 160000 },
  { phase: "LAND_PREP", category: "LAND", description: "Cartório + Custas", quantity: 1, unit: "lote", unitCost: 40000 },
  { phase: "DELIVERY", category: "COMMERCIAL", description: "Corretagem (3%)", quantity: 1, unit: "projeto", unitCost: 504000 },
  { phase: "DELIVERY", category: "COMMERCIAL", description: "Marketing e Publicidade", quantity: 1, unit: "projeto", unitCost: 840000 },
  { phase: "DELIVERY", category: "COMMERCIAL", description: "Showroom e Maquete", quantity: 1, unit: "projeto", unitCost: 168000 },
  { phase: "LAND_PREP", category: "TAXES", description: "Aprovação Prefeitura", quantity: 1, unit: "projeto", unitCost: 420000 },
  { phase: "FOUNDATION", category: "TAXES", description: "Licenças Ambientais", quantity: 1, unit: "projeto", unitCost: 168000 },
  { phase: "STRUCTURE", category: "TAXES", description: "Anotação de Responsabilidade", quantity: 1, unit: "projeto", unitCost: 252000 },
  { phase: "LAND_PREP", category: "PROJECT", description: "Projeto Arquitetônico Completo", quantity: 1, unit: "projeto", unitCost: 336000 },
  { phase: "FOUNDATION", category: "PROJECT", description: "Projetos Complementares", quantity: 1, unit: "projeto", unitCost: 252000 },
  { phase: "FOUNDATION", category: "PROJECT", description: "Coordenação e Administrativo", quantity: 24, unit: "mês-obra", unitCost: 20833.33 },
  { phase: "STRUCTURE", category: "CONTINGENCY", description: "Contingência Técnica", quantity: 1, unit: "projeto", unitCost: 1344000 },
];

export const START_BUTANTA_BUDGET: BudgetLineItemInput[] = [
  { phase: "LAND_PREP", category: "LAND", description: "Aquisição do terreno", quantity: 1, unit: "lote", unitCost: 8_000_000 },
  { phase: "STRUCTURE", category: "CONSTRUCTION", description: "Construção MCMV", quantity: 10_975.6098, unit: "m²", unitCost: 2_240 },
  { phase: "FOUNDATION", category: "INDIRECT", description: "Custos indiretos", quantity: 1, unit: "projeto", unitCost: 1_966_829.27 },
  { phase: "STRUCTURE", category: "CONTINGENCY", description: "Contingência técnica", quantity: 1, unit: "projeto", unitCost: 1_229_268.29 },
  { phase: "DELIVERY", category: "TAXES", description: "Tributos sobre vendas", quantity: 1, unit: "projeto", unitCost: 1_660_000 },
  { phase: "DELIVERY", category: "COMMERCIAL", description: "Comissão de vendas", quantity: 1, unit: "projeto", unitCost: 2_075_000 },
  { phase: "DELIVERY", category: "COMMERCIAL", description: "Marketing", quantity: 1, unit: "projeto", unitCost: 1_245_000 },
];

export function calculateImpactOnFinancial(
  currentBudgetTotal: number,
  newBudgetTotal: number,
  vgv: number
) {
  const budgetChange = newBudgetTotal - currentBudgetTotal;
  const budgetChangePercent = (budgetChange / currentBudgetTotal) * 100;
  const currentMargin = vgv - currentBudgetTotal;
  const newMargin = vgv - newBudgetTotal;

  return {
    budgetChange: Number(budgetChange.toFixed(2)),
    budgetChangePercent: Number(budgetChangePercent.toFixed(2)),
    marginImpact: Number((newMargin - currentMargin).toFixed(2)),
    marginImpactPercent: Number(((newMargin / vgv - currentMargin / vgv) * 100).toFixed(2)),
  };
}
