import { NextResponse } from "next/server";
import { prisma } from "@/infrastructure/database/prisma";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "pronto", service: "web", database: "acessível" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "indisponível", service: "web" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
