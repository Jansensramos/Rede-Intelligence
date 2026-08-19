import { NextRequest, NextResponse } from "next/server";
import { getBudget, getBudgetSummary } from "@/application/budget/budget-service";
import { prisma } from "@/infrastructure/database";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const budget = await getBudget(prisma, params.id);
    const summary = await getBudgetSummary(prisma, params.id, 16_800_000);
    return NextResponse.json({ success: true, data: { ...budget, summary } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
