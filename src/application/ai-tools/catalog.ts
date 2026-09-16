import type { MembershipRole } from "@prisma/client";
import type { ProtectedReadCapability } from "@/domain/auth/read-capabilities";
import { contextPolicyFor } from "@/domain/context-engine";
import type { AiToolName, ContextPurpose } from "@/domain/ai-tools";

/**
 * Fase 10C - registro fechado das 4 ferramentas do piloto (decisao 2,
 * docs/PHASE_10C_TOOL_LAYER_CONTRACT.md). Cada entrada mapeia 1:1 a um `ContextPurpose` ja
 * implementado e auditado pela 10B - nenhum reader novo, nenhuma consulta Prisma propria.
 * `minimumRole = REVIEWER` para as 4 (decisao 13), cumulativo com `AI_READ`+`AI_USE`+a
 * `domainCapability` abaixo (reaproveitada da propria ContextPolicy do proposito).
 */
export interface AiToolSpec {
  readonly name: AiToolName;
  readonly description: string;
  readonly minimumRole: MembershipRole;
  readonly domainCapability: ProtectedReadCapability;
  readonly contextPurpose: ContextPurpose;
}

interface ToolDefinitionInput {
  readonly name: AiToolName;
  readonly description: string;
  readonly minimumRole: MembershipRole;
  readonly contextPurpose: ContextPurpose;
}

/**
 * `domainCapability` nunca e digitada a mao aqui - e derivada de `contextPolicyFor(purpose)`,
 * a mesma politica que a 10B ja usa internamente (`assertAiUse(context, policy.domainCapability)`
 * em `prepareContextBundleInTransaction`). Fonte unica de verdade: evita a ferramenta declarar
 * uma capability diferente da que o proposito realmente exige.
 */
function defineTool(input: ToolDefinitionInput): AiToolSpec {
  return { ...input, domainCapability: contextPolicyFor(input.contextPurpose).domainCapability };
}

const TOOL_SPECS: readonly AiToolSpec[] = [
  defineTool({
    name: "getApprovedViabilitySummary",
    description: "Resumo factual da viabilidade aprovada (estudo, premissas, resultado financeiro e riscos da mesma linhagem).",
    minimumRole: "REVIEWER",
    contextPurpose: "EXECUTIVE_PROJECT_SUMMARY",
  }),
  defineTool({
    name: "getActiveRisks",
    description: "Riscos ativos comprovados do estudo vigente.",
    minimumRole: "REVIEWER",
    contextPurpose: "RISK_REVIEW",
  }),
  defineTool({
    name: "getEngineeringProgress",
    description: "Andamento de engenharia com base em pareceres tecnicos validados.",
    minimumRole: "REVIEWER",
    contextPurpose: "ENGINEERING_PROGRESS_REVIEW",
  }),
  defineTool({
    name: "getVerifiedLegalEvidence",
    description: "Evidencias juridicas verificadas e nao revogadas.",
    minimumRole: "REVIEWER",
    contextPurpose: "LEGAL_EVIDENCE_SUMMARY",
  }),
];

const TOOL_SPECS_BY_NAME = new Map<AiToolName, AiToolSpec>(TOOL_SPECS.map((spec) => [spec.name, spec]));

export function getAiToolSpec(name: string): AiToolSpec | undefined {
  return TOOL_SPECS_BY_NAME.get(name as AiToolName);
}

/** Metadado publico apenas - nunca inclui logica de execucao (secao 13/15 do contrato). */
export function listAiTools(): readonly AiToolSpec[] {
  return TOOL_SPECS;
}
