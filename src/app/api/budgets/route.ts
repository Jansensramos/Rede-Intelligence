import { NextRequest, NextResponse } from "next/server";
import { createBudget, listProjectBudgets, toBudgetWorkspaceView } from "@/application/budget/budget-service";
import { requireAuthContext } from "@/application/auth/session";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "A operação não pôde ser concluída.";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    const searchParams = request.nextUrl.searchParams;
    const projectId = searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId é obrigatório" }, { status: 400 });
    const budgets = await listProjectBudgets(context, projectId);
    return NextResponse.json({ success: true, data: budgets });
  } catch (error: unknown) {
    console.error("GET /api/budgets error:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    const body = await request.json();
    const { projectId, lineItems } = body;
    if (!projectId || !lineItems || !Array.isArray(lineItems)) return NextResponse.json({ error: "projectId e lineItems (array) são obrigatórios" }, { status: 400 });
    if (lineItems.length === 0) return NextResponse.json({ error: "Orçamento deve ter pelo menos uma linha" }, { status: 400 });
    const budget = await createBudget(context, { projectId, lineItems });
    return NextResponse.json({ success: true, data: toBudgetWorkspaceView(budget), message: `Orçamento criado com ${lineItems.length} linhas (Total: R$ ${budget.totalBudget.toFixed(2)})` }, { status: 201 });
  } catch (error: unknown) {
    console.error("POST /api/budgets error:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
