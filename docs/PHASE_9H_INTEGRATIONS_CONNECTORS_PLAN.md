# REDE Intelligence — Plano técnico da Fase 9H

## Central de Integrações, conectores e sincronização

> Documento de planejamento. Nenhum schema, migration, seed, serviço, API, conector, componente ou teste foi implementado nesta preparação.

## 1. Objetivo

A Fase 9H deve permitir que o REDE Intelligence consuma e distribua dados sem recadastro, duplicação ou perda de proveniência. O REDE não será automaticamente o sistema mestre de tudo: ele será a camada central de inteligência, integração, controle e decisão entre sistemas especializados.

```text
Fonte externa ou REDE
→ receber e preservar identidade
→ validar
→ normalizar
→ mapear
→ resolver entidade
→ validar regra de negócio
→ aplicar automaticamente ou solicitar aprovação
→ auditar, medir saúde e permitir replay
```

Princípio operacional:

```text
informação nasce uma vez
→ ownership declarado
→ sincronização versionada
→ efeito idempotente
→ proveniência verificável
```

## 2. Base e estado real analisado

Análise realizada na branch `planning/fase-9h-integracoes-conectores`, baseada no tag `rede-phase-9d-complete-2026-08-21`, commit `93a3cfaf0ca86760e2261193aa1cbaf909ad9ff4`.

### 2.1 Reuso confirmado

| Capacidade atual | Evidência | Reuso na 9H |
|---|---|---|
| Multiempresa | `Organization`, `EconomicGroup`, `Company`, `Project` e filtros por `organizationId` | Escopo e isolamento das instalações |
| Autenticação | sessão com token aleatório armazenado como hash | Identidade do operador; não serve para segredo de provedor |
| RBAC | `MembershipRole` e `ApprovalPolicy` | Base para capabilities e aprovações de integração |
| Auditoria | `AuditLog` com ator, entidade, antes/depois e metadados | Registro de configuração, replay, conflito e aplicação |
| Banco | `BankingAdapter` | Contrato inicial de saldo, sync incremental, cursor e webhook opcional |
| Importação | parser CSV bancário com validação por linha | Padrão para importador universal assistido |
| Idempotência bancária | `externalId`, `importBatchId`, checksum único por conta | Deduplicação de transações |
| Eventos internos | `FinancialIntegrationEvent` e `LegalFinancialEvent` | Padrão de source/version/checksum/status/retry |
| Storage | `FileStorageProvider` e `LocalPrivateFileStorage` | Porta inicial a generalizar para documentos externos |
| Documentos | `ProjectDocument`, `DesignFile`, `ProcurementDocumentLink` | Versão, checksum, referência e confidencialidade |
| BIM | pacote, revisão, arquivo, `BimModel` e IFC | Núcleo técnico interno e proveniência de modelos |
| Município | `MunicipalityAdapter`, resultados parciais/manuais e fontes | Contrato especializado sem assumir disponibilidade de API |
| IA | ferramentas com modos, papéis e evidências | Consultas estruturadas da Central, sem operação autônoma |

### 2.2 Comportamentos reais úteis

- `BankingAdapter` não persiste diretamente: normaliza transações para o serviço financeiro aplicar idempotentemente.
- O contrato bancário já prevê cursor incremental e webhook opcional.
- CSV bancário aceita/rejeita cada linha sem derrubar o arquivo inteiro.
- A importação cria checksum e retorna quantidade criada/duplicada.
- O storage privado calcula SHA-256, usa chave opaca e protege contra traversal.
- Documentos e arquivos técnicos preservam checksum e versões.
- Adapters municipais retornam `FOUND`, `PARTIAL`, `MANUAL_REQUIRED` ou `UNAVAILABLE`, com fontes e alertas.
- Eventos 9C→9B e 9D→9B já possuem idempotency key, checksum, estado e erro.

### 2.3 Lacunas

Não existem hoje:

- catálogo comum de conectores e instalações;
- secret manager ou armazenamento criptografado de credenciais;
- grants OAuth, rotação e revogação;
- referência externa genérica entre entidades;
- ownership e conflito por campo;
- inbox/outbox genéricos e catálogo formal de eventos;
- scheduler, worker e fila durável fora do processo Next.js;
- retry/backoff/dead-letter comuns;
- staging, quarentena e replay genéricos;
- runs e itens de sincronização;
- observabilidade, freshness, backlog ou health score de integrações;
- API pública e webhooks de saída do REDE;
- Central de Integrações.

O `FinancialIntegrationEvent` atual é específico da integração financeira. Não deve ser transformado à força em barramento universal; a 9H cria uma camada genérica que entrega comandos aos serviços donos dos domínios.

### 2.4 Planos futuros consultados

- 9E: vendas, unidades, clientes e recebíveis; propõe integração idempotente com 9B e external IDs para CRM/ERP.
- 9F: pessoas e eficiência; prevê portas para custos, comercial e contabilidade, com LGPD reforçada.
- 9G: eventos contábeis, importação/exportação de razão, ERP externo, fiscal e controladoria.

Esses contratos serão versionados na 9H e integrados somente após seus schemas finais estarem congelados.

## 3. Source of truth e ownership

### 3.1 Registro formal

Cada fluxo deve possuir `DataOwnershipPolicy` versionada com:

- domínio, entidade e campo/padrão de campo;
- sistema mestre;
- sistemas de origem permitidos;
- consumidores;
- direção: `INBOUND`, `OUTBOUND` ou `BIDIRECTIONAL`;
- risco da alteração;
- política de conflito;
- validade temporal e aprovadores.

Não existe regra global “REDE vence” ou “externo vence”. Ownership pode ser por campo.

### 3.2 Matriz inicial recomendada

| Dado | Mestre recomendado | Consumidores/direção | Observação |
|---|---|---|---|
| Base Aprovada, decisões, riscos e aprovações | REDE | saída controlada | Versões imutáveis |
| Orçamento e cronograma | Configurável por projeto | uni ou bidirecional com ERP | Um mestre por versão/período |
| Transação e saldo bancário | Banco/agregador | entrada | REDE concilia e enriquece |
| AP/AR operacional nativo | REDE 9B | saída para ERP, se adotado | Se ERP for mestre, REDE importa e compara |
| Escrituração fiscal/contábil oficial | ERP/escritório, salvo decisão explícita | entrada/saída conforme 9G | REDE controla e reconcilia |
| CNPJ/razão social do fornecedor | ERP/cadastro corporativo | entrada | Qualificação/performance continuam no REDE |
| Qualificação de fornecedor | REDE | saída opcional | Campo-level ownership |
| Arquivo técnico/revisão | CDE ou REDE Design conforme projeto | entrada/saída explícita | IFC permanece formato aberto |
| Análises BIM e conflitos | REDE | saída opcional | Derivados do modelo técnico |
| Arquivo no Drive | Drive quando apenas referenciado | metadados no REDE | Cópia somente por política |
| Classificação e workflow documental | REDE | saída opcional | Não depende da pasta física |
| Dados oficiais municipais/cartoriais | órgão/fonte oficial | entrada como snapshot | REDE preserva data e evidência |
| Unidade, venda e contrato | REDE 9E ou CRM/ERP definido por empreendimento | política por fluxo | Nunca dois mestres simultâneos |
| Pessoa/folha | RH/folha externo | entrada agregada | 9F controla vínculo/análise conforme política |
| Inteligência, score e recomendações | REDE | saída controlada | Não sobrescreve fonte operacional |

### 3.3 Conflitos

Políticas possíveis:

- `EXTERNAL_WINS`;
- `REDE_WINS`;
- `NEWEST_WINS`, somente com relógios confiáveis;
- `MANUAL_REVIEW`;
- `FIELD_OWNER_WINS`;
- `MERGE_BY_RULE`, apenas para coleções compatíveis.

Toda resolução registra valor local, externo, timestamps, política, decisão, ator e efeito. Alteração de alto risco nunca é sobrescrita silenciosamente.

## 4. Arquitetura da plataforma

```text
Connector Registry
  └─ definição e capabilities
       └─ instalação escopada
            ├─ referência de credencial
            ├─ ownership/mappings
            ├─ cursores e subscriptions
            └─ política de sync/freshness

Ingress: webhook | polling | arquivo | chamada manual
  → Inbox / Staging
  → Validate → Normalize → Map → Resolve Identity
  → Quarantine ou Business Validation
  → Auto Apply / Human Approval
  → Serviço de domínio
  → Audit + External Reference + Outbox

Worker durável
  → fila → retry/backoff → DLQ → replay
```

Componentes propostos:

- `connector-registry`: tipos, capabilities, versões e documentação;
- `integration-control-plane`: instalações, escopos, credenciais e políticas;
- `integration-runtime`: inbox/outbox, jobs, filas, sync runs e rate limit;
- `mapping-identity`: referências, matching, transformação e conflitos;
- `integration-observability`: saúde, freshness, logs e alertas;
- `integration-adapters`: implementações isoladas por provedor;
- `integration-center`: interface administrativa e operacional.

## 5. Modelo conceitual

### 5.1 Definição e instalação

| Entidade proposta | Responsabilidade |
|---|---|
| `ConnectorDefinition` | Tipo de conector: provedor, versão, categoria, auth e documentação |
| `ConnectorCapability` | Operação suportada: documentos, fornecedores, transações etc. |
| `ConnectorInstallation` | Conexão específica de um tenant/escopo com estado e configuração não secreta |
| `IntegrationScopeBinding` | Grupo, empresa, projeto e capability autorizados |
| `CredentialReference` | Referência opaca ao secret manager e metadados, nunca o segredo |
| `OAuthGrantMetadata` | scopes, consentimento, expiração, subject e estado; tokens ficam no cofre |

`ConnectorDefinition` responde “o que é Google Drive”; `ConnectorInstallation` responde “qual é o Drive da SPE START BUTANTÃ”. Uma definição pode ter muitas instalações.

### 5.2 Identidade e mapeamento

| Entidade proposta | Responsabilidade |
|---|---|
| `ExternalEntityReference` | Relação provider/external ID ↔ entidade REDE |
| `DataOwnershipPolicy` | Mestre e conflito por domínio/campo |
| `MappingProfile` | Versão de mapeamentos por instalação/capability |
| `FieldMappingRule` | Campo, enum, código, transformação e validação |
| `IdentityResolutionRule` | Critérios determinísticos de matching |
| `IntegrationConflict` | Valores concorrentes, política, decisão e status |

Unicidade mínima da referência: instalação + tipo externo + external ID. Uma referência sempre inclui tenant e, quando aplicável, empresa/projeto.

### 5.3 Execução

| Entidade proposta | Responsabilidade |
|---|---|
| `IntegrationInboxEvent` | Evento recebido, assinatura, deduplicação e estado |
| `IntegrationOutboxEvent` | Evento REDE a entregar depois do commit de domínio |
| `IntegrationSyncRun` | Execução manual/agendada/webhook/full/replay |
| `IntegrationSyncItem` | Objeto processado, ação, entidade, resultado e erro |
| `IntegrationCursor` | Cursor/checkpoint por installation + capability + partition |
| `IntegrationJob` | Trabalho durável com prioridade, tentativas e agendamento |
| `IntegrationDeadLetter` | Falha terminal preservada para diagnóstico/replay |
| `IntegrationQuarantineItem` | Payload inválido ou identidade não resolvida |
| `IntegrationHealthSnapshot` | disponibilidade, latência, erro, freshness e backlog |

Payload bruto, quando necessário, deve ficar em storage criptografado com checksum e retenção; o banco guarda referência e metadados seguros.

## 6. Contrato comum de connector

Interface conceitual:

```ts
interface IntegrationConnector {
  definition: ConnectorDescriptor;
  capabilities(): ConnectorCapabilityDescriptor[];
  validateConfiguration(context): Promise<ValidationResult>;
  healthCheck(context): Promise<ProviderHealth>;
  pull(request: PullRequest): Promise<PullPage>;
  push?(request: PushRequest): Promise<PushResult>;
  handleWebhook?(request: VerifiedWebhook): Promise<NormalizedExternalEvent[]>;
  testConnection(context): Promise<TestConnectionResult>;
}
```

O adapter normaliza dados e não persiste diretamente no domínio. O runtime controla credenciais, timeout, rate limit, retry, métricas e auditoria; o serviço dono do domínio valida e aplica.

Cada definição declara:

- objetivo, owner e provider;
- versão do adapter e contrato;
- capabilities e direções;
- autenticação/scopes;
- dados lidos/escritos;
- source of truth esperado;
- frequência/SLA/freshness;
- limites, paginação e webhooks;
- erros conhecidos e sandbox;
- política de depreciação.

## 7. Credenciais e autenticação externa

### 7.1 Segredos

Tokens, senhas, API keys, certificados e private keys nunca entram em Prisma, logs, payloads de auditoria ou variáveis exibidas pela UI.

Estratégia:

- produção: cofre gerenciado com KMS/HSM quando disponível;
- desenvolvimento: provider local seguro, fora do repositório;
- banco: apenas `secretRef`, versão, fingerprint não reversível, expiração e estado;
- acesso just-in-time pelo worker, com least privilege;
- rotação cria nova versão e revoga a anterior;
- cache de segredo curto e nunca persistido em disco/log.

### 7.2 OAuth2

Suportar Authorization Code + PKCE para usuário e Client Credentials quando cabível. Registrar consentimento, subject, tenant externo, scopes, expiração, última renovação e revogação. Access/refresh tokens permanecem no cofre.

Estados: `PENDING_CONSENT`, `ACTIVE`, `EXPIRING`, `EXPIRED`, `REVOKED`, `ERROR`. Scope insuficiente não dispara loop de retry: exige nova autorização.

### 7.3 Service accounts, API keys e certificados

Cada método declara finalidade, emissor, escopo, validade, rotação e restrição por IP quando o provedor suportar. Certificados têm alerta antecipado e cadeia validada. Chaves de API não aparecem após cadastro.

## 8. Motor de sincronização

Modos:

- manual;
- agendado;
- webhook;
- incremental;
- full sync controlado;
- replay de evento/run/item.

Direção sempre explícita: `INBOUND`, `OUTBOUND`, `BIDIRECTIONAL`. Bidirecional significa dois fluxos independentes, cada um com ownership, mapping e idempotência próprios.

### 8.1 Pipeline

```text
Raw External Data
→ validação estrutural
→ normalização canônica
→ mapping versionado
→ resolução de identidade
→ validação de negócio pelo domínio
→ classificação de risco
→ aplicar ou aguardar aprovação
→ referência externa + auditoria + métricas
```

Cada item preserva versão do connector, schema, mapping e política usados.

### 8.2 Semântica de entrega

A plataforma assume entrega “pelo menos uma vez”. O efeito de domínio é “uma vez” por idempotência transacional. Não prometer exactly-once distribuído.

Chave recomendada:

```text
organization + installation + capability
+ providerEventId/externalId + eventType + externalVersion
```

Se o provider não oferece ID confiável, usar fingerprint canônico/checksum com janela e regra documentada.

## 9. Webhooks

Fluxo seguro:

1. capturar corpo bruto com limite de tamanho;
2. localizar instalação sem expor segredo;
3. validar assinatura em tempo constante;
4. validar timestamp/janela e nonce quando disponível;
5. persistir inbox/deduplicação antes de processamento assíncrono;
6. responder rapidamente conforme SLA do provider;
7. processar no worker;
8. retry/DLQ/replay com a mesma identidade.

Assinatura inválida é rejeitada e auditada sem guardar payload sensível desnecessário. Rotação aceita duas versões de segredo por janela curta. Eventos fora de ordem usam versão/cursor e política explícita.

## 10. Polling e cursores

Quando não houver webhook:

- cursor opaco preferencial;
- fallback para `updatedSince` com janela de sobreposição;
- paginação e limite por run;
- checkpoint somente após página aplicada;
- cursor separado por instalação, capability e partição;
- full reconciliation periódico para detectar perdas;
- proteção contra cursor inválido/expirado.

Replay nunca avança o cursor oficial até validação completa.

## 11. Jobs, filas e workers

Integrações críticas não rodam exclusivamente dentro do processo web Next.js. Arquitetura:

- API/UI apenas agenda e consulta;
- worker dedicado consome jobs duráveis;
- `JobQueuePort` desacopla tecnologia;
- outbox transacional garante publicação após commit;
- leases/heartbeats evitam jobs presos;
- cancelamento cooperativo e timeout por capability;
- prioridade para webhooks críticos, normal para sync e baixa para full/replay.

Escolha tecnológica é gate da 9H.1. Uma fila persistente baseada em PostgreSQL pode reduzir infraestrutura no início; Redis/serviço gerenciado pode ser adotado quando volume/SLA justificar. O contrato não depende do fornecedor.

Retry usa backoff exponencial com jitter e respeita `Retry-After`. Erros permanentes não são repetidos. DLQ preserva contexto sem segredo e permite replay autorizado.

## 12. Rate limit, circuit breaker e resiliência

Rate limit por provider, instalação, credential e capability:

- token bucket/leaky bucket conforme contrato;
- quotas por minuto/dia;
- concorrência máxima;
- orçamento de requests e resposta a `429`;
- batching quando suportado.

Circuit breaker: `CLOSED → OPEN → HALF_OPEN → CLOSED`. Falha do provider não derruba REDE nem apaga dados já sincronizados. A Central mostra indisponibilidade, backlog e última versão confiável.

Caso provider fique fora por 8 horas: jobs aguardam/backoff, domínio interno segue operacional, dados ficam marcados como desatualizados e o sync retoma do checkpoint.

## 13. Erros, quarentena e reprocessamento

Classificação:

- autenticação/credencial;
- autorização/scope;
- rate limit/quota;
- rede/timeout;
- provider indisponível;
- schema/validação;
- mapping;
- identidade/duplicata;
- conflito;
- regra de negócio;
- storage/documento;
- erro interno.

Dados inválidos vão para quarentena, não para tabelas de domínio. Usuário autorizado pode revisar payload seguro, corrigir mapping/configuração, simular o reprocessamento e executar replay com a mesma idempotency key. Correção manual registra justificativa e versão.

## 14. Identidade externa e deduplicação

Resolução em camadas:

1. `ExternalEntityReference` exata;
2. identificador legal/canônico validado, como CNPJ;
3. regra composta configurada;
4. candidatos com score explicável;
5. revisão humana;
6. criação, apenas se a política permitir.

Caso fornecedor já exista e ERP envie o mesmo CNPJ: vincular referência externa ao fornecedor existente; nunca criar duplicata automaticamente. Match aproximado nunca aplica merge destrutivo.

Webhooks duplicados resolvem para um inbox/evento econômico. Uma constraint única e transação protegem contra concorrência.

## 15. Proveniência, raw payload e freshness

Todo dado externo aplicado registra:

- provider/installation/capability;
- ID e versão externos;
- sync run/item/evento;
- data de ocorrência, captura e aplicação;
- mapping/política/connector version;
- checksum;
- confiança quando derivado;
- referência ao payload/evidência.

Raw payload é preservado somente quando necessário para auditoria, debugging ou replay, em storage criptografado, com redaction, limite de tamanho e retenção por categoria. Payload com PII não entra em logs ou IA.

Freshness é política por tipo de dado, não um prazo universal. Exemplos: saldo bancário pode exigir minutos; IPTU pode aceitar meses. A interface mostra “atualizado em”, “válido até” e “stale desde”.

## 16. Mapeamento e transformação

`MappingProfile` versionado cobre:

- campos e tipos;
- enums/status;
- códigos de projeto/empresa/centro/conta;
- fornecedores/clientes;
- unidades e produtos;
- datas, moeda, unidade de medida e timezone;
- valores default explicitamente autorizados.

Transformações devem ser determinísticas, testáveis e sem código arbitrário fornecido pelo usuário. Nova versão passa por preview/diff e aprovação. Alterar mapping não reprocessa história automaticamente.

## 17. Automação segura e aprovação humana

Risco configurável por capability/ação:

- baixo: leitura de saldo ou novo documento referenciado → aplicação automática;
- médio: atualização cadastral não crítica → regra e eventual amostragem;
- alto: preço, contrato, pagamento, lançamento, aprovação ou alteração de Base → sugestão, revisão e aprovação.

```text
External Data → Suggestion → Review → ApprovalPolicy → Apply
```

Reutilizar `ApprovalPolicy`, estendendo atos somente em migration futura. Quem configura mapping/credencial não aprova necessariamente o efeito de alto risco.

## 18. Google Drive — primeira prioridade

### 18.1 Capabilities

- listar drives/pastas e mudanças;
- referenciar arquivos e versões;
- importar metadados/checksum quando permitido;
- vincular documentos a grupo, empresa, projeto e entidades;
- detectar nova versão;
- exportar documento do REDE apenas em fluxo autorizado;
- respeitar permissões e arquivos compartilhados.

### 18.2 Referência versus cópia

**Referenciar** quando Drive é mestre, acesso é estável e retenção do REDE não exige custódia. Guardar external ID, version ID, web URL segura, mime, tamanho, checksum/etag, modifiedAt e provenance.

**Copiar** quando necessário para snapshot imutável, obrigação legal, processamento BIM/IA, assinatura/checksum independente, preservação após revogação ou política de Data Room. Cópia usa storage privado e registra vínculo com a versão externa.

Não copiar por padrão. Não armazenar link público. Download acontece server-side com autorização vigente.

### 18.3 Organização

Metadados REDE modelam Grupo → Empresa → Empreendimento → categoria → documento. Pastas físicas podem ser sugeridas, mas não são obrigatórias; um arquivo pode ser classificado sem mover a pasta do cliente.

Google Drive deve usar changes/delta token quando disponível, OAuth com scopes mínimos e webhook apenas como sinal para buscar mudanças. Nova versão de projeto cria nova versão/revisão no REDE; a anterior permanece íntegra.

## 19. OneDrive e SharePoint

Mesmo contrato documental, adapter Microsoft Graph:

- drive/site/library/item/version IDs;
- delta query e subscriptions com renovação;
- permissões de site/application conforme política;
- referência versus cópia idêntica ao Drive;
- tratamento de rename/move sem perder identidade do item.

Não modelar SharePoint como pastas do Google. Diferenças ficam dentro do adapter.

## 20. ERPs: Sienge, Mega, TOTVS e SAP

### 20.1 Sienge

Capabilities futuras por contrato independente:

- cadastros: empresas, projetos, centros, fornecedores/clientes;
- orçamento e obra;
- compras, contratos e medições;
- AP/AR e financeiro;
- contábil/fiscal após 9G.

Source of truth deve ser decidido por domínio e cliente. Exemplo recomendável: Sienge mestre de escrituração/financeiro quando já operado; REDE mestre da Base, decisões, riscos e inteligência. Shadow sync e reconciliação precedem qualquer escrita.

### 20.2 Mega, TOTVS e SAP

Adapters implementam o mesmo contrato canônico, sem campos de fornecedor vazando para o domínio. Mappings tratam company/project/cost center/account/vendor codes. Cada capability pode ser ativada separadamente.

## 21. Construmanager e CDEs

Construmanager: documentos técnicos, projetos, revisões, aprovações e evidências de obra. External references ligam pacote/revisão/arquivo sem duplicar a verdade técnica.

CDEs Autodesk Construction Cloud/BIM 360, Trimble e Bentley:

- modelo, revisão, issue/clash e documento;
- delta/version ID e permissões;
- download controlado para processamento;
- vínculo ao `DesignProjectPackage`, `DesignRevision` e `BimModel`.

IFC continua formato aberto prioritário. O núcleo BIM não depende de API proprietária para existir.

## 22. CRM e portais imobiliários

Adapters para CV CRM, RD Station, Salesforce, HubSpot e outros devem usar fluxo canônico:

```text
Lead → Opportunity → Customer → SalesUnit → Sale
```

Após freeze da 9E, referências externas ligam entidades sem duplicar cliente/venda. Ownership por etapa/campo: CRM pode ser mestre do lead; REDE/ERP pode ser mestre de unidade, preço aprovado, contrato e recebível.

Portais futuros recebem estoque/preço/disponibilidade somente de snapshot aprovado e enviam leads. Alteração de preço nunca entra automaticamente sem alçada.

## 23. Bancos, OFX, CNAB e Open Finance

Evoluir o `BankingAdapter` existente, não substituí-lo:

- saldo, extrato e transações;
- Pix, boleto e cobrança como capabilities futuras independentes;
- webhooks normalizados;
- external account reference e cursor;
- entrega ao `importBankTransactions` idempotente.

Adapters de arquivo:

- OFX;
- CNAB 240/400 de retorno/remessa;
- CSV versionado.

Parsing é isolado, com preview, relatório por registro e checksum. Open Finance registra instituição, consentimento, scopes, validade e revogação; expiração interrompe sync e alerta, sem apagar dados nem entrar em loop.

Pix/boleto reais e iniciação de pagamento ficam posteriores e exigem segurança/transação/alçada próprias.

## 24. Prefeituras, cartórios e ambiental

### 24.1 Prefeituras

Evoluir `MunicipalityAdapter` para capabilities independentes: cadastro imobiliário, IPTU, zoneamento, processos, alvarás, NFS-e e taxas. Manter `MANUAL_REQUIRED` como resultado legítimo; não fingir API inexistente.

### 24.2 Cartórios

Matrícula, certidão, protocolo, averbação e registro. Quando não houver API: workflow assistido, upload, operador, validação humana, data da consulta e evidência. OCR/IA gera sugestão, não verdade registral.

### 24.3 Órgãos ambientais

Licenças, processos e condicionantes com external IDs, status, validade e fonte. A 9D permanece dona da obrigação/alerta jurídico; o connector apenas sincroniza evidência e estado oficial.

## 25. Receita, SEFAZ, fiscal e contabilidade

Adapters futuros consultam documentos/status e entregam à camada fiscal 9G. Transmissão não pertence à 9H inicial.

Contabilidade externa/ERP:

- exportar eventos, lançamentos, plano, centros, documentos e saldos;
- importar razão/balancete em staging;
- comparar e gerar divergências;
- nunca sobrescrever razão REDE automaticamente.

Contratos 9G são pré-requisito. Escritório/ERP pode ser sistema oficial e o REDE camada de conciliação/controladoria.

## 26. Pessoas e sistemas de RH

Após freeze da 9F, connectors de folha, RH, ponto e ERP entregam vínculos/custos agregados autorizados. PII e remuneração têm scopes, retention e auditoria próprios. Não implementar folha na 9H.

## 27. Importador universal

Arquivos suportados conceitualmente: CSV, XLSX, JSON e XML.

Fluxo:

1. upload seguro e antivírus quando disponível;
2. detecção de formato/encoding e limites;
3. preview amostral;
4. mapping assistido e versionado;
5. validação estrutural e de domínio;
6. relatório de aceitos/rejeitados/conflitos;
7. aprovação quando necessária;
8. importação parcial controlada e idempotente;
9. lote, checksum e auditoria.

Proteções: limite de linhas/tamanho, CSV injection em exportação, zip bomb em XLSX, XXE em XML, fórmulas não executadas e parsing no worker. Parcial significa somente linhas independentes válidas; agregados transacionais aplicam tudo ou nada.

## 28. Exportação

CSV, XLSX e JSON/API respeitam tenant, escopo, capability e redaction. Exports grandes são jobs assíncronos, versionados, com checksum, validade curta e storage privado. Nunca incluir segredo; fórmulas perigosas em CSV/XLSX são escapadas.

## 29. API pública REDE

Planejamento futuro:

- versionamento por URL/header e política de depreciação;
- OAuth2 client credentials ou API keys com hash/rotação;
- scopes por domínio/ação/empresa/projeto;
- rate limit e quota;
- idempotency key em mutações;
- paginação por cursor, filtros e data de corte;
- correlation/request ID;
- audit, schema OpenAPI e erros estáveis;
- sem acesso direto ao Prisma ou tabelas internas.

API chama os mesmos serviços de aplicação da UI.

## 30. Webhooks de saída REDE e catálogo de eventos

Eventos possíveis: `sale.created`, `payment.received`, `purchase.approved`, `legal.obligation.due`, `budget.approved` — somente após confirmação do owner e schema.

`EventCatalogEntry` declara nome, owner, versão, schema, classificação, PII, guarantees, ordenação e depreciação. Contratos evoluem `v1 → v2`; v1 permanece durante janela publicada.

`WebhookSubscription` define endpoint, scopes, eventos e secret reference. Entrega assina corpo, inclui event ID/timestamp, registra tentativa, retry/DLQ e permite replay. Consumidor deve tratar duplicidade.

Outbox é criada na mesma transação do fato de domínio, evitando evento sem commit ou commit sem evento.

## 31. Observabilidade e Central de Integrações

### 31.1 Logs e métricas

Logs estruturados incluem `correlationId`, `organizationId`, `installationId`, `syncRunId`, `jobId`, `eventId` e provider. Nunca incluem tokens, authorization headers ou payload pessoal bruto.

Métricas:

- sucesso/falha por capability;
- latência e duração;
- requests/quota/429;
- itens processados, ignorados, duplicados, conflitados e em quarentena;
- retry/DLQ/backlog;
- credential expiry;
- freshness e provider health.

### 31.2 Health score

Score técnico distinto do REDE Score do empreendimento. Componentes configuráveis: disponibilidade, taxa de sucesso, latência, freshness e backlog. Exibir decomposição; nunca usar um número opaco. Ausência de dados reduz confiança, não produz saúde perfeita.

### 31.3 Interface

Escopos: Grupo → Empresa/SPE → Empreendimento. Mostrar:

- connector/provider/capabilities/direção;
- status da instalação e credencial;
- última/próxima sincronização;
- freshness por domínio;
- volume e latência;
- erros, conflitos, quarentena, retries e DLQ;
- cursores/checkpoints;
- health score decomposto;
- ações autorizadas: testar, sincronizar, pausar, revisar, corrigir mapping e reprocessar.

Pausar não revoga automaticamente credenciais; revogar é ação separada e sensível. A interface segue a identidade visual atual e usa português.

## 32. REDE IA

Ferramentas somente leitura:

- `getIntegrationHealth`;
- `getStaleDataSources`;
- `getFailedSyncRuns`;
- `getIntegrationBacklog`;
- `getMappingConflicts`;
- `getQuarantinedItems`;
- `compareExternalAndRedeData`;
- `getNewExternalDocuments`;
- `getCredentialExpiryStatus`;
- `getConnectorFreshness`.

A IA consulta dados estruturados e evidências. Não lê secrets/raw payload sensível, não resolve conflito, não reprocessa, não muda mapping e não autoriza conexão.

## 33. Autopilot e Price Intelligence

A 9H prepara ingestores para BIM, histórico, fornecedores, compras, contratos, índices, fontes públicas e pesquisas externas.

`ExternalPriceObservation` conceitual:

- produto/serviço e especificação;
- região e data;
- quantidade/unidade;
- fornecedor/fonte;
- preço, frete e tributos conhecidos;
- validade e confiança;
- provider, URL/evidência, checksum e licença de uso;
- mapping para `EconomicItem` sem substituir o histórico.

Preço externo de R$ 100 e compra interna de R$ 82 coexistem como observações contextualizadas. O Autopilot compara e recomenda; não sobrescreve orçamento, preço ou compra e não compra autonomamente.

Pesquisa automatizada respeita termos de uso, robots/licenças, rate limit, evidência e revisão. Scraping indiscriminado fica proibido.

## 34. Segurança, LGPD e RBAC

### 34.1 Segurança

- least privilege e scopes mínimos;
- isolamento tenant/empresa/projeto;
- criptografia em trânsito e repouso;
- secret manager, rotação e revogação;
- validação SSRF para endpoints configuráveis;
- allowlist de hosts/IP quando aplicável;
- proteção contra replay/webhook forgery;
- limites de arquivo/payload e malware scanning;
- supply-chain review de SDKs;
- ambientes e credenciais separados por sandbox/produção;
- auditoria de acesso e mudança.

### 34.2 LGPD

- finalidade e base legal por fluxo;
- minimização de clientes, leads, pessoas, fornecedores e documentos;
- retenção diferenciada de raw payload, logs e referências;
- exclusão/anonimização quando aplicável sem quebrar obrigações legais;
- registro de processamento e operadores/suboperadores;
- redaction em logs, IA e suporte;
- localização/transferência internacional avaliada por provider;
- exportação e replay sob autorização.

### 34.3 Capabilities

Reutilizar RBAC existente e acrescentar:

- `INTEGRATION_VIEW`;
- `INTEGRATION_CONFIGURE`;
- `INTEGRATION_SYNC`;
- `INTEGRATION_RETRY`;
- `INTEGRATION_CREDENTIALS`;
- `INTEGRATION_APPROVE`;
- `INTEGRATION_AUDIT`;
- `INTEGRATION_EXPORT`;
- `INTEGRATION_API_MANAGE`.

Quem visualiza saúde não precisa ver/configurar credencial. Quem configura mapping não aprova mudança de alto risco. Escopos e `ApprovalPolicy` complementam `MembershipRole`.

## 35. Multiempresa e herança

Uma instalação pertence à organização e pode ser vinculada ao grupo, empresa, SPE, projeto ou combinação permitida. Regras:

- escopo filho nunca acessa irmão;
- instalação do grupo não se aplica a todas as empresas sem binding explícito;
- configuração pode herdar defaults, mas credencial/ownership pode ser sobrescrito apenas por autorização;
- cursores, referências e logs carregam o escopo efetivo;
- mover projeto/empresa não move referências externas silenciosamente;
- consultas agregadas respeitam autorização em cada nível.

## 36. Sandbox e mock connectors

Cada connector declara sandbox disponível, limitações e credenciais separadas. Nunca enviar dados reais pessoais ao sandbox sem base/autorização.

`MockConnector` e relógio/fila controláveis suportam testes determinísticos de páginas, duplicatas, 429, timeout, token expirado, eventos fora de ordem e indisponibilidade. Contract tests são comuns a todos os adapters.

## 37. Performance e escala

Projetar para milhares de instalações, milhões de itens e providers lentos:

- índices iniciados por `organizationId`/`installationId`, seguidos de status/data/external ID;
- inbox/outbox particionáveis por data após benchmark;
- paginação/cursor e processamento streaming;
- batches limitados e concorrência por provider;
- bulk upsert somente com idempotência e validação;
- retenção/arquivamento de payload e logs;
- read models da Central;
- backpressure e fairness entre tenants;
- evitar N+1 na resolução de identidades;
- métricas de memória, throughput e lag;
- grandes arquivos processados fora do web e sem carregar tudo em memória.

## 38. Testes futuros

### 38.1 Contrato e domínio

- connector definition/installation e capabilities;
- ownership/direção por campo;
- mapping, transformação e versões;
- external reference, matching e duplicata;
- idempotência concorrente e replay;
- conflito e aprovação;
- freshness/health score;
- herança/isolamento multiempresa.

### 38.2 Runtime

- webhook válido/inválido/repetido/fora de janela;
- polling, cursor, paginação e checkpoint;
- retry, jitter, `Retry-After`, DLQ e replay;
- rate limit e circuit breaker;
- worker crash/lease/heartbeat;
- token expirado/rotacionado/revogado;
- payload em quarentena;
- outbox após commit;
- provider indisponível por 8 horas.

### 38.3 Segurança

- cross-tenant/empresa/projeto;
- capabilities e segregação;
- segredo ausente em DB/log/erro/export;
- SSRF, signature replay, arquivo malicioso, zip bomb, XXE e CSV injection;
- LGPD, retenção e redaction.

### 38.4 Casos críticos

1. Fornecedor existente + mesmo CNPJ do ERP → uma entidade, nova referência.
2. Webhook duplicado → um efeito econômico.
3. Provider indisponível → REDE operacional, backlog retomado.
4. Token expirado → estado/alerta sem perda ou loop.
5. Nova versão no Drive → nova versão REDE, anterior preservada.
6. Mesmo campo alterado externamente/localmente → política de conflito, sem overwrite silencioso.
7. Dez mil transações bancárias → paginação, incremento, idempotência e métricas.
8. Preço externo versus interno → observações separadas e contextualizadas.

## 39. Sprints recomendadas

### 9H.0 — Contratos e Source of Truth

- catálogo de domínios/eventos/campos;
- ownership, direção, risco, conflito e freshness;
- revisão dos contratos finais 9E–9G;
- ADRs de fila, secret manager, inbox/outbox e storage.

**Saída:** nenhum fluxo sem owner, direção e política.

### 9H.1 — Core Integration Platform

- definition/capability/installation/scope;
- credential references/OAuth metadata;
- external references, mappings e conflitos;
- mock connector e contract tests.

**Saída:** conexão mock configurável sem segredo no banco.

### 9H.2 — Sync Engine

- worker, queue port, scheduler e jobs;
- inbox/outbox, cursor, runs/items;
- retries, rate limits, circuit breaker, DLQ e replay;
- staging/quarentena e observabilidade base.

**Saída:** duplicate/replay/outage/token expiry comprovados.

### 9H.3 — Arquivos e documentos

- contrato documental genérico;
- Google Drive como primeiro adapter real;
- referência versus cópia, versão, delta e permissionamento;
- OneDrive/SharePoint em contract/mock até priorização.

**Saída:** nova versão documental sincronizada sem perder anterior.

### 9H.4 — Importador universal e ERP/CRM/obra

- CSV/XLSX/JSON/XML assistidos;
- contratos Sienge, ERP, CRM e Construmanager/CDE;
- mappings e shadow reconciliation;
- primeiro adapter de negócio definido por discovery/API real.

**Saída:** importação segura e um fluxo externo reconciliado.

### 9H.5 — Bancos e órgãos

- evolução do `BankingAdapter`, OFX/CNAB e Open Finance selecionado;
- contratos municipais/cartoriais/ambientais/fiscais;
- workflows assistidos onde não houver API.

**Saída:** sync bancário paginado e adapter público com provenance.

### 9H.6 — Central de Integrações

- interface por grupo/empresa/projeto;
- saúde, freshness, backlog, conflitos, quarentena e credenciais;
- RBAC, auditoria e ações seguras.

**Saída:** operação ponta a ponta sem acesso ao banco/log bruto.

### 9H.7 — API, webhooks, REDE IA e Autopilot foundations

- API pública versionada e clients/scopes;
- catálogo/outbound webhooks;
- ferramentas IA de leitura;
- observações externas de preço e evidências;
- hardening, carga, rollout e documentação.

**Saída:** contratos públicos governados, sem automação financeira de alto risco.

## 40. Priorização prática de connectors

Critérios: benefício imediato, disponibilidade/estabilidade da API, segurança, volume, dependência de fases futuras, custo de suporte e risco de escrita.

| Prioridade | Connector/capability | Motivo e condição |
|---:|---|---|
| 1 | Google Drive | Alto benefício documental, leitura primeiro; validar API/OAuth do cliente |
| 2 | Importador CSV/XLSX | Resolve legado sem depender de API; segurança de arquivos obrigatória |
| 3 | Banking/Open Finance/OFX | `BankingAdapter` já existe; iniciar read-only/extratos |
| 4 | Sienge | Maior cobertura imobiliária; discovery e ownership por domínio antes |
| 5 | CRM selecionado | Depende do contrato final 9E; leads inbound primeiro |
| 6 | Construmanager/CDE | Aproveita Design/BIM; IFC segue fallback aberto |
| 7 | ERP contábil/escritório | Depende do contrato final 9G; importar/comparar antes de escrever |
| 8 | OneDrive/SharePoint | Mesmo valor documental; priorizar conforme base Microsoft dos clientes |
| 9 | Prefeituras/ambiental | APIs heterogêneas; combinar adapters e workflow assistido |
| 10 | Cartórios | Baixa padronização; evidência/upload humano inicialmente |
| 11 | Fontes de preços | Exige qualidade, licença, normalização e confiança |
| 12 | Portais imobiliários | Após política de estoque/preço e 9E estabilizada |

A ordem pode mudar após discovery de credenciais, contratos e API. Não iniciar todos simultaneamente.

## 41. Riscos e mitigação

| Risco | Consequência | Mitigação |
|---|---|---|
| REDE tratado como mestre universal | conflito/overwrite | ownership por domínio/campo |
| Segredo em banco/log | incidente grave | secret manager, redaction e testes |
| Persistência direta pelo adapter | regras contornadas | normalização + serviço de domínio |
| Webhook/polling duplicado | fatos duplicados | inbox e idempotência transacional |
| Job no Next.js | perda/timeout | worker e fila durável |
| Provider indisponível | cascata | circuit breaker, backlog e stale state |
| Mapping alterado silenciosamente | corrupção | versão, preview e aprovação |
| Matching aproximado automático | merge errado | candidatos e revisão humana |
| Bidirecional implícito | loop de sync | dois fluxos explícitos e origin marker |
| Payload bruto ilimitado | LGPD/custo | retenção, storage, limites e redaction |
| Conector específico vaza no domínio | lock-in | modelo canônico e adapters |
| Escopo multiempresa incorreto | vazamento | bindings explícitos e testes cross-tenant |
| Full sync pesado | indisponibilidade | cursor, batches, backpressure e janela |
| Score de saúde enganoso | falsa segurança | decomposição e confiança/freshness |
| Scraping indiscriminado | risco legal/técnico | fontes licenciadas, termos e evidência |
| Escopo de conectores simultâneos | fase interminável | prioridades e gates por sprint |

## 42. Itens posteriores

- todos os conectores reais simultaneamente;
- scraping indiscriminado;
- compra autônoma;
- Pix, boleto ou iniciação de pagamento reais;
- transmissão fiscal;
- assinatura automática de contratos;
- atualização automática de preço, contrato, pagamento, lançamento ou Base sem alçada;
- marketplace próprio;
- folha/RH completo;
- emissão fiscal;
- sync bidirecional de alto risco antes de shadow/reconciliação;
- automação Autopilot que altere dados oficiais sem aprovação.

## 43. Migrations e rollout futuros

Nenhuma migration foi criada neste planejamento. Na implementação:

1. migrations aditivas por sprint;
2. secret provider e worker homologados antes de credenciais reais;
3. mock/sandbox antes de produção;
4. shadow sync/read-only antes de escrita;
5. feature flag por tenant/instalação/capability;
6. backfill idempotente sem reset;
7. rollout por escopo pequeno;
8. métricas e rollback operacional antes de ampliar;
9. nenhum segredo em seed;
10. documentação/runbook e owner operacional por connector.

## 44. Critério de conclusão

A Fase 9H estará pronta quando o REDE souber, para cada dado integrado:

```text
quem é o dono
→ de onde veio
→ qual identidade externa possui
→ quando e por qual versão foi sincronizado
→ qual mapping/política foi aplicado
→ quem aprovou ou alterou
→ qual sistema recebeu
→ se está fresco, em conflito, com erro ou conciliado
```

O primeiro passo de implementação recomendado é a Sprint 9H.0, seguida da plataforma com mock connector. Google Drive deve ser o primeiro adapter real provável, condicionado à validação de OAuth, permissões, política de referência/cópia e disponibilidade da API no ambiente do cliente.
