import { NextRequest, NextResponse } from "next/server";
import { getBudget, toBudgetWorkspaceView } from "@/application/budget/budget-service";
import { requireAuthContext } from "@/application/auth/session";
import { reportInternalError, safeOperatorError } from "@/infrastructure/http/safe-error";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    const { id } = await params;
    const budget = await getBudget(context, id);
    return NextResponse.json({ success: true, data: toBudgetWorkspaceView(budget) });
  } catch (error: unknown) {
    const correlationId = reportInternalError(error, { component: "budgets-api", event: "detail_failed", correlationId: request.headers.get("x-correlation-id") ?? undefined });
    return NextResponse.json({ error: safeOperatorError(correlationId) }, { status: 500, headers: { "x-correlation-id": correlationId } });
  }
}
