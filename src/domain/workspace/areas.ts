/**
 * Grandes Áreas operacionais (Fase 9K.0, plano §E "Grandes áreas").
 *
 * Fundação estrutural apenas: esta é a metadata pura (id, rótulo em português, descrição e quais
 * das 24 abas atuais — `ViewKey` em `src/components/intelligence-workspace.tsx` — pertencem a
 * cada área). Nesta sprint ela é usada só para agrupar visualmente a navegação existente (sem
 * remover nenhuma aba, sem criar rotas novas). Rotas reais por área (nível 1/2 do plano §F) e a
 * substituição das 24 abas ficam para a 9K.1 — ver plano §AU, sprint 9K.1.
 *
 * Mantenha `viewKeys` sincronizado com o array `ViewKey` de `intelligence-workspace.tsx`; o teste
 * deste módulo verifica que as 24 chaves atuais estão cobertas exatamente uma vez.
 */

export type LegacyViewKey =
  | "overview"
  | "assumptions"
  | "land"
  | "design"
  | "budget"
  | "procurement"
  | "legal"
  | "financial"
  | "accounting"
  | "integrations"
  | "sales"
  | "people"
  | "scenarios"
  | "sensitivity"
  | "redteam"
  | "committee"
  | "studio"
  | "dataroom"
  | "ai"
  | "cashflow"
  | "risks"
  | "audit"
  | "dataIntelligence"
  | "marketIntelligence"
  | "productIntelligence";

export interface OperationalArea {
  id: string;
  label: string;
  description: string;
  /** Transversal: não aparece na grade de 12 áreas (plano §E), fica no chrome (§D). */
  transversal?: boolean;
  viewKeys: LegacyViewKey[];
}

/** As 12 grandes áreas do plano §E, na mesma ordem do documento. */
export const OPERATIONAL_AREAS: OperationalArea[] = [
  {
    id: "viabilidade",
    label: "Viabilidade",
    description: "Engine, Score, Sensibilidade, Red Team, Comitê, Studio, Data Room, fluxo de caixa, riscos e trilha de cálculo.",
    viewKeys: ["assumptions", "scenarios", "sensitivity", "redteam", "committee", "studio", "dataroom", "cashflow", "risks", "audit"],
  },
  {
    id: "terreno",
    label: "Terreno",
    description: "Land Intelligence e Zoning Lab.",
    viewKeys: ["land"],
  },
  {
    id: "mercado-produto",
    label: "Mercado e Produto",
    description: "Inteligência de Mercado e Inteligência de Produto.",
    viewKeys: ["marketIntelligence", "productIntelligence"],
  },
  {
    id: "engenharia-obra",
    label: "Engenharia e Obra",
    description: "Cronograma, Design Intelligence/BIM e Orçamento.",
    viewKeys: ["design", "budget"],
  },
  {
    id: "suprimentos",
    label: "Suprimentos",
    description: "Necessidades, requisições, cotações, contratos, medições e ordens de compra.",
    viewKeys: ["procurement"],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    description: "Contas a pagar, contas a receber, bancos, conciliação e fluxo de caixa.",
    viewKeys: ["financial"],
  },
  {
    id: "comercial",
    label: "Comercial",
    description: "Clientes, unidades/estoque, propostas, vendas, recebíveis e pós-venda.",
    viewKeys: ["sales"],
  },
  {
    id: "juridico",
    label: "Jurídico",
    description: "Diligência, obrigações, licenças, contratos e documentos.",
    viewKeys: ["legal"],
  },
  {
    id: "pessoas",
    label: "Pessoas",
    description: "Equipe, alocação, eficiência, causa-raiz e incentivos.",
    viewKeys: ["people"],
  },
  {
    id: "contabilidade-controladoria",
    label: "Contabilidade e Controladoria",
    description: "Plano de contas, lançamentos, fechamento, impostos e consolidação.",
    viewKeys: ["accounting"],
  },
  {
    id: "integracoes",
    label: "Integrações",
    description: "Conectores, sincronizações, conflitos e credenciais.",
    viewKeys: ["integrations"],
  },
  {
    id: "inteligencia-dados",
    label: "Inteligência de Dados",
    description: "Contratos analíticos, métricas, benchmarks, qualidade de dados e portfólio.",
    viewKeys: ["dataIntelligence"],
  },
];

/**
 * Transversais (plano §D): fora da grade de 12 áreas, vivem no chrome. `overview` e `ai` já
 * existem hoje como abas; nesta sprint continuam abas (sem chrome novo — isso é 9K.2/9K.4), mas
 * já ficam marcadas aqui como transversais para a 9K.1 não as tratar como uma 13ª área.
 */
export const TRANSVERSAL_AREAS: OperationalArea[] = [
  { id: "visao-executiva", label: "Visão Executiva", description: "Hoje: aba \"overview\". Redesenho por exceção é a 9K.2.", transversal: true, viewKeys: ["overview"] },
  { id: "rede-ai", label: "Pergunte ao REDE", description: "Hoje: aba \"ai\". Painel flutuante é a 9K.4.", transversal: true, viewKeys: ["ai"] },
];

export function findAreaForViewKey(viewKey: LegacyViewKey): OperationalArea | undefined {
  return [...OPERATIONAL_AREAS, ...TRANSVERSAL_AREAS].find((area) => area.viewKeys.includes(viewKey));
}
