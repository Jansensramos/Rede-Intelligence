import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { assertDemoSeedAllowed, resolveDemoLoginPresentation } from "./demo-access";

describe("política de acesso demonstrativo", () => {
  it("não apresenta credenciais em produção mesmo quando variáveis de demonstração existem", () => {
    const presentation = resolveDemoLoginPresentation({
      NODE_ENV: "production",
      ENABLE_DEMO_LOGIN: "true",
      DEMO_LOGIN_EMAIL: "conta@exemplo.invalid",
      DEMO_LOGIN_PASSWORD: "valor-de-teste",
    });
    expect(presentation).toEqual({ enabled: false });
    expect(JSON.stringify(presentation)).not.toContain("conta@exemplo.invalid");
    expect(JSON.stringify(presentation)).not.toContain("valor-de-teste");
  });

  it("mantém a conveniência explicitamente habilitada somente fora de produção", () => {
    expect(resolveDemoLoginPresentation({ NODE_ENV: "development", ENABLE_DEMO_LOGIN: "true", DEMO_LOGIN_EMAIL: "conta@exemplo.invalid", DEMO_LOGIN_PASSWORD: "valor-de-teste" }).enabled).toBe(true);
    expect(resolveDemoLoginPresentation({ NODE_ENV: "test", ENABLE_DEMO_LOGIN: "false", DEMO_LOGIN_EMAIL: "conta@exemplo.invalid", DEMO_LOGIN_PASSWORD: "valor-de-teste" })).toEqual({ enabled: false });
  });

  it("recusa o seed demonstrativo em produção antes de qualquer acesso ao banco", () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "production" })).toThrow(/proibido em produção/);
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "test" })).not.toThrow();
  });

  it("bloqueia o entrypoint real do seed quando o ambiente é produção", () => {
    const result = spawnSync(process.execPath, ["--import", "./scripts/patch-node-os.mjs", "--import", "tsx", "prisma/seed.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "postgresql://127.0.0.1:1/banco-inacessivel" },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("seed demonstrativo é proibido em produção");
    expect(`${result.stdout}${result.stderr}`).not.toContain("P1001");
  });
});
