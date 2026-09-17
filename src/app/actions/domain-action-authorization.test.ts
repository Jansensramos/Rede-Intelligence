import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const expected = {
  "capital.ts": { read: "CAPITAL_READ", gate: "requireDomainActionContext" },
  "design.ts": { read: "ENGINEERING_READ", gate: "requireDomainActionContext" },
  "engineering.ts": { read: "ENGINEERING_READ", gate: "requireDomainActionContext" },
  "executive-insights.ts": { read: "EXECUTIVE_READ", gate: "requireDomainActionContext" },
  "financial.ts": { read: "FINANCIAL_READ", gate: "requireDomainActionContext" },
  "integrations.ts": { read: "INTEGRATIONS_READ", gate: "requireDomainActionContext" },
  "investment.ts": { read: "EXECUTIVE_READ", gate: "requireDomainActionContext" },
  "land.ts": { read: "VIABILITY_READ", gate: "requireDomainWriteContext", write: "VIABILITY_WRITE" },
  "launch-intelligence.ts": { read: "MARKET_PRODUCT_READ", gate: "requireDomainActionContext" },
  "market-product.ts": { read: "MARKET_PRODUCT_READ", gate: "requireDomainWriteContext", write: "MARKET_PRODUCT_WRITE" },
  "operations.ts": { read: "OPERATIONS_READ", gate: "requireDomainWriteContext", write: "OPERATIONS_WRITE", approval: "OPERATIONS_APPROVE" },
  "procurement.ts": { read: "PROCUREMENT_READ", gate: "requireDomainActionContext" },
  "studies.ts": { read: "VIABILITY_READ", gate: "requireDomainWriteContext", write: "VIABILITY_WRITE" },
} as const;

describe("matriz arquitetural das Server Actions de domínio", () => {
  it("mantém gate server-side explícito e capabilities esperadas em cada módulo auditado", () => {
    for (const [file, contract] of Object.entries(expected)) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).toContain('from "./authorization"');
      expect(source, file).toContain(contract.gate);
      expect(source, file).toContain(`"${contract.read}"`);
      if ("write" in contract) expect(source, file).toContain(`"${contract.write}"`);
      if ("approval" in contract) {
        expect(source, file).toContain("requireDomainApprovalContext");
        expect(source, file).toContain(`"${contract.approval}"`);
      }
      expect(source, file).not.toContain('from "@/application/auth/session"');
    }
  });
});
