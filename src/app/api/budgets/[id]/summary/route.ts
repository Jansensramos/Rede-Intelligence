import { NextRequest, NextResponse } from "next/server";
import { getBudgetSummary } from "@/application/budget/budget-service";
import { requireAuthContext } from "@/application/auth/session";
import { reportInternalError, safeOperatorError } from "@/infrastructure/http/safe-error";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const vgv = searchParams.get("vgv") ? Number(searchParams.get("vgv")) : undefined;
    const summary = await getBudgetSummary(context, id, vgv);
    return NextResponse.json({ success: true, data: summary });
  } catch (error: unknown) {
    const correlationId = reportInternalError(error, { component: "budgets-api", event: "summary_failed", correlationId: request.headers.get("x-correlation-id") ?? undefined });
    return NextResponse.json({ error: safeOperatorError(correlationId) }, { status: 500, headers: { "x-correlation-id": correlationId } });
  }
}
