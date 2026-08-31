import { describe, expect, it } from "vitest";
import { GET as live } from "./live/route";
import { GET as ready } from "./ready/route";

describe("health da aplicação web", () => {
  it("expõe liveness sem detalhes sensíveis", async () => {
    const response = live();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "vivo", service: "web" });
  });
  it("confirma readiness com acesso ao banco isolado", async () => {
    const response = await ready();
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toMatch(/password|token|url/i);
  });
});
