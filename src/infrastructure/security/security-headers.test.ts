import { describe, expect, it, vi } from "vitest";
import createNextConfig from "../../../next.config";

describe("headers de segurança", () => {
  it("aplica CSP e proteções sem bloquear blob usado pelo BIM", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createNextConfig("phase-production-build");
    const entries = await config.headers?.();
    const headers = Object.fromEntries((entries?.[0]?.headers ?? []).map((item) => [item.key.toLowerCase(), item.value]));
    expect(headers["content-security-policy"]).toContain("worker-src 'self' blob:");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    vi.unstubAllEnvs();
  });
});
