import { z } from "zod";
import { isPlainContextData, ContextPurposeSchema, type ContextPurpose } from "@/domain/context-engine";

/**
 * Fase 10C (Tool Layer) - contratos provider-neutral. Nenhuma classe Prisma, SDK, modelo,
 * endpoint, chave ou funcao executavel e carregada aqui. Reaproveita a mesma guarda de
 * dados simples da 10B (isPlainContextData) antes de qualquer parse Zod - nenhum getter,
 * accessor, Proxy ou prototype hostil e executado antes da rejeicao.
 */

export const AI_TOOLS_LAYER_VERSION = "AI_TOOLS_LAYER_V1.0.0";

const INVALID_DATA = Object.freeze({ invalidToolData: true });
function plainDataSchema<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((input) => (isPlainContextData(input) ? input : INVALID_DATA), schema);
}

const safeIdSchema = z.string().min(1).max(96).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

/** Registro fechado - unica fonte de nomes de ferramenta validos nesta fatia (decisao 2, docs/PHASE_10C_TOOL_LAYER_CONTRACT.md). */
export const AiToolNameSchema = z.enum([
  "getApprovedViabilitySummary",
  "getActiveRisks",
  "getEngineeringProgress",
  "getVerifiedLegalEvidence",
]);
export type AiToolName = z.infer<typeof AiToolNameSchema>;

/** Unico modo aceito nesta fatia (decisao 4: nenhuma ferramenta SIMULATION ou MUTATION). */
export const AiToolModeSchema = z.literal("READ_ONLY");
export type AiToolMode = z.infer<typeof AiToolModeSchema>;

/** As 4 ferramentas do piloto nao aceitam nenhum argumento (decisao 2 - leitura pura do bundle do proposito). */
const emptyToolArgumentsObject = z.object({}).strict();
export const AiToolArgumentsSchema = plainDataSchema(emptyToolArgumentsObject);
export type AiToolArguments = z.infer<typeof AiToolArgumentsSchema>;

/**
 * Entrada logica de uma invocacao. IDs/escopo/correlationId sao sempre resolvidos no
 * servidor (decisao 11) - nunca aceitos de `arguments` ou de um payload de cliente.
 */
const aiToolInvocationRequestObject = z.object({
  toolName: AiToolNameSchema,
  correlationId: safeIdSchema,
  organizationId: safeIdSchema,
  userId: safeIdSchema,
  conversationId: safeIdSchema,
  arguments: AiToolArgumentsSchema,
  requestedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
}).strict();
export const AiToolInvocationRequestSchema = plainDataSchema(aiToolInvocationRequestObject);
export type AiToolInvocationRequest = z.infer<typeof AiToolInvocationRequestSchema>;

export const AiToolStatusSchema = z.enum(["COMPLETED", "REFUSED", "FAILED"]);
export type AiToolStatus = z.infer<typeof AiToolStatusSchema>;

export const AI_TOOL_ERROR_CODES = [
  "TOOL_UNKNOWN",
  "TOOL_ACCESS_DENIED",
  "TOOL_ARGUMENTS_INVALID",
  "TOOL_CONTEXT_REFUSED",
  "TOOL_RATE_LIMITED",
  "TOOL_TIMEOUT",
  "TOOL_CONCURRENT_CHANGE",
  "TOOL_UNAVAILABLE",
] as const;
export type AiToolErrorCode = typeof AI_TOOL_ERROR_CODES[number];

const ERROR_MESSAGES: Record<AiToolErrorCode, string> = {
  TOOL_UNKNOWN: "Ferramenta de IA nao reconhecida.",
  TOOL_ACCESS_DENIED: "Recurso da REDE AI nao encontrado.",
  TOOL_ARGUMENTS_INVALID: "Argumentos invalidos para esta ferramenta.",
  TOOL_CONTEXT_REFUSED: "Contexto necessario para esta ferramenta nao pode ser comprovado no momento.",
  TOOL_RATE_LIMITED: "Limite de uso desta ferramenta atingido.",
  TOOL_TIMEOUT: "Tempo limite excedido ao preparar a evidencia desta ferramenta.",
  TOOL_CONCURRENT_CHANGE: "Uma fonte relevante mudou durante a execucao; tente novamente.",
  TOOL_UNAVAILABLE: "Ferramenta temporariamente indisponivel.",
};
/** Nunca distingue "outro tenant" de "inexistente" (TOOL_ACCESS_DENIED) - mesma regra da 10B. */
const RETRYABLE = new Set<AiToolErrorCode>(["TOOL_CONCURRENT_CHANGE", "TOOL_UNAVAILABLE", "TOOL_RATE_LIMITED"]);

export class AiToolError extends Error {
  readonly name = "AiToolError";
  readonly retryable: boolean;
  readonly correlationId: string;
  constructor(readonly code: AiToolErrorCode, correlationId: string, options?: { cause?: unknown }) {
    super(ERROR_MESSAGES[code], options);
    this.correlationId = safeIdSchema.parse(correlationId);
    this.retryable = RETRYABLE.has(code);
  }
}

const aiToolErrorObject = z.object({
  code: z.enum(AI_TOOL_ERROR_CODES),
  message: z.string().min(1).max(200),
  correlationId: safeIdSchema,
  retryable: z.boolean(),
}).strict();
export const AiToolErrorSchema = plainDataSchema(aiToolErrorObject);

const measurementsObject = z.object({
  itemCount: z.number().int().nonnegative().max(100),
  byteCount: z.number().int().nonnegative().max(120_000),
  estimatedTokens: z.number().int().nonnegative().max(30_000),
}).strict();

/**
 * Saida de uma ferramenta concluida. `evidence` e literalmente a projecao JSON canonica ja
 * produzida por `renderContextBundleForTransport` (10B) - nenhuma nova regra de minimizacao,
 * nenhum objeto Prisma bruto, nenhum campo alem do que a 10B ja allowlista.
 */
const aiToolCompletedResultObject = z.object({
  name: AiToolNameSchema,
  status: z.literal("COMPLETED"),
  correlationId: safeIdSchema,
  toolsVersion: z.literal(AI_TOOLS_LAYER_VERSION),
  contextPolicyVersion: z.string().min(1).max(64),
  purpose: ContextPurposeSchema,
  measurements: measurementsObject,
  evidence: z.string().min(1).max(200_000),
  durationMs: z.number().int().nonnegative().max(600_000),
}).strict();

const aiToolRefusedOrFailedResultObject = z.object({
  // "UNKNOWN" cobre exclusivamente TOOL_UNKNOWN: nenhum nome do registro fechado pode ser
  // atribuido porque a propria invocacao nao resolveu a um.
  name: z.union([AiToolNameSchema, z.literal("UNKNOWN")]),
  status: z.enum(["REFUSED", "FAILED"]),
  correlationId: safeIdSchema,
  toolsVersion: z.literal(AI_TOOLS_LAYER_VERSION),
  error: aiToolErrorObject,
  durationMs: z.number().int().nonnegative().max(600_000),
}).strict();

export const AiToolResultSchema = plainDataSchema(
  z.discriminatedUnion("status", [aiToolCompletedResultObject, aiToolRefusedOrFailedResultObject]),
);
export type AiToolResult = z.infer<typeof AiToolResultSchema>;

/** Metadado publico do catalogo - nunca inclui `execute`/logica interna (secao 7.7/13). */
export const AiToolCatalogEntrySchema = plainDataSchema(z.object({
  name: AiToolNameSchema,
  description: z.string().min(1).max(160),
  mode: AiToolModeSchema,
  requiredCapability: z.string().min(1).max(64),
  contextPurpose: ContextPurposeSchema,
  toolsVersion: z.literal(AI_TOOLS_LAYER_VERSION),
}).strict());
export type AiToolCatalogEntry = z.infer<typeof AiToolCatalogEntrySchema>;

export type { ContextPurpose };
