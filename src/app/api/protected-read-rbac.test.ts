import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/application/auth/session";

const viewerContext: AuthContext = {
  sessionId: "session-viewer",
  userId: "user-viewer",
  userName: "Pessoa com leitura limitada",
  userEmail: "viewer@example.invalid",
  organizationId: "organization-viewer",
  organizationName: "Organização de teste",
  organizationSlug: "organizacao-teste",
  role: "VIEWER",
};

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  requireAuthContext: vi.fn(),
}));

vi.mock("@/application/auth/session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/application/auth/session")>();
  return { ...original, ...authMocks };
});

import { GET as listBudgets, POST as createBudget } from "./budgets/route";
import { GET as budgetDetail } from "./budgets/[id]/route";
import { GET as budgetSummary } from "./budgets/[id]/summary/route";
import { PUT as updateBudgetItem, DELETE as deleteBudgetItem } from "./budgets/[id]/items/[itemId]/route";
import { GET as bimModel } from "./design/bim/[modelId]/route";
import { GET as bimGeometry } from "./design/bim/[modelId]/geometry/route";
import { GET as designFile } from "./design/files/[fileId]/route";
import { POST as aiChat } from "./ai/chat/route";

describe("RBAC de leitura nas APIs protegidas", () => {
  beforeEach(() => {
    authMocks.getAuthContext.mockResolvedValue(viewerContext);
    authMocks.requireAuthContext.mockResolvedValue(viewerContext);
  });

  it.each([
    ["orçamentos/lista", () => listBudgets(new Request("http://localhost/api/budgets?projectId=project") as never)],
    ["orçamentos/criação", () => createBudget(new Request("http://localhost/api/budgets", { method: "POST" }) as never)],
    ["orçamentos/detalhe", () => budgetDetail(new Request("http://localhost/api/budgets/budget") as never, { params: Promise.resolve({ id: "budget" }) })],
    ["orçamentos/resumo", () => budgetSummary(new Request("http://localhost/api/budgets/budget/summary") as never, { params: Promise.resolve({ id: "budget" }) })],
    ["orçamentos/item/alteração", () => updateBudgetItem(new Request("http://localhost/api/budgets/budget/items/item", { method: "PUT" }) as never, { params: Promise.resolve({ id: "budget", itemId: "item" }) })],
    ["orçamentos/item/exclusão", () => deleteBudgetItem(new Request("http://localhost/api/budgets/budget/items/item", { method: "DELETE" }) as never, { params: Promise.resolve({ id: "budget", itemId: "item" }) })],
    ["BIM/modelo", () => bimModel(new Request("http://localhost/api/design/bim/model"), { params: Promise.resolve({ modelId: "model" }) })],
    ["BIM/geometria", () => bimGeometry(new Request("http://localhost/api/design/bim/model/geometry"), { params: Promise.resolve({ modelId: "model" }) })],
    ["projeto/arquivo", () => designFile(new Request("http://localhost/api/design/files/file"), { params: Promise.resolve({ fileId: "file" }) })],
    ["REDE AI", () => aiChat(new Request("http://localhost/api/ai/chat", { method: "POST" }))],
  ])("nega VIEWER antes de carregar dados em %s", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Seu perfil não possui acesso a estes dados." });
  });
});
