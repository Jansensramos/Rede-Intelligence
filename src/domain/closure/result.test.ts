import { describe, expect, it } from "vitest";
import { computeRealizedResult, missingCentralEvidence, validateDistributionAgainstAvailable, validateApprovedDistributionsAggregate, type EvidenceValue } from "./result";

const COM = (value: string): EvidenceValue => ({ status: "COM_EVIDENCIA", value });
const SEM: EvidenceValue = { status: "SEM_EVIDENCIA", value: null };

describe("computeRealizedResult — decisão 5 (sem evidência nunca vira zero)", () => {
  it("todos os componentes centrais com evidência calcula o resultado e a margem", () => {
    const outcome = computeRealizedResult({
      realizedRevenue: COM("1000000.00"), realizedCost: COM("600000.00"), realizedExpenses: COM("50000.00"),
      realizedTaxes: COM("80000.00"), realizedFinancialCosts: COM("20000.00"), realizedVgv: COM("1200000.00"), realizedNetRevenue: COM("1000000.00"),
    });
    expect(outcome.realizedResult.status).toBe("COM_EVIDENCIA");
    expect(outcome.realizedResult.value).toBe("250000.00");
    expect(outcome.realizedMarginOnVgv.status).toBe("COM_EVIDENCIA");
  });

  it("receita SEM_EVIDENCIA torna o resultado e a margem SEM_EVIDENCIA", () => {
    const outcome = computeRealizedResult({
      realizedRevenue: SEM, realizedCost: COM("600000.00"), realizedExpenses: COM("50000.00"),
      realizedTaxes: COM("80000.00"), realizedFinancialCosts: COM("20000.00"), realizedVgv: COM("1200000.00"), realizedNetRevenue: SEM,
    });
    expect(outcome.realizedResult).toEqual(SEM);
    expect(outcome.realizedMarginOnVgv).toEqual(SEM);
  });

  it("custo, tributos ou despesas financeiras SEM_EVIDENCIA também bloqueiam o resultado", () => {
    const base = { realizedRevenue: COM("1000000.00"), realizedCost: COM("600000.00"), realizedExpenses: COM("50000.00"), realizedTaxes: COM("80000.00"), realizedFinancialCosts: COM("20000.00"), realizedVgv: COM("1200000.00"), realizedNetRevenue: COM("1000000.00") };
    expect(computeRealizedResult({ ...base, realizedCost: SEM }).realizedResult).toEqual(SEM);
    expect(computeRealizedResult({ ...base, realizedTaxes: SEM }).realizedResult).toEqual(SEM);
    expect(computeRealizedResult({ ...base, realizedFinancialCosts: SEM }).realizedResult).toEqual(SEM);
  });

  it("despesas operacionais SEM_EVIDENCIA entra como 0 na soma — nunca bloqueia sozinha (decisão 5 não lista 'despesas')", () => {
    const withExpenses = computeRealizedResult({ realizedRevenue: COM("1000000.00"), realizedCost: COM("600000.00"), realizedExpenses: COM("50000.00"), realizedTaxes: COM("80000.00"), realizedFinancialCosts: COM("20000.00"), realizedVgv: COM("1200000.00"), realizedNetRevenue: COM("1000000.00") });
    const withoutExpenses = computeRealizedResult({ realizedRevenue: COM("1000000.00"), realizedCost: COM("600000.00"), realizedExpenses: SEM, realizedTaxes: COM("80000.00"), realizedFinancialCosts: COM("20000.00"), realizedVgv: COM("1200000.00"), realizedNetRevenue: COM("1000000.00") });
    expect(withoutExpenses.realizedResult.status).toBe("COM_EVIDENCIA");
    expect(Number(withoutExpenses.realizedResult.value)).toBe(Number(withExpenses.realizedResult.value) + 50000);
  });

  it("VGV zero ou SEM_EVIDENCIA torna só a margem SEM_EVIDENCIA, sem bloquear o resultado", () => {
    const outcome = computeRealizedResult({ realizedRevenue: COM("1000000.00"), realizedCost: COM("600000.00"), realizedExpenses: COM("0"), realizedTaxes: COM("80000.00"), realizedFinancialCosts: COM("20000.00"), realizedVgv: COM("0"), realizedNetRevenue: COM("1000000.00") });
    expect(outcome.realizedResult.status).toBe("COM_EVIDENCIA");
    expect(outcome.realizedMarginOnVgv).toEqual(SEM);
  });

  it("valor NaN/Infinity resultante nunca é aceito como evidência válida (defesa contra corrupção/erro de unidade)", () => {
    const outcome = computeRealizedResult({ realizedRevenue: COM("1e30"), realizedCost: COM("0"), realizedExpenses: COM("0"), realizedTaxes: COM("0"), realizedFinancialCosts: COM("0"), realizedVgv: COM("1"), realizedNetRevenue: COM("1e30") });
    expect(outcome.realizedResult).toEqual(SEM);
  });
});

describe("missingCentralEvidence — decisão 5", () => {
  it("lista exatamente os campos centrais sem evidência", () => {
    const missing = missingCentralEvidence({ realizedRevenue: SEM, realizedCost: COM("1"), realizedTaxes: SEM, realizedFinancialCosts: COM("1"), realizedResult: COM("1"), realizedMarginOnVgv: COM("1") });
    expect(missing).toEqual(["receita realizada", "tributos realizados"]);
  });

  it("nenhum campo faltando retorna lista vazia", () => {
    const value = COM("1");
    const missing = missingCentralEvidence({ realizedRevenue: value, realizedCost: value, realizedTaxes: value, realizedFinancialCosts: value, realizedResult: value, realizedMarginOnVgv: value });
    expect(missing).toEqual([]);
  });
});

describe("validateDistributionAgainstAvailable — decisão 8 (distribuição simples, sem waterfall)", () => {
  it("CAPITAL_RETURN dentro do capital aportado disponível é permitido", () => {
    const outcome = validateDistributionAgainstAvailable({ nature: "CAPITAL_RETURN", amount: "50000.00", existingApprovedCapitalContributed: "100000.00", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: SEM });
    expect(outcome.allowed).toBe(true);
  });

  it("CAPITAL_RETURN acima do capital aportado disponível é recusado", () => {
    const outcome = validateDistributionAgainstAvailable({ nature: "CAPITAL_RETURN", amount: "150000.00", existingApprovedCapitalContributed: "100000.00", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: SEM });
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/excede o capital aportado/);
  });

  it("CAPITAL_RETURN considera retornos já aprovados anteriormente (soma incompatível com o disponível)", () => {
    const outcome = validateDistributionAgainstAvailable({ nature: "CAPITAL_RETURN", amount: "60000.00", existingApprovedCapitalContributed: "100000.00", existingApprovedCapitalReturned: "50000.00", existingApprovedResultBased: "0", realizedResult: SEM });
    expect(outcome.allowed).toBe(false);
  });

  it("CAPITAL_CONTRIBUTION é sempre permitido (registra o fato, decisão 6)", () => {
    const outcome = validateDistributionAgainstAvailable({ nature: "CAPITAL_CONTRIBUTION", amount: "999999.00", existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: SEM });
    expect(outcome.allowed).toBe(true);
  });

  it("RESULT_DISTRIBUTION/REMUNERATION/RETENTION/PROVISION dentro do resultado disponível é permitido", () => {
    for (const nature of ["RESULT_DISTRIBUTION", "REMUNERATION", "RETENTION", "PROVISION"] as const) {
      const outcome = validateDistributionAgainstAvailable({ nature, amount: "10000.00", existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: COM("20000.00") });
      expect(outcome.allowed).toBe(true);
    }
  });

  it("distribuição baseada em resultado acima do resultado disponível é recusada (soma incompatível)", () => {
    const outcome = validateDistributionAgainstAvailable({ nature: "RESULT_DISTRIBUTION", amount: "30000.00", existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: COM("20000.00") });
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/excede o resultado disponível/);
  });

  it("distribuição baseada em resultado quando o resultado está SEM_EVIDENCIA é sempre recusada (falha fechado)", () => {
    const outcome = validateDistributionAgainstAvailable({ nature: "RESULT_DISTRIBUTION", amount: "1.00", existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: SEM });
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/sem evidência/);
  });

  it("soma de distribuições já aprovadas é considerada — segunda distribuição some com a primeira", () => {
    const outcome = validateDistributionAgainstAvailable({ nature: "RESULT_DISTRIBUTION", amount: "15000.00", existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "10000.00", realizedResult: COM("20000.00") });
    expect(outcome.allowed).toBe(false);
  });

  it("valores zero, negativos, NaN ou Infinity são sempre recusados", () => {
    expect(validateDistributionAgainstAvailable({ nature: "CAPITAL_CONTRIBUTION", amount: "0", existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: SEM }).allowed).toBe(false);
    expect(validateDistributionAgainstAvailable({ nature: "CAPITAL_CONTRIBUTION", amount: "-100", existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: SEM }).allowed).toBe(false);
    expect(validateDistributionAgainstAvailable({ nature: "CAPITAL_CONTRIBUTION", amount: "NaN", existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: SEM }).allowed).toBe(false);
    expect(validateDistributionAgainstAvailable({ nature: "CAPITAL_CONTRIBUTION", amount: "Infinity", existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: SEM }).allowed).toBe(false);
  });

  it("valor absurdamente excessivo (corrupção/erro de unidade) é recusado pelo limite defensivo", () => {
    const outcome = validateDistributionAgainstAvailable({ nature: "CAPITAL_CONTRIBUTION", amount: "1e20", existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: SEM });
    expect(outcome.allowed).toBe(false);
  });
});

describe("validateApprovedDistributionsAggregate — revalidação na aprovação final (correção Alto #3)", () => {
  it("totais dentro dos valores vigentes são permitidos", () => {
    const outcome = validateApprovedDistributionsAggregate({ existingApprovedCapitalContributed: "100000.00", existingApprovedCapitalReturned: "40000.00", existingApprovedResultBased: "15000.00", realizedResult: COM("20000.00") });
    expect(outcome.allowed).toBe(true);
  });

  it("nenhuma distribuição aprovada (tudo zero) é sempre permitido, mesmo com resultado SEM_EVIDENCIA", () => {
    const outcome = validateApprovedDistributionsAggregate({ existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "0", realizedResult: SEM });
    expect(outcome.allowed).toBe(true);
  });

  it("soma de distribuições baseadas em resultado já aprovada excede o resultado vigente (recálculo/reprepare teria invalidado) → recusado", () => {
    const outcome = validateApprovedDistributionsAggregate({ existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "900000.00", realizedResult: COM("50000.00") });
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/excede o resultado realizado vigente/);
  });

  it("há distribuição baseada em resultado aprovada mas o resultado vigente está SEM_EVIDENCIA → recusado (falha fechado)", () => {
    const outcome = validateApprovedDistributionsAggregate({ existingApprovedCapitalContributed: "0", existingApprovedCapitalReturned: "0", existingApprovedResultBased: "1.00", realizedResult: SEM });
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/sem evidência/);
  });

  it("CAPITAL_RETURN aprovado excede o CAPITAL_CONTRIBUTION aprovado → recusado", () => {
    const outcome = validateApprovedDistributionsAggregate({ existingApprovedCapitalContributed: "100000.00", existingApprovedCapitalReturned: "150000.00", existingApprovedResultBased: "0", realizedResult: SEM });
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/CAPITAL_RETURN/);
  });
});
