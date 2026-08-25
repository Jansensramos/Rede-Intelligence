/**
 * Abstração `SignatureProvider` (Fase 9K.4, plano §4) — mesmo espírito do `IntegrationConnector`
 * (9H, `src/domain/integrations/connector-contract.ts`): o domínio comercial fala só com esta
 * interface, nunca com um provider concreto. Nenhum campo/tipo aqui menciona Clicksign.
 */

export type SignatureProviderCode = "MOCK" | "CLICKSIGN" | "MANUAL_UPLOAD";

export interface SignaturePartyInput {
  displayName: string;
  email?: string | null;
  role: string;
  order: number;
}

export interface SignatureSendRequest {
  organizationId: string;
  requestId: string;
  document: { fileName: string; mimeType: string; checksum: string; bytes: Uint8Array };
  parties: SignaturePartyInput[];
}

export interface SignatureSendResult {
  /** Referência opaca no provider — nunca interpretada pelo domínio além de guardar/repassar. */
  externalId: string;
}

export interface SignatureCancelRequest {
  externalId: string;
  reason: string;
}

/**
 * Contrato comum de provider de assinatura. `send` inicia o envio; providers assíncronos reais
 * (Clicksign) confirmam o restante do ciclo via webhook → `IntegrationInboxEvent` (9H) →
 * `SignatureEvent` (ver `application/sales/signature-service.ts`) — nunca chamando de volta esta
 * interface. `cancel` é opcional (MOCK/MANUAL_UPLOAD podem não precisar de round-trip externo).
 */
export interface SignatureProvider {
  readonly code: SignatureProviderCode;
  send(input: SignatureSendRequest): Promise<SignatureSendResult>;
  cancel?(input: SignatureCancelRequest): Promise<void>;
}
