import { describe, expect, it } from "vitest";
import { evaluateRateLimit, emptyRateLimitState } from "@/domain/integrations/rate-limiter";
import { DUMMY_PASSWORD_HASH, INVALID_LOGIN_MESSAGE, LOGIN_RATE_LIMIT_POLICY, passwordHashForVerification } from "./login-security";

describe("proteção do login", () => {
  it("não diferencia usuário ausente de usuário inativo", () => {
    expect(passwordHashForVerification(null)).toBe(DUMMY_PASSWORD_HASH);
    expect(passwordHashForVerification({ isActive: false, passwordHash: "hash-real" })).toBe(DUMMY_PASSWORD_HASH);
    expect(INVALID_LOGIN_MESSAGE).not.toMatch(/usuário|senha incorreta/i);
  });

  it("usa o hash real somente para usuário ativo", () => {
    expect(passwordHashForVerification({ isActive: true, passwordHash: "hash-real" })).toBe("hash-real");
  });

  it("bloqueia a sexta tentativa na janela sem alterar a mensagem genérica", () => {
    let state = emptyRateLimitState();
    for (let attempt = 0; attempt < LOGIN_RATE_LIMIT_POLICY.limit; attempt += 1) {
      const decision = evaluateRateLimit(state, LOGIN_RATE_LIMIT_POLICY, 1_000);
      expect(decision.allowed).toBe(true);
      state = decision.state;
    }
    expect(evaluateRateLimit(state, LOGIN_RATE_LIMIT_POLICY, 1_000).allowed).toBe(false);
    expect(INVALID_LOGIN_MESSAGE).toContain("temporariamente");
  });
});
