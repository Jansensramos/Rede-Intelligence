import { randomUUID } from "node:crypto";
import type { SignatureProvider, SignatureSendRequest, SignatureSendResult } from "@/domain/sales/signature-provider";

/**
 * Primeiro adapter funcional de `SignatureProvider` (plano §4) — nenhuma chamada externa real.
 * `send` resolve de forma síncrona/imediata (não há transporte de rede); o serviço de aplicação
 * (`signature-service.ts`) é quem decide os próximos estados (AGUARDANDO_ASSINATURAS → ASSINADO)
 * a partir de ações registradas localmente (`recordPartySigned`/`recordPartyDeclined`).
 */
export class MockSignatureProvider implements SignatureProvider {
  readonly code = "MOCK" as const;

  async send(input: SignatureSendRequest): Promise<SignatureSendResult> {
    void input;
    return { externalId: `mock_sig_${randomUUID()}` };
  }

  async cancel(): Promise<void> {
    // MOCK não mantém estado do lado do "provider" — cancelamento é só local (`SignatureRequest.status`).
  }
}

export const mockSignatureProvider = new MockSignatureProvider();
