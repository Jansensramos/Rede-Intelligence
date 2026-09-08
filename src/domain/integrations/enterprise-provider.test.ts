import { afterEach, describe, expect, it, vi } from "vitest";
import { EnterpriseError, enterpriseConfiguration, enterpriseRequest, enterpriseBinding, normalizeEnterpriseItem, supportsEnterpriseEntity, pullEnterprisePage, type EnterpriseEntity, type EnterpriseTransport } from "./enterprise-provider";
import { encryptEnterpriseEvidence, decryptEnterpriseEvidence, enterpriseDigest } from "@/infrastructure/security/enterprise-evidence-cipher";

describe("9P.5 canonical enterprise contract", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  const request = { entityType: "BUDGET" as const, requestKey: "job-1", cursor: null };
  const sample = { externalId: "external-1", externalVersion: "v1", entityType: "BUDGET", data: { status: "APPROVED", version: 1, currency: "BRL", totalBudget: "10.00" } };
  const fake = (raw: unknown): EnterpriseTransport => ({ kind: "LOCAL_SIMULATION", pull: vi.fn(async () => raw) });
  it.each(["DISABLED", "REAL"] as const)("blocks %s before any transport", async mode => {
    const t = fake(null); await expect(pullEnterprisePage(mode, request, new AbortController().signal, t)).rejects.toThrow(mode === "REAL" ? "REAL_NOT_CONFIGURED" : "DISABLED"); expect(t.pull).not.toHaveBeenCalled();
  });
  it("default MOCK is empty and does not call fetch", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    expect(await pullEnterprisePage("MOCK", request, new AbortController().signal)).toEqual({ items: [], nextCursor: null, checkpoint: "mock-empty" }); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects arbitrary endpoints, credentials, unproved REAL flags and unrestricted inputs", () => {
    const c = { mode: "MOCK", capability: "ERP", sourceKey: "local-source", perMinute: 10, retentionDays: 30 };
    expect(enterpriseConfiguration.safeParse(c).success).toBe(true);
    for (const extra of [{ verified: true }, { endpoint: "https://example.invalid" }, { token: "secret" }]) expect(enterpriseConfiguration.safeParse({ ...c, ...extra }).success).toBe(false);
    expect(enterpriseConfiguration.safeParse({ ...c, perMinute: 0 }).success).toBe(false);
    expect(enterpriseConfiguration.safeParse({ ...c, retentionDays: 181 }).success).toBe(false);
    expect(enterpriseRequest.safeParse({ idempotencyKey: "k", entityType: "BUDGET", organizationId: "foreign" }).success).toBe(false);
    expect(enterpriseBinding.safeParse({ entityType: "CUSTOMER", entityId: "id", externalId: "email@example.invalid" }).success).toBe(false);
  });
  it("rejects PII and unknown financial fields instead of copying raw provider payloads", () => {
    for (const change of [{ ...sample, cpf: "synthetic" }, { ...sample, data: { ...sample.data, email: "x@example.invalid" } }, { ...sample, data: { ...sample.data, totalBudget: "NaN" } }]) expect(() => normalizeEnterpriseItem(change)).toThrow("INVALID_RESPONSE");
  });
  const cases: Array<[EnterpriseEntity, Record<string, unknown>]> = [
    ["COMPANY", { status: "ACTIVE" }], ["PROJECT", { status: "ACTIVE", currency: "BRL" }], ["COST_CENTER", { code: "C1", status: "ACTIVE" }],
    ["SUPPLIER", { status: "ACTIVE" }], ["CUSTOMER", { status: "ACTIVE" }], ["BUDGET", sample.data], ["ECONOMIC_ITEM", { code: "E1", unit: "m2" }],
    ["OPERATIONAL_CONTRACT", { status: "ACTIVE", currency: "BRL", originalAmount: "10.00" }], ["MEASUREMENT", { status: "DRAFT", version: 1, grossAmount: "10.00", netAmount: "9.00" }],
    ["FINANCIAL_OBLIGATION", { status: "PENDING", amount: "10.00" }], ["ACCOUNTING_ENTRY", { status: "POSTED", totalDebit: "10.00", totalCredit: "10.00" }],
    ["LEAD", { stage: "NOVO" }], ["SALES_PROPOSAL", { status: "DRAFT", proposedPrice: "10.00" }], ["SALES_UNIT", { code: "A1", status: "DISPONIVEL" }],
    ["SALE", { status: "DRAFT", version: 1, soldPrice: "10.00" }], ["SALES_CONTRACT", { status: "DRAFT", version: 1, soldPrice: "10.00" }],
  ];
  it.each(cases)("normalizes the minimal %s projection", (entityType, data) => {
    expect(normalizeEnterpriseItem({ externalId: "x", externalVersion: "v1", entityType, data }).data).toEqual(data);
  });
  it("gates ERP and CRM capabilities without claiming a selected provider", () => {
    expect(supportsEnterpriseEntity("CRM", "BUDGET")).toBe(false); expect(supportsEnterpriseEntity("ERP", "LEAD")).toBe(false);
    expect(supportsEnterpriseEntity("CRM", "SALES_CONTRACT")).toBe(true); expect(supportsEnterpriseEntity("ERP", "ECONOMIC_ITEM")).toBe(true);
  });
  it("rejects cross-entity results and oversized pages", async () => {
    await expect(pullEnterprisePage("MOCK", { ...request, entityType: "LEAD" }, new AbortController().signal, fake({ items: [sample], nextCursor: null, checkpoint: "c" }))).rejects.toThrow("INVALID_RESPONSE");
    await expect(pullEnterprisePage("MOCK", request, new AbortController().signal, fake({ items: Array(101).fill(sample), nextCursor: null, checkpoint: "c" }))).rejects.toThrow("INVALID_RESPONSE");
  });
  it("redacts unclassified errors and preserves bounded retry classification", async () => {
    const t: EnterpriseTransport = { kind: "LOCAL_SIMULATION", async pull() { throw new Error("Authorization: private@example.invalid"); } };
    await expect(pullEnterprisePage("MOCK", request, new AbortController().signal, t)).rejects.toThrow("ENTERPRISE_TRANSPORT_FAILURE");
    const limited = new EnterpriseError("RATE_LIMIT", "RATE_LIMIT", 2500);
    await expect(pullEnterprisePage("MOCK", request, new AbortController().signal, { ...t, async pull() { throw limited; } })).rejects.toBe(limited);
  });
  it("honors abort before and after transport", async () => {
    const controller = new AbortController(); controller.abort(); const t = fake(null);
    await expect(pullEnterprisePage("MOCK", request, controller.signal, t)).rejects.toThrow("TRANSPORT_FAILURE"); expect(t.pull).not.toHaveBeenCalled();
    const after = new AbortController(); await expect(pullEnterprisePage("MOCK", request, after.signal, { kind: "LOCAL_SIMULATION", async pull() { after.abort(); return { items: [], nextCursor: null, checkpoint: "c" }; } })).rejects.toThrow("TRANSPORT_FAILURE");
  });
  it("requires a local encryption key and authenticates scope, ciphertext and key", () => {
    vi.stubEnv("INTEGRATION_SECRET_KEY", ""); expect(() => enterpriseDigest(sample)).toThrow("CONTENT_UNAVAILABLE");
    vi.stubEnv("INTEGRATION_SECRET_KEY", "qa-local-only-enterprise-key-not-a-provider-credential");
    const encrypted = encryptEnterpriseEvidence(sample, "scope-1"); expect(encrypted).not.toContain("APPROVED"); expect(decryptEnterpriseEvidence(encrypted, "scope-1")).toEqual(sample);
    expect(() => decryptEnterpriseEvidence(encrypted, "scope-2")).toThrow("CONTENT_UNAVAILABLE");
    const changed = Buffer.from(encrypted, "base64"); changed[15] ^= 1; expect(() => decryptEnterpriseEvidence(changed.toString("base64"), "scope-1")).toThrow("CONTENT_UNAVAILABLE");
    const digest = enterpriseDigest(sample); vi.stubEnv("INTEGRATION_SECRET_KEY", "a-different-qa-key-not-a-provider-credential"); expect(enterpriseDigest(sample)).not.toBe(digest); expect(() => decryptEnterpriseEvidence(encrypted, "scope-1")).toThrow("CONTENT_UNAVAILABLE");
  });
});
