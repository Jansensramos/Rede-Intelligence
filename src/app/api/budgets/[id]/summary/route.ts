import { NextRequest, NextResponse } from "next/server";
import { getBudgetSummary } from "@/application/budget/budget-service";
import { prisma } from "@/infrastructure/database/prisma";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const vgv = searchParams.get("vgv") ? Number(searchParams.get("vgv")) : undefined;
    const summary = await getBudgetSummary(prisma, id, vgv);
    return NextResponse.json({ success: true, data: summary });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
