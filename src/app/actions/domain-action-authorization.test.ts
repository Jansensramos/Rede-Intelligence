import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const expected = {
  "capital.ts": "CAPITAL_READ", "design.ts": "ENGINEERING_READ", "engineering.ts": "ENGINEERING_READ",
  "executive-insights.ts": "EXECUTIVE_READ", "financial.ts": "FINANCIAL_READ", "integrations.ts": "INTEGRATIONS_READ",
  "investment.ts": "EXECUTIVE_READ", "land.ts": "VIABILITY_READ", "launch-intelligence.ts": "MARKET_PRODUCT_READ",
  "market-product.ts": "MARKET_PRODUCT_READ", "operations.ts": "OPERATIONS_READ", "procurement.ts": "PROCUREMENT_READ",
  "studies.ts": "VIABILITY_READ",
} as const;

describe("matriz arquitetural das Server Actions de domínio", () => {
  it("mantém um gate server-side explícito em cada módulo auditado", () => {
    for (const [file, capability] of Object.entries(expected)) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).toContain("requireDomainActionContext");
      expect(source, file).toContain(`requireDomainActionContext(\"${capability}\")`);
      expect(source, file).not.toContain('from "@/application/auth/session"');
    }
  });
});
