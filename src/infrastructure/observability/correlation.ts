const SAFE_CORRELATION_ID = /^[a-zA-Z0-9._:-]{1,128}$/;
export function resolveCorrelationId(value: string | null | undefined) {
  return value && SAFE_CORRELATION_ID.test(value) ? value : globalThis.crypto.randomUUID();
}
