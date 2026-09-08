# Fase 9P.5 — ERP e CRM locais

## Fonte e limite do checkpoint

Escopo baseado no Relatório Mestre atualizado em 05/09/2026, Apêndice D,
páginas 15–17, no plano 9H e nos contratos 9P.3A–9P.4. A fase prepara
comparação e revisão de dados externos contra os domínios existentes da REDE.
Os sistemas citados no roadmap não representam escolha de fornecedor do piloto.
Não há credenciais, chamadas externas ou evidência REAL neste checkpoint.

Budget, EconomicItem e contratos aprovados continuam sendo fontes oficiais.
Mesmo uma revisão local aprovada não altera esses registros: PROPOSE_REVISION
registra uma proposta e exige o fluxo próprio do domínio para qualquer alteração.
Não são criados novos domínios de ERP, CRM ou oportunidade comercial.

## Contratos e projeções

`ENTERPRISE_LOCAL_V1` registra um conector com provider UNASSIGNED, autenticação
NONE, direção INBOUND e capacidade ERP ou CRM. `sourceKey` identifica uma origem
lógica local; sua associação futura a um fornecedor exige contrato próprio.

| Projeção existente | Campos comparados |
| --- | --- |
| COMPANY | status |
| PROJECT | status, currency |
| COST_CENTER | code, status |
| SUPPLIER, CUSTOMER | status |
| BUDGET | status, version, currency, totalBudget |
| ECONOMIC_ITEM | code, unit |
| OPERATIONAL_CONTRACT | status, currency, originalAmount |
| MEASUREMENT | status, version, grossAmount, netAmount |
| FINANCIAL_OBLIGATION | status, amount |
| ACCOUNTING_ENTRY | status, totalDebit, totalCredit |
| LEAD | stage |
| SALES_PROPOSAL | status, proposedPrice |
| SALES_UNIT | code, status |
| SALE, SALES_CONTRACT | status, version, soldPrice |

ERP aceita as projeções acima exceto LEAD e SALES_PROPOSAL. CRM aceita LEAD,
CUSTOMER, SALES_PROPOSAL, SALES_UNIT, SALE e SALES_CONTRACT. O fluxo comercial
utiliza SalesLead e SalesProposal existentes; não inventa uma entidade Opportunity.
As projeções são mínimas: não importam cadastros completos nem nomes, documentos,
contatos ou dados bancários. Identificadores e versões externos são opacos e limitados.
Valores monetários são strings decimais fixas; campos desconhecidos são rejeitados.

## Modos, acesso e execução

- DISABLED inicia pausado e bloqueia sincronização.
- MOCK usa transporte interno injetável LOCAL_SIMULATION; o transporte padrão
  retorna uma página vazia, sem sockets. Apenas código servidor injeta transportes.
- REAL permanece fail-closed antes do transporte. Não existe sinalizador público
  que contorne a ausência de configuração e validação comprovadas.

As server actions autenticam a sessão. Os serviços revalidam usuário e vínculo
ativos, papel persistido, capacidade de integração e permissão do domínio.
Instalações, jobs, referências, evidências e leituras têm escopo por organização.
Entidades de projeto também exigem o projeto da instalação; empresa precisa ser
a empresa desse projeto. Fornecedores e clientes pertencem à organização.

Configuração e expurgo exigem INTEGRATION_CONFIGURE; sincronização exige
INTEGRATION_SYNC; vínculo e revisão exigem INTEGRATION_APPROVE; leitura de
conteúdo exige INTEGRATION_AUDIT e acesso ao domínio. Retentativa exige
INTEGRATION_RETRY e revalidação do autor original. Revogação não é ignorada
pelo worker. As operações relevantes geram AuditLog sem conteúdo externo bruto.

## Crosswalk, fila e revisão

ExternalEntityReference recebe namespace opcional, preservando referências antigas.
Há unicidade por tenant, origem lógica, tipo e identificador externo protegido
por HMAC. O vínculo é explícito, imutável e pertence à instalação que o criou;
outra instalação não o reaproveita silenciosamente. Não há fusão aproximada.

A fila durável existente executa ENTERPRISE_SYNC. Chaves de idempotência são
isoladas por tenant e instalação, com fingerprint do pedido. A configuração é
congelada por hash no job; mudanças impedem executá-lo silenciosamente. Lease,
tentativa e estado são conferidos antes de gravar resultados ou falhas.

Cada execução aceita até dez páginas de cem itens, detecta ciclos e possui sinal
de cancelamento de dez segundos e transação limitada a quinze segundos. O transporte
local deve respeitar o sinal. O limite configurável de 1–60 por minuto conta
execuções locais concluídas, não chamadas físicas a APIs. Páginas, cursor, evidências,
contador e conclusão do job são atômicos. Uma falha não publica progresso parcial.

Item sem vínculo ou versão externa reutilizada com conteúdo diferente gera
quarentena cifrada e dead-letter. Um operador autorizado pode consultar a quarentena,
criar o vínculo e pedir nova execução; não ocorre aplicação automática. Falhas
transitórias classificadas usam backoff e no máximo cinco tentativas. Dead-letter
e retentativas são auditados; erros arbitrários não são persistidos literalmente.

Snapshots reutilizam evidência apenas quando versão e conteúdo são iguais.
Uma nova versão cria nova evidência. Divergências criam IntegrationConflict com
MANUAL_REVIEW. PROPOSE_REVISION e REJECT são decisões imutáveis e idempotentes.
Revisão de projeção local alterada é recusada. O caminho genérico de resolução
não pode contornar a decisão específica exigida pelo banco.

## Evidência e retenção

EnterpriseSyncEvidence e EnterpriseEvidenceReview têm guards no PostgreSQL para
escopo, imutabilidade e retenção. Atualização e truncamento são bloqueados;
remoção só é permitida depois da expiração. Contexto da instalação, job e
crosswalk não pode ser trocado para deslocar evidência entre tenants.

Payloads e cursores usam AES-256-GCM com AAD próprio. Identidade e conteúdo usam
HMAC; nenhuma chave substituta é gerada quando INTEGRATION_SECRET_KEY está ausente
ou curta. Essa é uma chave local de aplicação, não uma credencial de API.
Evidências e quarentenas expiram em 1–180 dias. Leituras de conteúdo expirado são
bloqueadas; o expurgo explícito e auditado processa lotes de até cem de cada tipo.
O crosswalk retém identificadores protegidos para preservar identidade durável.

## Pendências e limites operacionais

Seleção dos sistemas de piloto, protocolos, webhooks/Inbox reais, credenciais,
adaptação de campos, consentimentos e smokes REAL ficam para a campanha final.
Não há interface visual nova ou execução em sistemas externos nesta fase.
Rotação da chave requer estratégia de migração dos dados cifrados e HMACs;
não se deve trocar a chave e presumir recuperação automática dos vínculos.
Agendamento operacional de expurgo e política final de retenção também precisam
ser definidos na implantação. Administradores capazes de remover triggers estão
fora da proteção contra mutações ordinárias oferecida por esses guards.

A migration aditiva e o backup restaurado estão registrados em
`PHASE_9P5_AUDIT_RECORD.md`. Nenhuma migration antiga foi editada.
