import { getAuthContext } from "@/application/auth/session";
import { askRedeAI } from "@/application/ai/ai-service";
import { aiQuestionSchema } from "@/domain/ai";
import { reportInternalError, safeOperatorError } from "@/infrastructure/http/safe-error";
import { assertProtectedReadCapability, isReadAccessDeniedError } from "@/domain/auth/read-capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const event = (type: string, data: unknown) => encoder.encode(`${JSON.stringify({ type, data })}\n`);

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return Response.json({ error: "Sessão expirada." }, { status: 401 });
  try { assertProtectedReadCapability(context.role, "AI_READ"); }
  catch (error) { if (isReadAccessDeniedError(error)) return Response.json({ error: error.message }, { status: 403 }); throw error; }
  let input: ReturnType<typeof aiQuestionSchema.parse>;
  try { input = aiQuestionSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Pergunta inválida." }, { status: 400 }); }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (type: string, data: unknown) => { if (!request.signal.aborted) controller.enqueue(event(type, data)); };
      try {
        send("progress", { label: "Carregando contexto e permissões…", status: "RUNNING" });
        if (request.signal.aborted) { controller.close(); return; }
        send("progress", { label: "Consultando módulos determinísticos…", status: "RUNNING" });
        const result = await askRedeAI(context, input);
        for (const tool of result.answer.tools) send("tool", { name: tool.name, mode: tool.mode, status: tool.status, durationMs: tool.durationMs });
        send("progress", { label: "Preparando resposta fundamentada…", status: "COMPLETED" });
        const chunks = result.message.content.match(/[\s\S]{1,180}(?:\s|$)/g) ?? [result.message.content];
        for (const chunk of chunks) send("delta", chunk);
        send("complete", result);
      } catch (error) {
        const correlationId = reportInternalError(error, { component: "rede-ai", event: "chat_failed", correlationId: request.headers.get("x-correlation-id") ?? undefined, organizationId: context.organizationId });
        send("error", { message: safeOperatorError(correlationId, "Não foi possível concluir esta análise."), correlationId });
      } finally { try { controller.close(); } catch {} }
    },
    cancel() { /* O cancelamento interrompe a entrega; a execução já iniciada permanece auditável. */ },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
