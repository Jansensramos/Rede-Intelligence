import { z, type ZodType } from "zod";
import type { AiOutputSchemaRef } from "./types";

/**
 * Saida estruturada versionada pelo servidor (docs Fase 10A §7). O cliente so escolhe um
 * `AiOutputSchemaRef {name, version}` ja conhecido - nunca envia o schema em si. Zod com
 * `.strict()` recusa campos extras; profundidade e tamanho sao limitados antes do parse
 * para nao gastar CPU validando payloads gigantes; NaN/Infinity sao sempre invalidos
 * (JSON.parse nunca produz esses valores, mas um adapter malicioso poderia inserir
 * Number.POSITIVE_INFINITY via um objeto construido em memoria).
 */

const MAX_STRUCTURED_OUTPUT_DEPTH = 12;
const MAX_STRUCTURED_OUTPUT_BYTES = 200_000;

export type OutputSchemaKey = `${string}@${string}`;

export function schemaKey(ref: AiOutputSchemaRef): OutputSchemaKey {
  return `${ref.name}@${ref.version}`;
}

/** Registro fechado de schemas conhecidos pelo servidor. Adicionar um schema exige revisao (docs §16). */
export const AI_OUTPUT_SCHEMA_REGISTRY = new Map<OutputSchemaKey, ZodType>([
  [
    "gateway.synthetic.text_summary@1" as OutputSchemaKey,
    z.strictObject({ summary: z.string().max(4_000), confidence: z.enum(["HIGH", "MEDIUM", "LOW"]) }),
  ],
]);

function measureDepth(value: unknown, depth = 0): number {
  if (depth > MAX_STRUCTURED_OUTPUT_DEPTH) return depth;
  if (Array.isArray(value)) return Math.max(depth, ...value.map((item) => measureDepth(item, depth + 1)));
  if (value !== null && typeof value === "object") return Math.max(depth, ...Object.values(value as Record<string, unknown>).map((item) => measureDepth(item, depth + 1)));
  return depth;
}

function containsNonFiniteNumber(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(containsNonFiniteNumber);
  if (value !== null && typeof value === "object") return Object.values(value as Record<string, unknown>).some(containsNonFiniteNumber);
  return false;
}

export type OutputValidationFailure = "SCHEMA_UNKNOWN" | "TOO_LARGE" | "TOO_DEEP" | "NON_FINITE_NUMBER" | "SCHEMA_MISMATCH";

export type OutputValidationResult<T = unknown> = { ok: true; data: T } | { ok: false; reason: OutputValidationFailure };

/**
 * Nunca repara silenciosamente: qualquer desvio do schema declarado retorna falha, que o
 * AiGateway converte em `INVALID_RESPONSE`. Texto gerado nunca ganha status de evidencia
 * so por passar nesta validacao (a marcacao de evidencia e responsabilidade do chamador).
 */
export function validateStructuredOutput(ref: AiOutputSchemaRef, raw: unknown): OutputValidationResult {
  const schema = AI_OUTPUT_SCHEMA_REGISTRY.get(schemaKey(ref));
  if (!schema) return { ok: false, reason: "SCHEMA_UNKNOWN" };
  let serialized: string;
  try { serialized = JSON.stringify(raw) ?? "null"; } catch { return { ok: false, reason: "TOO_LARGE" }; }
  if (Buffer.byteLength(serialized, "utf8") > MAX_STRUCTURED_OUTPUT_BYTES) return { ok: false, reason: "TOO_LARGE" };
  if (measureDepth(raw) > MAX_STRUCTURED_OUTPUT_DEPTH) return { ok: false, reason: "TOO_DEEP" };
  if (containsNonFiniteNumber(raw)) return { ok: false, reason: "NON_FINITE_NUMBER" };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "SCHEMA_MISMATCH" };
  return { ok: true, data: parsed.data };
}
