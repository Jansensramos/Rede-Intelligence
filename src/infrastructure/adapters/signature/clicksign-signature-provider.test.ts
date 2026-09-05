import { describe, expect, it, vi } from "vitest";
import { mockSignatureProvider } from "./mock-signature-provider";
import {
  CLICKSIGN_MAX_DOCUMENT_BYTES,
  ClicksignProviderError,
  ClicksignSignatureProvider,
  clicksignInternals,
  fetchClicksignTransport,
  type ClicksignHttpRequest,
  type ClicksignHttpResponse,
  type ClicksignHttpTransport,
} from "./clicksign-signature-provider";

const bytes = (value: string) => new TextEncoder().encode(value);
const response = (payload: unknown, status = 200, extra: Partial<ClicksignHttpResponse> = {}): ClicksignHttpResponse => ({
  status,
  headers: { "content-type": "application/vnd.api+json" },
  body: bytes(JSON.stringify(payload)),
  finalUrl: "__REQUEST_URL__",
  ...extra,
});

function transportWith(responses: ClicksignHttpResponse[]) {
  const requests: ClicksignHttpRequest[] = [];
  const transport: ClicksignHttpTransport = { request: vi.fn(async (request) => {
    requests.push(request);
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return { ...next, finalUrl: next.finalUrl === "__REQUEST_URL__" ? request.url : next.finalUrl };
  }) };
  return { transport, requests };
}

const sendInput = {
  organizationId: "org-1", requestId: "request-1",
  document: { fileName: "contrato.pdf", mimeType: "application/pdf", checksum: "abc", bytes: bytes("%PDF-1.7\ncontent") },
  parties: [{ displayName: "Pessoa Teste", email: "pessoa@example.test", role: "BUYER", order: 1 }],
};

const PRESIGNED_URL = "https://clicksign-sandbox-content.s3.amazonaws.com/signed/document.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=segredo";
const documentList = (data: unknown = [{ id: "doc-1", type: "documents", links: { files: { signed: PRESIGNED_URL, ziped: "https://clicksign-sandbox-content.s3.amazonaws.com/bundle.zip?X-Amz-Signature=segredo" } } }]) => response({ data });
const documentDetail = (input: { id?: unknown; status?: unknown; signed?: unknown } = {}) => response({ data: {
  id: input.id === undefined ? "doc-1" : input.id,
  type: "documents",
  attributes: { status: input.status === undefined ? "closed" : input.status },
  links: { files: { signed: input.signed === undefined ? PRESIGNED_URL : input.signed, ziped: "https://clicksign-sandbox-content.s3.amazonaws.com/bundle.zip?X-Amz-Signature=segredo" } },
} });
const pdfResponse = (body: Uint8Array, contentType = "application/pdf") => response({}, 200, { headers: { "content-type": contentType }, body });
const reconciliationEvent = (id: string, name: string, signerId?: unknown) => ({
  id, type: "events", attributes: { name, data: signerId === undefined ? {} : { signer: { key: signerId } } },
});
const reconciliationResponses = (events: unknown[], detail = documentDetail({ status: "closed" })) => [
  documentList([{ id: "doc-1", type: "documents" }]), detail, response({ data: events }),
];

async function finalEvidenceWith(document: ClicksignHttpResponse, metadata: ClicksignHttpResponse[] = [documentList(), documentDetail()]) {
  const controlled = transportWith([...metadata, document]);
  const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "vault-token" }, controlled.transport);
  return { outcome: provider.finalEvidence("env-1"), requests: controlled.requests };
}

describe("ClicksignSignatureProvider", () => {
  it("mantém MOCK sem abrir socket", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await mockSignatureProvider.send(sendInput);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("executa somente o fluxo Envelope API 3.0 pelo transporte injetado", async () => {
    const { transport, requests } = transportWith([
      response({ data: { id: "env-1" } }, 201), response({ data: { id: "doc-1" } }, 201), response({ data: { id: "signer-1" } }, 201),
      response({ data: { id: "req-role" } }, 201), response({ data: { id: "req-auth" } }, 201), response({ data: { id: "env-1" } }), response({ data: { id: "notification-1" } }, 201),
    ]);
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "vault-token" }, transport);
    await expect(provider.send(sendInput)).resolves.toEqual({ externalId: "env-1", parties: [{ order: 1, externalPartyId: "signer-1" }] });
    expect(requests.map((item) => `${item.method} ${new URL(item.url).pathname}`)).toEqual([
      "POST /api/v3/envelopes", "POST /api/v3/envelopes/env-1/documents", "POST /api/v3/envelopes/env-1/signers",
      "POST /api/v3/envelopes/env-1/requirements", "POST /api/v3/envelopes/env-1/requirements", "PATCH /api/v3/envelopes/env-1", "POST /api/v3/envelopes/env-1/notifications",
    ]);
    expect(requests.every((item) => item.headers.Authorization === "vault-token")).toBe(true);
    expect(requests.every((item) => item.headers.Accept === "application/vnd.api+json")).toBe(true);
    expect(requests.every((item) => item.headers["Content-Type"] === "application/vnd.api+json")).toBe(true);
    expect(requests.some((item) => item.url.includes("api/v1"))).toBe(false);
  });

  it("constrói Authorization puro e JSON:API para GET /envelopes", async () => {
    const { transport, requests } = transportWith([response({ data: [] })]);
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "token-exato" }, transport);
    const rawProvider = provider as unknown as { raw(method: "GET", path: string): Promise<ClicksignHttpResponse> };
    await rawProvider.raw("GET", "/envelopes");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers).toMatchObject({
      Authorization: "token-exato",
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    });
    expect(requests[0]?.headers.Authorization).not.toMatch(/^Bearer\s/i);
    expect(requests[0]?.headers.Authorization).not.toContain(" ");
  });

  it("usa o mesmo construtor central em POST, upload, PATCH e notificações", async () => {
    const { transport, requests } = transportWith([
      response({ data: { id: "env-1" } }, 201), response({ data: { id: "doc-1" } }, 201), response({ data: { id: "signer-1" } }, 201),
      response({ data: { id: "req-role" } }, 201), response({ data: { id: "req-auth" } }, 201), response({ data: { id: "env-1" } }), response({ data: { id: "notification-1" } }, 201),
    ]);
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "central-token" }, transport);
    await provider.send(sendInput);
    const uploads = requests.filter((item) => new URL(item.url).pathname.endsWith("/documents"));
    expect(uploads).toHaveLength(1);
    for (const request of requests) {
      expect(request.headers.Authorization).toBe("central-token");
      expect(request.headers.Accept).toBe("application/vnd.api+json");
      expect(request.headers["Content-Type"]).toBe("application/vnd.api+json");
    }
  });

  it.each([
    ["vazio", ""],
    ["CRLF", "token\r\nAuthorization: leaked"],
    ["NUL", "token\u0000value"],
    ["controle", "token\u001fvalue"],
    ["espaço inicial", " token"],
    ["espaço final", "token "],
  ])("rejeita token %s antes do transporte e sem expor valor", (_label, invalidToken) => {
    const transport: ClicksignHttpTransport = { request: vi.fn() };
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let caught: unknown;
    try { new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: invalidToken }, transport); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Credencial Clicksign ausente ou inválida.");
    expect((transport.request as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it.each([
    [401, "AUTHENTICATION"], [403, "AUTHORIZATION"], [404, "NOT_FOUND"], [409, "CONFLICT"], [422, "VALIDATION"], [429, "RATE_LIMIT"], [500, "PROVIDER"], [503, "PROVIDER"],
  ] as const)("classifica HTTP %s sem expor resposta", async (status, errorClass) => {
    const { transport } = transportWith([response({ errors: [{ detail: "token=segredo pessoa@example.test" }] }, status, { headers: { "content-type": "application/vnd.api+json", "retry-after": status === 429 ? "7" : undefined } })]);
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "token-super-secreto" }, transport);
    const caught = await provider.status("env-1").catch((error) => error);
    expect(caught).toBeInstanceOf(ClicksignProviderError);
    expect(caught.errorClass).toBe(errorClass);
    expect(caught.message).not.toContain("segredo");
    expect(caught.message).not.toContain("example.test");
    if (status === 429) expect(caught.retryAfterMs).toBe(7000);
  });

  it("classifica timeout de forma segura", async () => {
    const transport: ClicksignHttpTransport = { request: vi.fn(async () => { throw new DOMException("secret", "TimeoutError"); }) };
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "secret" }, transport);
    const caught = await provider.status("env-1").catch((error) => error);
    expect(caught).toMatchObject({ errorClass: "TIMEOUT" });
    expect(caught.message).not.toContain("secret");
  });

  it("rejeita redirecionamento para host não autorizado", async () => {
    const { transport } = transportWith([response({}, 200, { finalUrl: "https://evil.test/collect" })]);
    (transport.request as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ ...response({ data: { attributes: { status: "running" } } }), finalUrl: "https://evil.test/collect" }));
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "secret" }, transport);
    await expect(provider.status("env-1")).rejects.toMatchObject({ errorClass: "VALIDATION" });
  });

  it("falha fechado para host, MIME, assinatura e tamanho inválidos", async () => {
    expect(() => new ClicksignSignatureProvider({ baseUrl: "https://localhost/api/v3", accessToken: "x" }, { request: vi.fn() })).toThrow("não permitido");
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "x" }, { request: vi.fn() });
    await expect(provider.send({ ...sendInput, document: { ...sendInput.document, mimeType: "text/plain" } })).rejects.toThrow("deve ser PDF");
    await expect(provider.send({ ...sendInput, document: { ...sendInput.document, bytes: bytes("not-pdf") } })).rejects.toThrow("não corresponde");
    await expect(provider.send({ ...sendInput, document: { ...sendInput.document, bytes: new Uint8Array(CLICKSIGN_MAX_DOCUMENT_BYTES + 1) } })).rejects.toThrow("limite permitido");
  });

  it("não usa transporte real quando um double é injetado", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { transport } = transportWith([response({ data: { attributes: { status: "running" } } })]);
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "x" }, transport);
    await expect(provider.status("env-1")).resolves.toBe("RUNNING");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("evento de outro documento não é reutilizado quando o endpoint esperado não comprova sign", async () => {
    const baseUrl = "https://sandbox.clicksign.com/api/v3";
    const expectedEventsUrl = `${baseUrl}/envelopes/env-1/documents/doc-1/events`;
    const otherEventsUrl = `${baseUrl}/envelopes/env-1/documents/doc-other/events`;
    const fixtures = new Map<string, ClicksignHttpResponse>([
      [`${baseUrl}/envelopes/env-1/documents`, documentList([{ id: "doc-1", type: "documents" }])],
      [`${baseUrl}/envelopes/env-1/documents/doc-1`, documentDetail()],
      [expectedEventsUrl, response({ data: [reconciliationEvent("evt-start", "signature_started", "signer-1")] })],
      [otherEventsUrl, response({ data: [reconciliationEvent("evt-other", "sign", "signer-1")] })],
    ]);
    const transport: ClicksignHttpTransport = { request: vi.fn(async (request) => {
      const fixture = fixtures.get(request.url);
      if (!fixture) throw new Error("Unexpected local fixture request");
      return { ...fixture, finalUrl: request.url };
    }) };
    const provider = new ClicksignSignatureProvider({ baseUrl, accessToken: "vault-token" }, transport);
    await expect(provider.reconcileSignatures({ externalId: "env-1", expectedExternalPartyIds: ["signer-1"] })).rejects.toMatchObject({ reasonCode: "SIGNATURE_EVIDENCE_PENDING" });
    expect(vi.mocked(transport.request).mock.calls.map(([request]) => request.url)).toEqual([
      `${baseUrl}/envelopes/env-1/documents`, `${baseUrl}/envelopes/env-1/documents/doc-1`, expectedEventsUrl,
    ]);
  });

  it.each(["doc-other", "doc-1/events?crossed=1"])("recusa fixture de eventos cruzada na resposta: %s", async (crossedPath) => {
    const events = response({ data: [reconciliationEvent("evt-other-doc", "sign", "signer-1")] }, 200, {
      finalUrl: `https://sandbox.clicksign.com/api/v3/envelopes/env-1/documents/${crossedPath}`,
    });
    const { transport, requests } = transportWith([documentList(), documentDetail(), events]);
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "vault-token" }, transport);
    const error = await provider.reconcileSignatures({ externalId: "env-1", expectedExternalPartyIds: ["signer-1"] }).catch((error: unknown) => error);
    expect(error).toMatchObject({ errorClass: "VALIDATION", reasonCode: "SIGNATURE_EVIDENCE_INVALID", correlationId: expect.any(String) });
    expect(String(error)).not.toMatch(/evt-other-doc|signer-1|https:|vault-token/);
    expect(requests).toHaveLength(3);
    expect(requests[2].url).toBe("https://sandbox.clicksign.com/api/v3/envelopes/env-1/documents/doc-1/events");
  });

  it("detalhe de outro documento impede até mesmo a consulta dos eventos", async () => {
    const { transport, requests } = transportWith(reconciliationResponses([reconciliationEvent("evt-crossed", "sign", "signer-1")], documentDetail({ id: "doc-other" })));
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "vault-token" }, transport);
    await expect(provider.reconcileSignatures({ externalId: "env-1", expectedExternalPartyIds: ["signer-1"] })).rejects.toMatchObject({ reasonCode: "SIGNATURE_EVIDENCE_AMBIGUOUS" });
    expect(requests).toHaveLength(2);
  });

  it("reconcilia exclusivamente evento sign pelo externalPartyId com transporte injetado", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { transport, requests } = transportWith(reconciliationResponses([
      reconciliationEvent("evt-start", "signature_started", "signer-1"),
      reconciliationEvent("evt-add", "add_signer", "signer-1"),
      reconciliationEvent("evt-close", "document_closed", "signer-1"),
      reconciliationEvent("evt-auto", "auto_close", "signer-1"),
      reconciliationEvent("evt-sign", "sign", "signer-1"),
    ]));
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "vault-token" }, transport);
    await expect(provider.reconcileSignatures({ externalId: "env-1", expectedExternalPartyIds: ["signer-1"] })).resolves.toEqual({
      documentStatus: "CLOSED", documentRef: expect.stringMatching(/^[a-f0-9]{64}$/), signedParties: [{ externalPartyId: "signer-1", evidenceRef: expect.stringMatching(/^[a-f0-9]{64}$/) }],
    });
    expect(requests.map((item) => `${item.method} ${new URL(item.url).pathname}`)).toEqual([
      "GET /api/v3/envelopes/env-1/documents",
      "GET /api/v3/envelopes/env-1/documents/doc-1",
      "GET /api/v3/envelopes/env-1/documents/doc-1/events",
    ]);
    expect(requests.every((item) => item.headers.Authorization === "vault-token")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each(["signature_started", "add_signer", "document_closed", "auto_close", "future_event"])(
    "não promove evidência quando existe somente %s",
    async (name) => {
      const { transport } = transportWith(reconciliationResponses([reconciliationEvent(`evt-${name}`, name, "signer-1")]));
      const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "x" }, transport);
      await expect(provider.reconcileSignatures({ externalId: "env-1", expectedExternalPartyIds: ["signer-1"] })).rejects.toMatchObject({
        errorClass: "PROVIDER", reasonCode: "SIGNATURE_EVIDENCE_PENDING", retryAfterMs: 2_000,
      });
    },
  );

  it("falha fechado para signer desconhecido, ausente, duplicado ou ambíguo", async () => {
    for (const testCase of [
      { events: [reconciliationEvent("evt-1", "sign", "other-signer")], expected: ["signer-1"], reason: "SIGNER_MISMATCH" },
      { events: [reconciliationEvent("evt-1", "sign")], expected: ["signer-1"], reason: "SIGNATURE_EVIDENCE_INVALID" },
      { events: [reconciliationEvent("evt-1", "sign", "signer-1"), reconciliationEvent("evt-1", "sign", "signer-1")], expected: ["signer-1"], reason: "SIGNATURE_EVIDENCE_AMBIGUOUS" },
      { events: [reconciliationEvent("evt-1", "sign", "signer-1"), reconciliationEvent("evt-2", "sign", "signer-1")], expected: ["signer-1"], reason: "SIGNATURE_EVIDENCE_AMBIGUOUS" },
      { events: [reconciliationEvent("evt-1", "sign", "signer-1")], expected: ["signer-1", "signer-1"], reason: "SIGNATURE_EVIDENCE_AMBIGUOUS" },
    ]) {
      const { transport } = transportWith(reconciliationResponses(testCase.events));
      const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "x" }, transport);
      await expect(provider.reconcileSignatures({ externalId: "env-1", expectedExternalPartyIds: testCase.expected })).rejects.toMatchObject({ reasonCode: testCase.reason });
    }
  });

  it("exige um sign por parte e documento fechado", async () => {
    const partial = transportWith(reconciliationResponses([reconciliationEvent("evt-1", "sign", "signer-1")]));
    const partialProvider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "x" }, partial.transport);
    await expect(partialProvider.reconcileSignatures({ externalId: "env-1", expectedExternalPartyIds: ["signer-1", "signer-2"] })).rejects.toMatchObject({ reasonCode: "SIGNATURE_EVIDENCE_PENDING" });

    const complete = transportWith(reconciliationResponses([reconciliationEvent("evt-1", "sign", "signer-1"), reconciliationEvent("evt-2", "sign", "signer-2")]));
    const completeProvider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "x" }, complete.transport);
    await expect(completeProvider.reconcileSignatures({ externalId: "env-1", expectedExternalPartyIds: ["signer-1", "signer-2"] })).resolves.toMatchObject({ signedParties: [{ externalPartyId: "signer-1" }, { externalPartyId: "signer-2" }] });

    const open = transportWith(reconciliationResponses([], documentDetail({ status: "running" })));
    const openProvider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "x" }, open.transport);
    await expect(openProvider.reconcileSignatures({ externalId: "env-1", expectedExternalPartyIds: ["signer-1"] })).rejects.toMatchObject({ reasonCode: "DOCUMENT_NOT_CLOSED" });
  });

  it("não expõe payload, signer externo ou token em erro e logs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { transport } = transportWith(reconciliationResponses([reconciliationEvent("evt-sensitive", "sign", "signer-sensitive") ]));
    const provider = new ClicksignSignatureProvider({ baseUrl: "https://sandbox.clicksign.com/api/v3", accessToken: "token-sensitive" }, transport);
    const caught = await provider.reconcileSignatures({ externalId: "env-sensitive", expectedExternalPartyIds: ["signer-expected"] }).catch((error) => error);
    expect(caught).toBeInstanceOf(ClicksignProviderError);
    expect(caught.message).not.toMatch(/sensitive|token|signer/i);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore(); logSpy.mockRestore();
  });

  it("interpreta Retry-After HTTP-date e restringe endpoints", () => {
    expect(clicksignInternals.parseRetryAfter(new Date(Date.now() + 10_000).toUTCString())).toBeGreaterThan(0);
    expect(() => clicksignInternals.safeBaseUrl("https://sandbox.clicksign.com/api/v1")).toThrow();
  });

  it("interpreta o formato real observado sem depender de downloads no envelope nem tratar ZIP como certificado", async () => {
    const signedPdf = bytes("%PDF-documento-assinado");
    const { outcome, requests } = await finalEvidenceWith(pdfResponse(signedPdf));
    await expect(outcome).resolves.toEqual({ document: { fileName: "documento-assinado.pdf", mimeType: "application/pdf", bytes: signedPdf } });
    expect(requests.map((item) => `${item.method} ${new URL(item.url).pathname}`)).toEqual([
      "GET /api/v3/envelopes/env-1/documents",
      "GET /api/v3/envelopes/env-1/documents/doc-1",
      "GET /signed/document.pdf",
    ]);
    expect(requests.some((item) => item.url.includes("zip"))).toBe(false);
    expect(requests.some((item) => item.url.includes("certificate"))).toBe(false);
  });

  it.each([
    ["lista ausente", response({})],
    ["lista nula", response({ data: null })],
    ["lista não-array", response({ data: { id: "doc-1" } })],
    ["lista vazia", documentList([])],
    ["múltiplos documentos", documentList([{ id: "doc-1" }, { id: "doc-2" }])],
    ["documento sem id", documentList([{}])],
  ])("rejeita estrutura permanente: %s", async (_label, malformed) => {
    const { outcome, requests } = await finalEvidenceWith(pdfResponse(bytes("%PDF-ok")), [malformed]);
    const caught = await outcome.catch((error) => error);
    expect(caught).toBeInstanceOf(ClicksignProviderError);
    expect(caught).toMatchObject({ errorClass: "VALIDATION", reasonCode: "STRUCTURE_INVALID" });
    expect(caught.correlationId).toBeTruthy();
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["detalhe ausente", response({})],
    ["detalhe nulo", response({ data: null })],
    ["detalhe array", response({ data: [] })],
    ["id divergente", documentDetail({ id: "doc-outro" })],
  ])("rejeita documento incompatível: %s", async (_label, malformedDetail) => {
    const { outcome, requests } = await finalEvidenceWith(pdfResponse(bytes("%PDF-ok")), [documentList(), malformedDetail]);
    await expect(outcome).rejects.toMatchObject({ errorClass: "VALIDATION", reasonCode: "STRUCTURE_INVALID" });
    expect(requests).toHaveLength(2);
  });

  it("exige documento closed antes de baixar", async () => {
    const { outcome, requests } = await finalEvidenceWith(pdfResponse(bytes("%PDF-ok")), [documentList(), documentDetail({ status: "running" })]);
    await expect(outcome).rejects.toMatchObject({ errorClass: "CONFLICT", reasonCode: "DOCUMENT_NOT_CLOSED" });
    expect(requests).toHaveLength(2);
  });

  it.each([undefined, null, ""])("trata link signed temporariamente ausente como retry limitado (%s)", async (signed) => {
    const detail = signed === undefined
      ? response({ data: { id: "doc-1", attributes: { status: "closed" }, links: { files: {} } } })
      : documentDetail({ signed });
    const { outcome, requests } = await finalEvidenceWith(pdfResponse(bytes("%PDF-ok")), [documentList(), detail]);
    await expect(outcome).rejects.toMatchObject({ errorClass: "PROVIDER", reasonCode: "SIGNED_LINK_PENDING", retryAfterMs: clicksignInternals.SIGNED_LINK_RETRY_AFTER_MS });
    expect(requests).toHaveLength(2);
  });

  it("rejeita signed com tipo incompatível como erro permanente", async () => {
    const { outcome, requests } = await finalEvidenceWith(pdfResponse(bytes("%PDF-ok")), [documentList(), documentDetail({ signed: [] })]);
    await expect(outcome).rejects.toMatchObject({ errorClass: "VALIDATION", reasonCode: "STRUCTURE_INVALID" });
    expect(requests).toHaveLength(2);
  });

  it("permite somente o host Sandbox exato e mantém produção fail-closed", () => {
    const correlationId = "correlation-safe";
    expect(clicksignInternals.safePresignedEvidenceUrl(PRESIGNED_URL, "https://sandbox.clicksign.com/api/v3", correlationId).hostname).toBe(clicksignInternals.SANDBOX_CONTENT_HOST);
    for (const forbidden of [
      "https://evil.clicksign-sandbox-content.s3.amazonaws.com/file.pdf?X-Amz-Signature=x",
      "https://bucket.s3.amazonaws.com/file.pdf?X-Amz-Signature=x",
      "https://clicksign-sandbox-content.s3.amazonaws.com.evil.test/file.pdf?X-Amz-Signature=x",
      "https://user:password@clicksign-sandbox-content.s3.amazonaws.com/file.pdf?X-Amz-Signature=x",
      "https://clicksign-sandbox-content.s3.amazonaws.com:444/file.pdf?X-Amz-Signature=x",
    ]) expect(() => clicksignInternals.safePresignedEvidenceUrl(forbidden, "https://sandbox.clicksign.com/api/v3", correlationId)).toThrow(ClicksignProviderError);
    expect(() => clicksignInternals.safePresignedEvidenceUrl(PRESIGNED_URL, "https://app.clicksign.com/api/v3", correlationId)).toThrow(ClicksignProviderError);
  });

  it("não envia credencial nem headers JSON:API ao host de conteúdo", async () => {
    const { outcome, requests } = await finalEvidenceWith(pdfResponse(bytes("%PDF-ok")));
    await outcome;
    expect(requests[0]?.headers.Authorization).toBe("vault-token");
    expect(requests[1]?.headers.Authorization).toBe("vault-token");
    expect(requests[2]?.headers).toEqual({ Accept: "application/pdf" });
    expect(requests[2]?.headers.Authorization).toBeUndefined();
    expect(requests[2]?.headers["Content-Type"]).toBeUndefined();
  });

  it("recusa redirecionamento no download pré-assinado", async () => {
    const redirected = pdfResponse(bytes("%PDF-ok"));
    redirected.finalUrl = "https://clicksign-sandbox-content.s3.amazonaws.com/other.pdf?X-Amz-Signature=segredo";
    const { outcome } = await finalEvidenceWith(redirected);
    await expect(outcome).rejects.toMatchObject({ errorClass: "VALIDATION", reasonCode: "CONTENT_REDIRECTED" });
  });

  it("classifica download indisponível sem expor URL", async () => {
    const unavailable = pdfResponse(bytes("indisponível"));
    unavailable.status = 503;
    const { outcome } = await finalEvidenceWith(unavailable);
    const caught = await outcome.catch((error) => error);
    expect(caught).toMatchObject({ errorClass: "PROVIDER", reasonCode: "DOWNLOAD_UNAVAILABLE" });
    expect(caught.message).not.toContain("amazonaws");
    expect(caught.message).not.toContain("X-Amz");
    expect(caught.correlationId).toBeTruthy();
  });

  it.each([
    ["HTML declarado como PDF", bytes("<html>segredo</html>"), "application/pdf"],
    ["JSON declarado como PDF", bytes('{"token":"segredo"}'), "application/pdf"],
    ["corpo vazio", new Uint8Array(), "application/pdf"],
    ["corpo menor que cinco bytes", bytes("%PDF"), "application/pdf"],
    ["magic bytes alterados", bytes("%PDX-1.7"), "application/pdf"],
    ["Content-Type não permitido", bytes("%PDF-1.7"), "text/plain"],
  ])("rejeita evidência inválida: %s", async (_label, body, contentType) => {
    const { outcome, requests } = await finalEvidenceWith(pdfResponse(body, contentType));
    const caught = await outcome.catch((error) => error);
    expect(caught).toMatchObject({ errorClass: "VALIDATION", reasonCode: "PDF_INVALID" });
    expect(caught.message).not.toContain("segredo");
    expect(requests).toHaveLength(3);
  });

  it("retorna apenas o PDF assinado válido, sem duplicá-lo como certificado", async () => {
    const document = bytes("%PDF-document");
    const { outcome } = await finalEvidenceWith(pdfResponse(document));
    const evidence = await outcome;
    expect(evidence).toEqual({ document: { fileName: "documento-assinado.pdf", mimeType: "application/pdf", bytes: document } });
    expect(evidence).not.toHaveProperty("certificate");
    expect(evidence).not.toHaveProperty("auxiliary");
  });

  it("aceita exatamente o limite e rejeita um byte acima sem expor o corpo", async () => {
    const exact = new Uint8Array(clicksignInternals.MAX_EVIDENCE_BYTES);
    exact.set(bytes("%PDF-"));
    const valid = await finalEvidenceWith(pdfResponse(exact));
    const accepted = await valid.outcome;
    expect(accepted.document.bytes.byteLength).toBe(clicksignInternals.MAX_EVIDENCE_BYTES);
    expect(new TextDecoder().decode(accepted.document.bytes.slice(0, 5))).toBe("%PDF-");

    const oversized = new Uint8Array(clicksignInternals.MAX_EVIDENCE_BYTES + 1);
    oversized.set(bytes("%PDF-"));
    const invalid = await finalEvidenceWith(pdfResponse(oversized));
    await expect(invalid.outcome).rejects.toMatchObject({ errorClass: "VALIDATION" });
  });

  it("classifica evidência inválida deterministicamente como permanente, sem retorno ou armazenamento parcial", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { outcome, requests } = await finalEvidenceWith(pdfResponse(bytes("invalid")));
      await expect(outcome).rejects.toMatchObject({ errorClass: "VALIDATION", reasonCode: "PDF_INVALID" });
      expect(requests).toHaveLength(3);
    }
  });

  it("nunca registra a URL pré-assinada e sempre retorna erro classificado com correlation ID", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const malicious = "https://clicksign-sandbox-content.s3.amazonaws.com.evil.test/file.pdf?X-Amz-Signature=nao-vazar";
    const { outcome } = await finalEvidenceWith(pdfResponse(bytes("%PDF-ok")), [documentList(), documentDetail({ signed: malicious })]);
    const caught = await outcome.catch((error) => error);
    expect(caught).toBeInstanceOf(ClicksignProviderError);
    expect(caught).toMatchObject({ errorClass: "VALIDATION", reasonCode: "CONTENT_HOST_FORBIDDEN" });
    expect(caught.correlationId).toBeTruthy();
    expect(caught.message).not.toContain(malicious);
    expect(caught.message).not.toContain("nao-vazar");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore(); warnSpy.mockRestore(); logSpy.mockRestore();
  });

  it("executa a recuperação diretamente com transporte injetado, sem rede real", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { outcome } = await finalEvidenceWith(pdfResponse(bytes("%PDF-ok")));
    await expect(outcome).resolves.toMatchObject({ document: { mimeType: "application/pdf" } });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("recompõe resposta PDF fragmentada em múltiplos chunks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes("%P"));
        controller.enqueue(bytes("DF-1.7"));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "application/pdf" } }));
    const result = await fetchClicksignTransport.request({ method: "GET", url: "https://sandbox.clicksign.com/api/v3/download", headers: {}, timeoutMs: 1000, maxResponseBytes: 100 });
    expect(new TextDecoder().decode(result.body)).toBe("%PDF-1.7");
    fetchSpy.mockRestore();
  });
});
