import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ status: "vivo", service: "web" }, { headers: { "cache-control": "no-store" } });
}
