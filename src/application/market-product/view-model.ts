import { Prisma } from "@prisma/client";
import type { MarketProductWorkspace } from "./workspace-service";

// Fronteira de serialização Server → Client Component: converte Decimal/Date do Prisma em
// number/string simples antes de cruzar o limite RSC, sem exigir mapeamento manual campo a campo.
export type Serialized<T> = T extends Prisma.Decimal
  ? number
  : T extends Date
    ? string
    : T extends (infer U)[]
      ? Serialized<U>[]
      : T extends object
        ? { [K in keyof T]: Serialized<T[K]> }
        : T;

function serialize<T>(value: T): Serialized<T> {
  if (value instanceof Prisma.Decimal) return Number(value) as Serialized<T>;
  if (value instanceof Date) return value.toISOString() as Serialized<T>;
  if (Array.isArray(value)) return value.map((item) => serialize(item)) as Serialized<T>;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) out[key] = serialize(val);
    return out as Serialized<T>;
  }
  return value as Serialized<T>;
}

export type MarketProductWorkspaceView = Serialized<MarketProductWorkspace>;

export function buildMarketProductWorkspaceView(workspace: MarketProductWorkspace): MarketProductWorkspaceView {
  return serialize(workspace);
}
