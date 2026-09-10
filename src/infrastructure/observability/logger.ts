const REDACTED = "[REDACTED]";
// Nomes de chave "identidade operacional" (org/instalação/inbox/usuário) são
// permitidos como chave de objeto em logs internos (precisam ser depuráveis) — só o
// PAYLOAD EXTERNO de alerta usa tenantRef hasheado (operational-alerts.ts). Aqui só
// entram na lista quando aparecem como valor embutido em TEXTO LIVRE (achado da
// reauditoria 9Q.2B: "installationId=..." dentro de uma mensagem de erro não era
// redigido, só quando era chave de um objeto estruturado).
const SENSITIVE_KEY = /(password|senha|secret|token|authorization|cookie|cpf|cnpj|company.*tax.*id|tax.*id|document|credential|api[-_]?key|email|phone|telefone|signed.*url|temporary.*url)/i;
const KEY_VALUE_SECRET = /(?:password|senha|secret|token|credential|api[-_]?key|authorization|organiza(?:tion|[cç][aã]o)[-_]?id|installation[-_]?id|inbox[-_]?id|user[-_]?id)\s*[:=]\s*[^\s,;]+/gi;
const SENSITIVE_VALUE = /(bearer\s+[a-z0-9._~+/=-]+|rede_session=|postgres(?:ql)?:\/\/[^@\s]+@|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b)/gi;
const CNPJ_CANDIDATE = /(?<!\d)(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?!\d)/g;
const CPF_CANDIDATE = /(?<!\d)(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?!\d)/g;
const EMAIL_CANDIDATE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Telefone BR com/sem formatação: DDD (2 dígitos) + 9º dígito opcional + 4+4, com
// separador opcional em cada junção. `(?<!\d)`/`(?!\d)` evitam capturar um trecho no
// meio de uma sequência numérica maior (ex.: um ID de 12 dígitos não é truncado).
const PHONE_CANDIDATE = /(?<!\d)(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\d)/g;
// JWT "nu": três segmentos base64url separados por ponto, começando por "eyJ" (base64
// de `{"`) — o mesmo heurístico usado por scanners de segredo reais, útil quando o
// token aparece sem um prefixo reconhecível como "bearer "/"token:".
const BARE_JWT_CANDIDATE = /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g;
const TEMPORARY_URL_QUERY = /(https?:\/\/[^\s?]+)\?[^\s]*/gi;

function sanitizeString(value: string) {
  return value
    .replace(KEY_VALUE_SECRET, REDACTED)
    .replace(SENSITIVE_VALUE, REDACTED)
    .replace(BARE_JWT_CANDIDATE, REDACTED)
    .replace(CNPJ_CANDIDATE, REDACTED)
    .replace(CPF_CANDIDATE, REDACTED)
    .replace(PHONE_CANDIDATE, REDACTED)
    .replace(EMAIL_CANDIDATE, REDACTED)
    .replace(TEMPORARY_URL_QUERY, `$1?${REDACTED}`)
    .slice(0, 2_000);
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogContext {
  correlationId?: string;
  jobId?: string;
  organizationId?: string;
  component?: string;
  event?: string;
  durationMs?: number;
  errorClass?: string;
  [key: string]: unknown;
}

export function sanitizeLogValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return sanitizeString(value);
  if (value instanceof Error) {
    const sanitized: Record<string, unknown> = { name: value.name, message: sanitizeLogValue(value.message, "message") };
    if (value.cause !== undefined) sanitized.cause = sanitizeLogValue(value.cause);
    return sanitized;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeLogValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 50).map(([childKey, child]) => [childKey, sanitizeLogValue(child, childKey)]));
  return value;
}

export function writeLog(level: LogLevel, message: string, context: LogContext = {}) {
  const line = JSON.stringify(sanitizeLogValue({ timestamp: new Date().toISOString(), level, message, ...context }));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => writeLog("debug", message, context),
  info: (message: string, context?: LogContext) => writeLog("info", message, context),
  warn: (message: string, context?: LogContext) => writeLog("warn", message, context),
  error: (message: string, context?: LogContext) => writeLog("error", message, context),
};
