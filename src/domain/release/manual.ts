import { OPERATIONAL_AREAS, ECOSYSTEM_ENTRIES } from "@/domain/workspace/areas";
export const roleGuidance = {
  OWNER: "Responde pela organização, aprova responsáveis e confirma o aceite local. Decide a promoção somente com os responsáveis de segurança, operação e cliente.",
  ADMIN: "Prepara acessos e configuração autorizada, acompanha filas e registra o onboarding. Não substitui aprovações específicas dos domínios.",
  ANALYST: "Prepara estudos, dados e análises nos módulos permitidos. Submete decisões e divergências para revisão; não transforma simulação em evidência real.",
  REVIEWER: "Examina premissas, evidências e propostas nas áreas permitidas. Usa as aprovações disponíveis no domínio, sem presumir autorização para configurar ou reenviar integrações.",
  VIEWER: "Consulta somente as áreas liberadas para seu perfil, incluindo ajuda e viabilidade. Solicita ao administrador qualquer acesso adicional; um link não concede permissão.",
};
const guidance: Record<string, string[]> = {
  "/executivo": ["Confirme a organização e o empreendimento no seletor.", "Leia indicadores, recomendação e pendências com suas datas de referência.", "No rito semanal, registre decisão, responsável, prazo e evidência; acompanhe na Central de Ações."],
  "/viabilidade": ["Cadastre ou selecione o terreno e o estudo no contexto correto.", "Informe premissas com fonte, data, unidades e cenário; calcule a viabilidade.", "Revise fluxo de caixa, sensibilidade e riscos. Submeta a versão à governança antes de criar a Base Aprovada."],
  "/mercado-produto": ["Identifique fontes e data da pesquisa.", "Revise comparáveis e premissas de produto; resultados locais não são consulta real a fornecedor.", "Submeta alterações econômicas pelo fluxo da viabilidade."],
  "/engenharia-obra": ["Confira Base Aprovada, orçamento e cronograma separadamente.", "Importe arquivos permitidos e verifique versão, unidades e validação.", "Analise deltas e impactos antes de aprovar mudanças; arquivo recebido não altera a Base sozinho."],
  "/suprimentos": ["Confira fornecedor, contrato, escopo e orçamento do empreendimento.", "Revise medições e documentos antes da aprovação.", "Encaminhe obrigações ao fluxo financeiro autorizado, preservando a origem."],
  "/financeiro": ["Confira obrigação, vencimento, competência e origem.", "Revise conciliação e divergências; simulações bancárias não demonstram pagamento.", "Aprove somente com evidência e permissão apropriadas."],
  "/capital-funding": ["Revise cenário, fontes e dossiê de funding.", "Compare condições e pendências sem interpretar MOCK como oferta de crédito.", "Registre decisão humana; esta fase não executa desembolso externo."],
  "/comercial": ["Confira lead, cliente, unidade, preço e proposta no projeto correto.", "Revise contrato e condições pelos fluxos comerciais.", "Assinatura e bureau reais permanecem pendentes de campanha específica; não marque conclusão com evidência sintética."],
  "/juridico": ["Organize documentos e obrigações com fonte e responsável.", "Revise pendências, prazos e riscos.", "Use aprovações do domínio e preserve histórico documental."],
  "/pessoas": ["Confira equipe, papéis e alocação autorizada.", "Interprete eficiência junto com avanço físico e causas.", "Limite dados pessoais à finalidade e ao acesso necessário."],
  "/contabilidade-controladoria": ["Confira empresa, competência e plano de contas.", "Revise lançamentos, saldos e rastreabilidade antes do fechamento.", "Resultados locais não comprovam envio fiscal ou integração com ERP."],
  "/integracoes": ["Escolha somente a integração mínima do ensaio e mantenha DISABLED inicialmente.", "MOCK usa dados sintéticos e transporte local. Revise fila, dead-letter, quarentena e vínculos antes de retentar.", "REAL não deve ser ativado neste checkpoint. Credenciais e validação operacional ficam para a 9Q.2B."],
  "/inteligencia-dados": ["Confirme escopo e origem dos dados.", "Compare empreendimentos apenas dentro do acesso autorizado.", "Exporte somente o necessário e confira se o destinatário tem permissão."],
  "/acoes": ["Revise a ação, contexto, responsável e prazo.", "Associe evidência ao trabalho concluído.", "Feche a ação somente após validar o resultado; atraso exige escalonamento."],
  "/rotina": ["Confira prioridades e pendências do dia.", "Atualize responsáveis e prazos pelos fluxos autorizados.", "Leve bloqueios ao rito executivo semanal."],
  "/assistente": ["Confira o projeto antes de perguntar.", "Leia fontes e limitações da resposta.", "A IA apoia a preparação; cálculo oficial e aprovação continuam nos fluxos determinísticos e humanos."],
  "/asset": ["Consulte apenas o conteúdo efetivamente disponível.", "Não interprete a presença do módulo como serviço financeiro externo ativado."],
  "/academy": ["Use o manual e o onboarding para o treinamento assistido.", "A presença deste acesso não comprova catálogo de cursos ou certificação externa."],
};
export const manualModules = [...OPERATIONAL_AREAS, ...ECOSYSTEM_ENTRIES, { path: "/acoes", label: "Central de Ações" }, { path: "/rotina", label: "Minha Rotina" }, { path: "/assistente", label: "Assistente" }].map(area => ({ path: area.path, title: area.label, id: area.path.slice(1), steps: guidance[area.path] ?? ["Confirme o contexto e consulte seu responsável antes de executar alterações."] }));
export function contextualHelp(path: string) { return manualModules.find(module => path === module.path || path.startsWith(`${module.path}/`)); }
export const glossary = {
  "Base Aprovada": "Referência econômica aprovada e versionada; não é sinônimo de orçamento corrente ou cenário.",
  "Cenário": "Conjunto de premissas para comparação, sem mudança automática da referência oficial.",
  "Tenant": "Organização isolada para fins de acesso e dados.",
  "Evidência": "Registro rastreável do que foi executado, com origem e data. Simulação deve ser identificada.",
  "Idempotência": "Repetir o mesmo pedido não duplica seu efeito; conteúdo diferente exige revisão.",
  "Dead-letter": "Fila de falhas que precisam de análise antes de nova tentativa.",
  "Quarentena": "Item retido por inconsistência, segurança ou falta de vínculo; não foi aplicado.",
  "RPO / RTO": "Perda de dados tolerada e prazo de recuperação; dependem de medição no ambiente alvo.",
  "DISABLED / MOCK / REAL": "Integração bloqueada, simulação local ou operação real. REAL está pendente neste checkpoint.",
};
export const onboardingGuide = [
  "Organização: o responsável de implantação provisiona a organização isolada pelo procedimento administrativo autorizado; confirma finalidade, responsáveis e segregação. Não use o seed demonstrativo para dados reais.",
  "Usuário: o administrador cadastra o vínculo e o menor papel necessário pelo procedimento de identidade existente. Cada pessoa realiza primeiro acesso, confere organização, encerra a sessão e testa a recusa a outra organização. Convite por e-mail real não está disponível neste ensaio.",
  "Primeiro projeto: responsável cadastra empresa e empreendimento no contexto correto, confirma moeda, localização e responsáveis. Se o cadastro exigir operação assistida, solicite à implantação; o checklist não cria registros administrativos.",
  "Importação inicial: inventarie arquivos, autorizações, formatos e unidades; use o fluxo de importação disponível do módulo, valide contagens, totais e duplicidades e registre rejeições. Não edite diretamente tabelas para corrigir importações.",
  "Primeira viabilidade: selecione o terreno/estudo, preencha premissas, calcule o cenário, revise sensibilidade e preserve a versão submetida.",
  "Primeira Base Aprovada: complete o fluxo de revisão e aprovação da versão e da base operacional; confirme o vínculo com o estudo e o checksum. O checklist só confirma uma base existente.",
  "Primeiro rito: reúna patrocinador, operação e analista; revise indicadores, riscos e decisões, registre ação com dono e prazo e valide na reunião seguinte.",
  "Primeira integração: DISABLED para cadastro e preparação; MOCK para ensaio sintético. Confira tenant, acesso, idempotência, fila e falha controlada. REAL permanece bloqueado e será ensaiado na 9Q.2B.",
  "Suporte: ensaie pausa, diagnóstico sanitizado e recuperação isolada; defina contatos reais antes de iniciar cliente piloto.",
  "Aceite: OWNER/ADMIN confirma somente o que foi ensaiado, após validar as etapas anteriores. Esse aceite local não libera cloud, APIs reais ou produção.",
];
