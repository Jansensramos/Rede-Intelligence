import { describe, expect, it } from "vitest";
import {
  aggregateCorporateBreakEven,
  computeFreeCashToInvest,
  computeRunwayScenarios,
  computeSalesContribution,
  describeProjectBreakEven,
  describeRunwayApplicability,
  simulateDiscount,
  simulateHiring,
  type RunwayBaseInput,
  type RunwayScenarioResult,
} from "./engine";

describe("computeSalesContribution (pergunta 1 — quanto realmente sobra das vendas)", () => {
  const baseInput = {
    vgvVendido: 1_000_000,
    discountsGranted: 20_000,
    incentivesGranted: 5_000,
    salesCount: 4,
    commissionsRecorded: 30_000,
    vgvWithoutRecordedCommission: 0,
    commissionPolicyRate: null,
    taxRate: 0.06,
    taxRateSource: "Estudo de viabilidade ativo, cenário base",
    costsIncurredToDate: 400_000,
  };

  it("calcula a contribuição líquida quando todas as premissas existem", () => {
    const result = computeSalesContribution(baseInput);
    expect(result.status).toBe("OK");
    const netAfterDiscounts = 1_000_000 - 20_000 - 5_000;
    expect(result.data!.netAfterDiscounts).toBeCloseTo(netAfterDiscounts, 2);
    const taxes = netAfterDiscounts * 0.06;
    expect(result.data!.taxes.amount).toBeCloseTo(taxes, 2);
    expect(result.data!.cashContributionToDate).toBeCloseTo(netAfterDiscounts - taxes - 30_000 - 400_000, 2);
  });

  it("SEM_DADOS quando não há vendas aprovadas no escopo", () => {
    const result = computeSalesContribution({ ...baseInput, salesCount: 0, vgvVendido: 0 });
    expect(result.status).toBe("SEM_DADOS");
    expect(result.data).toBeNull();
  });

  it("nunca inventa taxa de imposto: sem estudo ativo, cashContributionToDate fica null (não zero, não estimado)", () => {
    const result = computeSalesContribution({ ...baseInput, taxRate: null, taxRateSource: null });
    expect(result.status).toBe("OK");
    expect(result.data!.taxes.amount).toBeNull();
    expect(result.data!.cashContributionToDate).toBeNull();
    expect(result.data!.notes.some((note) => note.includes("Sem taxa de imposto"))).toBe(true);
  });

  it("comissão sem política ativa para VGV não registrado fica sem evidência, não estimada como zero", () => {
    const result = computeSalesContribution({ ...baseInput, vgvWithoutRecordedCommission: 200_000, commissionPolicyRate: null });
    expect(result.data!.commissions.unresolvedVgv).toBe(200_000);
    expect(result.data!.commissions.estimated).toBe(0);
    expect(result.data!.cashContributionToDate).toBeNull();
  });

  it("estima comissão pela política ativa quando disponível, e reporta cashContributionToDate", () => {
    const result = computeSalesContribution({ ...baseInput, vgvWithoutRecordedCommission: 100_000, commissionPolicyRate: 0.05 });
    expect(result.data!.commissions.estimated).toBeCloseTo(5_000, 2);
    expect(result.data!.commissions.unresolvedVgv).toBe(0);
    expect(result.data!.cashContributionToDate).not.toBeNull();
  });

  it("é determinística: mesma entrada produz a mesma saída", () => {
    const first = computeSalesContribution(baseInput);
    const second = computeSalesContribution(baseInput);
    expect(first).toEqual(second);
  });
});

describe("computeRunwayScenarios (pergunta 2 — quanto tempo o caixa aguenta)", () => {
  const baseInput: RunwayBaseInput = {
    freeCash: 300_000,
    avgMonthlyOtherInflow: 10_000,
    avgMonthlySalesInflow: 100_000,
    avgMonthlyOutflow: 150_000,
    historicalMonths: 3,
    horizonMonths: 24,
  };

  it("SEM_EVIDENCIA quando não há histórico real (0 meses)", () => {
    const result = computeRunwayScenarios({ ...baseInput, historicalMonths: 0 });
    expect(result.status).toBe("SEM_EVIDENCIA");
    expect(result.data).toBeNull();
  });

  it("calcula os 4 cenários obrigatórios: atual, -20%, -40% e sem novas vendas", () => {
    const result = computeRunwayScenarios(baseInput);
    expect(result.status).toBe("OK");
    const scenarios = result.data!.map((item) => item.scenario);
    expect(scenarios).toEqual(["ATUAL", "QUEDA_20", "QUEDA_40", "SEM_NOVAS_VENDAS"]);
  });

  it("cenários de stress reduzem o runway monotonicamente (quanto mais queda de vendas, menos meses ou igual)", () => {
    const result = computeRunwayScenarios(baseInput);
    const [atual, queda20, queda40, semVendas] = result.data!;
    const monthsOrHorizon = (s: RunwayScenarioResult) => s.monthsOfRunway ?? Number.POSITIVE_INFINITY;
    expect(monthsOrHorizon(atual)).toBeGreaterThanOrEqual(monthsOrHorizon(queda20));
    expect(monthsOrHorizon(queda20)).toBeGreaterThanOrEqual(monthsOrHorizon(queda40));
    expect(monthsOrHorizon(queda40)).toBeGreaterThanOrEqual(monthsOrHorizon(semVendas));
  });

  it("premissas mostradas: cada cenário expõe as entradas/saídas mensais usadas no cálculo", () => {
    const result = computeRunwayScenarios(baseInput);
    const semVendas = result.data!.find((item) => item.scenario === "SEM_NOVAS_VENDAS")!;
    expect(semVendas.monthlyInflow).toBe(baseInput.avgMonthlyOtherInflow);
    expect(semVendas.monthlyOutflow).toBe(baseInput.avgMonthlyOutflow);
  });

  it("quando entradas médias cobrem as saídas, o cenário atual não zera dentro do horizonte", () => {
    const healthy: RunwayBaseInput = { ...baseInput, avgMonthlyOtherInflow: 50_000, avgMonthlySalesInflow: 200_000, avgMonthlyOutflow: 100_000 };
    const result = computeRunwayScenarios(healthy);
    const atual = result.data!.find((item) => item.scenario === "ATUAL")!;
    expect(atual.exceedsHorizon).toBe(true);
    expect(atual.monthsOfRunway).toBeNull();
  });

  it("NAO_APLICAVEL quando o caixa não está de fato sendo consumido no cenário atual", () => {
    const healthy: RunwayBaseInput = { ...baseInput, avgMonthlyOtherInflow: 50_000, avgMonthlySalesInflow: 200_000, avgMonthlyOutflow: 100_000 };
    const result = computeRunwayScenarios(healthy);
    const applicability = describeRunwayApplicability(result.data!);
    expect(applicability?.status).toBe("NAO_APLICAVEL");
  });

  it("é determinística", () => {
    const first = computeRunwayScenarios(baseInput);
    const second = computeRunwayScenarios(baseInput);
    expect(first).toEqual(second);
  });
});

describe("break-even (pergunta 3)", () => {
  it("empreendimento: calcula progresso e se já foi atingido", () => {
    const result = describeProjectBreakEven(2_000_000, 40, 0.55, 1_500_000);
    expect(result.status).toBe("OK");
    expect(result.data!.progress).toBeCloseTo(0.75, 2);
    expect(result.data!.reached).toBe(false);
  });

  it("marca como atingido quando vendido >= equilíbrio", () => {
    const result = describeProjectBreakEven(1_000_000, 20, 0.5, 1_200_000);
    expect(result.data!.reached).toBe(true);
  });

  it("SEM_EVIDENCIA quando o VGV de equilíbrio não é positivo", () => {
    const result = describeProjectBreakEven(0, 0, 0, 100_000);
    expect(result.status).toBe("SEM_EVIDENCIA");
  });

  it("corporativo: agrega só os projetos com estudo ativo e reporta quantos ficaram de fora", () => {
    const result = aggregateCorporateBreakEven(
      [
        { projectId: "p1", breakEvenVgv: 1_000_000, vgvVendido: 600_000 },
        { projectId: "p2", breakEvenVgv: 2_000_000, vgvVendido: 2_100_000 },
      ],
      3,
    );
    expect(result.status).toBe("OK");
    expect(result.data!.projectsIncluded).toBe(2);
    expect(result.data!.projectsExcluded).toBe(1);
    expect(result.data!.totalBreakEvenVgv).toBe(3_000_000);
  });

  it("corporativo: SEM_EVIDENCIA quando nenhum projeto do escopo tem estudo ativo", () => {
    const result = aggregateCorporateBreakEven([], 3);
    expect(result.status).toBe("SEM_EVIDENCIA");
  });
});

describe("simulateHiring (pergunta 4 — dá para contratar agora)", () => {
  const runwayBase: RunwayBaseInput = {
    freeCash: 500_000,
    avgMonthlyOtherInflow: 10_000,
    avgMonthlySalesInflow: 150_000,
    avgMonthlyOutflow: 140_000,
    historicalMonths: 3,
  };

  it("simulação nunca cria pessoa/folha — é uma função pura só de leitura/cálculo", () => {
    const result = simulateHiring({ monthlyCost: 15_000, runwayBase, reserveMinimum: 50_000 });
    expect(result.status).toBe("OK");
    expect(result.data).not.toHaveProperty("employeeId");
    expect(result.data).not.toHaveProperty("payrollId");
  });

  it("runway 'depois' nunca é melhor que 'antes' ao adicionar um custo mensal", () => {
    const result = simulateHiring({ monthlyCost: 20_000, runwayBase, reserveMinimum: 50_000 });
    const before = result.data!.before.monthsOfRunway ?? Number.POSITIVE_INFINITY;
    const after = result.data!.after.monthsOfRunway ?? Number.POSITIVE_INFINITY;
    expect(after).toBeLessThanOrEqual(before);
  });

  it("rejeita custo mensal inválido (<=0)", () => {
    expect(() => simulateHiring({ monthlyCost: 0, runwayBase, reserveMinimum: 50_000 })).toThrow();
  });

  it("SEM_EVIDENCIA quando não há histórico real de caixa", () => {
    const result = simulateHiring({ monthlyCost: 10_000, runwayBase: { ...runwayBase, historicalMonths: 0 }, reserveMinimum: 50_000 });
    expect(result.status).toBe("SEM_EVIDENCIA");
  });

  it("é determinística", () => {
    const first = simulateHiring({ monthlyCost: 15_000, runwayBase, reserveMinimum: 50_000 });
    const second = simulateHiring({ monthlyCost: 15_000, runwayBase, reserveMinimum: 50_000 });
    expect(first).toEqual(second);
  });
});

describe("simulateDiscount (pergunta 5 — esse desconto ainda faz sentido)", () => {
  it("calcula desconto, impacto de caixa e margem quando comissão/imposto existem", () => {
    const result = simulateDiscount({
      listPrice: 500_000,
      proposedPrice: 460_000,
      commissionRate: 0.05,
      taxRate: 0.06,
      minimumAuthorizedPrice: 450_000,
      requiredApprovalRole: null,
      monthsOfStock: 4,
    });
    expect(result.status).toBe("OK");
    expect(result.data!.discountAmount).toBeCloseTo(40_000, 2);
    expect(result.data!.marginBeforeNet).not.toBeNull();
    expect(result.data!.marginAfterNet).not.toBeNull();
    expect(result.data!.belowMinimumAuthorizedPrice).toBe(false);
  });

  it("sinaliza quando o preço proposto fica abaixo do mínimo autorizado", () => {
    const result = simulateDiscount({
      listPrice: 500_000,
      proposedPrice: 440_000,
      commissionRate: 0.05,
      taxRate: 0.06,
      minimumAuthorizedPrice: 450_000,
      requiredApprovalRole: null,
      monthsOfStock: null,
    });
    expect(result.data!.belowMinimumAuthorizedPrice).toBe(true);
  });

  it("reporta a alçada aplicável quando há política de desconto cadastrada para a faixa", () => {
    const result = simulateDiscount({
      listPrice: 500_000,
      proposedPrice: 470_000,
      commissionRate: null,
      taxRate: null,
      minimumAuthorizedPrice: 400_000,
      requiredApprovalRole: "ADMIN",
      monthsOfStock: null,
    });
    expect(result.data!.belowMinimumAuthorizedPrice).toBe(false);
    expect(result.data!.requiredApprovalRole).toBe("ADMIN");
    expect(result.data!.conclusion).toContain("ADMIN");
  });

  it("nunca inventa margem: sem comissão/imposto de referência, marginBeforeNet/marginAfterNet ficam null, não zero", () => {
    const result = simulateDiscount({
      listPrice: 500_000,
      proposedPrice: 460_000,
      commissionRate: null,
      taxRate: null,
      minimumAuthorizedPrice: null,
      requiredApprovalRole: null,
      monthsOfStock: null,
    });
    expect(result.data!.marginBeforeNet).toBeNull();
    expect(result.data!.marginAfterNet).toBeNull();
    expect(result.data!.conclusion).toContain("não pôde ser calculado");
  });

  it("nunca recomenda a decisão — a conclusão descreve impacto, não diz 'aprove' nem 'recuse'", () => {
    const result = simulateDiscount({ listPrice: 500_000, proposedPrice: 460_000, commissionRate: 0.05, taxRate: 0.06, minimumAuthorizedPrice: null, requiredApprovalRole: null, monthsOfStock: null });
    expect(result.data!.conclusion.toLowerCase()).not.toContain("recomend");
  });

  it("rejeita preço de tabela inválido", () => {
    expect(() => simulateDiscount({ listPrice: 0, proposedPrice: 0, commissionRate: null, taxRate: null, minimumAuthorizedPrice: null, requiredApprovalRole: null, monthsOfStock: null })).toThrow();
  });

  it("é determinística", () => {
    const input = { listPrice: 500_000, proposedPrice: 460_000, commissionRate: 0.05, taxRate: 0.06, minimumAuthorizedPrice: 450_000, requiredApprovalRole: null, monthsOfStock: 4 };
    expect(simulateDiscount(input)).toEqual(simulateDiscount(input));
  });
});

describe("computeFreeCashToInvest (pergunta 6 — existe caixa livre para investir)", () => {
  it("nunca usa só o saldo bancário: desconta reserva mínima e obrigações próximas", () => {
    const result = computeFreeCashToInvest({ cashPosition: 1_000_000, reserveMinimum: 200_000, obligationsNear: 300_000 });
    expect(result.status).toBe("OK");
    expect(result.data!.freeToInvest).toBe(500_000);
  });

  it("pode retornar negativo (informação real, não um erro)", () => {
    const result = computeFreeCashToInvest({ cashPosition: 100_000, reserveMinimum: 200_000, obligationsNear: 50_000 });
    expect(result.data!.freeToInvest).toBe(-150_000);
  });

  it("SEM_EVIDENCIA quando não há posição de caixa consolidada (sem conta vinculada)", () => {
    const result = computeFreeCashToInvest({ cashPosition: null, reserveMinimum: 0, obligationsNear: 0 });
    expect(result.status).toBe("SEM_EVIDENCIA");
    expect(result.data).toBeNull();
  });
});
