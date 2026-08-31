import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("boundary assíncrono das integrações web", () => {
  it("a action de sincronização apenas valida o tenant e enfileira o trabalho", () => {
    const source = readFileSync(new URL("./integrations.ts", import.meta.url), "utf8");
    expect(source).toContain("enqueueJob(");
    expect(source).toContain("organizationId: context.organizationId");
    expect(source).not.toContain("runConnectorSync(");
  });
});
