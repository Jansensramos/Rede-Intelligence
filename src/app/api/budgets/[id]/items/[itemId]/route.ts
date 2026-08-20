import { NextRequest, NextResponse } from "next/server";
import { updateLineItem, deleteLineItem } from "@/application/budget/budget-service";
import { prisma } from "@/infrastructure/database/prisma";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const body = await request.json();
    const updated = await updateLineItem(prisma, id, itemId, body);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    await deleteLineItem(prisma, id, itemId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
