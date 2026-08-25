/**
 * Fase 9K.4A — Perguntas Executivas e Simulações de Decisão. Tipos compartilhados pelas engines
 * puras de `engine.ts`. Nenhum destes tipos é persistido — são contratos de leitura/simulação
 * (ordem de serviço §8/§9: "engines determinísticas calculam, REDE AI futuramente explica, humano
 * decide"; nunca LLM no cálculo, nunca mutação de domínio).
 */

/** Confiança do dado que alimenta a resposta — mesma semântica de `ExecutiveExceptionConfidence` (`src/domain/workspace/exceptions.ts`), reaproveitada aqui em vez de um novo conceito paralelo. */
export type Confidence = "ALTA" | "MEDIA" | "BAIXA";

/**
 * Distinção obrigatória (ordem de serviço §11): `0` é uma resposta real (ex.: nenhum custo
 * registrado), nunca confundido com ausência de dado/evidência.
 *  - `OK`: a resposta foi calculada com os dados disponíveis (pode incluir `0` como valor real).
 *  - `SEM_DADOS`: não há registros de origem no escopo consultado (ex.: nenhuma venda aprovada).
 *  - `SEM_EVIDENCIA`: há dados parciais, mas falta uma premissa necessária para responder com
 *    segurança (ex.: sem taxa de imposto de referência) — nunca preenchido com estimativa arbitrária.
 *  - `NAO_APLICAVEL`: a pergunta não se aplica ao estado atual (ex.: caixa não está queimando, não
 *    há "quanto tempo aguenta").
 */
export type AnswerStatus = "OK" | "SEM_DADOS" | "SEM_EVIDENCIA" | "NAO_APLICAVEL";

export interface EngineAnswer<T> {
  status: AnswerStatus;
  /** Presente mesmo em `SEM_EVIDENCIA` quando parte do cálculo é sólida — nunca mistura número real com inventado no mesmo campo (ver notas por campo). */
  data: T | null;
  /** Motivo em português, sempre presente quando `status !== "OK"`. */
  reason?: string;
}

export function ok<T>(data: T): EngineAnswer<T> {
  return { status: "OK", data };
}

export function noData<T = never>(reason: string): EngineAnswer<T> {
  return { status: "SEM_DADOS", data: null, reason };
}

export function noEvidence<T = never>(reason: string): EngineAnswer<T> {
  return { status: "SEM_EVIDENCIA", data: null, reason };
}

export function notApplicable<T = never>(reason: string): EngineAnswer<T> {
  return { status: "NAO_APLICAVEL", data: null, reason };
}
