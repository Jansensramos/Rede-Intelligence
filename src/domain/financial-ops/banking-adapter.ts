// Contrato abstrato para futura integração bancária real (Open Finance, API nativa,
// CNAB, webhook). Nenhuma implementação aqui conhece um banco específico — apenas o
// formato de dados que qualquer provedor futuro deve produzir para alimentar
// BankTransaction/BankAccount de forma idempotente. Ver ManualBankingAdapter em
// src/application/financial-ops/manual-banking-adapter.ts para a única implementação
// real desta fase (sem conexão externa).

export interface BankingAdapterAccountSnapshot {
  externalAccountId: string;
  balance: number;
  asOf: Date;
}

export interface BankingAdapterTransaction {
  externalId: string;
  occurredAt: Date;
  amount: number;
  direction: "DEBIT" | "CREDIT";
  description: string;
  counterparty?: string;
  documentRef?: string;
}

export interface BankingAdapterSyncResult {
  transactions: BankingAdapterTransaction[];
  /** Cursor opaco do provedor para a próxima sincronização incremental, quando suportado. */
  cursor?: string;
}

export interface BankingAdapterAccountIdentity {
  externalAccountId: string;
  agency?: string;
  accountNumber?: string;
}

export interface BankingWebhookEvent {
  provider: string;
  eventType: string;
  externalAccountId?: string;
  payload: unknown;
  receivedAt: Date;
}

/**
 * Contrato que qualquer integração bancária futura (Open Finance, API nativa de banco,
 * CNAB, agregador) deve implementar. Escolher o provedor é decisão de uma fase futura;
 * esta fase apenas garante que o domínio financeiro já sabe como consumir um provedor
 * assim que ele existir, sem redesenho de PayableAccount/ReceivableAccount/BankTransaction.
 */
export interface BankingAdapter {
  readonly provider: string;

  /** Consulta o saldo atual reportado pelo provedor para a conta bancária informada. */
  getAccountBalance(externalAccountId: string): Promise<BankingAdapterAccountSnapshot>;

  /**
   * Importa/sincroniza transações desde `since` (ou a partir do `cursor` de uma
   * sincronização anterior). A implementação NÃO deve persistir diretamente — o
   * chamador deve alimentar `importBankTransactions`, que garante idempotência via
   * checksum independentemente da origem dos dados.
   */
  syncTransactions(externalAccountId: string, since?: Date, cursor?: string): Promise<BankingAdapterSyncResult>;

  /** Resolve identidade de conta (agência/número) a partir do identificador do provedor. */
  identifyAccount(externalAccountId: string): Promise<BankingAdapterAccountIdentity | null>;

  /**
   * Traduz um evento de webhook do provedor em transações estruturadas prontas para
   * `importBankTransactions`. Opcional: nem todo provedor oferece webhooks.
   */
  handleWebhookEvent?(event: BankingWebhookEvent): Promise<BankingAdapterTransaction[]>;
}
