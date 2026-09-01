import { getAuthContext } from "@/application/auth/session";
import { getDesignFileForDownload } from "@/application/design/design-service";
import { reportInternalError, safeOperatorError } from "@/infrastructure/http/safe-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeRange(header: string | null, size: number) {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end };
}

export async function GET(request: Request, route: { params: Promise<{ fileId: string }> }) {
  const context = await getAuthContext();
  if (!context) return Response.json({ error: "Sessão expirada." }, { status: 401 });
  try {
    const { fileId } = await route.params;
    const { file, bytes } = await getDesignFileForDownload(context.organizationId, fileId);
    const range = safeRange(request.headers.get("range"), bytes.length);
    const body = range ? bytes.slice(range.start, range.end + 1) : bytes;
    return new Response(Buffer.from(body), { status: range ? 206 : 200, headers: { "content-type": file.mimeType, "content-length": String(body.length), "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`, "accept-ranges": "bytes", ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${bytes.length}` } : {}), "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox" } });
  } catch (error) {
    const correlationId = reportInternalError(error, { component: "design-files", event: "download_failed", correlationId: request.headers.get("x-correlation-id") ?? undefined, organizationId: context.organizationId });
    return Response.json({ error: safeOperatorError(correlationId, "Arquivo indisponível.") }, { status: 404, headers: { "x-correlation-id": correlationId } });
  }
}
