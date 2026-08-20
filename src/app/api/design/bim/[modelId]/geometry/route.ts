import { NextResponse } from "next/server";
import { requireAuthContext } from "@/application/auth/session";
import { getBimArtifact } from "@/application/design/bim-service";

export async function GET(_request: Request, { params }: { params: Promise<{ modelId: string }> }) {
  try {
    const context = await requireAuthContext();
    const { modelId } = await params;
    const artifact = await getBimArtifact(context.organizationId, modelId);
    return new NextResponse(Buffer.from(artifact.bytes), { headers: { "Content-Type": "application/vnd.rede.bim+json", "Cache-Control": "private, max-age=300", ETag: artifact.checksum ? `"${artifact.checksum}"` : "" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Geometria BIM indisponível." }, { status: 404 });
  }
}
