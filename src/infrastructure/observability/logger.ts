const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(password|senha|secret|token|authorization|cookie|cpf|cnpj|company.*tax.*id|tax.*id|document|credential|api[-_]?key|email|phone|signed.*url|temporary.*url)/i;
const SENSITIVE_VALUE = /(bearer\s+[a-z0-9._~+/=-]+|rede_session=|(?:password|senha|secret|token|credential|api[-_]?key)\s*[:=]\s*[^\s,;]+|postgres(?:ql)?:\/\/[^@\s]+@|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b)/gi;
const CNPJ_CANDIDATE = /(?<!\d)(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?!\d)/g;
const CPF_CANDIDATE = /(?<!\d)(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?!\d)/g;
const EMAIL_CANDIDATE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TEMPORARY_URL_QUERY = /(https?:\/\/[^\s?]+)\?[^\s]*/gi;

function sanitizeString(value: string) {
  return value.replace(SENSITIVE_VALUE, REDACTED).replace(CNPJ_CANDIDATE, REDACTED).replace(CPF_CANDIDATE, REDACTED).replace(EMAIL_CANDIDATE, REDACTED).replace(TEMPORARY_URL_QUERY, `$1?${REDACTED}`).slice(0, 2_000);
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
  if (value instanceof Error) return { name: value.name, message: sanitizeLogValue(value.message, "message") };
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
