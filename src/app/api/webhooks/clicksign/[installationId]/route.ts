import { NextResponse } from "next/server";
import { CLICKSIGN_WEBHOOK_MAX_BYTES, receiveClicksignWebhook } from "@/application/sales/clicksign-service";
import { reportInternalError, safeOperatorError } from "@/infrastructure/http/safe-error";
import { readLimitedRequestBody } from "@/infrastructure/http/limited-request-body";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ installationId: string }> }) {
  const correlationId = request.headers.get("x-correlation-id") ?? undefined;
  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json") && !contentType.startsWith("application/vnd.api+json")) return NextResponse.json({ error: "Requisição inválida." }, { status: 415 });
    const { installationId } = await context.params;
    const rawBody = await readLimitedRequestBody(request, CLICKSIGN_WEBHOOK_MAX_BYTES);
    const result = await receiveClicksignWebhook({ installationId, rawBody, signature: request.headers.get("x-clicksign-signature") });
    return NextResponse.json({ accepted: true, status: result.status }, { status: 202 });
  } catch (error) {
    const id = reportInternalError(error, { component: "clicksign-webhook", event: "rejected", correlationId });
    const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
    return NextResponse.json({ error: safeOperatorError(id, tooLarge ? "Payload acima do limite permitido." : "Webhook recusado.") }, { status: tooLarge ? 413 : 400 });
  }
}
