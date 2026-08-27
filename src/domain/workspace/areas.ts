/**
 * Grandes Áreas operacionais (Fase 9K.0, plano §E "Grandes áreas"; reestruturado na 9K.1
 * "Navegação por Grandes Áreas").
 *
 * A 9K.0 tratava "Visão executiva" (`overview`) como transversal (chrome, fora da grade de áreas)
 * e mantinha `land` como uma 13ª área própria ("Terreno"). A ordem de serviço da 9K.1 substitui os
 * dois pontos:
 *
 *   1. Gestão Executiva deixa de ser chrome transversal e passa a ser a PRIMEIRA área da navegação
 *      — porta de entrada principal para perfis de gestão/diretoria (`primary: true` abaixo). Ela
 *      ainda reaproveita 100% do conteúdo hoje em `view === "overview"`; a reconstrução profunda
 *      fica para a 9K.2 (Nova Visão Executiva).
 *   2. Terreno deixa de ser uma área isolada e passa a ser a primeira função dentro de Viabilidade
 *      (ordem de serviço 9K.1, item 3: "terreno; estudo; premissas; cenário; viabilidade;
 *      investimento; score/sensibilidade; decisão" — tudo em um único ambiente coerente).
 *
 * `viewKeys` continua mapeando 1:1 para as 24 abas legadas de `intelligence-workspace.tsx`
 * (preservadas ali, sem alteração de conteúdo — ver `src/app/legado/page.tsx` na 9K.1). O teste
 * deste módulo verifica que as 24 chaves continuam cobertas exatamente uma vez.
 *
 * `path` é o segmento de rota Next.js real desta área (plano §F/§D: nível 1 vira rota, não estado
 * de componente) — usado tanto pela navegação (`src/components/workspace-shell.tsx`) quanto pelos
 * testes de arquitetura.
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
  /** Segmento de rota real desta área (ex.: "/executivo", "/financeiro"). */
  path: string;
  /** Porta de entrada principal (Gestão Executiva). Nunca mais de uma área com esta marca. */
  primary?: boolean;
  /** Transversal: não aparece na grade de áreas operacionais, fica no chrome (§D). */
  transversal?: boolean;
  viewKeys: LegacyViewKey[];
}

/**
 * As 13 grandes áreas (9K.1 definiu 12; a 9N.1 promoveu Capital & Funding de "ação" — onde vivia
 * como atalho avulso no grupo AÇÕES da sidebar — a Grande Área própria, entre Financeiro e
 * Comercial). Gestão Executiva sempre primeiro; a ordem das demais NÃO está congelada — poderá ser
 * revista em sprint futura. `capital-funding` não tem `viewKeys`: não existe aba legada
 * correspondente em `intelligence-workspace.tsx` (é conteúdo 100% novo da Fase 9N), então não
 * participa do teste de cobertura das 24 chaves legadas.
 */
export const OPERATIONAL_AREAS: OperationalArea[] = [
  {
    id: "gestao-executiva",
    label: "Gestão Executiva",
    description: "Porta de entrada principal: recomendação do motor, KPIs essenciais, riscos e panorama por módulo.",
    path: "/executivo",
    primary: true,
    viewKeys: ["overview"],
  },
  {
    id: "viabilidade",
    label: "Viabilidade",
    description: "Terreno, premissas, cenários, score, sensibilidade, Red Team, comitê, Studio, Data Room, fluxo de caixa, riscos e trilha de cálculo — um único ambiente de decisão.",
    path: "/viabilidade",
    viewKeys: ["land", "assumptions", "scenarios", "sensitivity", "redteam", "committee", "studio", "dataroom", "cashflow", "risks", "audit"],
  },
  {
    id: "mercado-produto",
    label: "Mercado e Produto",
    description: "Inteligência de Mercado e Inteligência de Produto.",
    path: "/mercado-produto",
    viewKeys: ["marketIntelligence", "productIntelligence"],
  },
  {
    id: "engenharia-obra",
    label: "Engenharia e Obra",
    description: "Design Intelligence/BIM, Orçamento e Operações/Cronograma.",
    path: "/engenharia-obra",
    viewKeys: ["design", "budget"],
  },
  {
    id: "suprimentos",
    label: "Suprimentos",
    description: "Necessidades, requisições, cotações, contratos, medições e ordens de compra.",
    path: "/suprimentos",
    viewKeys: ["procurement"],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    description: "Contas a pagar, contas a receber, bancos, conciliação e fluxo de caixa.",
    path: "/financeiro",
    viewKeys: ["financial"],
  },
  {
    id: "capital-funding",
    label: "Capital e Financiamento",
    description: "Necessidade de capital, propostas de financiamento, comparação, desembolsos, serviço da dívida, cláusulas financeiras, condições precedentes e garantias.",
    path: "/capital-funding",
    viewKeys: [],
  },
  {
    id: "comercial",
    label: "Comercial",
    description: "Clientes, unidades/estoque, propostas, vendas, recebíveis e pós-venda.",
    path: "/comercial",
    viewKeys: ["sales"],
  },
  {
    id: "juridico",
    label: "Jurídico",
    description: "Diligência, obrigações, licenças, contratos e documentos.",
    path: "/juridico",
    viewKeys: ["legal"],
  },
  {
    id: "pessoas",
    label: "Pessoas",
    description: "Equipe, alocação, eficiência, causa-raiz e incentivos.",
    path: "/pessoas",
    viewKeys: ["people"],
  },
  {
    id: "contabilidade-controladoria",
    label: "Contabilidade e Controladoria",
    description: "Plano de contas, lançamentos, fechamento, impostos e consolidação.",
    path: "/contabilidade-controladoria",
    viewKeys: ["accounting"],
  },
  {
    id: "integracoes",
    label: "Integrações",
    description: "Conectores, sincronizações, conflitos e credenciais.",
    path: "/integracoes",
    viewKeys: ["integrations"],
  },
  {
    id: "inteligencia-dados",
    label: "Inteligência de Dados",
    description: "Contratos analíticos, métricas, benchmarks, qualidade de dados e portfólio.",
    path: "/inteligencia-dados",
    viewKeys: ["dataIntelligence"],
  },
];

/**
 * Transversais (plano §D): fora da grade de 12 áreas, vivem no chrome. `ai` continua acessível
 * como rota própria (`/assistente`) nesta sprint — o painel flutuante é a 9K.4.
 */
export const TRANSVERSAL_AREAS: OperationalArea[] = [
  { id: "rede-ai", label: "Pergunte ao REDE", description: "Assistente contextual. Painel flutuante é a 9K.4.", path: "/assistente", transversal: true, viewKeys: ["ai"] },
];

/**
 * Ecossistema REDE (ordem de serviço 9K.1, itens 9 e 10): áreas futuras do ecossistema, separadas
 * da operação principal. Nesta sprint são apenas entrada estrutural — sem plataforma de cursos,
 * sem marketplace. REDE Academy fica deliberadamente por último na navegação (item 9).
 */
export interface EcosystemEntry {
  id: string;
  label: string;
  description: string;
  path: string;
}

export const ECOSYSTEM_ENTRIES: EcosystemEntry[] = [
  { id: "rede-asset", label: "REDE Asset", description: "Oportunidades do ecossistema REDE Asset. Estrutural nesta sprint — sem marketplace, sem funding.", path: "/asset" },
  { id: "rede-academy", label: "REDE Academy", description: "Mentorias, treinamentos e certificações REDE. Estrutural nesta sprint — sem plataforma de cursos.", path: "/academy" },
];

export const HELP_ENTRY = { id: "ajuda", label: "Central de Ajuda", description: "Arquitetura completa do Help System é a 9K.4.", path: "/ajuda" };

export function findAreaForViewKey(viewKey: LegacyViewKey): OperationalArea | undefined {
  return [...OPERATIONAL_AREAS, ...TRANSVERSAL_AREAS].find((area) => area.viewKeys.includes(viewKey));
}

export function findAreaById(id: string): OperationalArea | undefined {
  return [...OPERATIONAL_AREAS, ...TRANSVERSAL_AREAS].find((area) => area.id === id);
}

/** A área principal (Gestão Executiva). Lança se a metadata estiver inconsistente — nunca deve faltar. */
export function getPrimaryArea(): OperationalArea {
  const primary = OPERATIONAL_AREAS.find((area) => area.primary);
  if (!primary) throw new Error("Metadata de Grandes Áreas inconsistente: nenhuma área principal (Gestão Executiva) definida.");
  return primary;
}
