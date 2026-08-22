import { describe, expect, it } from "vitest";
import { calculateHealthScore, MockGoogleDriveConnector, resolveByCanonicalIdentifier, resolveConflict, scoreIdentityCandidates, assertSafeExternalUrl } from ".";

describe("política de conflito determinística", () => {
  it("nunca sobrescreve silenciosamente sem sinal suficiente", () => {
    expect(resolveConflict("EXTERNAL_WINS", { localValue: "A", externalValue: "B" })).toBe("APPLY_EXTERNAL");
    expect(resolveConflict("REDE_WINS", { localValue: "A", externalValue: "B" })).toBe("KEEP_LOCAL");
    expect(resolveConflict("MANUAL_REVIEW", { localValue: "A", externalValue: "B" })).toBe("NEEDS_REVIEW");
    expect(resolveConflict("FIELD_OWNER_WINS", { localValue: "A", externalValue: "B" })).toBe("NEEDS_REVIEW");
    expect(resolveConflict("MERGE_BY_RULE", { localValue: "A", externalValue: "B" })).toBe("NEEDS_REVIEW");
  });

  it("identifica ausência real de conflito quando os valores já coincidem", () => {
    expect(resolveConflict("EXTERNAL_WINS", { localValue: "A", externalValue: "A" })).toBe("NO_CONFLICT");
  });

  it("NEWEST_WINS exige relógio confiável dos dois lados, senão exige revisão", () => {
    expect(resolveConflict("NEWEST_WINS", { localValue: 1, externalValue: 2, localUpdatedAt: new Date("2026-01-01"), externalUpdatedAt: new Date("2026-01-02") })).toBe("APPLY_EXTERNAL");
    expect(resolveConflict("NEWEST_WINS", { localValue: 1, externalValue: 2, localUpdatedAt: new Date("2026-01-02"), externalUpdatedAt: new Date("2026-01-01") })).toBe("KEEP_LOCAL");
    expect(resolveConflict("NEWEST_WINS", { localValue: 1, externalValue: 2 })).toBe("NEEDS_REVIEW");
  });
});

describe("resolução de identidade externa", () => {
  it("vincula por identificador canônico (CNPJ) ignorando máscara, nunca cria duplicata por si só", () => {
    const suppliers = [{ id: "sup-1", taxId: "12.345.678/0001-90" }, { id: "sup-2", taxId: "99.999.999/0001-99" }];
    const found = resolveByCanonicalIdentifier(suppliers, (item) => item.taxId, "12345678000190");
    expect(found?.id).toBe("sup-1");
    expect(resolveByCanonicalIdentifier(suppliers, (item) => item.taxId, "00000000000000")).toBeNull();
    expect(resolveByCanonicalIdentifier(suppliers, (item) => item.taxId, null)).toBeNull();
  });

  it("gera score explicável e ordenado por candidato composto", () => {
    const scores = scoreIdentityCandidates(
      { name: "Fundações Alfa", city: "São Paulo" },
      [{ entityId: "a", fields: { name: "Fundações Alfa", city: "São Paulo" } }, { entityId: "b", fields: { name: "Fundações Alfa", city: "Curitiba" } }],
      [{ field: "name", weight: 2 }, { field: "city", weight: 1 }],
    );
    expect(scores[0]).toMatchObject({ entityId: "a", score: 1 });
    expect(scores[1].score).toBeCloseTo(2 / 3, 5);
  });
});

describe("health score decomposto", () => {
  it("nunca produz saúde perfeita sem dados — ausência reduz confiança", () => {
    const result = calculateHealthScore({});
    expect(result.score).toBe(0);
    expect(result.confidence).toBe("LOW");
  });

  it("combina disponibilidade, sucesso, latência, freshness e backlog com pesos declarados", () => {
    const result = calculateHealthScore({ availability: 1, successRate: 1, avgLatencyMs: 0, freshnessSeconds: 0, backlogCount: 0 });
    expect(result.score).toBe(1);
    expect(result.confidence).toBe("HIGH");
    expect(result.components).toEqual({ availability: 1, successRate: 1, latencyScore: 1, freshnessScore: 1, backlogScore: 1 });
  });
});

describe("MockGoogleDriveConnector — adapter determinístico sem I/O real", () => {
  const files = [
    { externalId: "file-1", versionId: "v1", name: "Memorial descritivo.pdf", mimeType: "application/pdf", size: 1024, webUrl: "https://drive.example/file-1", checksum: "chk-1", modifiedAt: new Date("2026-08-01") },
    { externalId: "file-2", versionId: "v1", name: "Planta baixa.dwg", mimeType: "application/dwg", size: 2048, webUrl: "https://drive.example/file-2", checksum: "chk-2", modifiedAt: new Date("2026-08-02") },
  ];

  it("pagina de forma determinística e devolve cursor opaco", async () => {
    const connector = new MockGoogleDriveConnector(files);
    const page1 = await connector.pull({ capability: "DOCUMENTS", pageSize: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.hasMore).toBe(true);
    const page2 = await connector.pull({ capability: "DOCUMENTS", pageSize: 1, cursor: page1.cursor });
    expect(page2.items[0].externalId).toBe("file-2");
    expect(page2.hasMore).toBe(false);
  });

  it("normaliza evento de webhook para o mesmo formato de pull, sem inventar arquivo inexistente", async () => {
    const connector = new MockGoogleDriveConnector(files);
    const events = await connector.handleWebhook({ provider: "GOOGLE_DRIVE", eventId: "evt-1", eventType: "file.updated", payload: { fileId: "file-1" }, receivedAt: new Date() });
    expect(events).toHaveLength(1);
    expect(events[0].externalId).toBe("file-1");
    const missing = await connector.handleWebhook({ provider: "GOOGLE_DRIVE", eventId: "evt-2", eventType: "file.updated", payload: { fileId: "does-not-exist" }, receivedAt: new Date() });
    expect(missing).toHaveLength(0);
  });
});

describe("proteção contra SSRF em URLs externas configuráveis", () => {
  it("bloqueia loopback, rede privada e metadata de nuvem", () => {
    expect(() => assertSafeExternalUrl("http://127.0.0.1/webhook")).toThrow();
    expect(() => assertSafeExternalUrl("http://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => assertSafeExternalUrl("http://10.0.0.5/hook")).toThrow();
    expect(() => assertSafeExternalUrl("http://192.168.1.5/hook")).toThrow();
    expect(() => assertSafeExternalUrl("http://metadata.google.internal/")).toThrow();
    expect(() => assertSafeExternalUrl("ftp://example.com/x")).toThrow();
  });

  it("permite hosts públicos https válidos", () => {
    expect(() => assertSafeExternalUrl("https://api.example.com/webhooks/rede")).not.toThrow();
  });
});
