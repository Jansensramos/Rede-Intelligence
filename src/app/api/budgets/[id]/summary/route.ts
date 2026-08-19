import { NextRequest, NextResponse } from "next/server";
import { getBudgetSummary } from "@/application/budget/budget-service";
import { prisma } from "@/infrastructure/database";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const vgv = searchParams.get("vgv") ? Number(searchParams.get("vgv")) : undefined;
    const summary = await getBudgetSummary(prisma, params.id, vgv);
    return NextResponse.json({ success: true, data: summary });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
