export const INTERNAL_CLIENT_ADDRESS_HEADER = "x-rede-client-address";
export const UNKNOWN_CLIENT_ADDRESS = "unavailable";
const MAX_PROXY_HOPS = 10;
const MAX_CHAIN_LENGTH = 20;

export class TrustedProxyConfigurationError extends Error {
  readonly name = "TrustedProxyConfigurationError";
  constructor() { super("Configuração de proxy confiável inválida."); }
}

export function parseTrustedProxyHops(value: string | undefined) {
  if (value === undefined || value.trim() === "") return 0;
  if (!/^\d+$/.test(value.trim())) throw new TrustedProxyConfigurationError();
  const hops = Number(value);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > MAX_PROXY_HOPS) throw new TrustedProxyConfigurationError();
  return hops;
}

function normalizeIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  const normalized: string[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) return undefined;
    const number = Number(part);
    if (number > 255) return undefined;
    normalized.push(String(number));
  }
  return normalized.join(".");
}

function stripAddressPort(value: string) {
  const bracketed = /^\[([^\]]+)](?::\d{1,5})?$/.exec(value);
  if (bracketed) return bracketed[1];
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
  return ipv4WithPort?.[1] ?? value;
}

export function normalizeIpAddress(value: string) {
  const candidate = stripAddressPort(value.trim());
  const ipv4 = normalizeIpv4(candidate);
  if (ipv4) return ipv4;
  if (!candidate.includes(":") || candidate.includes("%") || !/^[0-9a-fA-F:.]+$/.test(candidate)) return undefined;
  try {
    const hostname = new URL(`http://[${candidate}]`).hostname;
    const normalized = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
    return normalized.includes(":") ? normalized.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export interface SafeHeadersReader { get(name: string): string | null; }

function safeHeader(headers: SafeHeadersReader, name: string) {
  try {
    const value = headers.get(name);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function resolveTrustedClientAddress(headers: SafeHeadersReader, trustedProxyHops: number) {
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops <= 0 || trustedProxyHops > MAX_PROXY_HOPS) return UNKNOWN_CLIENT_ADDRESS;
  const forwarded = safeHeader(headers, "x-forwarded-for");
  if (forwarded) {
    const entries = forwarded.split(",").map((entry) => entry.trim());
    if (entries.length === 0 || entries.length > MAX_CHAIN_LENGTH || entries.length < trustedProxyHops) return UNKNOWN_CLIENT_ADDRESS;
    const addresses = entries.map(normalizeIpAddress);
    if (addresses.some((address) => !address)) return UNKNOWN_CLIENT_ADDRESS;
    return addresses[addresses.length - trustedProxyHops] ?? UNKNOWN_CLIENT_ADDRESS;
  }
  if (trustedProxyHops === 1) {
    return normalizeIpAddress(safeHeader(headers, "x-real-ip") ?? "") ?? UNKNOWN_CLIENT_ADDRESS;
  }
  return UNKNOWN_CLIENT_ADDRESS;
}
