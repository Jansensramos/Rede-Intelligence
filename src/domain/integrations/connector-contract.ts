export type ConnectorDirection = "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";

export interface ConnectorCapabilityDescriptor {
  code: string;
  direction: ConnectorDirection;
  description: string;
}

export interface ConnectorDescriptor {
  code: string;
  name: string;
  provider: string;
  adapterVersion: string;
  contractVersion: string;
}

export interface PullRequest {
  capability: string;
  cursor?: string | null;
  since?: Date | null;
  pageSize?: number;
}

export interface PullItem {
  externalType: string;
  externalId: string;
  externalVersion?: string;
  data: Record<string, unknown>;
  occurredAt: Date;
  checksum?: string;
}

export interface PullPage {
  items: PullItem[];
  cursor: string | null;
  hasMore: boolean;
}

export interface PushRequest {
  capability: string;
  items: Array<{ externalId?: string; data: Record<string, unknown> }>;
}

export interface PushResult {
  applied: number;
  errors: Array<{ externalId?: string; message: string }>;
}

export interface VerifiedWebhookEvent {
  provider: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
}

export interface NormalizedExternalEvent {
  externalType: string;
  externalId: string;
  externalVersion?: string;
  data: Record<string, unknown>;
  occurredAt: Date;
}

export interface ProviderHealth {
  available: boolean;
  latencyMs?: number;
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

/**
 * Contrato comum de connector. O adapter normaliza dados de/para o provedor externo e
 * NUNCA persiste diretamente no domínio — quem aplica é o serviço dono do domínio
 * (ver `BankingAdapter` em src/domain/financial-ops, que segue o mesmo princípio).
 */
export interface IntegrationConnector {
  readonly descriptor: ConnectorDescriptor;
  capabilities(): ConnectorCapabilityDescriptor[];
  validateConfiguration(configuration: Record<string, unknown>): Promise<ValidationResult>;
  healthCheck(): Promise<ProviderHealth>;
  testConnection(): Promise<TestConnectionResult>;
  pull(request: PullRequest): Promise<PullPage>;
  push?(request: PushRequest): Promise<PushResult>;
  handleWebhook?(event: VerifiedWebhookEvent): Promise<NormalizedExternalEvent[]>;
}
