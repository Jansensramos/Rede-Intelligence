import type {
  ConnectorCapabilityDescriptor,
  ConnectorDescriptor,
  IntegrationConnector,
  NormalizedExternalEvent,
  ProviderHealth,
  PullPage,
  PullRequest,
  TestConnectionResult,
  ValidationResult,
  VerifiedWebhookEvent,
} from "./connector-contract";

export interface MockDriveFile {
  externalId: string;
  versionId: string;
  name: string;
  mimeType: string;
  size: number;
  webUrl: string;
  checksum: string;
  modifiedAt: Date;
}

/**
 * Adapter mock do Google Drive (Fase 9H §18/§23). Determinístico e sem I/O real —
 * prova a arquitetura de referência-antes-de-cópia sem exigir credenciais.
 * Segue o mesmo princípio do BankingAdapter: normaliza e nunca persiste diretamente.
 */
export class MockGoogleDriveConnector implements IntegrationConnector {
  readonly descriptor: ConnectorDescriptor = {
    code: "GOOGLE_DRIVE_MOCK",
    name: "Google Drive (mock)",
    provider: "GOOGLE_DRIVE",
    adapterVersion: "1.0.0",
    contractVersion: "1.0.0",
  };

  constructor(private readonly files: MockDriveFile[]) {}

  capabilities(): ConnectorCapabilityDescriptor[] {
    return [{ code: "DOCUMENTS", direction: "INBOUND", description: "Lista, referencia e detecta novas versões de arquivos do Drive." }];
  }

  async validateConfiguration(): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { available: true, latencyMs: 5 };
  }

  async testConnection(): Promise<TestConnectionResult> {
    return { success: true, message: "Conexão simulada com o Google Drive (mock) bem-sucedida." };
  }

  async pull(request: PullRequest): Promise<PullPage> {
    const pageSize = request.pageSize ?? 50;
    const sorted = [...this.files].sort((a, b) => a.externalId.localeCompare(b.externalId));
    const startIndex = request.cursor ? sorted.findIndex((file) => file.externalId === request.cursor) + 1 : 0;
    const page = sorted.slice(startIndex, startIndex + pageSize);
    return {
      items: page.map((file) => ({
        externalType: "DRIVE_FILE",
        externalId: file.externalId,
        externalVersion: file.versionId,
        occurredAt: file.modifiedAt,
        checksum: file.checksum,
        data: { name: file.name, mimeType: file.mimeType, size: file.size, webUrl: file.webUrl },
      })),
      cursor: page.length > 0 ? page[page.length - 1].externalId : (request.cursor ?? null),
      hasMore: startIndex + pageSize < sorted.length,
    };
  }

  async handleWebhook(event: VerifiedWebhookEvent): Promise<NormalizedExternalEvent[]> {
    const fileId = typeof event.payload.fileId === "string" ? event.payload.fileId : undefined;
    const file = this.files.find((item) => item.externalId === fileId);
    if (!file) return [];
    return [{
      externalType: "DRIVE_FILE",
      externalId: file.externalId,
      externalVersion: file.versionId,
      occurredAt: file.modifiedAt,
      data: { name: file.name, mimeType: file.mimeType, size: file.size, webUrl: file.webUrl },
    }];
  }
}
