import type { AiContentEnvelope } from "./types";

/**
 * Envelope de prompt seguro. A partir da 10B, o Gateway substitui `trustedContext` pela
 * projeção validada do ContextBundle antes de chamar o adapter.
 */

export const ENVELOPE_LIMITS = {
  maxSystemInstructionsBytes: 8_000,
  maxTrustedContextBytes: 120_000,
  maxUntrustedUserContentBytes: 60_000,
  maxTotalItems: 500,
};

export type EnvelopeValidationError =
  | "SYSTEM_INSTRUCTIONS_TOO_LARGE"
  | "TRUSTED_CONTEXT_TOO_LARGE"
  | "UNTRUSTED_CONTENT_TOO_LARGE"
  | "EMPTY_SYSTEM_INSTRUCTIONS";

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Cerca (fence) o conteudo nao confiavel dentro de um delimitador explicito e o marca
 * como dado, nunca como instrucao - o conteudo do usuario nunca ocupa a posicao de
 * "system"/"instrucao" (docs: "conteudo do usuario nunca em posicao de instrucao").
 */
const UNTRUSTED_FENCE_START = "<untrusted_user_content>";
const UNTRUSTED_FENCE_END = "</untrusted_user_content>";

export function validateEnvelope(envelope: AiContentEnvelope): EnvelopeValidationError | null {
  if (!envelope.systemInstructions.trim()) return "EMPTY_SYSTEM_INSTRUCTIONS";
  if (byteLength(envelope.systemInstructions) > ENVELOPE_LIMITS.maxSystemInstructionsBytes) return "SYSTEM_INSTRUCTIONS_TOO_LARGE";
  if (byteLength(envelope.trustedContext) > ENVELOPE_LIMITS.maxTrustedContextBytes) return "TRUSTED_CONTEXT_TOO_LARGE";
  if (envelope.untrustedUserContent && byteLength(envelope.untrustedUserContent) > ENVELOPE_LIMITS.maxUntrustedUserContentBytes) return "UNTRUSTED_CONTENT_TOO_LARGE";
  return null;
}

export interface RenderedEnvelope {
  system: string;
  user: string;
}

/**
 * Monta o texto final enviado ao provider (hoje nunca enviado de fato, pois o unico
 * provider habilitado e "disabled" - decisao 1/2). system e SEMPRE controlado pelo
 * servidor; user contem contexto confiavel em texto livre seguido do conteudo nao
 * confiavel do usuario cercado por um fence explicito, nunca interpretado como comando.
 */
export function renderEnvelope(envelope: AiContentEnvelope): RenderedEnvelope {
  const untrusted = envelope.untrustedUserContent
    ? `\n\n${UNTRUSTED_FENCE_START}\n${envelope.untrustedUserContent}\n${UNTRUSTED_FENCE_END}`
    : "";
  return { system: envelope.systemInstructions, user: `${envelope.trustedContext}${untrusted}` };
}
