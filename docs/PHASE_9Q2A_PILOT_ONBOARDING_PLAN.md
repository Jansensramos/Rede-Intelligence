# 9Q.2A — Implantação piloto e onboarding assistido

Plano de dez semanas, ajustável entre oito e doze mediante aceite dos responsáveis.
É um plano e ensaio local; não declara cliente implantado, fornecedor escolhido ou
produção liberada. Dados reais só entram depois dos gates jurídicos e operacionais.

## Entrada do cliente

- Patrocinador, gestor operacional, administrador e substitutos nomeados.
- Problema de negócio, empreendimento, escopo e critérios de sucesso acordados.
- Finalidade, autorização de dados, retenção e responsáveis LGPD registrados.
- Organização segregada e matriz de papéis revisada; nenhum usuário compartilhado.
- Empresa, projeto, moeda, localização, calendário e responsáveis conferidos.
- Inventário dos arquivos, fontes, versões, unidades e qualidade inicial.
- Baseline de indicadores e premissas preservada antes de qualquer comparação.
- Integrações mínimas escolhidas pelo cliente quando necessário, sem presumir provedor.
- Suporte, horários, severidades, recuperação, saída e critérios de aceite pactuados.
- Gates locais e externos separados. Ausência de cloud/API validada impede piloto real.

## Responsabilidades

| Entrega | REDE | Cliente | Aceite |
| --- | --- | --- | --- |
| Escopo e sucesso | Facilita e documenta | Patrocinador prioriza e fornece baseline | Ambos |
| Organização e acessos | Implantação prepara e testa isolamento | Administrador valida pessoas e papéis | Dono da organização |
| Dados iniciais | Define formatos e valida importação | Autoriza, prepara e corrige origem | Dono do dado |
| Premissas e Base Aprovada | Orienta cálculo e governança | Analista prepara; aprovador decide | Aprovador competente |
| Integrações mínimas | Prepara contratos e simulações | Informa sistemas e necessidade | Operação e cliente |
| Segurança/LGPD | Aplica controles técnicos | Define finalidade e responsáveis | Segurança/LGPD designados |
| Suporte/recuperação | Runbook, diagnóstico e ensaio | Contatos, disponibilidade e comunicação | Operação |
| Conversão/expansão | Apresenta resultado medido | Patrocinador decide | Ambos, formalmente |

Não são inventados nomes de responsáveis ou canais. Essas lacunas precisam ser
preenchidas antes do início real. O e-mail informado anteriormente pelo usuário não
define provedor transacional nem canal de suporte contratado.

## Cronograma de dez semanas

| Semana | Trabalho | Saída verificável |
| --- | --- | --- |
| 1 | Kickoff, escopo, dados autorizados e papéis | Termo de escopo e matriz de responsabilidades |
| 2 | Organização, usuários, primeiro acesso e projeto | Checklist de acesso/tenant e cadastro validado |
| 3 | Importação inicial e qualidade | Contagens, totais, duplicidades e rejeições conciliados |
| 4 | Primeira viabilidade e cenários | Versão calculada, premissas e sensibilidade revisadas |
| 5 | Governança e primeira Base Aprovada | Aprovação rastreável e referência congelada |
| 6 | Rotina executiva e Central de Ações | Rito com decisões, donos, prazos e evidências |
| 7 | Integrações mínimas DISABLED/MOCK | Ensaio de fila, erro, retry e quarentena sem chamadas externas |
| 8 | Suporte, pausa e recuperação | Ensaio local documentado e pendências explícitas |
| 9 | Avaliação de sucesso e ajustes | Comparação com baseline e riscos remanescentes |
| 10 | Aceite local, decisão de continuidade | Ata de aceite/rejeição, conversão ou encerramento |

Versão de oito semanas pode combinar preparação das semanas 1–2 e revisão 9–10.
Versão de doze semanas reserva duas semanas para saneamento de dados e treinamento.
Nenhuma compressão dispensa segurança, governança ou evidência. Ativação real de
integrações é separada e depende da 9Q.2B, mesmo se o calendário do piloto terminar.

## Rito executivo semanal

Reunião de 45–60 minutos com patrocinador, responsável operacional e analista.
Revise: indicadores versus baseline; riscos e dados faltantes; ações vencidas;
decisões que exigem aprovação; plano da próxima semana. Registre data, participantes,
decisão, fundamento, responsável, prazo e evidência no fluxo disponível da plataforma.
Comece a reunião seguinte conferindo as decisões anteriores. Não use respostas da
IA como substituto da aprovação nem interprete MOCK como resultado de fornecedor.

## Fluxo de onboarding na plataforma

O Manual Online em `/ajuda` apresenta dez passos, linguagem por papel e glossário.
O link “Ajuda desta tela” leva à seção do módulo atual. OWNER/ADMIN acessam
`/ajuda/prontidao` para métricas e confirmação explícita de etapas.

Organização → usuários/papéis → primeiro projeto → importação validada → primeira
viabilidade → Base Aprovada → rito executivo → integração local → suporte/recuperação
→ aceite local. Cadastros administrativos são assistidos pelos procedimentos existentes;
esta entrega não cria signup público, convite por e-mail real ou provisionamento cloud.

As confirmações de organização, qualidade da importação, rito e suporte são declarações
humanas auditadas. Projeto, estudo, base aprovada e integração local exigem também
existência verificável no banco. Existência não prova qualidade: o operador deve revisar
conteúdo e guardar a evidência do ensaio antes de confirmar. Aceite local exige todos os
passos e nunca altera `productionReady=false`.

## Sucesso, conversão e expansão

Critérios propostos, a pactuar no kickoff: todos os usuários previstos com acesso correto;
primeiro projeto e viabilidade revisados; Base Aprovada rastreável; dados importados sem
divergência material não resolvida; pelo menos quatro ritos registrados; ações críticas
com dono e prazo; nenhum achado alto/crítico aberto; recuperação local validada; aceite
explícito dos responsáveis. Metas de produtividade e financeiras devem usar baseline
do cliente, não números inventados por esta entrega.

Conversão exige evidência de uso e benefício, escopo de operação e suporte contratado,
revisão de riscos e aprovação comercial humana. Expansão para novos projetos/usuários
exige nova matriz de acesso, capacidade e qualidade de dados. Dependência externa não
comprovada permanece NO-GO para aquela operação, mesmo com aceite local.

## Encerramento ou reversão

Registre a decisão e responsáveis; pause integrações e entradas; drene filas; revogue
sessões e acessos pelo fluxo autorizado; exporte somente dados permitidos e registre
destinatário e finalidade; preserve evidências sujeitas a retenção; descarte dados
somente pelo procedimento aprovado. Nunca apague organização ou evidência imutável
para “limpar o piloto”. Confirme entrega/retorno dos dados, retenção e encerramento do
suporte em ata. Reversão técnica segue o runbook, sem restore sobre banco principal.
