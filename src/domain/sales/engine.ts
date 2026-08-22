import Decimal from "decimal.js";

export type DecimalLike = Decimal.Value;

const money = (value: DecimalLike) => new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const percentage = (value: DecimalLike) => new Decimal(value).toDecimalPlaces(6);

// ---------------------------------------------------------------------------
// Preço, desconto e alçada (Seções H/I/J/K do plano)
// ---------------------------------------------------------------------------

export function pricePerM2(price: DecimalLike, areaM2: DecimalLike) {
  const area = new Decimal(areaM2);
  if (area.isZero() || area.isNegative()) return new Decimal(0);
  return money(new Decimal(price).div(area));
}

export function computeDiscount(listPrice: DecimalLike, soldPrice: DecimalLike) {
  const list = money(listPrice);
  const sold = money(soldPrice);
  const discountAmount = money(list.sub(sold));
  const discountPercentage = list.isZero() ? new Decimal(0) : percentage(discountAmount.div(list));
  return { discountAmount, discountPercentage };
}

export function requiresDiscountApproval(soldPrice: DecimalLike, minimumAuthorizedPrice?: DecimalLike | null) {
  if (minimumAuthorizedPrice === null || minimumAuthorizedPrice === undefined) return false;
  return new Decimal(soldPrice).lessThan(minimumAuthorizedPrice);
}

// ---------------------------------------------------------------------------
// Máquina de estados da unidade (Seção F/R do plano)
// ---------------------------------------------------------------------------

export type SalesUnitStatus = "DISPONIVEL" | "EM_RESERVA" | "RESERVADA" | "EM_PROPOSTA" | "VENDIDA" | "BLOQUEADA" | "PERMUTA" | "DISTRATADA" | "ENTREGUE";

const UNIT_TRANSITIONS: Record<SalesUnitStatus, SalesUnitStatus[]> = {
  DISPONIVEL: ["EM_RESERVA", "EM_PROPOSTA", "BLOQUEADA", "PERMUTA"],
  EM_RESERVA: ["RESERVADA", "DISPONIVEL", "BLOQUEADA"],
  RESERVADA: ["VENDIDA", "DISPONIVEL", "BLOQUEADA", "EM_PROPOSTA"],
  EM_PROPOSTA: ["VENDIDA", "DISPONIVEL", "BLOQUEADA", "EM_RESERVA", "RESERVADA"],
  VENDIDA: ["DISTRATADA", "ENTREGUE"],
  BLOQUEADA: ["DISPONIVEL", "EM_RESERVA", "EM_PROPOSTA"],
  PERMUTA: ["DISPONIVEL", "VENDIDA"],
  DISTRATADA: ["DISPONIVEL"],
  ENTREGUE: [],
};

/** Estados a partir dos quais uma unidade pode ser vendida diretamente (usados na cláusula `where` do `updateMany` condicional). */
export const SALEABLE_UNIT_STATUSES: readonly SalesUnitStatus[] = ["DISPONIVEL", "RESERVADA", "EM_PROPOSTA"];

export function assertUnitTransition(from: SalesUnitStatus, to: SalesUnitStatus) {
  if (from === to) return;
  if (!UNIT_TRANSITIONS[from]?.includes(to)) throw new Error(`Transição de status de unidade inválida: ${from} → ${to}.`);
}

// ---------------------------------------------------------------------------
// Reserva (Seção Q) — expiração calculada em leitura, nunca armazenada
// ---------------------------------------------------------------------------

export function isReservationExpired(expiresAt: Date, status: string, referenceDate: Date) {
  return status === "ACTIVE" && expiresAt.getTime() < referenceDate.getTime();
}

// ---------------------------------------------------------------------------
// Distrato (Seção AC/AD) — devolução calculada, nunca decidida silenciosamente
// ---------------------------------------------------------------------------

export function calculateRescissionRefund(paidAmount: DecimalLike, retentionRate: DecimalLike) {
  const paid = money(paidAmount);
  const rate = new Decimal(retentionRate);
  if (rate.isNegative() || rate.greaterThan(1)) throw new Error("A taxa de retenção do distrato deve estar entre 0 e 1.");
  const retainedAmount = money(paid.mul(rate));
  const refundAmount = money(paid.sub(retainedAmount));
  if (refundAmount.isNegative()) throw new Error("O valor de devolução do distrato não pode ser negativo.");
  return { paidAmount: paid, retainedAmount, refundAmount };
}

// ---------------------------------------------------------------------------
// Comissão (Seção AE/AF) — percentage é fração (0.05 = 5%), igual a ownershipPercentage
// ---------------------------------------------------------------------------

export function calculateCommissionAmount(basis: "SOLD_PRICE" | "RECEIVED_AMOUNT", commissionPercentage: DecimalLike, soldPrice: DecimalLike, receivedAmount?: DecimalLike | null) {
  const base = basis === "SOLD_PRICE" ? new Decimal(soldPrice) : new Decimal(receivedAmount ?? 0);
  return money(base.mul(commissionPercentage));
}

// ---------------------------------------------------------------------------
// VGV e indicadores comerciais (Seção AG/AH) — cálculo puro, nunca armazenado
// ---------------------------------------------------------------------------

export interface VgvUnitInput {
  status: SalesUnitStatus;
  listPrice: DecimalLike;
}

export interface VgvSaleInput {
  status: "DRAFT" | "UNDER_APPROVAL" | "APPROVED" | "CANCELLED";
  soldPrice: DecimalLike;
  tradeInValue?: DecimalLike | null;
}

export function vgvBreakdown(units: VgvUnitInput[], sales: VgvSaleInput[]) {
  const sum = (values: DecimalLike[]) => money(values.reduce((total: Decimal, value) => total.add(value), new Decimal(0)));
  const total = sum(units.map((unit) => unit.listPrice));
  const disponivel = sum(units.filter((unit) => unit.status === "DISPONIVEL").map((unit) => unit.listPrice));
  const reservado = sum(units.filter((unit) => unit.status === "EM_RESERVA" || unit.status === "RESERVADA").map((unit) => unit.listPrice));
  const vendido = sum(sales.filter((sale) => sale.status === "APPROVED").map((sale) => sale.soldPrice));
  const distratado = sum(sales.filter((sale) => sale.status === "CANCELLED").map((sale) => sale.soldPrice));
  const permutado = sum(sales.filter((sale) => sale.status === "APPROVED" && sale.tradeInValue != null).map((sale) => sale.tradeInValue!));
  return { total, disponivel, reservado, vendido, distratado, permutado };
}

/** VGV a receber = vendido − recebido (nunca somado ao previsto, mesma disciplina de não-dupla-contagem da 9B). */
export function vgvToReceive(vgvSold: DecimalLike, vgvReceived: DecimalLike) {
  return money(new Decimal(vgvSold).sub(vgvReceived));
}

/** VSO (Vendas Sobre Oferta) = vendas do período / (estoque disponível no início + vendas do período). */
export function vso(unitsSoldInPeriod: number, unitsAvailableAtStart: number) {
  const offered = unitsAvailableAtStart + unitsSoldInPeriod;
  return offered <= 0 ? 0 : percentage(unitsSoldInPeriod / offered).toNumber();
}

/** Meses de estoque = estoque disponível / velocidade média de vendas (unidades/mês). */
export function monthsOfStock(unitsAvailable: number, averageUnitsSoldPerMonth: number) {
  if (averageUnitsSoldPerMonth <= 0) return null;
  return Math.round((unitsAvailable / averageUnitsSoldPerMonth) * 100) / 100;
}

export { money, percentage };
