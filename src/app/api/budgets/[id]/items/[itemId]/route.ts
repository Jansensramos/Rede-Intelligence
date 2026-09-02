import { NextRequest, NextResponse } from "next/server";
import { updateLineItem, deleteLineItem, toBudgetWorkspaceView } from "@/application/budget/budget-service";
import { requireAuthContext } from "@/application/auth/session";
import { reportInternalError, safeOperatorError } from "@/infrastructure/http/safe-error";
import { assertProtectedReadCapability, isReadAccessDeniedError } from "@/domain/auth/read-capabilities";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const context = await requireAuthContext();
    assertProtectedReadCapability(context.role, "ENGINEERING_READ");
    const { id, itemId } = await params;
    const body = await request.json();
    const updated = await updateLineItem(context, id, itemId, body);
    return NextResponse.json({ success: true, data: toBudgetWorkspaceView(updated) });
  } catch (error: unknown) {
    if (isReadAccessDeniedError(error)) return NextResponse.json({ error: error.message }, { status: 403 });
    const correlationId = reportInternalError(error, { component: "budgets-api", event: "item_update_failed", correlationId: request.headers.get("x-correlation-id") ?? undefined });
    return NextResponse.json({ error: safeOperatorError(correlationId) }, { status: 500, headers: { "x-correlation-id": correlationId } });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const context = await requireAuthContext();
    assertProtectedReadCapability(context.role, "ENGINEERING_READ");
    const { id, itemId } = await params;
    await deleteLineItem(context, id, itemId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (isReadAccessDeniedError(error)) return NextResponse.json({ error: error.message }, { status: 403 });
    const correlationId = reportInternalError(error, { component: "budgets-api", event: "item_delete_failed", correlationId: request.headers.get("x-correlation-id") ?? undefined });
    return NextResponse.json({ error: safeOperatorError(correlationId) }, { status: 500, headers: { "x-correlation-id": correlationId } });
  }
}
