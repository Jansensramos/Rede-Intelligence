import type { AiContentEnvelope, AiDataClassification, AiSafetyPolicy } from "./types";

/**
 * Minimizacao e bloqueio por padrao (docs Fase 10A / decisao 8). Enum fechado de
 * classificacao - nenhum transporte externo e autorizado nesta rodada (decisao 1/3),
 * entao esta politica so decide o que e seguro para ENTRAR no envelope do Gateway; a
 * decisao de roteamento (routing.ts) decide separadamente se algum provider pode
 * receber o conteudo - hoje sempre "disabled" (decisao 2).
 */

/** Classificacoes que nunca podem sair do processo local, mesmo com provider autorizado no futuro. */
const ALWAYS_BLOCKED_CLASSIFICATIONS: ReadonlySet<AiDataClassification> = new Set(["SECRET"]);

/**
 * Sinais estruturais de segredo/credencial/PII - usados como camada adicional de defesa,
 * nunca como unica linha de defesa (docs: "nao depender so de regex"). A classificacao
 * declarada pelo servidor (AiRequest.dataClassification) e sempre a fonte primaria.
 */
const BLOCKED_CONTENT_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bsk-[A-Za-z0-9]{20,}\b/, // formato generico de API key com prefixo "sk-"
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /https?:\/\/[^\s]+[?&](?:x-amz-signature|signature|sig|token)=/i, // URL assinada
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, // CPF formatado
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/, // CNPJ formatado
  /\b\d{2}\.\d{3}\.\d{3}\.\d{3}-\d{2}\b/, // RG formatado (alguns estados)
  /\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/, // telefone BR
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i, // e-mail
  /\bagencia\s*\d{3,5}[-.]?\d?\b/i,
  /\bconta[-\s]?corrente\s*\d{4,}[-.]?\d?\b/i,
];

export const DEFAULT_AI_SAFETY_POLICY: AiSafetyPolicy = {
  blockedContentPatterns: BLOCKED_CONTENT_PATTERNS.map((pattern) => pattern.source),
  maxInputBytes: 200_000,
  maxOutputBytes: 200_000,
  maxJsonDepth: 12,
  untrustedContentMustBeFenced: true,
};

export type SafetyBlockReason =
  | "CLASSIFICATION_ALWAYS_BLOCKED"
  | "BLOCKED_CONTENT_PATTERN_MATCHED"
  | "INPUT_TOO_LARGE"
  | "CONTROL_CHARACTERS_DETECTED"
  | "NUL_BYTE_DETECTED";

export interface SafetyDecision {
  allowed: boolean;
  reason?: SafetyBlockReason;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** NUL e checado separadamente por clareza de diagnostico (docs: "NUL/expansao excessiva"). */
const NUL_CHARACTER = String.fromCharCode(0);
/** Unicode de controle fora de tab/CR/LF - nunca "sanitizado" silenciosamente, sempre recusado. */
const CONTROL_CHARACTERS_PATTERN = "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]";
const CONTROL_CHARACTERS = new RegExp(CONTROL_CHARACTERS_PATTERN);

function containsBlockedPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Decide, antes de qualquer roteamento, se o conteudo do request pode prosseguir.
 * Falha fechado: qualquer sinal de bloqueio interrompe a execucao com SAFETY_BLOCKED,
 * sem fabricar resposta e sem consumir orcamento.
 */
export function evaluateSafety(
  classification: AiDataClassification,
  content: AiContentEnvelope,
  policy: AiSafetyPolicy = DEFAULT_AI_SAFETY_POLICY,
): SafetyDecision {
  if (ALWAYS_BLOCKED_CLASSIFICATIONS.has(classification)) return { allowed: false, reason: "CLASSIFICATION_ALWAYS_BLOCKED" };
  const parts = [content.systemInstructions, content.trustedContext, content.untrustedUserContent ?? ""];
  const combined = parts.join("\n");
  if (byteLength(combined) > policy.maxInputBytes) return { allowed: false, reason: "INPUT_TOO_LARGE" };
  if (combined.includes(NUL_CHARACTER)) return { allowed: false, reason: "NUL_BYTE_DETECTED" };
  if (CONTROL_CHARACTERS.test(combined)) return { allowed: false, reason: "CONTROL_CHARACTERS_DETECTED" };
  const patterns = policy.blockedContentPatterns.map((source) => new RegExp(source, "i"));
  if (containsBlockedPattern(combined, patterns)) return { allowed: false, reason: "BLOCKED_CONTENT_PATTERN_MATCHED" };
  return { allowed: true };
}

/** Classificacoes elegiveis a transporte externo futuro (decisao 5) - hoje irrelevante, pois nenhum provider externo esta autorizado. */
export function isExternalTransportEligible(classification: AiDataClassification): boolean {
  return classification === "PUBLIC" || classification === "INTERNAL";
}
