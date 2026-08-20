import { NextRequest, NextResponse } from "next/server";
import { getBudget, getBudgetSummary } from "@/application/budget/budget-service";
import { prisma } from "@/infrastructure/database/prisma";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const budget = await getBudget(prisma, id);
    const summary = await getBudgetSummary(prisma, id, 16_800_000);
    return NextResponse.json({ success: true, data: { ...budget, summary } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
