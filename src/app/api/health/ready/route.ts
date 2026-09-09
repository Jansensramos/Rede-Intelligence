import { NextResponse } from "next/server";
import { prisma } from "@/infrastructure/database/prisma";
import { runtimeConfig } from "@/infrastructure/config/runtime-config";
import { configurationChecks, productionTrafficBlocked } from "@/domain/release/local-readiness";
import { localDatabaseReleaseCheck } from "@/application/release/local-readiness-service";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (productionTrafficBlocked(process.env)) throw new Error("Release pending");
    if (configurationChecks(process.env).some(check => !check.ok)) throw new Error("Local configuration incomplete");
    const config = runtimeConfig();
    if (config.STORAGE_PROVIDER !== "local" || config.SECRET_PROVIDER !== "environment" || config.KMS_PROVIDER !== "local") throw new Error("Local dependencies required");
    await prisma.$queryRaw`SELECT 1`;
    if (!await localDatabaseReleaseCheck()) throw new Error("Migration integrity pending");
    return NextResponse.json({ status: "pronto", service: "web", scope: "local", productionReady: false }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "indisponível", service: "web" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
