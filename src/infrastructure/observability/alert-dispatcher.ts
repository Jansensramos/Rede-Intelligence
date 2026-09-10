import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { RuntimeConfig } from "@/infrastructure/config/runtime-config";
import { runtimeConfig } from "@/infrastructure/config/runtime-config";
import { invalidProductionDependencyConfiguration, wrapProductionDependencyFailure } from "@/infrastructure/security/production-dependency-error";
import { sanitizeLogValue, type LogContext } from "./logger";
import type { ErrorReporterProvider, MetricsProvider } from "./providers";
import { LocalErrorReporter, LocalMetricsProvider } from "./providers";

const DEPENDENCY = "ALERTING_PROVIDER";
const REQUEST_TIMEOUT_MS = 5_000;

export interface AlertTransport {
  send(payload: Record<string, unknown>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Camada 1: validação estrutural da URL configurada (protocolo, userinfo, porta,
// e o literal do host se ele já for um IP). Não depende de rede.
// ---------------------------------------------------------------------------

function isUnsafeIPv4Parts(a: number, b: number, c: number, d: number): boolean {
  void c; void d;
  if (a === 0) return true; // "this network" / unspecified
  if (a === 127) return true; // loopback
  if (a === 10) return true; // privado 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // privado 172.16.0.0/12
  if (a === 192 && b === 168) return true; // privado 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local / metadados de nuvem (169.254.169.254)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT compartilhado 100.64.0.0/10
  if (a >= 224 && a <= 239) return true; // multicast 224.0.0.0/4
  if (a >= 240) return true; // reservado/Classe E + broadcast 240.0.0.0/4
  return false;
}

function isUnsafeIPv4(host: string): boolean | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return undefined;
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some((part) => part > 255)) return true; // não é um IPv4 válido — falha fechado
  return isUnsafeIPv4Parts(a, b, c, d);
}

/**
 * Expande um endereço IPv6 já no formato canônico (o que `new URL()` sempre produz
 * para o `hostname`) em 8 grupos de 16 bits. Não tenta decodificar formas não
 * canônicas (dotted-quad embutido, zeros redundantes) porque `assertSafeAlertEndpoint`
 * sempre lê o host já normalizado pelo parser de URL antes de chamar isto.
 */
function expandIPv6Groups(bare: string): number[] | null {
  const parts = bare.split("::");
  if (parts.length > 2) return null;
  const parseSide = (side: string) => (side ? side.split(":").filter((segment) => segment.length > 0) : []);
  const head = parseSide(parts[0]);
  const tail = parts.length === 2 ? parseSide(parts[1]) : [];
  const toGroup = (segment: string) => (/^[0-9a-f]{1,4}$/i.test(segment) ? parseInt(segment, 16) : null);
  const headGroups = head.map(toGroup);
  const tailGroups = tail.map(toGroup);
  if (headGroups.includes(null) || tailGroups.includes(null)) return null;
  if (parts.length === 1) return headGroups.length === 8 ? (headGroups as number[]) : null;
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0) return null;
  return [...(headGroups as number[]), ...Array(missing).fill(0), ...(tailGroups as number[])];
}

/**
 * Cobre loopback/unspecified/link-local/unique-local/multicast diretos, e os três
 * mecanismos conhecidos de embutir um IPv4 dentro de um IPv6 (mapeado ::ffff:0:0/96,
 * NAT64 64:ff9b::/96, 6to4 2002::/16) — extraindo e revalidando o IPv4 embutido com a
 * mesma política do IPv4 direto, em vez de só checar o prefixo textual.
 */
function isUnsafeIPv6(bare: string): boolean {
  const groups = expandIPv6Groups(bare.toLowerCase());
  if (!groups) return true; // não parseou como IPv6 canônico — falha fechado
  if (groups.every((value) => value === 0)) return true; // :: (unspecified)
  if (groups.slice(0, 7).every((value) => value === 0) && groups[7] === 1) return true; // ::1 loopback
  if (groups[0] >= 0xfe80 && groups[0] <= 0xfebf) return true; // link-local fe80::/10
  if (groups[0] >= 0xfc00 && groups[0] <= 0xfdff) return true; // unique local fc00::/7
  if (groups[0] >= 0xff00 && groups[0] <= 0xffff) return true; // multicast ff00::/8
  const embeddedIPv4 = (hi: number, lo: number) => isUnsafeIPv4Parts(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
  // ::ffff:0:0/96 — 96 bits de prefixo = grupos 0-5 (cinco zeros + 0xffff no grupo 5);
  // o IPv4 embutido ocupa os últimos 32 bits, grupos 6-7.
  if (groups.slice(0, 5).every((value) => value === 0) && groups[5] === 0xffff) {
    return embeddedIPv4(groups[6], groups[7]); // IPv4-mapped ::ffff:a.b.c.d
  }
  // IPv4-translated (RFC 2765/SIIT) — ::ffff:0:a.b.c.d: distinto do mapeado acima
  // porque 0xffff está no grupo 4 (não no 5); grupos 0-3 zero, grupo 5 zero, o IPv4
  // embutido ocupa os grupos 6-7. Achado da reauditoria 9Q.2B: `[::ffff:0:127.0.0.1]`
  // e `[::ffff:0:169.254.169.254]` passavam sem essa checagem.
  if (groups.slice(0, 4).every((value) => value === 0) && groups[4] === 0xffff && groups[5] === 0) {
    return embeddedIPv4(groups[6], groups[7]); // IPv4-translated ::ffff:0:a.b.c.d
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((value) => value === 0)) {
    return embeddedIPv4(groups[6], groups[7]); // NAT64 64:ff9b::a.b.c.d
  }
  if (groups[0] === 0x2002) {
    return embeddedIPv4(groups[1], groups[2]); // 6to4 2002:AABB:CCDD::
  }
  return false;
}

function isUnsafeAlertHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return true;
  if (host.startsWith("[") && host.endsWith("]")) return isUnsafeIPv6(host.slice(1, -1));
  const ipv4Result = isUnsafeIPv4(host);
  if (ipv4Result !== undefined) return ipv4Result;
  return false; // hostname textual — a Camada 2 (DNS) decide se é seguro
}

/**
 * Recusa qualquer endpoint que não seja um destino HTTPS público explícito: sem
 * userinfo embutido, sem porta alternativa, e sem apontar (pelo literal da URL) para
 * loopback, link-local, unspecified, multicast, reservado ou rede privada — incluindo
 * as três formas de IPv4 embutido em IPv6. Isto sozinho NÃO protege contra DNS
 * rebinding (um hostname textual "seguro" ainda pode resolver para um IP proibido em
 * tempo de conexão) — essa proteção é a Camada 2, em `resolveSafeAddress`.
 */
export function assertSafeAlertEndpoint(rawUrl: string) {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw invalidProductionDependencyConfiguration(DEPENDENCY, "ALERTING_EXTERNAL_ENDPOINT inválida."); }
  if (url.protocol !== "https:") throw invalidProductionDependencyConfiguration(DEPENDENCY, "ALERTING_EXTERNAL_ENDPOINT precisa ser https.");
  if (url.username || url.password) throw invalidProductionDependencyConfiguration(DEPENDENCY, "ALERTING_EXTERNAL_ENDPOINT não pode conter usuário/senha na URL.");
  if (url.port && url.port !== "443") throw invalidProductionDependencyConfiguration(DEPENDENCY, "ALERTING_EXTERNAL_ENDPOINT usa porta não autorizada.");
  if (isUnsafeAlertHost(url.hostname.toLowerCase())) throw invalidProductionDependencyConfiguration(DEPENDENCY, "ALERTING_EXTERNAL_ENDPOINT aponta para um host não permitido.");
  return url;
}

// ---------------------------------------------------------------------------
// Camada 2: resolução DNS validada e conexão fixada ("pinned") ao endereço já
// validado — proteção contra DNS rebinding/TOCTOU. Usa somente `node:dns` e
// `node:https` (sem dependência nova). O hostname original é preservado para o
// cabeçalho Host e para o SNI/validação de certificado TLS; só o socket TCP conecta
// no IP fixado.
// ---------------------------------------------------------------------------

export interface DnsRecord { address: string; family: 4 | 6; }
export type DnsResolver = (hostname: string) => Promise<DnsRecord[]>;

async function defaultDnsResolver(hostname: string): Promise<DnsRecord[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({ address: record.address, family: record.family as 4 | 6 }));
}

/**
 * Só aceita IPv4 canônico: exatamente 4 grupos decimais 0-255, sem zero à esquerda
 * (rejeita ambiguidade octal como "0177"), sem sinal, espaço, hexadecimal ou dígito
 * Unicode fora de ASCII (`\d` sem a flag `u` já não casa dígitos não-ASCII). Usado só
 * para validar o que o `DnsResolver` devolveu — nunca o literal da URL (Camada 1 usa
 * `isUnsafeIPv4`, mais permissiva na forma porque só decide "é um IP → aplicar
 * política", nunca "aceitar como endereço para conectar").
 */
const CANONICAL_IPV4 = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

function parseCanonicalIPv4(address: unknown): [number, number, number, number] | null {
  if (typeof address !== "string") return null;
  const match = CANONICAL_IPV4.exec(address);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return null;
  return parts as [number, number, number, number];
}

async function resolveSafeAddress(hostname: string, resolver: DnsResolver): Promise<DnsRecord> {
  const records = await resolver(hostname);
  if (!records.length) throw invalidProductionDependencyConfiguration(DEPENDENCY, "ALERTING_EXTERNAL_ENDPOINT não resolveu nenhum endereço.");
  for (const record of records) {
    if (record.family === 6) {
      if (isUnsafeIPv6(record.address)) throw invalidProductionDependencyConfiguration(DEPENDENCY, "ALERTING_EXTERNAL_ENDPOINT resolveu para um endereço não permitido.");
      continue;
    }
    if (record.family !== 4) throw invalidProductionDependencyConfiguration(DEPENDENCY, "ALERTING_EXTERNAL_ENDPOINT resolveu para um endereço não permitido.");
    // Fail-closed: qualquer resposta family=4 que não seja um IPv4 canônico válido
    // (não-numérica, octeto ausente/>255/negativo, hex, octal, forma decimal inteira,
    // ponto final, objeto incompleto) é recusada — achado da reauditoria 9Q.2B: antes
    // essa checagem ia direto para `isUnsafeIPv4Parts`, que trata entrada não-numérica
    // (`NaN`) como "nenhuma faixa insegura bateu" = falsamente segura.
    const parts = parseCanonicalIPv4(record.address);
    if (!parts || isUnsafeIPv4Parts(...parts)) throw invalidProductionDependencyConfiguration(DEPENDENCY, "ALERTING_EXTERNAL_ENDPOINT resolveu para um endereço não permitido.");
  }
  // Fixa em um único endereço já validado — a conexão HTTP nunca resolve de novo.
  return records[0];
}

export interface HttpRequestOptions {
  connectAddress: string;
  connectFamily: 4 | 6;
  servername: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}
export interface HttpResponseLike { statusCode: number; }
export type HttpRequester = (options: HttpRequestOptions) => Promise<HttpResponseLike>;

function defaultHttpsRequester(options: HttpRequestOptions): Promise<HttpResponseLike> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: options.connectAddress,
        servername: options.servername, // SNI + verificação de certificado contra o hostname real, nunca contra o IP
        port: 443,
        method: options.method,
        path: options.path,
        headers: { ...options.headers, host: options.servername },
        timeout: options.timeoutMs,
        // `rejectUnauthorized` nunca é definido aqui — permanece no padrão (true).
      },
      (response) => {
        response.resume(); // descarta o corpo sem nunca bufferizá-lo
        response.on("end", () => resolve({ statusCode: response.statusCode ?? 0 }));
        response.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Tempo limite ao entregar o alerta.")));
    req.on("error", reject);
    req.write(options.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Circuit breaker mínimo, em memória, por instância de transporte — não some
// alertas indefinidamente: depois do cooldown, uma nova tentativa fecha o circuito
// em caso de sucesso. Relógio injetável para teste sem espera real.
// ---------------------------------------------------------------------------

export interface CircuitBreakerOptions { failureThreshold: number; cooldownMs: number; now: () => number; }
const DEFAULT_CIRCUIT_OPTIONS: CircuitBreakerOptions = { failureThreshold: 5, cooldownMs: 30_000, now: () => Date.now() };

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Máquina de 3 estados com exclusão real de probe no half-open (achado da
 * reauditoria 9Q.2B: a versão anterior computava "aberto?" como função pura do tempo
 * decorrido — qualquer número de chamadas concorrentes no instante em que o cooldown
 * expirava passavam juntas em `beforeAttempt()`, gerando tempestade de probes).
 *
 * `beforeAttempt()` é síncrono e não contém `await`: a primeira chamada que o executa
 * depois do cooldown reivindica o estado HALF_OPEN e segue adiante (é a única "sonda"),
 * e qualquer outra chamada síncrona ou concorrente que chegue depois — inclusive antes
 * de a sonda terminar — encontra HALF_OPEN já reivindicado e é suprimida. Isto vale
 * mesmo sob `Promise.all`: em JS, cada chamada assíncrona roda de forma síncrona até o
 * primeiro `await`, então a mutação de estado sempre termina antes de qualquer outra
 * chamada da mesma leva começar a rodar.
 */
class CircuitBreaker {
  private consecutiveFailures = 0;
  private state: CircuitState = "CLOSED";
  private openedAt: number | null = null;
  suppressedCount = 0;
  constructor(private readonly options: CircuitBreakerOptions) {}
  beforeAttempt() {
    if (this.state === "CLOSED") return;
    if (this.state === "OPEN") {
      if (this.openedAt !== null && this.options.now() - this.openedAt >= this.options.cooldownMs) {
        this.state = "HALF_OPEN"; // esta chamada, e só ela, é a sonda
        return;
      }
      this.suppressedCount += 1;
      throw invalidProductionDependencyConfiguration(DEPENDENCY, "Circuito de alerting aberto; destino recentemente indisponível.");
    }
    // HALF_OPEN: uma sonda já está em andamento — qualquer outra chamada é suprimida,
    // nunca uma segunda sonda concorrente.
    this.suppressedCount += 1;
    throw invalidProductionDependencyConfiguration(DEPENDENCY, "Circuito de alerting em teste de recuperação; nova tentativa suprimida.");
  }
  onSuccess() { this.consecutiveFailures = 0; this.state = "CLOSED"; this.openedAt = null; }
  onFailure() {
    this.consecutiveFailures += 1;
    if (this.state === "HALF_OPEN") { this.state = "OPEN"; this.openedAt = this.options.now(); return; } // sonda falhou: reabre com cooldown fresco
    if (this.consecutiveFailures >= this.options.failureThreshold) { this.state = "OPEN"; this.openedAt = this.options.now(); }
  }
}

/**
 * Transporte agnóstico de fornecedor: qualquer backend que aceite POST HTTP com corpo
 * JSON (Slack/Teams incoming webhook, PagerDuty Events API v2, OpsGenie, Datadog,
 * Sentry envelope relay, endpoint HTTP interno) pode ser conectado sem acoplar o domínio
 * a um fornecedor específico. Nenhum valor de segredo entra no corpo — apenas o payload
 * já sanitizado pelo logger. Resolver DNS e executor HTTP são injetáveis para teste sem
 * rede real.
 */
export class WebhookAlertTransport implements AlertTransport {
  private readonly url: URL;
  private readonly breaker: CircuitBreaker;
  constructor(
    endpoint: string,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
    private readonly resolver: DnsResolver = defaultDnsResolver,
    private readonly requester: HttpRequester = defaultHttpsRequester,
    circuitOptions: Partial<CircuitBreakerOptions> = {},
  ) {
    this.url = assertSafeAlertEndpoint(endpoint);
    this.breaker = new CircuitBreaker({ ...DEFAULT_CIRCUIT_OPTIONS, ...circuitOptions });
  }

  get suppressedByCircuitBreaker() { return this.breaker.suppressedCount; }

  async send(payload: Record<string, unknown>) {
    // Fora do try/catch de propósito: uma tentativa suprimida pelo breaker nunca toca a
    // rede e não deve contar como uma NOVA falha (achado corrigido durante a implementação
    // do half-open exclusivo — chamar `onFailure()` para uma supressão fazia a sonda
    // "falhar" antes mesmo de terminar, reabrindo o circuito prematuramente sob
    // concorrência).
    this.breaker.beforeAttempt();
    try {
      const resolved = await resolveSafeAddress(this.url.hostname, this.resolver);
      const response = await this.requester({
        connectAddress: resolved.address,
        connectFamily: resolved.family,
        servername: this.url.hostname,
        path: `${this.url.pathname}${this.url.search}`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: this.timeoutMs,
      });
      // Sem seguidor de redirecionamento em nenhuma camada (raw https.request nunca
      // segue 3xx) — qualquer resposta fora de 2xx, incluindo 3xx, é recusa.
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Object.assign(new Error("Destino de alerta recusou o payload."), { name: "AlertTransportError", statusCode: response.statusCode });
      }
      this.breaker.onSuccess();
    } catch (error) {
      this.breaker.onFailure();
      throw wrapProductionDependencyFailure(error, DEPENDENCY, "Não foi possível entregar o alerta ao destino externo configurado.");
    }
  }

  async healthCheck() {
    await this.send({ kind: "HEALTHCHECK", timestamp: new Date().toISOString() });
  }
}

export class ExternalAlertReporter implements ErrorReporterProvider {
  readonly name = "EXTERNAL_ALERT_TRANSPORT";
  constructor(private readonly transport: AlertTransport) {}
  async capture(error: unknown, context: LogContext = {}) {
    const safe = sanitizeLogValue({ kind: "ERROR", message: error instanceof Error ? error.message : "Erro não identificado.", ...context }) as Record<string, unknown>;
    await this.transport.send(safe);
  }
}

export class ExternalAlertMetrics implements MetricsProvider {
  readonly name = "EXTERNAL_ALERT_TRANSPORT";
  constructor(private readonly transport: AlertTransport) {}
  increment(name: string, value = 1, dimensions: Record<string, string> = {}) {
    void this.transport.send(sanitizeLogValue({ kind: "METRIC_INCREMENT", name, value, ...dimensions }) as Record<string, unknown>);
  }
  timing(name: string, durationMs: number, dimensions: Record<string, string> = {}) {
    void this.transport.send(sanitizeLogValue({ kind: "METRIC_TIMING", name, durationMs, ...dimensions }) as Record<string, unknown>);
  }
}

/**
 * Espelha o padrão fail-closed de `createSecretProvider`/`createKmsProvider`: produção
 * nunca aceita o reporter/metrics local silencioso — falha fechado até um destino real
 * ser configurado (§7 do escopo 9Q.2B: "alertas reais com destino comprovado").
 */
export function createErrorReporter(config: RuntimeConfig = runtimeConfig()): ErrorReporterProvider {
  if (config.ALERTING_PROVIDER !== "external") {
    if (config.NODE_ENV === "production") throw new Error("Reporter de erro local é proibido em produção.");
    return new LocalErrorReporter();
  }
  if (!config.ALERTING_EXTERNAL_ENDPOINT) throw new Error("Configuração obrigatória ausente: ALERTING_EXTERNAL_ENDPOINT.");
  return new ExternalAlertReporter(new WebhookAlertTransport(config.ALERTING_EXTERNAL_ENDPOINT));
}

export function createMetricsProvider(config: RuntimeConfig = runtimeConfig()): MetricsProvider {
  if (config.ALERTING_PROVIDER !== "external") {
    if (config.NODE_ENV === "production") throw new Error("Provider de métricas local é proibido em produção.");
    return new LocalMetricsProvider();
  }
  if (!config.ALERTING_EXTERNAL_ENDPOINT) throw new Error("Configuração obrigatória ausente: ALERTING_EXTERNAL_ENDPOINT.");
  return new ExternalAlertMetrics(new WebhookAlertTransport(config.ALERTING_EXTERNAL_ENDPOINT));
}

export async function checkAlertingHealth(config: RuntimeConfig = runtimeConfig()) {
  if (config.ALERTING_PROVIDER !== "external" || !config.ALERTING_EXTERNAL_ENDPOINT) {
    throw new Error("Alerting externo não configurado.");
  }
  await new WebhookAlertTransport(config.ALERTING_EXTERNAL_ENDPOINT).healthCheck();
}
