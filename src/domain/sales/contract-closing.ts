/**
 * Funções puras do Fechamento Comercial 360 (Fase 9K.4, plano §1-§5): modelo contratual →
 * documento → assinatura → crédito. Mesmo princípio dos demais arquivos `engine.ts` deste
 * diretório — sem I/O, testável sem banco. `node:crypto` aqui segue o mesmo precedente já usado
 * em domínio puro noutras fases (ex.: `src/domain/design/bim-geometry.ts`).
 */
import { createHash } from "node:crypto";

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// Modelo contratual (item 1/3/6) — merge simples, sem motor jurídico
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export interface RenderedContract {
  rendered: string;
  /** Placeholders presentes no modelo sem valor em `variables` — o serviço decide se bloqueia ou aceita rascunho incompleto; nunca inventamos um valor para eles. */
  unresolved: string[];
}

/** Substituição literal de `{{chave}}` pelo valor em `variables` — motor de merge intencionalmente simples (plano §3, "não inventar motor jurídico sofisticado"). */
export function renderContractTemplate(content: string, variables: Record<string, string>): RenderedContract {
  const unresolved = new Set<string>();
  const rendered = content.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) return variables[key];
    unresolved.add(key);
    return match;
  });
  return { rendered, unresolved: [...unresolved] };
}

export type ContractTemplateVersionStatusLike = "DRAFT" | "APPROVED";

/** Versão `APPROVED` é imutável — nenhum `UPDATE` de conteúdo depois da aprovação (item 6). Conteúdo novo sempre cria `version + 1`. */
export function assertTemplateVersionEditable(status: ContractTemplateVersionStatusLike) {
  if (status === "APPROVED") throw new Error("Versão de modelo já aprovada é imutável — crie uma nova versão para alterar o conteúdo.");
}

// ---------------------------------------------------------------------------
// Assinatura (item 4) — máquina de estados de domínio, sem I/O
// ---------------------------------------------------------------------------

export type SignaturePartyStatusLike = "PENDING" | "SIGNED" | "DECLINED";
export type SignatureRequestStatusLike = "PREPARADO" | "ENVIADO" | "AGUARDANDO_ASSINATURAS" | "ASSINADO" | "RECUSADO" | "CANCELADO" | "ERRO";
export type SalesContractSignatureStatusLike = "PENDING" | "PARTIALLY_SIGNED" | "SIGNED";

/**
 * Próximo status da `SignatureRequest` a partir dos status atuais dos signatários (plano §4):
 * qualquer recusa falha a request inteira (regra de negócio explícita — uma recusa não deixa
 * "parcialmente assinado" pendurado); todos assinados fecha; caso contrário permanece aguardando.
 */
export function nextSignatureRequestStatus(parties: { status: SignaturePartyStatusLike }[]): "AGUARDANDO_ASSINATURAS" | "ASSINADO" | "RECUSADO" {
  if (parties.some((party) => party.status === "DECLINED")) return "RECUSADO";
  if (parties.length > 0 && parties.every((party) => party.status === "SIGNED")) return "ASSINADO";
  return "AGUARDANDO_ASSINATURAS";
}

/** Mapeia o estado do fluxo de assinatura para o enum já existente `SalesContract.signatureStatus` (9E) — nunca um segundo conceito de status de assinatura no contrato. */
export function mapToContractSignatureStatus(parties: { status: SignaturePartyStatusLike }[]): SalesContractSignatureStatusLike {
  if (parties.length > 0 && parties.every((party) => party.status === "SIGNED")) return "SIGNED";
  if (parties.some((party) => party.status === "SIGNED")) return "PARTIALLY_SIGNED";
  return "PENDING";
}

// ---------------------------------------------------------------------------
// Crédito (item 5/7) — mascaramento e classificação, nunca decide a venda
// ---------------------------------------------------------------------------

/** Máscara padrão de CPF/CNPJ para UI/log (item 8, "CPF mascarado"): mantém só os 3 primeiros dígitos, oculta o resto. Não depende de formatação de entrada (aceita com ou sem pontuação). */
export function maskTaxId(taxId: string): string {
  const digits = taxId.replace(/\D/g, "");
  if (digits.length === 0) return "***";
  const visible = digits.slice(0, 3);
  return `${visible}${"*".repeat(Math.max(digits.length - 3, 3))}`;
}

export type CreditConsultationResultLike = "SEM_RESTRICAO" | "COM_RESTRICAO" | "REQUER_ANALISE";

/** Classificação determinística do resultado bruto do provider — nunca decide a venda sozinha (plano §5), só alimenta a política/alçada existente. */
export function classifyCreditResult(input: { score: number | null; findingsCount: number }): CreditConsultationResultLike {
  if (input.findingsCount > 0) return "COM_RESTRICAO";
  if (input.score === null || input.score < 500) return "REQUER_ANALISE";
  return "SEM_RESTRICAO";
}
