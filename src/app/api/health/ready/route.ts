import { NextResponse } from "next/server";
import { prisma } from "@/infrastructure/database/prisma";
import { runtimeConfig } from "@/infrastructure/config/runtime-config";
import { storageProvider } from "@/infrastructure/storage/storage-provider";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const config = runtimeConfig();
    if (config.NODE_ENV === "production") await storageProvider().healthCheck();
    return NextResponse.json({ status: "pronto", service: "web", database: "acessível", storage: config.NODE_ENV === "production" ? "acessível" : "não obrigatório" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "indisponível", service: "web" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
