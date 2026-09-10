import { describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "@/infrastructure/config/runtime-config";
import {
  assertSafeAlertEndpoint,
  createErrorReporter,
  createMetricsProvider,
  checkAlertingHealth,
  WebhookAlertTransport,
  type DnsRecord,
  type DnsResolver,
  type HttpRequester,
  type HttpResponseLike,
} from "./alert-dispatcher";

function baseConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    NODE_ENV: "production", DATABASE_URL: "postgresql://db/producao", SESSION_COOKIE_NAME: "rede", TRUSTED_PROXY_HOPS: 0,
    STORAGE_PROVIDER: "s3", STORAGE_FORCE_PATH_STYLE: "false", STORAGE_SIGNED_URL_TTL_SECONDS: 300,
    MALWARE_SCANNER_PROVIDER: "external", SECRET_PROVIDER: "external", KMS_PROVIDER: "external",
    ALERTING_PROVIDER: "external", ALERTING_EXTERNAL_ENDPOINT: "https://alerts.example.invalid/webhook",
    WORKER_CONCURRENCY: 1, WORKER_POLL_MS: 100, WORKER_LEASE_MS: 5000, WORKER_JOB_TIMEOUT_MS: 1000,
    ...overrides,
  } as RuntimeConfig;
}

const publicRecord: DnsRecord[] = [{ address: "93.184.216.34", family: 4 }];
function fakeResolver(records: DnsRecord[] | Error): DnsResolver {
  return vi.fn(async () => { if (records instanceof Error) throw records; return records; });
}
function fakeRequester(response: HttpResponseLike | Error): HttpRequester {
  return vi.fn(async () => { if (response instanceof Error) throw response; return response; });
}

describe("gate de alerting fail-closed", () => {
  it("proíbe reporter/metrics local em produção", () => {
    const config = baseConfig({ ALERTING_PROVIDER: "local" });
    expect(() => createErrorReporter(config)).toThrow(/proibido/);
    expect(() => createMetricsProvider(config)).toThrow(/proibido/);
  });

  it("exige endpoint externo quando ALERTING_PROVIDER=external", () => {
    const config = baseConfig({ ALERTING_EXTERNAL_ENDPOINT: undefined });
    expect(() => createErrorReporter(config)).toThrow(/ALERTING_EXTERNAL_ENDPOINT/);
  });

  it("fora de produção, aceita o provider local sem lançar", () => {
    const config = baseConfig({ NODE_ENV: "test", ALERTING_PROVIDER: "local" });
    expect(createErrorReporter(config).constructor.name).toBe("LocalErrorReporter");
    expect(createMetricsProvider(config).constructor.name).toBe("LocalMetricsProvider");
  });

  it("healthCheck falha fechado quando alerting não está configurado", async () => {
    await expect(checkAlertingHealth(baseConfig({ ALERTING_PROVIDER: "local" }))).rejects.toThrow(/não configurado/);
  });
});

describe("transporte de webhook de alerta — envio e classificação", () => {
  it("envia payload sanitizado e classifica falha de indisponibilidade", async () => {
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(publicRecord), fakeRequester({ statusCode: 500 }));
    await expect(transport.send({ message: "erro" })).rejects.toThrow(/entregar o alerta/);
  });

  it("reporter externo nunca inclui segredo no corpo enviado", async () => {
    const requester = fakeRequester({ statusCode: 200 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(publicRecord), requester);
    const reporter = new (await import("./alert-dispatcher")).ExternalAlertReporter(transport);
    await reporter.capture(new Error("falha"), { token: "segredo-nao-pode-vazar", correlationId: "abc" });
    const call = vi.mocked(requester).mock.calls[0][0];
    expect(call.body).not.toContain("segredo-nao-pode-vazar");
    expect(call.body).toContain("abc");
  });

  it("recusa 3xx (sem seguir redirecionamento) como qualquer outro erro", async () => {
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(publicRecord), fakeRequester({ statusCode: 302 }));
    await expect(transport.send({ message: "erro" })).rejects.toThrow(/entregar o alerta/);
  });

  it("resolver e requester são injetáveis — nenhum destino real é chamado no teste", async () => {
    const resolver = fakeResolver(publicRecord);
    const requester = fakeRequester({ statusCode: 200 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, resolver, requester);
    await transport.send({ message: "ok" });
    expect(resolver).toHaveBeenCalledWith("alerts.example.invalid");
    expect(requester).toHaveBeenCalledOnce();
  });

  it("preserva o hostname original como servername TLS, mesmo conectando pelo IP resolvido", async () => {
    const requester = fakeRequester({ statusCode: 200 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(publicRecord), requester);
    await transport.send({});
    const call = vi.mocked(requester).mock.calls[0][0];
    expect(call.connectAddress).toBe("93.184.216.34");
    expect(call.servername).toBe("alerts.example.invalid");
  });

  it("aplica timeout via o requester injetado sem esperar indefinidamente", async () => {
    const requester: HttpRequester = vi.fn(() => new Promise<HttpResponseLike>((_resolve, reject) => { reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }));
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 10, fakeResolver(publicRecord), requester);
    await expect(transport.send({ message: "erro" })).rejects.toThrow(/entregar o alerta/);
  });

  it("nunca inclui o endpoint completo ou o payload numa mensagem de erro voltada ao operador", async () => {
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook?token=segredo-de-webhook", 5000, fakeResolver(publicRecord), fakeRequester({ statusCode: 403 }));
    const error = await transport.send({ message: "erro", detalheSensivel: "não pode vazar" }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("segredo-de-webhook");
    expect((error as Error).message).not.toContain("não pode vazar");
    expect((error as Error).message).not.toContain("alerts.example.invalid");
  });
});

describe("auditoria adversarial do literal da URL (Camada 1 — sem rede)", () => {
  it.each([
    ["http://alerts.example.invalid/webhook", "http em vez de https"],
    ["https://user:pass@alerts.example.invalid/webhook", "userinfo embutido na URL"],
    ["https://alerts.example.invalid:8443/webhook", "porta alternativa não autorizada"],
    ["https://localhost/webhook", "localhost"],
    ["https://sub.localhost/webhook", "subdomínio de localhost"],
    ["https://0.0.0.0/webhook", "0.0.0.0"],
    ["https://127.0.0.1/webhook", "loopback IPv4"],
    ["https://[::1]/webhook", "loopback IPv6"],
    ["https://169.254.169.254/latest/meta-data/", "link-local / metadados de nuvem"],
    ["https://[fe80::1]/webhook", "link-local IPv6"],
    ["https://10.0.0.5/webhook", "rede privada 10.0.0.0/8"],
    ["https://172.16.0.5/webhook", "rede privada 172.16.0.0/12"],
    ["https://172.31.255.255/webhook", "rede privada 172.16.0.0/12 (limite superior)"],
    ["https://192.168.1.1/webhook", "rede privada 192.168.0.0/16"],
    ["https://[fd00::1]/webhook", "unique local IPv6 (fc00::/7)"],
    ["https://224.0.0.1/webhook", "multicast IPv4"],
    ["https://240.0.0.1/webhook", "reservado/Classe E IPv4"],
    ["https://100.64.0.1/webhook", "CGNAT compartilhado 100.64.0.0/10"],
    ["https://[ff02::1]/webhook", "multicast IPv6"],
    ["https://[::]/webhook", "unspecified IPv6"],
    ["not-a-url", "URL malformada"],
    // IPv4 embutido em IPv6 — Achado B1 desta correção
    ["https://[::ffff:127.0.0.1]/webhook", "IPv4-mapped: loopback"],
    ["https://[::ffff:169.254.169.254]/webhook", "IPv4-mapped: metadados de nuvem"],
    ["https://[::ffff:10.0.0.5]/webhook", "IPv4-mapped: privado 10/8"],
    ["https://[::ffff:192.168.1.1]/webhook", "IPv4-mapped: privado 192.168/16"],
    ["https://[::ffff:7f00:1]/webhook", "IPv4-mapped em hex puro: 127.0.0.1"],
    ["https://[::ffff:a9fe:a9fe]/webhook", "IPv4-mapped em hex puro: 169.254.169.254"],
    ["https://[::ffff:a00:5]/webhook", "IPv4-mapped em hex puro: 10.0.0.5"],
    ["https://[::ffff:c0a8:101]/webhook", "IPv4-mapped em hex puro: 192.168.1.1"],
    ["https://[64:ff9b::127.0.0.1]/webhook", "NAT64: loopback embutido"],
    ["https://[64:ff9b::169.254.169.254]/webhook", "NAT64: metadados de nuvem embutidos"],
    ["https://[2002:7f00:0001::]/webhook", "6to4: loopback embutido"],
    ["https://[2002:a9fe:a9fe::]/webhook", "6to4: metadados de nuvem embutidos"],
    // IPv4-translated (RFC 2765/SIIT) — achado da reauditoria 9Q.2B: distinto do
    // IPv4-mapped porque 0xffff está no grupo 4, não no grupo 5.
    ["https://[::ffff:0:127.0.0.1]/webhook", "IPv4-translated: loopback embutido"],
    ["https://[::ffff:0:169.254.169.254]/webhook", "IPv4-translated: metadados de nuvem embutidos"],
    ["https://[::ffff:0:10.0.0.1]/webhook", "IPv4-translated: privado 10/8 embutido"],
    ["https://[0:0:0:0:ffff:0:127.0.0.1]/webhook", "IPv4-translated, forma totalmente expandida"],
  ])("rejeita %s (%s)", (endpoint) => {
    expect(() => assertSafeAlertEndpoint(endpoint)).toThrow();
    expect(() => new WebhookAlertTransport(endpoint)).toThrow();
  });

  it.each([
    "https://alerts.example.invalid/webhook",
    "https://alerts.example.invalid:443/webhook",
    "https://hooks.slack.com/services/T000/B000/token",
    "https://172.15.255.255/webhook",
    "https://172.32.0.0/webhook",
    "https://[2001:db8::1]/webhook", // documentação IPv6, formato público válido
  ])("aceita %s no literal (a Camada 2/DNS ainda decide o restante)", (endpoint) => {
    expect(() => assertSafeAlertEndpoint(endpoint)).not.toThrow();
  });
});

describe("proteção contra DNS rebinding / TOCTOU (Camada 2)", () => {
  it("hostname resolve apenas para IP público — aceito", async () => {
    const requester = fakeRequester({ statusCode: 200 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(publicRecord), requester);
    await expect(transport.send({})).resolves.toBeUndefined();
  });

  it("hostname resolve para público e privado simultaneamente — recusado inteiro (nenhum endereço proibido é tolerado)", async () => {
    const mixed: DnsRecord[] = [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
    const requester = fakeRequester({ statusCode: 200 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(mixed), requester);
    await expect(transport.send({})).rejects.toThrow(/não permitido/);
    expect(requester).not.toHaveBeenCalled(); // nem chega a conectar
  });

  it("A público e AAAA privado simultaneamente — recusado", async () => {
    const mixed: DnsRecord[] = [{ address: "93.184.216.34", family: 4 }, { address: "fd00::1", family: 6 }];
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(mixed), fakeRequester({ statusCode: 200 }));
    await expect(transport.send({})).rejects.toThrow(/não permitido/);
  });

  it("resolver retorna IPv4 embutido em IPv6 (rebinding via AAAA) — recusado mesmo vindo do DNS, não só do literal", async () => {
    const rebound: DnsRecord[] = [{ address: "::ffff:169.254.169.254", family: 6 }];
    const requester = fakeRequester({ statusCode: 200 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(rebound), requester);
    await expect(transport.send({})).rejects.toThrow(/não permitido/);
    expect(requester).not.toHaveBeenCalled();
  });

  it("NXDOMAIN / falha de DNS é classificada de forma segura, sem vazar detalhe interno", async () => {
    const dnsError = Object.assign(new Error("queryA ENOTFOUND alerts.example.invalid"), { code: "ENOTFOUND" });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(dnsError), fakeRequester({ statusCode: 200 }));
    const error = await transport.send({}).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("ENOTFOUND");
  });

  it("resolver retorna lista vazia — recusado (nenhum endereço para conectar)", async () => {
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver([]), fakeRequester({ statusCode: 200 }));
    await expect(transport.send({})).rejects.toThrow(/não resolveu/);
  });

  it("timeout de DNS é classificado de forma segura", async () => {
    const timeoutError = Object.assign(new Error("queryA ETIMEOUT alerts.example.invalid"), { code: "ETIMEOUT" });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(timeoutError), fakeRequester({ statusCode: 200 }));
    await expect(transport.send({})).rejects.toThrow(/entregar o alerta/);
  });

  it("conecta exatamente no endereço já validado — nunca um diferente, e nunca re-resolve antes de conectar dentro da mesma tentativa", async () => {
    const resolver = fakeResolver(publicRecord);
    const requester = fakeRequester({ statusCode: 200 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, resolver, requester);
    await transport.send({});
    expect(resolver).toHaveBeenCalledOnce();
    expect(requester).toHaveBeenCalledOnce();
    const requestedAddress = vi.mocked(requester).mock.calls[0][0].connectAddress;
    expect(requestedAddress).toBe(publicRecord[0].address);
  });

  it("cada tentativa (send) nova resolve de novo — não reutiliza resolução obsoleta entre chamadas", async () => {
    const resolver = fakeResolver(publicRecord);
    const requester = fakeRequester({ statusCode: 200 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, resolver, requester);
    await transport.send({});
    await transport.send({});
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("nunca desabilita verificação TLS nem confia no IP para validação de certificado — servername é sempre o hostname original", async () => {
    const requester = fakeRequester({ statusCode: 200 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(publicRecord), requester);
    await transport.send({});
    const call = vi.mocked(requester).mock.calls[0][0];
    expect(call.servername).not.toBe(call.connectAddress);
    expect(Object.prototype.hasOwnProperty.call(call, "rejectUnauthorized")).toBe(false);
  });

  it("resolver retorna IPv4-translated (::ffff:0:a.b.c.d) embutido — recusado mesmo vindo do DNS", async () => {
    const rebound: DnsRecord[] = [{ address: "::ffff:0:169.254.169.254", family: 6 }];
    const requester = fakeRequester({ statusCode: 200 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(rebound), requester);
    await expect(transport.send({})).rejects.toThrow(/não permitido/);
    expect(requester).not.toHaveBeenCalled();
  });

  describe("resolver hostil — resposta family=4 malformada (Camada 2, achado da reauditoria 9Q.2B)", () => {
    it.each([
      ["not-an-ip", "texto não numérico"],
      ["10.0.0", "octeto ausente"],
      ["10.0.0.1.2", "octeto a mais"],
      ["999.0.0.1", "octeto >255"],
      ["-1.0.0.1", "octeto negativo"],
      ["1.0. 0.1", "espaço embutido"],
      ["+1.0.0.1", "sinal de mais"],
      ["0x7f.0.0.1", "hexadecimal"],
      ["0177.0.0.1", "octal (zero à esquerda)"],
      ["2130706433", "decimal inteiro único (equivalente a 127.0.0.1)"],
      ["127.0.0.1.", "ponto final"],
      ["127.0.0.১", "dígito Unicode não-ASCII (bengali)"],
      ["", "string vazia"],
    ])("recusa family=4 com endereço '%s' (%s) — fail-closed, não fail-open", async (address) => {
      const hostile: DnsRecord[] = [{ address, family: 4 }];
      const requester = fakeRequester({ statusCode: 200 });
      const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(hostile), requester);
      await expect(transport.send({})).rejects.toThrow(/não permitido/);
      expect(requester).not.toHaveBeenCalled();
    });

    it("recusa objeto de endereço incompleto/hostil (sem address, address não textual)", async () => {
      const incomplete = [{ family: 4 }] as unknown as DnsRecord[];
      const transport1 = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(incomplete), fakeRequester({ statusCode: 200 }));
      await expect(transport1.send({})).rejects.toThrow(/não permitido/);

      const nonTextual = [{ address: 2130706433, family: 4 }] as unknown as DnsRecord[];
      const transport2 = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(nonTextual), fakeRequester({ statusCode: 200 }));
      await expect(transport2.send({})).rejects.toThrow(/não permitido/);
    });

    it("recusa family divergente do endereço (family desconhecida, nem 4 nem 6)", async () => {
      const weird = [{ address: "93.184.216.34", family: 5 }] as unknown as DnsRecord[];
      const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(weird), fakeRequester({ statusCode: 200 }));
      await expect(transport.send({})).rejects.toThrow(/não permitido/);
    });

    it("ainda aceita IPv4 canônico legítimo depois do endurecimento (sem regressão)", async () => {
      const requester = fakeRequester({ statusCode: 200 });
      const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver([{ address: "8.8.8.8", family: 4 }]), requester);
      await expect(transport.send({})).resolves.toBeUndefined();
    });
  });
});

describe("circuit breaker mínimo (em memória, por instância)", () => {
  it("abre após N falhas consecutivas e suprime tentativas durante o cooldown", async () => {
    const now = 0;
    const requester = fakeRequester({ statusCode: 500 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(publicRecord), requester, { failureThreshold: 3, cooldownMs: 1000, now: () => now });
    for (let i = 0; i < 3; i += 1) await transport.send({}).catch(() => undefined);
    expect(vi.mocked(requester)).toHaveBeenCalledTimes(3);
    await transport.send({}).catch(() => undefined); // circuito já aberto — não deve chamar o requester de novo
    expect(vi.mocked(requester)).toHaveBeenCalledTimes(3);
    expect(transport.suppressedByCircuitBreaker).toBe(1);
  });

  it("fecha o circuito após o cooldown se a próxima tentativa tiver sucesso", async () => {
    let now = 0;
    let statusCode = 500;
    const requester: HttpRequester = vi.fn(async () => ({ statusCode }));
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(publicRecord), requester, { failureThreshold: 2, cooldownMs: 1000, now: () => now });
    await transport.send({}).catch(() => undefined);
    await transport.send({}).catch(() => undefined); // abre o circuito
    now = 1000; // avança o relógio injetado além do cooldown — sem espera real
    statusCode = 200;
    await expect(transport.send({})).resolves.toBeUndefined();
    now = 1000;
    await expect(transport.send({})).resolves.toBeUndefined(); // circuito fechado: chamadas seguintes passam normalmente
  });

  // Achado Médio da reauditoria 9Q.2B: o breaker anterior computava "aberto?" como
  // função pura do tempo — qualquer número de chamadas concorrentes no instante em que
  // o cooldown expirava passava junto, sem exclusão de sonda única.
  it("half-open permite exatamente UMA sonda sob concorrência real (Promise.all) — as demais são suprimidas, nunca uma tempestade", async () => {
    let now = 0;
    const requester = fakeRequester({ statusCode: 500 });
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(publicRecord), requester, { failureThreshold: 2, cooldownMs: 1000, now: () => now });
    await transport.send({}).catch(() => undefined);
    await transport.send({}).catch(() => undefined); // 2 falhas consecutivas -> abre o circuito
    expect(vi.mocked(requester)).toHaveBeenCalledTimes(2);
    now = 1000; // exatamente no fim do cooldown

    const results = await Promise.allSettled([transport.send({}), transport.send({}), transport.send({}), transport.send({}), transport.send({})]);

    // Só a sonda chega ao requester: 2 falhas iniciais + exatamente 1 tentativa real nesta leva.
    expect(vi.mocked(requester)).toHaveBeenCalledTimes(3);
    const suppressedBySlot = results.filter((r) => r.status === "rejected" && /suprimida/.test(String((r as PromiseRejectedResult).reason)));
    expect(suppressedBySlot).toHaveLength(4);
    expect(transport.suppressedByCircuitBreaker).toBe(4);
  });

  it("sonda falha -> reabre o circuito com cooldown novo (transição determinística, não permanece meio-aberto)", async () => {
    let now = 0;
    let statusCode = 500;
    const requester: HttpRequester = vi.fn(async () => ({ statusCode }));
    const transport = new WebhookAlertTransport("https://alerts.example.invalid/webhook", 5000, fakeResolver(publicRecord), requester, { failureThreshold: 1, cooldownMs: 1000, now: () => now });
    await transport.send({}).catch(() => undefined); // abre (threshold=1)
    now = 1000; // cooldown expira -> próxima chamada é a sonda
    await transport.send({}).catch(() => undefined); // sonda também falha (statusCode ainda 500) -> reabre
    // Imediatamente após a sonda falhar, o circuito já deve estar OPEN de novo: uma nova
    // chamada no mesmo instante (cooldown ainda não recomeçou a contar) é suprimida.
    await transport.send({}).catch(() => undefined);
    expect(vi.mocked(requester)).toHaveBeenCalledTimes(2); // falha inicial + sonda, nunca a 3ª chamada
    now = 2000; // cooldown fresco (a partir de quando a sonda falhou, não do original) expira
    statusCode = 200;
    await expect(transport.send({})).resolves.toBeUndefined(); // nova sonda, sucesso -> fecha
    now = 2000;
    await expect(transport.send({})).resolves.toBeUndefined(); // fechado: chamada normal, sem suprimir
  });
});
