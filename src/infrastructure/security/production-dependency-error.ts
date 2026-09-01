export type ProductionDependencyFailureKind =
  | "INVALID_CONFIGURATION"
  | "MISSING_CREDENTIALS"
  | "PERMISSION_DENIED"
  | "TIMEOUT"
  | "SERVICE_UNAVAILABLE"
  | "UNEXPECTED";

export interface ProductionDependencyFailureClassification {
  kind: ProductionDependencyFailureKind;
  errorClass: string;
}

const MAX_CAUSE_DEPTH = 12;
const SAFE_ERROR_CLASS = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const CREDENTIAL_ERRORS = new Set([
  "credentialsprovidererror",
  "unrecognizedclientexception",
  "invalidclienttokenid",
  "expiredtokenexception",
  "invalidsignatureexception",
  "signaturedoesnotmatch",
  "missingcredentials",
]);
const PERMISSION_ERRORS = new Set(["accessdenied", "accessdeniedexception", "unauthorizedexception"]);
const TIMEOUT_ERRORS = new Set(["aborterror", "timeouterror", "requesttimeout", "requesttimeoutexception", "etimedout", "econnaborted"]);
const UNAVAILABLE_ERRORS = new Set([
  "serviceunavailable",
  "serviceunavailableexception",
  "internalfailure",
  "internalservererror",
  "internalservererrorexception",
  "econnrefused",
  "enotfound",
  "econnreset",
  "enetunreach",
  "ehostunreach",
  "networkingerror",
  "networkerror",
  "throttling",
  "throttlingexception",
  "toomanyrequestsexception",
]);
const FAILURE_KINDS = new Set<ProductionDependencyFailureKind>([
  "INVALID_CONFIGURATION",
  "MISSING_CREDENTIALS",
  "PERMISSION_DENIED",
  "TIMEOUT",
  "SERVICE_UNAVAILABLE",
  "UNEXPECTED",
]);

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function safeClass(value: unknown) {
  return typeof value === "string" && SAFE_ERROR_CLASS.test(value) ? value : undefined;
}

function safeProperty(record: Record<string, unknown>, property: string): unknown {
  try {
    return Reflect.get(record, property);
  } catch {
    return undefined;
  }
}

function errorClass(error: unknown) {
  const record = recordOf(error);
  if (!record) return "UnknownError";
  const name = safeClass(safeProperty(record, "name"));
  const code = safeClass(safeProperty(record, "code"));
  if (name && name !== "Error") return name;
  if (code) return code;
  return name ?? "UnknownError";
}

function identifiers(error: unknown) {
  const record = recordOf(error);
  if (!record) return [];
  const rawProviderType = safeProperty(record, "__type");
  const providerType = typeof rawProviderType === "string" ? safeClass(rawProviderType.split("#").at(-1)) : undefined;
  return [safeClass(safeProperty(record, "name")), safeClass(safeProperty(record, "code")), providerType]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
}

function httpStatus(error: unknown) {
  const record = recordOf(error);
  if (!record) return undefined;
  const metadata = recordOf(safeProperty(record, "$metadata"));
  const metadataStatus = metadata ? safeProperty(metadata, "httpStatusCode") : undefined;
  const candidate = metadataStatus ?? safeProperty(record, "statusCode") ?? safeProperty(record, "status");
  return typeof candidate === "number" ? candidate : undefined;
}

function typedClassification(error: unknown): ProductionDependencyFailureClassification | undefined {
  try {
    if (!(error instanceof ProductionDependencyError)) return undefined;
  } catch {
    return undefined;
  }
  const record = recordOf(error);
  if (!record) return undefined;
  const kind = safeProperty(record, "kind");
  const originalErrorClass = safeClass(safeProperty(record, "originalErrorClass"));
  if (typeof kind !== "string" || !FAILURE_KINDS.has(kind as ProductionDependencyFailureKind) || !originalErrorClass) return undefined;
  return { kind: kind as ProductionDependencyFailureKind, errorClass: originalErrorClass };
}

function classifySingle(error: unknown): ProductionDependencyFailureClassification | undefined {
  const typed = typedClassification(error);
  if (typed) return typed;
  const names = identifiers(error);
  const usefulClass = errorClass(error);
  if (names.some((name) => CREDENTIAL_ERRORS.has(name))) return { kind: "MISSING_CREDENTIALS", errorClass: usefulClass };
  if (names.some((name) => PERMISSION_ERRORS.has(name)) || httpStatus(error) === 403) return { kind: "PERMISSION_DENIED", errorClass: usefulClass };
  if (names.some((name) => TIMEOUT_ERRORS.has(name))) return { kind: "TIMEOUT", errorClass: usefulClass };
  const status = httpStatus(error);
  if (names.some((name) => UNAVAILABLE_ERRORS.has(name)) || (status !== undefined && status >= 500 && status <= 599)) {
    return { kind: "SERVICE_UNAVAILABLE", errorClass: usefulClass };
  }
  return undefined;
}

export function classifyProductionDependencyFailure(error: unknown): ProductionDependencyFailureClassification {
  const visited = new Set<object>();
  let current: unknown = error;
  let fallbackClass = errorClass(error);
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined; depth += 1) {
    const record = recordOf(current);
    if (record) {
      if (visited.has(record)) break;
      visited.add(record);
    }
    const classification = classifySingle(current);
    if (classification) return classification;
    const currentClass = errorClass(current);
    if (fallbackClass === "UnknownError" && currentClass !== "UnknownError") fallbackClass = currentClass;
    current = record ? safeProperty(record, "cause") : undefined;
  }
  return { kind: "UNEXPECTED", errorClass: fallbackClass };
}

export class ProductionDependencyError extends Error {
  readonly name = "ProductionDependencyError";
  constructor(
    readonly dependency: string,
    readonly kind: ProductionDependencyFailureKind,
    readonly originalErrorClass: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export function invalidProductionDependencyConfiguration(dependency: string, message: string) {
  return new ProductionDependencyError(dependency, "INVALID_CONFIGURATION", "ConfigurationError", message);
}

export function wrapProductionDependencyFailure(error: unknown, dependency: string, safeMessage: string) {
  if (error instanceof ProductionDependencyError) return error;
  const classification = classifyProductionDependencyFailure(error);
  return new ProductionDependencyError(dependency, classification.kind, classification.errorClass, safeMessage, { cause: error });
}
