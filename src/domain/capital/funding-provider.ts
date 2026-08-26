/**
 * Fase 9N §10 — Funding Gateway (seam arquitetural).
 * Mesmo espírito de `CreditBureauProvider`/`SignatureProvider`: o domínio nunca decide nada a
 * partir da resposta do financiador — só alimenta o registro determinístico da proposta
 * (`FundingProposal`, quando a migration for aprovada), que segue o mesmo fluxo humano de
 * aprovação de qualquer outra proposta cadastrada manualmente. NÃO integrar banco real agora —
 * nenhuma implementação concreta desta interface existe ainda (nem mock: só se um consumidor
 * real precisar provar o seam, ver plano §10). Os quatro modos de submissão cobrem os canais
 * citados no plano: API própria do financiador, arquivo estruturado (ex.: CNAB/planilha), portal
 * (upload manual) e dossiê estruturado (ver `capital-dossier.ts`).
 */

export type FundingSubmissionChannel = "API" | "FILE" | "PORTAL" | "STRUCTURED_DOSSIER";

export interface FundingDossierPayload {
  projectId: string;
  organizationId: string;
  /** Estrutura de saída de `assembleFundingDossier` (`capital-dossier.ts`) — nunca duplica documentos já existentes, só referencia. */
  dossier: Record<string, unknown>;
}

export interface FundingSubmissionRequest {
  channel: FundingSubmissionChannel;
  providerCode: string;
  payload: FundingDossierPayload;
}

export interface FundingSubmissionResult {
  externalReference: string;
  submittedAt: string;
  channel: FundingSubmissionChannel;
}

export type FundingProposalStatusCheck =
  | { status: "PENDING" }
  | { status: "UPDATED"; proposalChanges: Record<string, unknown> }
  | { status: "DISBURSEMENT_CONFIRMED"; amount: string; occurredAt: string };

/**
 * Porta que um futuro adapter concreto (`infrastructure/adapters/funding/*`) implementará por
 * financiador/canal. Nenhum caso de uso do domínio/aplicação chama isto diretamente hoje —
 * existe só para o seam já nascer no lugar certo quando a integração real for autorizada.
 */
export interface FundingProviderAdapter {
  readonly providerCode: string;
  readonly supportedChannels: FundingSubmissionChannel[];
  submitDossier(request: FundingSubmissionRequest): Promise<FundingSubmissionResult>;
  checkStatus(externalReference: string): Promise<FundingProposalStatusCheck>;
}
