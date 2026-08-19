import { NextRequest, NextResponse } from "next/server";
import { updateLineItem, deleteLineItem } from "@/application/budget/budget-service";
import { prisma } from "@/infrastructure/database";

export async function PUT(request: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const body = await request.json();
    const updated = await updateLineItem(prisma, params.id, params.itemId, body);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    await deleteLineItem(prisma, params.id, params.itemId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
