import { describe, expect, it } from "vitest";
import type { LegacyViewKey } from "./areas";
import { ECOSYSTEM_ENTRIES, HELP_ENTRY, OPERATIONAL_AREAS, TRANSVERSAL_AREAS, findAreaById, findAreaForViewKey, getPrimaryArea } from "./areas";

/** As 24 chaves hoje em `viewItems` de `src/components/intelligence-workspace.tsx` (legado, 9K.1 item 13: nunca apagado). */
const ALL_LEGACY_VIEW_KEYS: LegacyViewKey[] = [
  "overview", "assumptions", "land", "design", "budget", "procurement", "legal", "financial",
  "accounting", "integrations", "dataIntelligence", "marketIntelligence", "productIntelligence",
  "sales", "people", "scenarios", "sensitivity", "redteam", "committee", "studio", "dataroom",
  "ai", "cashflow", "risks", "audit",
];

describe("metadata de Grandes Áreas (9K.1, ordem de serviço §2)", () => {
  it("tem exatamente 12 áreas operacionais", () => {
    expect(OPERATIONAL_AREAS).toHaveLength(12);
  });

  it("Gestão Executiva é a primeira área e a única marcada como principal", () => {
    expect(OPERATIONAL_AREAS[0].id).toBe("gestao-executiva");
    expect(OPERATIONAL_AREAS[0].label).toBe("Gestão Executiva");
    expect(OPERATIONAL_AREAS[0].primary).toBe(true);
    expect(OPERATIONAL_AREAS.filter((area) => area.primary)).toHaveLength(1);
    expect(getPrimaryArea().id).toBe("gestao-executiva");
  });

  it("cobre todas as 24 abas legadas exatamente uma vez, sem sobreposição, entre áreas + transversais", () => {
    const covered = [...OPERATIONAL_AREAS, ...TRANSVERSAL_AREAS].flatMap((area) => area.viewKeys);
    expect(new Set(covered).size).toBe(covered.length);
    expect(new Set(covered)).toEqual(new Set(ALL_LEGACY_VIEW_KEYS));
  });

  it("Viabilidade concentra terreno, premissas, cenários, score/sensibilidade e decisão (item 3 da ordem de serviço)", () => {
    const viabilidade = findAreaById("viabilidade");
    expect(viabilidade?.viewKeys).toEqual(
      expect.arrayContaining(["land", "assumptions", "scenarios", "sensitivity", "redteam", "committee", "studio", "dataroom", "risks"]),
    );
  });

  it("nenhuma área operacional tem rota duplicada", () => {
    const paths = OPERATIONAL_AREAS.map((area) => area.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("cada área operacional tem uma rota real iniciando por /", () => {
    for (const area of OPERATIONAL_AREAS) expect(area.path.startsWith("/")).toBe(true);
  });

  it("findAreaForViewKey resolve tanto área operacional quanto transversal", () => {
    expect(findAreaForViewKey("financial")?.id).toBe("financeiro");
    expect(findAreaForViewKey("overview")?.id).toBe("gestao-executiva");
    expect(findAreaForViewKey("overview")?.transversal).toBeUndefined();
    expect(findAreaForViewKey("ai")?.id).toBe("rede-ai");
    expect(findAreaForViewKey("ai")?.transversal).toBe(true);
  });

  it("findAreaById resolve por id de área", () => {
    expect(findAreaById("juridico")?.label).toBe("Jurídico");
    expect(findAreaById("inexistente")).toBeUndefined();
  });
});

describe("ecossistema REDE e Ajuda (9K.1, itens 9-11)", () => {
  it("REDE Academy fica por último entre as entradas de ecossistema", () => {
    expect(ECOSYSTEM_ENTRIES.at(-1)?.id).toBe("rede-academy");
  });

  it("REDE Asset e REDE Academy são estruturais, separadas das 12 áreas operacionais", () => {
    const operationalIds = new Set(OPERATIONAL_AREAS.map((area) => area.id));
    for (const entry of ECOSYSTEM_ENTRIES) expect(operationalIds.has(entry.id)).toBe(false);
  });

  it("Central de Ajuda tem um ponto de entrada estrutural próprio", () => {
    expect(HELP_ENTRY.path).toBe("/ajuda");
  });
});
