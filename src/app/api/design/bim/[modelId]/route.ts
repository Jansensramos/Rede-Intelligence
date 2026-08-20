import { NextResponse } from "next/server";
import { getAuthContext } from "@/application/auth/session";
import { getBimWorkspace } from "@/application/design/bim-service";

export async function GET(_request: Request, { params }: { params: Promise<{ modelId: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { modelId } = await params;
    return NextResponse.json(await getBimWorkspace(context.organizationId, modelId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Modelo BIM indisponível." }, { status: 404 });
  }
}
