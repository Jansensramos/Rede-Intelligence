import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("final product readiness", () => {
  it("keeps market mutations behind an explicit write capability", () => {
    const source = read("src/app/actions/market-product.ts");
    expect(source).toContain('requireDomainWriteContext("MARKET_PRODUCT_READ", "MARKET_PRODUCT_WRITE")');
    expect(source).not.toContain('requireDomainActionContext("MARKET_PRODUCT_READ")');
  });

  it("surfaces the remaining 10C.1 operational gaps", () => {
    const people = read("src/app/(workspace)/pessoas/page.tsx");
    const accounting = read("src/app/(workspace)/contabilidade-controladoria/page.tsx");
    const commercial = read("src/app/(workspace)/comercial/page.tsx");
    const legal = read("src/app/(workspace)/juridico/page.tsx");

    expect(people).toContain("PeopleWorkforceOperabilityPanel");
    expect(accounting).toContain("AccountingGovernanceOperabilityPanel");
    expect(commercial).toContain("CommercialLifecycleOperabilityPanel");
    expect(legal).toContain("LegalLifecycleOperabilityPanel");
  });

  it("surfaces cognitive governance in both executive entry points", () => {
    const current = read("src/app/(workspace)/executivo/page.tsx");
    const drilldown = read("src/app/(workspace)/executivo/[projectId]/page.tsx");
    expect(current).toContain("ExecutiveCognitiveTimeline");
    expect(drilldown).toContain("ExecutiveCognitiveTimeline");
  });

  it("documents external activation separately from code completion", () => {
    const readiness = read("docs/FINAL_PRODUCT_READINESS_2026-09-18.md");
    expect(readiness).toContain("Provider comercial de IA");
    expect(readiness).toContain("Fontes de mercado ao vivo");
    expect(readiness).toContain("REDE Operator sobre sistemas externos");
    expect(readiness).toContain("Smoke test de produção");
  });
});
