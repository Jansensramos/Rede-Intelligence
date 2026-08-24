import type { MembershipRole } from "@prisma/client";

// Controle de acesso e matriz de permissões (plano 9J, seção AW).
export type MarketProductCapability =
  | "MARKET_VIEW"
  | "MARKET_MANAGE"
  | "MARKET_REFRESH"
  | "PRODUCT_VIEW"
  | "PRODUCT_SIMULATE"
  | "PRODUCT_RECOMMEND"
  | "PRODUCT_APPROVE";

const readOnly: MarketProductCapability[] = ["MARKET_VIEW", "PRODUCT_VIEW"];
const full: MarketProductCapability[] = [
  "MARKET_VIEW", "MARKET_MANAGE", "MARKET_REFRESH", "PRODUCT_VIEW", "PRODUCT_SIMULATE", "PRODUCT_RECOMMEND", "PRODUCT_APPROVE",
];

// Segregação intencional: ANALYST simula e recomenda mas não aprova; REVIEWER aprova/rejeita mas
// não constrói — evita que quem propõe o cenário também valide a própria proposta (mesma
// disciplina do gate ANALYST/REVIEWER da 9I).
const matrix: Record<MembershipRole, MarketProductCapability[]> = {
  OWNER: full,
  ADMIN: full,
  ANALYST: ["MARKET_VIEW", "MARKET_MANAGE", "PRODUCT_VIEW", "PRODUCT_SIMULATE", "PRODUCT_RECOMMEND"],
  REVIEWER: ["MARKET_VIEW", "PRODUCT_VIEW", "PRODUCT_APPROVE"],
  VIEWER: readOnly,
};

export function hasMarketProductCapability(role: MembershipRole, capability: MarketProductCapability) {
  return matrix[role].includes(capability);
}

export function assertMarketProductCapability(role: MembershipRole, capability: MarketProductCapability) {
  if (!hasMarketProductCapability(role, capability)) throw new Error(`A função ${role} não possui a capacidade ${capability}.`);
}
