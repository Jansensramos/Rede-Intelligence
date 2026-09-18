import { OPERATIONAL_AREAS, ECOSYSTEM_ENTRIES } from "@/domain/workspace/areas";

export const roleGuidance = {
  OWNER: "Responde pela organização, define responsáveis e aprova decisões de maior impacto conforme as regras de cada área.",
  ADMIN: "Administra acessos, configurações autorizadas e rotinas operacionais. Não substitui aprovações específicas das áreas de negócio.",
  ANALYST: "Prepara estudos, dados e análises nas áreas permitidas. Registra propostas e encaminha decisões para revisão quando necessário.",
  REVIEWER: "Revisa premissas, evidências e propostas nas áreas permitidas e utiliza as aprovações disponíveis para seu perfil.",
  VIEWER: "Consulta somente as áreas liberadas para seu perfil. Acesso adicional deve ser solicitado ao administrador da organização.",
};

const guidance: Record<string, string[]> = {
  "/executivo": ["Confirme a organização e o empreendimento no seletor.", "Revise indicadores, recomendações e pendências com suas datas de referência.", "Registre decisões, responsáveis, prazos e evidências e acompanhe a execução pela Central de Ações."],
  "/viabilidade": ["Cadastre ou selecione o terreno e o estudo no contexto correto.", "Informe premissas com fonte, data, unidade e cenário e calcule a viabilidade.", "Revise fluxo de caixa, sensibilidade e riscos antes de submeter a versão para aprovação."],
  "/mercado-produto": ["Identifique as fontes e a data da pesquisa.", "Revise comparáveis, premissas de produto e sinais de mercado.", "Leve alterações econômicas relevantes ao fluxo da viabilidade para manter a coerência das premissas."],
  "/engenharia-obra": ["Confira a Base Aprovada, orçamento e cronograma separadamente.", "Importe arquivos permitidos e verifique versão, unidades e consistência.", "Analise diferenças e impactos antes de aprovar mudanças; um arquivo recebido não altera automaticamente a referência oficial."],
  "/suprimentos": ["Confira necessidade, fornecedor, escopo, contrato e orçamento do empreendimento.", "Revise pedidos, ordens de serviço, medições e documentos antes da aprovação.", "Encaminhe obrigações ao Financeiro preservando a origem e a rastreabilidade."],
  "/financeiro": ["Confira obrigação, vencimento, competência e origem.", "Revise conciliações e divergências antes de confirmar movimentações.", "Aprove pagamentos e recebimentos somente com evidência e permissão apropriadas."],
  "/capital-funding": ["Revise cenário, fontes e dossiê de funding.", "Compare condições, garantias, custos e pendências.", "Registre a decisão humana e preserve as condições consideradas na análise."],
  "/comercial": ["Confira lead, cliente, unidade, preço e proposta no empreendimento correto.", "Revise reservas, vendas, contrato e condições comerciais antes da aprovação.", "Mantenha o histórico da negociação e preserve a origem dos recebíveis gerados."],
  "/juridico": ["Organize diligências, documentos e obrigações com fonte e responsável.", "Revise pendências, prazos, riscos e condições antes de registrar uma decisão.", "Preserve o histórico documental e a integração das obrigações jurídicas com o Financeiro."],
  "/pessoas": ["Confira estrutura, cargos, equipe e alocações autorizadas.", "Interprete eficiência em conjunto com avanço físico, custos e causas.", "Registre investigações, hipóteses e ações corretivas com responsável, prazo e evidência."],
  "/contabilidade-controladoria": ["Confira empresa, competência, origem e classificação dos eventos.", "Revise lançamentos, saldos e rastreabilidade antes do fechamento.", "Feche o período somente após concluir o checklist e tratar as pendências relevantes."],
  "/integracoes": ["Configure apenas as integrações necessárias para a operação atual.", "Use o ambiente de teste para validar autenticação, filas, vínculos e tratamento de falhas antes de ativar uma integração real.", "A ativação em produção deve ocorrer somente depois da validação operacional e das credenciais do cliente."],
  "/inteligencia-dados": ["Confirme escopo, origem e data de referência dos dados.", "Compare empreendimentos somente dentro do acesso autorizado.", "Atualize as métricas quando houver novos fatos operacionais e valide a qualidade antes de usar o resultado em decisões."],
  "/acoes": ["Revise contexto, responsável, prazo e prioridade da ação.", "Associe evidência ao trabalho concluído.", "Feche a ação somente após validar o resultado; atrasos e bloqueios devem ser tratados no rito de gestão."],
  "/rotina": ["Confira prioridades e pendências do dia.", "Atualize responsáveis e prazos pelos fluxos autorizados.", "Leve bloqueios relevantes ao rito executivo e registre a decisão tomada."],
  "/assistente": ["Confirme o empreendimento antes de perguntar.", "Leia as fontes, premissas e limitações apresentadas na resposta.", "A IA apoia a preparação e a análise; cálculos oficiais, aprovações e registros permanecem nos fluxos determinísticos da REDE."],
  "/asset": ["Consulte somente produtos, análises e oportunidades efetivamente disponíveis para sua organização.", "A presença do módulo não representa contratação automática de serviço financeiro ou investimento."],
  "/academy": ["Use a Academy e a Central de Ajuda para treinamento e consulta dos processos da REDE.", "Conteúdos e trilhas disponíveis dependem da configuração da organização."],
};

export const manualModules = [
  ...OPERATIONAL_AREAS,
  ...ECOSYSTEM_ENTRIES,
  { path: "/acoes", label: "Central de Ações" },
  { path: "/rotina", label: "Minha Rotina" },
  { path: "/assistente", label: "Assistente REDE" },
].map((area) => ({
  path: area.path,
  title: area.label,
  id: area.path.slice(1),
  steps: guidance[area.path] ?? ["Confirme o contexto e as permissões antes de executar alterações."],
}));

export function contextualHelp(path: string) {
  return manualModules.find((module) => path === module.path || path.startsWith(`${module.path}/`));
}

export const glossary = {
  "Base Aprovada": "Referência econômica aprovada e versionada. Não é sinônimo de orçamento corrente nem de cenário de simulação.",
  "Cenário": "Conjunto de premissas usado para comparação sem alterar automaticamente a referência oficial.",
  "Organização": "Ambiente isolado de dados, usuários e permissões de uma empresa ou grupo dentro da REDE.",
  "Evidência": "Registro rastreável do que foi executado, com origem, data e vínculo com o processo correspondente.",
  "Idempotência": "Proteção contra duplicidade: repetir a mesma operação não deve criar o mesmo efeito duas vezes.",
  "Fila de falhas": "Integrações que não puderam ser processadas e precisam de análise antes de uma nova tentativa.",
  "Quarentena": "Registro temporariamente retido por inconsistência, segurança ou falta de vínculo, sem aplicação automática.",
  "RPO / RTO": "Metas de perda máxima de dados e tempo de recuperação definidas para o ambiente de produção.",
  "Teste / Produção": "O ambiente de teste valida configuração e comportamento sem representar uma operação real; produção usa credenciais e dados reais autorizados.",
};

export const onboardingGuide = [
  "Organização: o responsável pela implantação cria o ambiente da empresa, define responsáveis e confirma a segregação de dados e acessos.",
  "Usuários: o administrador cadastra cada pessoa com o menor nível de permissão necessário. No primeiro acesso, cada usuário deve confirmar organização e empreendimento corretos.",
  "Primeiro empreendimento: cadastre empresa e empreendimento, confirme moeda, localização, responsáveis e contexto operacional.",
  "Importação inicial: inventarie arquivos, formatos, unidades e autorizações; importe pelo fluxo da área correspondente e valide contagens, totais, duplicidades e rejeições.",
  "Primeira viabilidade: selecione o terreno e o estudo, preencha premissas, calcule o cenário, revise sensibilidade e preserve a versão submetida.",
  "Primeira Base Aprovada: conclua a revisão e aprovação da versão e confirme o vínculo com o estudo de origem.",
  "Primeiro rito: reúna patrocinador, operação e analistas; revise indicadores, riscos e decisões e registre ações com responsável e prazo.",
  "Primeira integração: configure primeiro em ambiente de teste, valide acesso, vínculos, filas e falhas controladas e só então prepare a ativação em produção.",
  "Suporte: defina responsáveis de negócio e tecnologia, canais de atendimento, procedimentos de diagnóstico e recuperação antes do início do piloto.",
  "Aceite: a organização confirma somente os processos que foram efetivamente configurados, testados e validados para sua operação.",
];
