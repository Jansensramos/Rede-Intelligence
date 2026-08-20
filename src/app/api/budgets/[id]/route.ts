import { NextRequest, NextResponse } from "next/server";
import { getBudget, toBudgetWorkspaceView } from "@/application/budget/budget-service";
import { requireAuthContext } from "@/application/auth/session";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "A operação não pôde ser concluída.";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    const { id } = await params;
    const budget = await getBudget(context, id);
    return NextResponse.json({ success: true, data: toBudgetWorkspaceView(budget) });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
