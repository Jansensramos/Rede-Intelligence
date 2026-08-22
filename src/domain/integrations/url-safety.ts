/**
 * Bloqueia SSRF em URLs externas configuráveis (webhooks de saída, endpoints de
 * conector). Rejeita loopback, redes privadas/link-local e metadata de nuvem —
 * ver plano 9H §47 e caso crítico H (§61).
 */
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

export function assertSafeExternalUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL externa inválida.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Apenas URLs http(s) são permitidas.");
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) throw new Error("URL externa aponta para um host bloqueado.");
  if (isLoopbackOrPrivateIPv4(hostname) || isBlockedIPv6(hostname)) throw new Error("URL externa aponta para um endereço interno bloqueado.");
}

function isLoopbackOrPrivateIPv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function isBlockedIPv6(hostname: string): boolean {
  return hostname === "::1" || hostname.startsWith("fe80:") || hostname.startsWith("fc00:") || hostname.startsWith("fd00:");
}
