/**
 * Abstração `CreditBureauProvider` (Fase 9K.4, plano §5) — mesmo espírito do `SignatureProvider`
 * (ver `signature-provider.ts`). O domínio nunca decide venda a partir do resultado — só alimenta
 * `CreditBureauConsultation.result`, consumido pela política/alçada já existente (9C).
 */
import type { CreditConsultationResultLike } from "./contract-closing";

export type CreditBureauProviderCode = "MOCK" | "SERASA_EXPERIAN";

export interface CreditBureauConsultRequest {
  organizationId: string;
  customerId: string;
  /** CPF/CNPJ em claro — só existe na memória da chamada, nunca persistido pelo chamador (ver `credit-service.ts`, que só grava `cpfMasked`). */
  taxId: string;
}

export interface CreditBureauConsultResult {
  externalReference: string;
  score: number | null;
  /** Resumo mínimo (contagens/categorias) — nunca o relatório bruto (plano §5, LGPD). */
  findingsSummary: Record<string, unknown> | null;
  result: CreditConsultationResultLike;
}

export interface CreditBureauProvider {
  readonly code: CreditBureauProviderCode;
  consult(input: CreditBureauConsultRequest): Promise<CreditBureauConsultResult>;
}
