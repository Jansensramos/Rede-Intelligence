import { request as httpsRequest } from "node:https";
import {
  defaultDnsResolver,
  isUnsafeIPv4,
  isUnsafeIPv6,
  parseCanonicalIPv4,
  isUnsafeIPv4Parts,
  type DnsRecord,
  type DnsResolver,
} from "@/infrastructure/observability/alert-dispatcher";
import { invalidProductionDependencyConfiguration, wrapProductionDependencyFailure } from "@/infrastructure/security/production-dependency-error";

/**
 * SSRF/DNS-rebinding para o AI Gateway (docs Fase 10A §3). Reaproveita as validacoes
 * puras de IP/host ja auditadas em alert-dispatcher.ts (camada 1 - literal da URL, sem
 * rede) e adiciona duas camadas extras exigidas para provider de IA (mais sensivel do
 * que webhook de alerta):
 *   1. allowlist EXATA de host (sem wildcard/sufixo) - nunca "qualquer https publico".
 *   2. resolucao DNS validada + conexao fixada ("pinned") no IP resolvido (camada 2),
 *      construida aqui porque o requester de alert-dispatcher descarta o corpo da
 *      resposta e usa method fixo POST sem headers customizados - o provider de IA
 *      precisa do corpo (JSON da conclusao) e de headers de autenticacao.
 * Nenhuma rede real e usada nos testes: resolver e requester sao injetaveis.
 */

const DEPENDENCY = "AI_PROVIDER";
export const MAX_RESPONSE_BODY_BYTES = 2_000_000;

export interface AiHttpRequestOptions {
  connectAddress: string;
  connectFamily: 4 | 6;
  servername: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}
export interface AiHttpResponseLike { statusCode: number; headers: Record<string, string | string[] | undefined>; body: string; }
export type AiHttpRequester = (options: AiHttpRequestOptions) => Promise<AiHttpResponseLike>;

/**
 * Camada 1: exige HTTPS, sem userinfo, porta padrao (443), host EXATO presente na
 * allowlist do tenant/ambiente, e sem indicar host inseguro pelo literal da URL.
 * `allowedHosts` e sempre comparado por igualdade exata (lowercase) - nunca por sufixo
 * ou prefixo, para nao permitir "evil-openai.com" ou "openai.com.evil.com".
 */
export function assertSafeAiProviderEndpoint(rawUrl: string, allowedHosts: ReadonlySet<string>): URL {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL invalida."); }
  if (url.protocol !== "https:") throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL precisa ser https.");
  if (url.username || url.password) throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL nao pode conter usuario/senha na URL.");
  if (url.port && url.port !== "443") throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL usa porta nao autorizada.");
  if (url.hash) throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL nao pode conter fragmento.");
  const hostname = url.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL nao esta na allowlist exata de hosts.");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "0.0.0.0") throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL aponta para um host nao permitido.");
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    if (isUnsafeIPv6(hostname.slice(1, -1))) throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL aponta para um host nao permitido.");
  } else {
    const ipv4Result = isUnsafeIPv4(hostname);
    if (ipv4Result) throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL aponta para um host nao permitido.");
  }
  return url;
}

/** Camada 2: resolve o host permitido e recusa qualquer IP fora da faixa publica segura - protege contra DNS rebinding/TOCTOU. */
export async function resolveSafeAiProviderAddress(hostname: string, resolver: DnsResolver = defaultDnsResolver): Promise<DnsRecord> {
  const records = await resolver(hostname);
  if (!records.length) throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL nao resolveu nenhum endereco.");
  for (const record of records) {
    if (record.family === 6) {
      if (isUnsafeIPv6(record.address)) throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL resolveu para um endereco nao permitido.");
      continue;
    }
    if (record.family !== 4) throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL resolveu para um endereco nao permitido.");
    const parts = parseCanonicalIPv4(record.address);
    if (!parts || isUnsafeIPv4Parts(...parts)) throw invalidProductionDependencyConfiguration(DEPENDENCY, "AI_PROVIDER_BASE_URL resolveu para um endereco nao permitido.");
  }
  return records[0];
}

/** Executor HTTPS real com conexao fixada no IP validado; nunca segue redirect (https.request nunca segue 3xx); corpo limitado a MAX_RESPONSE_BODY_BYTES. */
export function defaultAiHttpsRequester(options: AiHttpRequestOptions): Promise<AiHttpResponseLike> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    const req = httpsRequest(
      {
        host: options.connectAddress,
        servername: options.servername,
        port: 443,
        method: options.method,
        path: options.path,
        headers: { ...options.headers, host: options.servername },
        timeout: options.timeoutMs,
      },
      (response) => {
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BODY_BYTES) { req.destroy(new Error("AI_PROVIDER_RESPONSE_TOO_LARGE")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers as Record<string, string | string[] | undefined>, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Tempo limite ao chamar o provider de IA.")));
    req.on("error", reject);
    req.write(options.body);
    req.end();
  });
}

export interface SafeAiRequestParams {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  resolver?: DnsResolver;
  requester?: AiHttpRequester;
}

/** Combina as duas camadas + executor - unico ponto de saida de rede real desta infra. */
export async function performSafeAiHttpRequest(params: SafeAiRequestParams): Promise<AiHttpResponseLike> {
  const resolver = params.resolver ?? defaultDnsResolver;
  const requester = params.requester ?? defaultAiHttpsRequester;
  try {
    const resolved = await resolveSafeAiProviderAddress(params.url.hostname, resolver);
    return await requester({
      connectAddress: resolved.address,
      connectFamily: resolved.family,
      servername: params.url.hostname,
      path: `${params.url.pathname}${params.url.search}`,
      method: params.method,
      headers: params.headers,
      body: params.body,
      timeoutMs: params.timeoutMs,
    });
  } catch (error) {
    throw wrapProductionDependencyFailure(error, DEPENDENCY, "Nao foi possivel comunicar com o provider de IA.");
  }
}
