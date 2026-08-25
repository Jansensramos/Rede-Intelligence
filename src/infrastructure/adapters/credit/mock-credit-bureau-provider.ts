import { createHash, randomUUID } from "node:crypto";
import { classifyCreditResult } from "@/domain/sales/contract-closing";
import type { CreditBureauConsultRequest, CreditBureauConsultResult, CreditBureauProvider } from "@/domain/sales/credit-bureau-provider";

/**
 * Primeiro adapter funcional de `CreditBureauProvider` (plano §5) — nenhuma chamada Serasa real.
 * `score`/apontamentos são determinísticos por CPF (mesmo CPF → mesmo resultado, útil para
 * QA/teste reprodutível); `externalReference` é único por chamada (cada consulta é um novo
 * protocolo, como num bureau real). Nunca persiste o CPF em claro — só devolve o resultado, quem
 * grava é `credit-service.ts`.
 */
export class MockCreditBureauProvider implements CreditBureauProvider {
  readonly code = "MOCK" as const;

  async consult(input: CreditBureauConsultRequest): Promise<CreditBureauConsultResult> {
    const digest = createHash("sha256").update(input.taxId).digest();
    const score = 300 + (digest.readUInt16BE(0) % 651); // 300..950
    const findingsCount = digest[2] % 3; // 0..2
    const result = classifyCreditResult({ score, findingsCount });
    return {
      externalReference: `mock_bureau_${randomUUID()}`,
      score,
      findingsSummary: findingsCount > 0 ? { apontamentos: findingsCount, categorias: ["protesto"] } : null,
      result,
    };
  }
}

export const mockCreditBureauProvider = new MockCreditBureauProvider();
