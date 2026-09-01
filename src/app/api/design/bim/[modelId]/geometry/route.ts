import { NextResponse } from "next/server";
import { requireAuthContext } from "@/application/auth/session";
import { getBimArtifact } from "@/application/design/bim-service";
import { reportInternalError, safeOperatorError } from "@/infrastructure/http/safe-error";

export async function GET(request: Request, { params }: { params: Promise<{ modelId: string }> }) {
  try {
    const context = await requireAuthContext();
    const { modelId } = await params;
    const artifact = await getBimArtifact(context.organizationId, modelId);
    return new NextResponse(Buffer.from(artifact.bytes), { headers: { "Content-Type": "application/vnd.rede.bim+json", "Cache-Control": "private, max-age=300", ETag: artifact.checksum ? `"${artifact.checksum}"` : "" } });
  } catch (error) {
    const correlationId = reportInternalError(error, { component: "design-bim", event: "geometry_failed", correlationId: request.headers.get("x-correlation-id") ?? undefined });
    return NextResponse.json({ error: safeOperatorError(correlationId, "Geometria BIM indisponível.") }, { status: 404, headers: { "x-correlation-id": correlationId } });
  }
}
