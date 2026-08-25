/**
 * Contrato de Exceção Executiva (Fase 9K.2, ordem de serviço §5 "Contrato Executivo" e plano §L
 * "Contrato de Ação"). Read model de apresentação — nunca uma nova fonte de fato de negócio (ordem
 * de serviço §4/§24, plano §AP): cada exceção aponta (`href`) para o registro oficial de origem
 * (`LegalObligation`, `PayableInstallment`, `ProcurementNeed`, ...) e nunca duplica seu estado.
 *
 * A 9K.3 (Central de Ações) introduz o contrato completo `AcaoCanonica` do plano (com `status`
 * ABERTA/RECONHECIDA/RESOLVIDA/DISPENSADA e a tabela de reconhecimento `AcaoReconhecimento`). Esta
 * fase entrega o subconjunto necessário à Gestão Executiva: leitura + severidade + drill-down, sem
 * reconhecimento/resolução manual (isso é 9K.3).
 *
 * Todas as funções aqui são puras (mesma entrada, mesma saída, sem I/O) — a busca de dados vive em
 * `src/application/executive/`.
 */
import { CANONICAL_SEVERITY_ORDER, type CanonicalSeverity } from "./severity";

/**
 * Confiança do fato (plano §L, nota sobre `confianca`): itens vindos de status/data explícitos no
 * banco são ALTA. Nenhum builder desta sprint usa inferência cruzada de módulos — o tipo já existe
 * para quando a 9K.3+ introduzir heurísticas (plano §AZ) sem precisar de um novo contrato.
 */
export type ExecutiveExceptionConfidence = "ALTA" | "MEDIA" | "BAIXA";

export interface ExecutiveExceptionImpact {
  /** Valor financeiro em jogo (R$), quando aplicável. */
  financial?: number;
  /** Se o item pode atrasar/bloquear cronograma de obra. */
  schedule?: boolean;
  /** Se o item tem natureza jurídica (obrigação, licença, contrato). */
  legal?: boolean;
}

/**
 * Domínios de origem cobertos pela Gestão Executiva (9K.2). Usado tanto para rotular a exceção
 * quanto para o gate de capacidade por domínio (`src/domain/workspace/executive-capabilities.ts`,
 * gate 2 do fechamento da 9K.2) — cada valor aqui tem uma pergunta de autorização correspondente.
 */
export type ExecutiveDomain = "viability" | "legal" | "financial" | "sales" | "procurement" | "operations" | "accounting" | "integrations" | "approvals";

export interface ExecutiveException {
  /** Determinístico — ver `buildExceptionId`. Recalcular a leitura duas vezes produz o mesmo id. */
  id: string;
  organizationId: string;
  economicGroupId?: string | null;
  companyId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  domain: ExecutiveDomain;
  /** Tipo dentro do domínio (ex.: "obligation_due", "payable_overdue"). */
  type: string;
  title: string;
  summary: string;
  severity: CanonicalSeverity;
  impact?: ExecutiveExceptionImpact;
  /** Valor/materialidade para ordenação (normalmente igual a `impact.financial`, quando houver). */
  materialityValue?: number | null;
  /** Prazo relevante (vencimento, expiração), ISO 8601. */
  dueDate?: string | null;
  confidence: ExecutiveExceptionConfidence;
  /** Fonte oficial do dado (ex.: "REDE", ou nome do conector para dados externos — plano §AK). */
  source: string;
  /** Quando o fato de origem foi observado/calculado (ISO 8601) — não confundir com `dueDate`. */
  occurredAt: string;
  /** Rota interna para o registro original (plano §11 "Drill-down"). */
  href: string;
  /** Explicação determinística do porquê do item aparecer com esta severidade (plano §N). */
  reason: string;
}

/**
 * Id determinístico (plano §AQ "Idempotência", aplicado ao subconjunto de leitura desta fase):
 * `(organizationId, domain, type, id-do-registro-original[, período])` → mesma leitura duas vezes
 * produz o mesmo id. Nunca cria — só identifica a mesma exceção entre recálculos.
 */
export function buildExceptionId(
  organizationId: string,
  domain: string,
  type: string,
  recordId: string,
  period?: string,
): string {
  return [organizationId, domain, type, recordId, period].filter((part) => part !== undefined).join(":");
}

const severityWeight: Record<CanonicalSeverity, number> = Object.fromEntries(
  CANONICAL_SEVERITY_ORDER.map((severity, index) => [severity, index]),
) as Record<CanonicalSeverity, number>;

/**
 * Ordena por prioridade executiva (plano §N "Priorização", motor determinístico — nunca a IA):
 * severidade (CRÍTICO primeiro) → materialidade (maior primeiro) → prazo (mais próximo primeiro).
 * Itens sem materialidade/prazo vão para o fim do respectivo critério, nunca para o topo.
 */
function hasMateriality(value: number | null | undefined): value is number {
  return value !== null && value !== undefined;
}

export function sortExceptionsByPriority(exceptions: ExecutiveException[]): ExecutiveException[] {
  return [...exceptions].sort((a, b) => {
    const severityDelta = severityWeight[b.severity] - severityWeight[a.severity];
    if (severityDelta !== 0) return severityDelta;
    // Comparação em duas etapas (nunca subtração direta com sentinela ±Infinity dos dois lados —
    // isso produziria NaN quando nenhum dos dois itens tem materialidade, e um comparador que
    // devolve NaN quebra o critério de desempate seguinte, o prazo).
    const aHasMateriality = hasMateriality(a.materialityValue);
    const bHasMateriality = hasMateriality(b.materialityValue);
    if (aHasMateriality !== bHasMateriality) return aHasMateriality ? -1 : 1;
    if (aHasMateriality && bHasMateriality) {
      const materialityDelta = b.materialityValue! - a.materialityValue!;
      if (materialityDelta !== 0) return materialityDelta;
    }
    const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return aDue - bDue;
  });
}

/** Contagem por severidade canônica — usado no resumo "O que precisa da minha atenção" e na carteira. */
export function summarizeExceptionsBySeverity(exceptions: ExecutiveException[]): Record<CanonicalSeverity, number> {
  const summary = Object.fromEntries(CANONICAL_SEVERITY_ORDER.map((severity) => [severity, 0])) as Record<CanonicalSeverity, number>;
  for (const exception of exceptions) summary[exception.severity] += 1;
  return summary;
}

/** Maior severidade presente em uma lista de exceções (NORMAL quando vazia ou só houver itens normais). */
export function highestSeverity(exceptions: ExecutiveException[]): CanonicalSeverity {
  return exceptions.reduce<CanonicalSeverity>((worst, item) => (severityWeight[item.severity] > severityWeight[worst] ? item.severity : worst), "NORMAL");
}
