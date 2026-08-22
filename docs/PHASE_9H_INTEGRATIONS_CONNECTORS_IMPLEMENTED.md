# REDE Intelligence — Fase 9H implementada

## Central de Integrações, Conectores e Sincronização

Aditiva sobre a base 9A–9G (`rede-phase-9g-complete-2026-08-22`). Nenhuma migration anterior foi editada, nenhuma tabela de domínio 9A–9G foi alterada e nenhum campo financeiro/contábil passou a ser escrito diretamente por um adapter. O REDE continua dono da Base Aprovada, decisões e inteligência; sistemas externos podem ser mestres de campos específicos, nunca de tudo.

```text
Fonte externa ou REDE
→ receber e preservar identidade (ExternalEntityReference)
→ validar (webhook signature / quarentena)
→ normalizar (IntegrationConnector.pull/handleWebhook)
→ mapear (MappingProfile versionado)
→ resolver entidade (identity-resolution: canônico > composto > revisão)
→ validar ownership (DataOwnershipPolicy + resolveConflict)
→ aplicar (serviço de domínio, nunca o adapter) ou colocar em quarentena
→ auditar, medir saúde (health-score) e permitir replay (IntegrationSyncRun/Item)
```

## Escopo entregue

### Core de conectores

- `ConnectorDefinition` (catálogo global: provider, categoria, auth, capabilities, versão de adapter/contrato, sandbox, deprecação) e `ConnectorInstallation` (instância por organização, escopável a grupo/empresa/projeto, com `status`, `direction`, `healthStatus`, `configuration` não secreta).
- Um `ConnectorDefinition` (`GOOGLE_DRIVE_MOCK`) tem várias instalações possíveis; a demo cria uma instalação por START BUTANTÃ, provando "definição ≠ instalação" na prática.
- `IntegrationConnector` (`src/domain/integrations/connector-contract.ts`) é a interface comum — `pull`, `push?`, `handleWebhook?`, `healthCheck`, `testConnection` — o adapter **nunca persiste diretamente**; quem aplica é `runConnectorSync` no serviço de aplicação, espelhando o princípio já usado pelo `BankingAdapter`.

### Source of truth e ownership

- `DataOwnershipPolicy` por domínio/entidade/campo (`fieldPattern` nulo = entidade inteira), com `masterSystem`, `allowedSources`, `consumers`, `direction`, `conflictPolicy` e `riskLevel`. Não existe "REDE sempre vence": o seed registra CNPJ de fornecedor mestre no ERP e qualificação mestre no REDE para o mesmo `Supplier`.
- `resolveConflict` (`src/domain/integrations/conflict-policy.ts`) é pura e determinística: `EXTERNAL_WINS`, `REDE_WINS`, `NEWEST_WINS` (exige os dois relógios, senão exige revisão), `MANUAL_REVIEW`, `FIELD_OWNER_WINS`, `MERGE_BY_RULE` — as três últimas **nunca aplicam automaticamente**, sempre retornam `NEEDS_REVIEW`.

### Identidade externa e deduplicação

- `ExternalEntityReference` com unicidade `[installationId, externalType, externalId]` — a mesma trinca nunca cria duas referências.
- `resolveByCanonicalIdentifier` resolve por CNPJ/identificador legal ignorando máscara; `scoreIdentityCandidates` gera score explicável (0..1) para matching composto, sempre exigindo decisão humana antes de qualquer vínculo automático de baixa confiança.
- Prova real no seed: o ERP mock envia o mesmo CNPJ da Construtora Horizonte (fornecedor já cadastrado na 9C) — o resultado é uma referência externa nova apontando para o `Supplier` existente, nunca um segundo fornecedor.

### Credenciais e segredo

- `CredentialReference` guarda apenas `secretRef` (opaco), `fingerprint` (hash não reversível, 16 hex), `status`, `expiresAt`, `scopes` e histórico de rotação (`rotatedFromId`) — **nunca o segredo**.
- `LocalEncryptedSecretVault` (`src/infrastructure/security/local-secret-vault.ts`) grava o segredo fora do Postgres, cifrado com AES-256-GCM, chave derivada por `scrypt`, arquivo `0o600`, sem sobrescrita silenciosa (`flag: "wx"`) e com a mesma proteção de path traversal do `LocalPrivateFileStorage` (Design Intelligence). É a base local para produção evoluir a um KMS/HSM gerenciado sem mudar o contrato (`SecretVaultProvider`).
- `OAuthGrant` modela `PENDING_CONSENT → ACTIVE → EXPIRING/EXPIRED/REVOKED/ERROR`, scopes e subject — pronto para Authorization Code + PKCE real sem exigir credenciais nesta fase.
- Teste de integração prova que a linha de `CredentialReference` e o JSON serializado do registro **não contêm** o segredo original, e que o vault faz round-trip correto.

### Sync engine, runs e itens

- `IntegrationSyncRun` (modo `MANUAL/SCHEDULED/WEBHOOK/INCREMENTAL/FULL/REPLAY`, direção explícita, contadores `itemsRead/Applied/Ignored/Errored/Conflicted`, `correlationId` único) e `IntegrationSyncItem` (ação por objeto externo, resultado, checksum, erro).
- `IntegrationCursor` é opaco, por `installation + capability + partitionKey`; **FULL e REPLAY ignoram o cursor persistido** e reconciliam desde o início (plano §8/§10); **REPLAY nunca avança o cursor oficial**, mesmo após aplicar itens — provado em teste (`cursorAfter === cursorBefore` depois de um `REPLAY`).
- `runConnectorSync` só conclui `SUCCEEDED` quando não há erro; erro parcial vira `PARTIAL`; falha total (sem nenhum item aplicado/ignorado) vira `FAILED`, e a instalação some para `DEGRADED`/`DOWN` sem apagar histórico.

### Webhook inbox e deduplicação

- `IntegrationInboxEvent` com unicidade `[installationId, provider, eventId]`: o mesmo evento entregue duas vezes retorna a **mesma linha**, nunca reprocessa (Caso Crítico B, provado em seed e em teste). Assinatura inválida é rejeitada e auditada sem persistir o payload não confiável (`payload: null`, `status: REJECTED`).

### Retry, dead-letter e quarentena

- `IntegrationJob` (fila durável — fundação/contrato: prioridade, lease/heartbeat, tentativas, agendamento) e `IntegrationDeadLetter` (falha permanente preservada, nunca apagada, com `errorClass` e `resolvedAt` opcional).
- `IntegrationQuarantineItem` isola payload com identidade não resolvida (ex.: fornecedor sem CNPJ) do domínio principal; `reprocessQuarantineItem` marca `REVIEWED`/`DISCARDED` e **bloqueia segunda revisão** do mesmo item (`"já foi revisado"`).
- `IntegrationErrorClass` cobre autenticação, autorização, rate limit, validação, mapping, duplicata, conflito, rede, provider, regra de negócio, storage e desconhecido.

### Proveniência, freshness e health score

- Toda referência externa carrega `externalVersion`, `installationId`, `metadata` com o `syncRunId`/`documentReferenceId` de origem.
- `calculateHealthScore` (`src/domain/integrations/health-score.ts`) decompõe disponibilidade, taxa de sucesso, latência, freshness e backlog em pesos declarados; **ausência de dado reduz a confiança** (`LOW`/`MEDIUM`/`HIGH`) em vez de simular saúde perfeita — testado com 0 componentes (`score = 0`, `confidence = LOW`) e 5 componentes completos (`score = 1`, `confidence = HIGH`).
- `getIntegrationsWorkspace` calcula `stale` por instalação (limiar de 24h, configurável por fonte no futuro) e `expiringCredentials` (janela de 30 dias).

### Google Drive (primeiro conector prático)

- `MockGoogleDriveConnector` (`src/domain/integrations/mock-drive-connector.ts`) é determinístico, sem I/O real, com paginação por cursor opaco e `handleWebhook` que nunca inventa um arquivo inexistente.
- `runConnectorSync` aplica arquivos do Drive como `ConnectorDocumentReference` (**referência**, nunca cópia por padrão — `referenceMode: REFERENCE`): guarda `externalFileId`, `externalVersionId`, `webUrl`, `checksum`, `mimeType`, `size` e `modifiedAtSource`. Uma nova versão de um arquivo (`versionId` diferente) atualiza a referência sem apagar a anterior no `ExternalEntityReference` — comprovado no seed (`drive-file-planta` chega em `v2`).
- `copiedDocumentLinkId` fica disponível para quando a política de Data Room exigir cópia física via `ProcurementDocumentLink` (9C) — **nenhuma segunda Sala de Documentos foi criada**; a tabela nova é só o registro de proveniência do conector.

### Importador universal, ERP, CRM, bancos e órgãos públicos (contratos)

- `IntegrationConnector` é o mesmo contrato para qualquer provider futuro (OneDrive/SharePoint, Sienge, Mega/TOTVS/SAP, CV CRM/RD Station/Salesforce/HubSpot, prefeituras, cartórios, SEFAZ/contabilidade externa) — nenhum campo de fornecedor específico vaza para o domínio.
- `MappingProfile` versionado (`rules` + `identityRules` em JSON, aprovação e `version`) é o mesmo mecanismo para qualquer capability futura (fornecedores, contas, centros de custo, unidades). O CSV bancário e o parser de extrato (9B) continuam sendo o importador de arquivo reaproveitado; nenhum parser foi reescrito.

### Autopilot / Price Intelligence — fundação

- `ExternalPriceObservation` guarda item, especificação, região, data, quantidade/unidade, preço, frete, tributos, fonte, `evidenceChecksum`, `confidence` e nota de licença. O seed registra um preço público de referência (R$ 100/kg de aço) que **coexiste** com o custo real de compra da 9C (R$ conforme medição), sem substituir histórico — Caso Crítico I.

### Segurança

- `assertSafeExternalUrl` (`src/domain/integrations/url-safety.ts`) bloqueia loopback, `169.254.169.254` (metadata de nuvem), `10/8`, `172.16/12`, `192.168/16`, `metadata.google.internal` e protocolos que não sejam `http(s)` — testado com 6 casos de bloqueio e 1 caso de host público válido.
- Nenhum segredo aparece em `AuditLog`, log de teste ou payload serializado (teste dedicado). `IntegrationInboxEvent` com assinatura inválida não persiste o payload.

## RBAC, segregação, tenant e auditoria

- `IntegrationCapability`: `INTEGRATION_VIEW`, `INTEGRATION_CONFIGURE`, `INTEGRATION_SYNC`, `INTEGRATION_RETRY`, `INTEGRATION_CREDENTIALS`, `INTEGRATION_APPROVE`, `INTEGRATION_AUDIT`, `INTEGRATION_EXPORT`, `INTEGRATION_API_MANAGE` (`src/domain/integrations/capabilities.ts`), seguindo o padrão de matriz por `MembershipRole` já usado em Contabilidade/Pessoas.
- Segregação real: `ANALYST` configura e sincroniza mas **não** gerencia credenciais nem aprova conflito; `REVIEWER` aprova conflito mas não configura nem sincroniza — testado (`storeInstallationCredential` com `ANALYST` lança `"não possui a capacidade"`).
- Toda mutação grava `AuditLog` (ator, entidade, `before/after`, `projectId` quando aplicável): instalação criada, credencial armazenada (nunca o segredo), sync run concluído, conflito resolvido, quarentena revisada.
- Tenant: `createConnectorInstallation` valida `companyId`/`projectId` contra a organização do contexto antes de criar; `getIntegrationsWorkspace` de uma organização isolada (`grupo-atlas`) para um `projectId` do START BUTANTÃ falha com `"não encontrado"` — testado.

### REDE IA

Dez ferramentas somente leitura registradas em `src/application/ai/tool-registry.ts`: `getIntegrationHealth`, `getStaleDataSources`, `getFailedSyncRuns`, `getIntegrationBacklog`, `getMappingConflicts`, `getQuarantinedItems`, `compareExternalAndRedeData`, `getNewExternalDocuments`, `getCredentialExpiryStatus`, `getConnectorFreshness`. Nenhuma executa sync, resolve conflito, muda mapping ou lê segredo/raw payload sensível.

## Banco e migration

Migration nova: `prisma/migrations/20260822153439_phase_9h_integrations_connectors/` — 25 enums e 21 tabelas novas, 100% aditiva (gerada por `prisma migrate diff` contra o banco real já em 9G, sem `DROP`). Nenhuma migration 9A–9G foi editada; o banco não foi resetado. Arquivo UTF-8 sem BOM.

## Seed START BUTANTÃ

`prisma/seed-integrations.ts`, chamado a partir de `prisma/seed.ts` logo após a demonstração contábil 9G, aditivo e idempotente (todo passo faz *find-or-create* ou reaproveita o comportamento idempotente do próprio serviço). Executado duas vezes seguidas sem duplicar uma única linha (contagem de tabelas 9H conferida após a segunda execução). Demonstra:

- 2 `ConnectorDefinition` (Drive mock, ERP mock) e 2 `ConnectorInstallation` (uma por projeto, uma por empresa);
- credencial OAuth ativa (Drive) e credencial de API key **expirada** (ERP) — sem apagar dados, sem loop de retry (Caso Crítico D);
- sync `FULL` do Drive com 2 documentos aplicados por referência, cursor persistido;
- webhook idêntico entregue duas vezes → 1 única linha em `IntegrationInboxEvent` (Caso Crítico B);
- CNPJ do ERP igual ao de um `Supplier` já cadastrado → 1 única referência externa, 0 duplicatas (Caso Crítico A);
- 3 `DataOwnershipPolicy` (CNPJ mestre ERP, qualificação mestre REDE, documento mestre Drive);
- 1 conflito de e-mail (local × externo) resolvido manualmente, nunca sobrescrito silenciosamente (Caso Crítico F);
- 1 item em quarentena (fornecedor sem CNPJ) revisado sem criar duplicata;
- 1 dead-letter de autenticação preservado para diagnóstico;
- 2 `IntegrationHealthSnapshot` (Drive saudável, ERP degradado — score nunca opaco);
- 1 `ExternalPriceObservation` (preço público) coexistindo com o custo real de obra da 9C (Caso Crítico I).

## Validação

```powershell
pnpm db:local:start
pnpm db:validate
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dev -- --port 3099
$env:SMOKE_BASE_URL = "http://127.0.0.1:3099"; npx tsx scripts/smoke-authenticated.ts
```

Executado neste ambiente contra PostgreSQL real (não o cluster isolado padrão do repositório — indisponível por restrição de conta administrativa neste sandbox Windows; usado o `DATABASE_URL` já configurado no worktree, apontando para `127.0.0.1:55432/rede_intelligence`). Resultado: schema válido, migration aplicada, seed idempotente (rodado duas vezes, contagem de linhas 9H inalterada), 230/230 testes passando (37 arquivos, incluindo os 8 novos testes de integração 9H e 11 testes de domínio 9H), lint e typecheck sem erros, build de produção completo, smoke autenticado 200 com todos os marcadores presentes e nenhum chunk quebrado. 0 skips essenciais.

## Regressão 9A–9G

A mesma execução de `pnpm test` cobre as suítes de integração de Operações (9A), Financeiro (9B), Suprimentos (9C), Jurídico (9D), Vendas (9E), Land, Design/BIM, Investment/Studio, Red Team, Pessoas (9F) e Contabilidade (9G) contra o mesmo banco onde o seed 9H foi executado — todas passando, provando que a Fase 9H não alterou comportamento nem dado de nenhuma fase anterior.

## Limites e pendências reais

Não implementados nesta fase (contratos/fundações prontos, aguardando credenciais, discovery ou decisão de negócio antes de qualquer escrita real):

- Google Drive real (OAuth de produção), OneDrive/SharePoint (Microsoft Graph), Sienge, Mega/TOTVS/SAP, CV CRM/RD Station/Salesforce/HubSpot, Construmanager/CDE, prefeituras além do `MunicipalityAdapter` já existente, cartórios, SEFAZ/contabilidade externa real;
- Worker/fila durável real (Postgres-backed ou gerenciada) — `IntegrationJob` é a fundação de schema e contrato; execução ainda roda dentro do processo que chama o serviço, como documentado no plano como gate da 9H.1/9H.2;
- Rate limit/circuit breaker automatizados (schema e classificação de erro prontos; enforcement ainda não implementado);
- Importador universal completo (XLSX/JSON/XML com preview/staging); o CSV bancário 9B continua sendo o único parser de arquivo reaproveitado nesta fase;
- Webhooks de saída reais (entrega HTTP, retry, DLQ) — `IntegrationOutboxEvent`, `WebhookSubscription` e `EventCatalogEntry` são schema e contrato, sem worker de entrega;
- API pública REDE (schema/contrato conceitual apenas, sem rota HTTP versionada);
- Pix, boleto, Open Finance real, transmissão fiscal, scraping amplo, compra autônoma, Market Intelligence completo — fora de escopo por definição do plano (§70/§42);
- Interface "Central de Integrações" (React) — o read model (`getIntegrationsWorkspace`) e as 10 ferramentas de IA já existem; a tela ainda não foi construída, seguindo o mesmo padrão das fases 9A–9G, que também não têm UI própria neste branch.

Próxima fase não iniciada.
