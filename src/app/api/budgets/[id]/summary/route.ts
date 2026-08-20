import { NextRequest, NextResponse } from "next/server";
import { getBudgetSummary } from "@/application/budget/budget-service";
import { requireAuthContext } from "@/application/auth/session";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "A operação não pôde ser concluída.";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext();
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const vgv = searchParams.get("vgv") ? Number(searchParams.get("vgv")) : undefined;
    const summary = await getBudgetSummary(context, id, vgv);
    return NextResponse.json({ success: true, data: summary });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
