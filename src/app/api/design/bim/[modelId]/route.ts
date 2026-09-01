import { NextResponse } from "next/server";
import { getAuthContext } from "@/application/auth/session";
import { getBimWorkspace } from "@/application/design/bim-service";
import { reportInternalError, safeOperatorError } from "@/infrastructure/http/safe-error";

export async function GET(request: Request, { params }: { params: Promise<{ modelId: string }> }) {
  try {
    const context = await getAuthContext();
    if (!context) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { modelId } = await params;
    return NextResponse.json(await getBimWorkspace(context.organizationId, modelId));
  } catch (error) {
    const correlationId = reportInternalError(error, { component: "design-bim", event: "workspace_failed", correlationId: request.headers.get("x-correlation-id") ?? undefined });
    return NextResponse.json({ error: safeOperatorError(correlationId, "Modelo BIM indisponível.") }, { status: 404, headers: { "x-correlation-id": correlationId } });
  }
}
