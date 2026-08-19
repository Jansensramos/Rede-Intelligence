import Decimal from "decimal.js";
import { z } from "zod";

const decimalString = z
  .string()
  .trim()
  .min(1, "Informe um valor")
  .refine((value) => {
    try {
      return new Decimal(value).isFinite();
    } catch {
      return false;
    }
  }, "Valor decimal inválido");

const nonNegativeDecimal = decimalString.refine(
  (value) => new Decimal(value).gte(0),
  "O valor não pode ser negativo",
);

const positiveDecimal = decimalString.refine(
  (value) => new Decimal(value).gt(0),
  "O valor deve ser maior que zero",
);

const percentage = nonNegativeDecimal.refine(
  (value) => new Decimal(value).lte(100),
  "O percentual não pode superar 100%",
);

export const projectAssumptionsSchema = z
  .object({
    projectName: z.string().trim().min(2, "Informe o nome do empreendimento"),
    city: z.string().trim().min(2, "Informe a cidade"),
    state: z.string().trim().length(2, "Use a sigla do estado").transform((value) => value.toUpperCase()),
    landAreaM2: positiveDecimal,
    units: z.number().int().positive("Informe pelo menos uma unidade"),
    privateAreaPerUnitM2: positiveDecimal,
    grossBuiltAreaM2: z.union([positiveDecimal, z.null()]),
    efficiencyRate: percentage.refine((value) => new Decimal(value).gt(0), "A eficiência deve ser maior que zero"),
    unitPrice: positiveDecimal,
    landPrice: nonNegativeDecimal,
    constructionCostPerM2: positiveDecimal,
    indirectCostsRate: percentage,
    contingencyRate: percentage,
    taxRate: percentage,
    commissionRate: percentage,
    marketingRate: percentage,
    approvalMonths: z.number().int().nonnegative(),
    constructionMonths: z.number().int().positive(),
    salesVelocityUnitsMonth: positiveDecimal,
    salesStartDelayMonths: z.number().int().nonnegative(),
    downPaymentRate: percentage,
    duringConstructionRate: percentage,
    onDeliveryRate: percentage,
    financingLimit: nonNegativeDecimal,
    annualFinancingRate: percentage,
    annualDiscountRate: percentage,
    policy: z.object({
      minimumMarginRate: percentage,
      minimumRoiRate: percentage,
      minimumIrrRate: percentage,
      maximumExposure: nonNegativeDecimal,
      minimumContingencyRate: percentage,
    }),
  })
  .superRefine((value, context) => {
    const total = new Decimal(value.downPaymentRate)
      .plus(value.duringConstructionRate)
      .plus(value.onDeliveryRate);
    if (!total.eq(100)) {
      context.addIssue({
        code: "custom",
        path: ["downPaymentRate"],
        message: "Entrada, obra e entrega devem somar 100%",
      });
    }
  });

export type ValidProjectAssumptions = z.infer<typeof projectAssumptionsSchema>;
