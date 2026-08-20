import { NextRequest, NextResponse } from "next/server";
import { updateLineItem, deleteLineItem, toBudgetWorkspaceView } from "@/application/budget/budget-service";
import { requireAuthContext } from "@/application/auth/session";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "A operação não pôde ser concluída.";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const context = await requireAuthContext();
    const { id, itemId } = await params;
    const body = await request.json();
    const updated = await updateLineItem(context, id, itemId, body);
    return NextResponse.json({ success: true, data: toBudgetWorkspaceView(updated) });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const context = await requireAuthContext();
    const { id, itemId } = await params;
    await deleteLineItem(context, id, itemId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
