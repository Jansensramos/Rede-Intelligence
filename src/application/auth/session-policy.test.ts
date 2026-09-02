import { describe, expect, it } from "vitest";
import { sessionCookieOptions } from "./session";

describe("política do cookie de sessão", () => {
  it("é HttpOnly, SameSite=Lax e Secure em produção", () => {
    const expiresAt = new Date("2026-09-08T12:00:00.000Z");
    expect(sessionCookieOptions(expiresAt, "production")).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires: expiresAt,
    });
  });

  it("não exige transporte TLS apenas no ambiente local de teste", () => {
    expect(sessionCookieOptions(new Date(), "test").secure).toBe(false);
  });
});
