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
  parties?: { order: number; externalPartyId: string }[];
}

export interface SignatureCancelRequest {
  externalId: string;
  reason: string;
}

export type ExternalSignatureStatus = "DRAFT" | "RUNNING" | "CLOSED" | "CANCELLED" | "UNKNOWN";

export type SignatureAuxiliaryEvidenceKind = "PROVIDER_BUNDLE" | "AUDIT_TRAIL" | "OTHER";

export interface SignatureFinalEvidence {
  /** PDF assinado final, obrigatório para concluir a solicitação. */
  document: { fileName: string; mimeType: string; bytes: Uint8Array };
  /** Artefato provider-neutral opcional. Nunca deve duplicar o PDF final. */
  auxiliary?: { kind: SignatureAuxiliaryEvidenceKind; fileName: string; mimeType: string; bytes: Uint8Array };
}

export interface SignatureReconciliationRequest {
  /** Envelope opaco já vinculado à solicitação e à instalação pelo REDE. */
  externalId: string;
  /** IDs opacos persistidos no envio. Nome, e-mail e posição nunca participam da correlação. */
  expectedExternalPartyIds: string[];
}

export interface ReconciledSignatureParty {
  externalPartyId: string;
  /** Referência opaca do evento usada somente para auditoria segura, nunca como identidade da parte. */
  evidenceRef: string;
}

export interface SignatureReconciliationResult {
  documentStatus: "CLOSED";
  /** SHA-256 of the document identifier validated by the authenticated scoped endpoint. */
  documentRef: string;
  signedParties: ReconciledSignatureParty[];
}

export type SignatureReconciliationFailureReason =
  | "LOCAL_STATE_INELIGIBLE"
  | "LOCAL_PARTY_ID_INVALID"
  | "SOURCE_INBOX_INVALID"
  | "PROVIDER_RECONCILIATION_UNAVAILABLE"
  | "SIGNATURE_EVIDENCE_PENDING"
  | "SIGNATURE_EVIDENCE_INVALID"
  | "SIGNATURE_EVIDENCE_AMBIGUOUS"
  | "SIGNER_MISMATCH"
  | "DOCUMENT_NOT_CLOSED";

export class SignatureReconciliationError extends Error {
  readonly name = "SignatureReconciliationError";
  constructor(
    readonly errorClass: "CONFLICT" | "VALIDATION" | "PROVIDER",
    readonly correlationId: string,
    readonly reasonCode: SignatureReconciliationFailureReason,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`Não foi possível reconciliar as assinaturas externas. Código de correlação: ${correlationId}.`);
  }
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
  status?(externalId: string): Promise<ExternalSignatureStatus>;
  notify?(externalId: string, message?: string | null): Promise<void>;
  reconcileSignatures?(input: SignatureReconciliationRequest): Promise<SignatureReconciliationResult>;
  finalEvidence?(externalId: string): Promise<SignatureFinalEvidence>;
}
