import { describe, expect, it, vi } from "vitest";
import createNextConfig from "../../../next.config";
import { buildContentSecurityPolicy } from "./content-security-policy";

describe("headers de segurança", () => {
  it("aplica proteções estáticas sem duplicar a CSP dinâmica do middleware", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = createNextConfig("phase-production-build");
    const entries = await config.headers?.();
    const headers = Object.fromEntries((entries?.[0]?.headers ?? []).map((item) => [item.key.toLowerCase(), item.value]));
    expect(headers["content-security-policy"]).toBeUndefined();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    vi.unstubAllEnvs();
  });

  it("remove unsafe-inline de scripts em produção e preserva nonce, WebAssembly e worker BIM", () => {
    const csp = buildContentSecurityPolicy("nonce-seguro", true);
    const scriptDirective = csp.split("; ").find((directive) => directive.startsWith("script-src"));
    expect(scriptDirective).toContain("'nonce-nonce-seguro'");
    expect(scriptDirective).toContain("'strict-dynamic'");
    expect(scriptDirective).toContain("'wasm-unsafe-eval'");
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
