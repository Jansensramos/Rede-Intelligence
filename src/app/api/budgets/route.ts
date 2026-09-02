import { NextRequest, NextResponse } from "next/server";
import { createBudget, listProjectBudgets, toBudgetWorkspaceView } from "@/application/budget/budget-service";
import { requireAuthContext } from "@/application/auth/session";
import { reportInternalError, safeOperatorError } from "@/infrastructure/http/safe-error";
import { assertProtectedReadCapability, isReadAccessDeniedError } from "@/domain/auth/read-capabilities";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    assertProtectedReadCapability(context.role, "ENGINEERING_READ");
    const searchParams = request.nextUrl.searchParams;
    const projectId = searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId é obrigatório" }, { status: 400 });
    const budgets = await listProjectBudgets(context, projectId);
    return NextResponse.json({ success: true, data: budgets });
  } catch (error: unknown) {
    if (isReadAccessDeniedError(error)) return NextResponse.json({ error: error.message }, { status: 403 });
    const correlationId = reportInternalError(error, { component: "budgets-api", event: "list_failed", correlationId: request.headers.get("x-correlation-id") ?? undefined });
    return NextResponse.json({ error: safeOperatorError(correlationId) }, { status: 500, headers: { "x-correlation-id": correlationId } });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    assertProtectedReadCapability(context.role, "ENGINEERING_READ");
    const body = await request.json();
    const { projectId, lineItems } = body;
    if (!projectId || !lineItems || !Array.isArray(lineItems)) return NextResponse.json({ error: "projectId e lineItems (array) são obrigatórios" }, { status: 400 });
    if (lineItems.length === 0) return NextResponse.json({ error: "Orçamento deve ter pelo menos uma linha" }, { status: 400 });
    const budget = await createBudget(context, { projectId, lineItems });
    return NextResponse.json({ success: true, data: toBudgetWorkspaceView(budget), message: `Orçamento criado com ${lineItems.length} linhas (Total: R$ ${budget.totalBudget.toFixed(2)})` }, { status: 201 });
  } catch (error: unknown) {
    if (isReadAccessDeniedError(error)) return NextResponse.json({ error: error.message }, { status: 403 });
    const correlationId = reportInternalError(error, { component: "budgets-api", event: "create_failed", correlationId: request.headers.get("x-correlation-id") ?? undefined });
    return NextResponse.json({ error: safeOperatorError(correlationId) }, { status: 500, headers: { "x-correlation-id": correlationId } });
  }
}
