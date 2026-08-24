import { describe, expect, it } from "vitest";
import type { LegacyViewKey } from "./areas";
import { OPERATIONAL_AREAS, TRANSVERSAL_AREAS, findAreaForViewKey } from "./areas";

/** As 24 chaves hoje em `viewItems` de `src/components/intelligence-workspace.tsx`. */
const ALL_LEGACY_VIEW_KEYS: LegacyViewKey[] = [
  "overview", "assumptions", "land", "design", "budget", "procurement", "legal", "financial",
  "accounting", "integrations", "dataIntelligence", "marketIntelligence", "productIntelligence",
  "sales", "people", "scenarios", "sensitivity", "redteam", "committee", "studio", "dataroom",
  "ai", "cashflow", "risks", "audit",
];

describe("metadata de Grandes Áreas (9K.0, plano §E)", () => {
  it("tem exatamente 12 áreas operacionais, nenhuma nova além do plano", () => {
    expect(OPERATIONAL_AREAS).toHaveLength(12);
  });

  it("cobre todas as abas legadas exatamente uma vez, sem sobreposição", () => {
    const covered = [...OPERATIONAL_AREAS, ...TRANSVERSAL_AREAS].flatMap((area) => area.viewKeys);
    expect(new Set(covered).size).toBe(covered.length);
    expect(new Set(covered)).toEqual(new Set(ALL_LEGACY_VIEW_KEYS));
  });

  it("findAreaForViewKey resolve tanto área operacional quanto transversal", () => {
    expect(findAreaForViewKey("financial")?.id).toBe("financeiro");
    expect(findAreaForViewKey("overview")?.id).toBe("visao-executiva");
    expect(findAreaForViewKey("overview")?.transversal).toBe(true);
  });
});
