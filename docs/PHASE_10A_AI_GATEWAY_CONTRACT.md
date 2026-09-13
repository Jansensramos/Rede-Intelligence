# Fase 10A — AI Gateway — Contrato técnico (diagnóstico + design)

**Status: implementado nesta mesma branch; corrigido após auditoria adversarial
independente (§9); reprovado numa reauditoria focal final que encontrou bugs reais
adicionais; corrigido de novo numa correção crítica (§11).** Este documento permanece o
contrato de design original; a implementação real, o que foi de fato construído, os
desvios (nenhuma migration criada, apenas um provider disabled ativo) e os achados de
todas as rodadas de auditoria/correção estão em `docs/PHASE_10A_AUDIT_RECORD.md`:
- §9 ("Correção focal pós-auditoria com ressalvas"): três Altos (gate arquitetural
  bypassável, corrigido com análise AST real; RBAC da 10A integrado ao call site real;
  identidade de provider/model no ledger vindo exclusivamente do roteamento do servidor) e
  quatro Médios (`idempotencyKey`/custo/header validados antes de qualquer acesso ao
  Prisma/transporte; reserva órfã `RUNNING` distinguida de `QUEUED` segura, sem migration).
- §11 ("Correção crítica pós-reauditoria — máquina de estados, custo e gate
  arquitetural"): a reauditoria focal final provou, com testes reais contra PostgreSQL,
  que a correção de §9 tinha uma ressurreição real de reserva expirada (uma linha `FAILED`
  podia voltar a `COMPLETED` por um `confirm` tardio, recobrando custo já liberado), custo
  observado hostil do adapter não validado na confirmação, três bypasses triviais do gate
  AST (não exóticos — acesso computado/colchete a `fetch`, extensões `.js`/`.mjs`/`.cjs`
  nunca escaneadas, `scripts/` fora do escopo), o reaper nunca chamado por nenhum caminho
  de produção, e o choke point de RBAC (`assertAiUse`) continuando sem nenhum call site
  real. Todos corrigidos com CAS transacional verificado, validação do custo observado,
  fechamento dos 3 bypasses, recuperação oportunística tenant-scoped, e centralização do
  RBAC — sem nenhuma migration nova.

Nenhum commit/push foi feito; nenhum provider comercial foi habilitado; nenhuma Fase
10B–10I foi iniciada, em nenhuma das rodadas.

Branch: `codex/fase-10a-ai-gateway`, nascida de `457aa75c874a673d51e0f72e4bbfc31417e8fb79`
(9S — encerramento do empreendimento e evidência jurídica canônica, aprovada). Worktree
limpo, zero staged, confirmado antes de escrever este documento e antes de implementar.

Este documento é diagnóstico e contrato de design; a implementação seguiu-o com um desvio
documentado (ver `docs/PHASE_10A_AUDIT_RECORD.md` §3): nenhuma migration foi criada, porque
a ceremônia de segurança pré-migration exigida pela decisão 9 (backup + restauração isolada)
precisa de um privilégio de banco (`CREATEDB`) indisponível neste ambiente, e solicitar essa
credencial é proibido pela própria autorização desta rodada. Nenhuma chamada de rede real a
OpenAI/Anthropic/Google/outro provedor foi feita em nenhum momento desta fase — todo achado
vem de leitura de código e documentação já existentes neste repositório, e toda a
implementação foi testada com transporte/rede injetados.

## 1. Objetivo

Desenhar o **AI Gateway** — a fronteira única, segura e provider-neutral entre a REDE
Intelligence e modelos de IA — responsável por roteamento, políticas, custo, privacidade,
auditoria, resiliência e validação de saída. A 10A **não implementa** Context Engine
(10B), Tool Layer (10C), agentes especializados (10D), Red Team 2.0 (10E), Decision
Engine (10F), Investment Committee (10G), REDE Operator (10H) ou Autopilot (10I). Este
documento também não implementa o Gateway; autoriza (ou não) seu design para uma sessão
de implementação futura.

## 2. Estado atual (diagnóstico real, lido — não resumido de memória)

### 2.1 Duas fronteiras de IA já existem, nenhuma delas é o Gateway

**(A) `LLMProvider` — porta do REDE Red Team (Fase 6/7).**
`src/domain/red-team/provider.ts`: interface mínima, só
`generateStructured<T>({system, evidence, schemaName, schema: ZodType<T>, repair?})`.
`createDisabledProvider()` sempre lança `ProviderUnavailableError`. **Não existe adaptador
real** implementando `LLMProvider` em todo o `src/` — só `createDisabledProvider` (produção)
e três fakes de teste em `provider.test.ts` (`MalformedProvider`, `FailingProvider`,
`ValidProvider`). `src/domain/red-team/orchestrator.ts` chama o provider com
`provider: LLMProvider = createDisabledProvider()` como default; os seis especialistas
determinísticos (`executeDeterministicSpecialists`) sempre rodam primeiro e de forma
completa — o provider só *complementa* opinião/perguntas/achados quando `configured`.
Retry único com `repair: attempt > 0` (`generateValidated`, 2 tentativas), validação Zod
obrigatória do resultado (`schema.parse`), e toda referência de evidência gerada é
validada contra o Evidence Pack real (`validateEvidenceReferences`) antes de entrar num
achado — nunca aceita referência inventada. `RedTeamRun` (schema) persiste
`calls/durationMs/inputTokens/outputTokens/retries/error` — sem `prompt`/`response` bruto.
Hoje, em produção, este caminho está **sempre efetivamente desligado** (nenhum adaptador
real existe), o que é o comportamento correto e fail-closed por omissão.

**(B) `AIProvider` — porta da "REDE AI" (Fase 7), assistente conversacional.**
`src/domain/ai/types.ts`: interface bem mais ampla —
`generateText/generateStructured/stream/embed/classify/summarize`, mais um sistema
completo de tarefas (`AITask`), contexto (`RelevantContextPackage`), ferramentas
(`AIToolDefinition` com `mode: READ_ONLY|SIMULATION|MUTATION` e `minimumRole`), evidência
(`AIResponseEvidenceInput`) e um pipeline de conversa persistida.

- `src/domain/ai/provider.ts` tem **duas implementações**:
  - `DeterministicAIProvider` (`status: "LIMITED"`) — nunca sai da rede; devolve o
    `groundedContext` já composto ou uma frase fixa. **Este é o fallback padrão.**
  - `CompatibleHTTPAIProvider` (`status: "AVAILABLE"`) — **faz `fetch()` real** para
    `this.options.baseUrl` com `Authorization: Bearer <apiKey>`, payload
    `{model, temperature, max_tokens, messages: [system, user+groundedContext]}`, timeout
    de 45s, até 2 tentativas só para `429`/`5xx`/timeout (linha 51-70 de `provider.ts`).
  - `src/infrastructure/ai/provider-factory.ts::createAIProvider()` decide entre as duas
    lendo `process.env.AI_PROVIDER_API_KEY`/`AI_PROVIDER_BASE_URL`/`AI_DEFAULT_MODEL`
    **direto do `process.env`**, fora de `runtimeConfig()` — ver 2.3.
- `src/application/ai/ai-service.ts::askRedeAI` é o orquestrador real: valida limite de
  uso (`enforceUsageLimits` — `AIUsageBudget.maxRequestsPerMinute`/`monthlyLimit`, já
  persistidos por organização), monta o plano de tarefa (`planAIIntent`), roteia por
  `AIModelRouter` (`src/domain/ai/router.ts` — rota só por `AITask`, nunca por nome de
  modelo vindo do cliente; usa `AITaskPolicy` por organização ou uma tabela de fallback
  determinístico), executa ferramentas (`aiToolRegistry`, **116** tools READ_ONLY/MUTATION
  já com `minimumRole` — contagem direta em `tool-registry.ts`, confere com o número já
  citado no Relatório Mestre para o fechamento da 9Q.1B), compõe a resposta em linguagem
  natural a partir de dados JÁ
  ESTRUTURADOS E JÁ AUTORIZADOS (`composeGroundedAnswer`), e **só então**, se
  `provider.status === "AVAILABLE"`, chama `provider.generateText` passando
  `groundedContext: answer.content` (o texto já composto, não o objeto de domínio bruto).
  Guarda real de veracidade: `numericGroundingSafe()` (`ai-service.ts:153`) só aceita o
  texto gerado pelo provider se **todo número nele já aparecia no `groundedContext`** —
  nenhum número novo pode ser inventado pela IA. Se o provider falhar, cai para
  `answer.providerStatus = "LIMITED"` e mantém o conteúdo determinístico.
- `composeGroundedAnswer` (`src/application/ai/composer.ts`) **hoje já inclui, em texto
  natural, VGV/margem/VPL/exposição/equity/preço-teto de terreno reais** quando as
  ferramentas correspondentes rodam. Isto é o `groundedContext` enviado ao HTTP provider
  quando configurado — **não há classificação de sensibilidade nem redação antes do envio**.
  CPF/CNPJ/dados pessoais não aparecem hoje nos textos observados, mas nada no código
  impede um tool futuro de incluir esse tipo de dado na composição.

### 2.2 Modelo de dados de IA já é substancial — 16 modelos Prisma

`prisma/schema.prisma`: `AIAnalysisRun` (2505), `AIConversation` (3521), `AIMessage`
(3552), `AIResponseEvidence` (3573), `AIExecutionLog` (3598), `AIToolCallLog` (3630),
`AIPendingAction` (3652), `AIInsight` (3678), `AIFeedback` (3696), `AITaskPolicy` (3712),
`AIUsageBudget` (3729), `AIDocumentChunk` (3745), `AIFavoritePrompt` (3766),
`AIOrganizationPrompt` (3779), `AISystemPromptVersion` (3794), `AIFeatureFlag` (3807).

Pontos relevantes já corretos, a preservar:
- `AIExecutionLog` **não** guarda prompt/resposta bruta — só `task/model/provider/status/
  durationMs/inputTokens/outputTokens/estimatedCost(Decimal 14,6)/retries/errorCode/
  errorMessage/promptVersion/toolsVersion/contextBuilderVersion`. É, na prática, um
  proto-`AiGatewayError`/auditoria de execução já bem desenhado.
- `AITaskPolicy` é, na prática, uma proto-`AiRoutingPolicy` por organização+tarefa
  (`{organizationId, task, provider, model, maxTokens, temperature, enabled}`).
- `AIUsageBudget` (`@unique organizationId`) é uma proto-`AiBudgetPolicy`:
  `monthlyLimit/perUserMonthlyLimit/warningThreshold/currency/maxRequestsPerMinute/
  maxToolSteps`, mas **sem** orçamento por projeto/categoria de tarefa, sem limite diário
  distinto do mensal, sem reserva/reconciliação para concorrência (ver §10).
- `AIPendingAction` já tem `idempotencyKey` real (`@@unique([organizationId,
  idempotencyKey])`, SHA-256 de `conversationId:sourceMessageId:actionType:JSON(args)`) e
  fluxo de confirmação humana (`PENDING_CONFIRMATION → EXECUTING → COMPLETED/FAILED`,
  só `OWNER`/`ADMIN` confirma). Precedente direto para idempotência de chamadas do
  Gateway.
- `AIDocumentChunk.untrusted: Boolean @default(true)` confirma que o modelo de ameaça
  "documento do usuário é conteúdo não confiável" já está no schema, não só na doc.
- `AIFeatureFlag` (`{organizationId, key, enabled, config: Json}`) existe mas **não é
  usado** hoje para ligar/desligar o provider — `createAIProvider()` só lê `process.env`
  global, sem variação por organização.
- **Gap real de auditoria**: `AIToolCallLog.arguments`/`resultSummary` (Json, truncado a
  16 KB pelo chamador) persistem os argumentos e um resumo do resultado de cada tool call
  — dados estruturados internos (mesma classificação que o usuário já vê na tela), não
  PII adicional, mas sem classificação explícita de sensibilidade por tool. A ser
  resolvido pela política de auditoria do Gateway (§11), não pelos módulos futuros de
  Tool Layer.

### 2.3 Configuração de IA está **fora** do `runtimeConfig()` central — gap real

`src/infrastructure/config/runtime-config.ts` é o único ponto Zod-validado, fail-closed em
produção (`productionIssues()` bloqueia produção sem `STORAGE_PROVIDER=s3`,
`SECRET_PROVIDER=external`, `KMS_PROVIDER=external` etc.). **Nenhuma variável `AI_*`
está neste schema.** `AI_PROVIDER_API_KEY`/`AI_PROVIDER_BASE_URL`/`AI_DEFAULT_MODEL`/
`AI_PROVIDER_NAME`/`AI_INPUT_COST_PER_MILLION`/`AI_OUTPUT_COST_PER_MILLION` são lidas
direto de `process.env` em `provider-factory.ts`, sem validação de formato, sem allowlist
de host, sem gate de produção. Consequências concretas:
- `AI_PROVIDER_BASE_URL` é uma string livre — **nenhuma validação de URL, nenhum
  allowlist de host**. Um valor malicioso ou mal configurado faz `CompatibleHTTPAIProvider`
  enviar `Authorization: Bearer <apiKey>` mais o contexto composto para qualquer host —
  risco de SSRF/exfiltração via configuração, não via input do usuário.
- Não existe hoje um `AI_PROVIDER=disabled` explícito e testado — o "disabled" atual é
  implícito (ausência das 3 variáveis → `DeterministicAIProvider`). Funciona, mas não é
  auditável como decisão, e nada impede produção de subir sem querer com credencial real
  mal configurada, porque não há gate de produção equivalente ao de storage/secrets.
- Nenhuma variação por organização (`AIFeatureFlag` existe mas não é consultado aqui).

### 2.4 Filas/jobs

`src/application/worker/*` tem um worker genérico (`WORKER_CONCURRENCY/POLL_MS/
LEASE_MS/JOB_TIMEOUT_MS`, já em `runtimeConfig()`) usado por Google Drive/webhooks/e-mail.
**Nenhum job de IA existe hoje** — `askRedeAI` é síncrono, dentro do request. Isso é
aceitável para chat interativo, mas relevante para 10B+ (execuções longas de agentes).

### 2.5 Resiliência — infraestrutura pura já pronta, não usada por IA

`src/domain/integrations/` (Fase 9H) já tem, puros, testados e **exatamente** no formato
pedido por este contrato:
- `circuit-breaker.ts` — `CLOSED→OPEN→HALF_OPEN`, sonda única em `HALF_OPEN`
  (`halfOpenProbeInFlight`), sem depender de serviço externo.
- `retry-policy.ts` — `RetryableErrorClass` já separa `PERMANENT` (`AUTHENTICATION`,
  `AUTHORIZATION`, `VALIDATION`, `MAPPING`, `DUPLICATE`, `BUSINESS_RULE` — nunca repetidas)
  de retryable; backoff exponencial com jitter configurável, `maxAttempts`.
- `rate-limiter.ts` — janela fixa + `blockedUntilMs`; `applyProviderRetryAfter` já
  sanitiza e limita um `Retry-After` de provider (`MAX_PROVIDER_RETRY_AFTER_MS`,
  trunca/valida finitude) antes de aplicar — exatamente o requisito "429 deve respeitar
  Retry-After sanitizado".

**Nenhum destes três módulos é usado hoje pelo caminho de IA.** Reaproveitá-los
integralmente (não recriar) é a recomendação central de resiliência deste contrato.

### 2.6 RBAC

`src/domain/auth/read-capabilities.ts` já tem `"AI_READ"` (rota `/assistente`), **não**
concedida a `VIEWER` (`viewerCapabilities` não inclui `AI_READ`) — ou seja, `VIEWER` já
não acessa a REDE AI hoje. Dentro do próprio domínio de IA,
`src/application/ai/context-builder.ts::buildAIContext` já calcula
`canViewConfidential = role !== "VIEWER" && !["MUNICIPALITY","LANDOWNER"].includes(audience)`
e `canMutate`/`canSimulate` por papel — um segundo nível de RBAC já existe dentro do
próprio contexto de IA, além da capability de rota. Não existem ainda `AI_USE`,
`AI_ADMIN`, `AI_BUDGET_READ`, `AI_BUDGET_MANAGE`, `AI_AUDIT_READ`.

### 2.7 Redação/PII em log

`docs/PHASE_9Q2B_LGPD_CHECKLIST.md` confirma um padrão já existente: `logger.ts` já
redige CPF/CNPJ por padrão de valor e por nome de campo (`tax.*id`). Este padrão é
reaproveitável para a camada de redação do Gateway, mas **não é hoje aplicado** ao
caminho de IA especificamente (o `groundedContext` nunca passa por essa redação).

### 2.8 SDKs e dependências

`package.json` **não tem nenhuma dependência de SDK de IA** (`openai`, `@anthropic-ai/sdk`,
`@google/generative-ai` etc. — busca direta, zero resultados). `CompatibleHTTPAIProvider`
usa `fetch` nativo contra um endpoint HTTP compatível com o formato OpenAI Chat
Completions. Superfície de supply-chain hoje é **zero SDK de terceiro** — ponto forte a
preservar: o Gateway não deveria introduzir um SDK proprietário sem necessidade
comprovada; um adaptador HTTP fino por provedor, todos atrás da mesma porta, é
consistente com o padrão já estabelecido.

### 2.9 Busca global — termos pedidos

`openai|anthropic|claude|gemini` → zero ocorrências em código (só nomes de arquivo deste
próprio diagnóstico e documentação neutra). `completion|chat|embeddings|prompt|model|
tokens` → só dentro de `src/domain/ai/*`, `src/application/ai/*`,
`src/domain/red-team/*` (já mapeados acima) e `src/domain/legal/engine.ts`/
`src/application/legal/legal-service.ts` (falso positivo — "prazo"/strings não
relacionadas a IA, confirmado por leitura). `AI_PROVIDER|AI_API_KEY` → só
`provider-factory.ts`. **Nenhuma chamada de rede a provedor de IA fora de
`CompatibleHTTPAIProvider.generateText` existe em todo o `src/`.**

### 2.10 Único ponto capaz de contornar o futuro Gateway

`src/domain/ai/provider.ts::CompatibleHTTPAIProvider.generateText` (linhas 46-71) — é a
ÚNICA chamada de rede real a um provedor de IA em todo o código, hoje inerte por ausência
de configuração. Qualquer AI Gateway da 10A precisa **substituir o composition root**
(`provider-factory.ts`) para que este ou qualquer adaptador futuro só seja alcançável
através do Gateway — nunca instanciado direto por `ai-service.ts`/`orchestrator.ts`.

### 2.11 Outros precedentes diretos já na campanha (9I, 9M, 9Q.2A/2B)

- **9I (`docs/PHASE_9I_REDE_DATA_PORTFOLIO_INTELLIGENCE_IMPLEMENTED.md`)**: já expõe 6
  ferramentas de IA somente-leitura (`getCostBenchmark`, `getForecastAccuracy`,
  `getPortfolioScorecard`, `getDataQualityFindings`, `getAutoBudgetSuggestion`,
  `getMetricCatalog`) sobre um motor 100% determinístico (mediana/percentil/IQR/MAD,
  sem LLM) e 14 capacidades de RBAC próprias — terceiro exemplo confirmado (junto com
  Red Team e REDE AI) do mesmo princípio "IA só explica/lê, nunca recalcula".
- **9M (`prisma/migrations/20260827120000_phase_9m_engineering_auto_budget_proposal/`)**:
  cabeçalho da própria migration diz "PROPOSTA FINAL PARA REVISÃO — NÃO EXECUTADA".
  Cria `auto_budget_proposals` com `series_key`+`version` (lineage/idempotência de
  propostas geradas), `input_checksum` (fingerprint do input que gerou a proposta —
  nunca do output, mesmo cuidado que o Gateway deve ter ao "assinar" uma resposta) e
  **FKs compostas tenant-safe** (`(organization_id, project_id, id)`) em vez de FK
  simples, para impedir referência cross-tenant/cross-projeto por construção — mesmo
  problema estrutural que uma futura tabela `AiCostReservation`/auditoria do Gateway
  teria se referenciasse `AIExecutionLog`/`AIConversation` por FK simples (ver §16).
- **9Q.2A (`docs/PHASE_9Q2A_SECURITY_QA_RECORD.md`)** e o código real
  (`src/infrastructure/http/safe-error.ts` + `src/infrastructure/observability/
  correlation.ts::resolveCorrelationId`): um `correlationId` vindo do cliente **já é
  aceito hoje**, mas só se casar com `/^[a-zA-Z0-9._:-]{1,128}$/` — caso contrário é
  substituído por um UUID gerado no servidor; nunca usado para autorizar ou localizar
  um registro. Este contrato (§4/§6) escolhe deliberadamente a variante **mais
  estrita** já usada na 9S (`correlationId` sempre gerado no servidor, nunca aceito do
  cliente em nenhuma forma) para o `AiRequest`, por ser a chamada mais sensível
  (custo/política/segurança) — o padrão mais permissivo de `resolveCorrelationId`
  continua correto para logs de erro HTTP genéricos, não é revogado por este contrato.
- **9Q.2B IAM (`docs/PHASE_9Q2B_IAM_KMS_POLICY.md`)**: quatro identidades já segregadas
  (`app-runtime`, `worker-runtime`, `deploy-pipeline`, `operator-human`), nenhuma com
  privilégio de administrador de infraestrutura. Um futuro adaptador real de provedor
  de IA deve rodar sob `app-runtime`/`worker-runtime` (nunca uma identidade nova), com
  a chave do provedor no mesmo cofre (`SECRET_PROVIDER`/`KMS_PROVIDER`) já usado por
  `src/infrastructure/security/secret-provider.ts` (`EnvironmentSecretProvider` em
  dev/teste; `ExternalSecretProvider`/`ExternalKmsProvider` em produção, via adapter
  AWS; `createSecretProvider` já falha fechado se `SECRET_PROVIDER=environment` em
  produção) — nunca um cofre paralelo específico de IA.
- **9Q.2B LGPD (`docs/PHASE_9Q2B_LGPD_CHECKLIST.md`)**: a taxonomia de dados pessoais
  já em uso operacional hoje é Identificação (nome/e-mail/telefone), CPF, CNPJ, Dados
  financeiros (cifrados via KMS — `enterprise-evidence-cipher.ts`/
  `financial-evidence-cipher.ts`), Documentos de sala de dados, Evidência de
  assinatura (URL sempre pré-assinada com TTL, nunca fixa). O `AiDataClassification`
  proposto no §7 é uma generalização desta taxonomia já aprovada — não uma invenção
  nova — acrescentando só as categorias que a IA introduz (`TRADE_SECRET`,
  `CONFIDENTIAL` operacional) que o checklist de LGPD ainda não precisava nomear.
  Pendências humanas do mesmo checklist (finalidade/base legal, retenção,
  operadores/suboperadores, atendimento ao titular, plano de incidente à ANPD) são
  agora, adicionalmente, pendências diretas deste contrato (§21) — nenhuma foi
  aprovada por agente.

### 2.12 Testes existentes

`src/domain/ai/ai.test.ts` (44 linhas), `src/domain/red-team/provider.test.ts` (fakes
`Malformed/Failing/Valid`), `src/domain/integrations/resilience.test.ts` +
`resilience.database.integration.test.ts` (circuit breaker/retry/rate-limit já testados
para os conectores 9H), `src/application/ai/database.integration.test.ts` (147 linhas,
fluxo real de `askRedeAI` contra Postgres). Nenhum teste hoje exercita
`CompatibleHTTPAIProvider` contra rede real (correto) nem existe teste de
prompt-injection/payload hostil no caminho de IA.

## 3. Fronteira provider-neutral

O AI Gateway substitui a composição hoje feita em `provider-factory.ts` +
chamada direta em `ai-service.ts`/`orchestrator.ts`. Nenhum código de domínio ou
aplicação chama um adaptador de provedor diretamente; todos chamam `AiGateway.execute(...)`.
O domínio nunca vê: nome de SDK, formato de mensagem específico de fornecedor, headers,
endpoints, chaves, IDs externos do provedor. Isso já é parcialmente verdade hoje
(`AIProviderRequest`/`LLMProvider` já não expõem formato OpenAI ao domínio) — o Gateway
formaliza e centraliza o que hoje está espalhado em duas portas paralelas (`AIProvider` e
`LLMProvider`).

**Decisão de design:** o Gateway não substitui `AIProvider`/`LLMProvider` como
interfaces — ele se torna o único **chamador autorizado** de qualquer implementação
delas. `AIModelRouter`/`createAIProvider`/`runRedTeam(provider)` passam a receber o
Gateway (ou uma fachada dele), nunca um provider concreto instanciado localmente.

## 4. Contratos propostos (assinatura, não implementação)

```ts
// src/domain/ai-gateway/types.ts (proposto)

type AiModelCapability =
  | "TEXT_GENERATION" | "STRUCTURED_OUTPUT" | "EMBEDDINGS"
  | "VISION" /* futuro, não usado nesta fase */
  | "TOOL_USE" /* contrato futuro para 10C, gateway não executa tools */
  | "STREAMING";

interface AiModelProfile {
  provider: string;              // referência interna, nunca exposta ao domínio
  capabilities: AiModelCapability[];
  contextWindowTokens: number;
  maxOutputTokens: number;
  supportsJsonSchema: boolean;
  safetyTier: "STANDARD" | "RESTRICTED";
  dataResidency?: string;        // só quando comprovadamente conhecida; nunca inventada
  retentionPolicy?: "NONE" | "PROVIDER_DEFAULT" | "ZERO_RETENTION_CONFIRMED";
}

interface AiRequest {
  correlationId: string;         // gerado no servidor, nunca aceito do cliente
  organizationId: string;        // do contexto autenticado, nunca do payload do cliente
  projectId?: string;
  actorRef: string;              // referência interna do usuário, nunca PII
  task: AiTaskCategory;          // enum fechado do domínio, nunca string livre do cliente
  requiredCapabilities: AiModelCapability[];
  dataClassification: AiDataClassification; // ver §7 — obrigatório, sem default inseguro
  criticality: "LOW" | "STANDARD" | "HIGH";
  maxLatencyMs?: number;
  maxCostUsdMicros?: number;     // teto por chamada, opcional
  content: AiContentEnvelope;    // nunca uma string única não tipada
  outputSchema?: AiOutputSchemaRef; // versão + Zod/JSON Schema — ver §8
  idempotencyKey?: string;
}

interface AiContentEnvelope {
  systemInstructions: string;         // só instrução, nunca dado de negócio
  trustedContext: string;             // já composto/validado (padrão composeGroundedAnswer)
  untrustedUserContent?: string;      // marcado explicitamente; nunca tratado como instrução
}

interface AiResponse {
  correlationId: string;
  status: "OK" | "PARTIAL" | "BLOCKED";
  content?: unknown;              // só quando outputSchema validou
  evidenceRefs: string[];         // nunca fatos sem referência
  usage: AiUsage;
  routing: { capabilityMatched: AiModelCapability[]; providerRef: string; modelRef: string; fallbackUsed: boolean };
  policyVersion: string;
  promptVersion: string;
  schemaVersion?: string;
}

interface AiUsage {
  inputUnits: number; outputUnits: number;
  estimatedCostUsdMicros: number;
  observedCostUsdMicros?: number;   // nunca confiado sem reconciliação — ver §10
  latencyMs: number;
}

interface AiRoutingPolicy {
  organizationId: string;
  task: AiTaskCategory;
  allowedProviders: string[];
  allowedModelsByCapability: Record<AiModelCapability, string[]>;
  fallbackChain: string[];        // ordem explícita, nunca implícita
  maxFallbackAttempts: number;
  requiresHumanApprovalAbove?: "HIGH"; // criticidade que nunca é automática
}

interface AiSafetyPolicy {
  blockedContentPatterns: string[];       // versionado, nunca ad hoc
  maxInputBytes: number; maxOutputBytes: number;
  maxJsonDepth: number;
  untrustedContentMustBeFenced: true;     // invariante, não configurável para false
}

interface AiBudgetPolicy {
  organizationId: string; projectId?: string; role?: string; taskCategory?: AiTaskCategory;
  dailyLimitUsdMicros?: number; monthlyLimitUsdMicros: number;
  hardBlock: boolean; // false = soft (alerta, segue); true = bloqueia chamada
}

type AiGatewayErrorCode =
  | "CONFIGURATION" | "AUTHENTICATION" | "AUTHORIZATION" | "POLICY_BLOCKED"
  | "BUDGET_EXCEEDED" | "RATE_LIMIT" | "TIMEOUT" | "PROVIDER_UNAVAILABLE"
  | "INVALID_RESPONSE" | "SAFETY_BLOCKED" | "RETENTION_UNCONFIRMED" | "UNEXPECTED";

class AiGatewayError extends Error {
  constructor(message: string, readonly code: AiGatewayErrorCode, readonly retryable: boolean, readonly correlationId: string) { super(message); }
}

interface AiProviderAdapter {
  readonly ref: string;                 // referência interna, nunca nome de SDK exposto
  readonly profile: AiModelProfile;
  execute(request: AiRequest, signal: AbortSignal): Promise<AiResponse>;
}

interface AiGateway {
  execute(request: AiRequest): Promise<AiResponse>;
}
```

Nenhuma abstração rasa: `AiRequest`/`AiResponse` não têm campo `messages`/`role`/
`model` no formato de nenhum fornecedor; o mapeamento para o formato real (ex.: o já
existente `{model,temperature,max_tokens,messages}` de `CompatibleHTTPAIProvider`) fica
inteiramente dentro do adaptador, nunca sobe à interface.

## 5. Roteamento

Critério determinístico, nesta ordem, cada um capaz de recusar antes do próximo:
1. `dataClassification` permitida para a tarefa (bloqueia antes de rotear — nunca
   "tenta e trunca depois").
2. Capacidades exigidas (`requiredCapabilities`) casadas contra `AiModelProfile` —
   nunca nome de modelo vindo do cliente.
3. `AiRoutingPolicy` da organização — provedores/modelos permitidos, na mesma linha do
   já existente `AITaskPolicy`.
4. Orçamento (§9) — checagem de custo estimado antes da chamada.
5. Disponibilidade (circuit breaker por provedor, reaproveitando
   `src/domain/integrations/circuit-breaker.ts`).
6. Ambiente (produção nunca usa um provider "mock" por engano — ver §14).

Fallback: só dentro de `fallbackChain` explícita da política, nunca decidido ad hoc;
nunca reduz `dataClassification` permitida nem tenta um provedor fora do
`allowedProviders`; nunca transforma erro em conteúdo inventado (uma falha de todos os
fallbacks é `PROVIDER_UNAVAILABLE`, nunca um texto sintético tratado como resposta real);
`maxFallbackAttempts` explícito; cada tentativa é uma entrada de auditoria própria
(nunca "silenciosamente tentou outro provedor"); em caso de erro ambíguo sobre se a
chamada anterior já consumiu orçamento/já produziu efeito (ex.: timeout depois do envio),
o Gateway trata como "possivelmente cobrado" e não reserva orçamento duplicado — ver §10.

## 6. Segurança

- **Prompt injection / indirect injection**: `untrustedUserContent` é sempre "fenced"
  (`AiSafetyPolicy.untrustedContentMustBeFenced`, invariante não configurável) e nunca
  concatenado com `systemInstructions` — mesmo padrão já em produção no Red Team
  (`<UNTRUSTED_EVIDENCE>`, ARCHITECTURE.md §Fronteira de IA). O Gateway não interpreta
  conteúdo do usuário como instrução de sistema em nenhuma camada.
- **Data exfiltration**: nenhum campo de `AiRequest.content` pode conter
  `storageKey`/URL assinada/credencial — reforçado pela classificação de dados (§7,
  bloqueio antes do envio) e pelo próprio contrato de tipos (não há campo para isso).
- **Jailbreak / conteúdo hostil / saída malformada**: tratados na validação de saída
  (§8) — nunca corrigidos silenciosamente.
- **Unicode de controle / JSON excessivo / decompression bomb**: `AiSafetyPolicy.
  maxInputBytes/maxOutputBytes/maxJsonDepth` aplicados antes de qualquer parse; mesmo
  princípio já usado em `upload-validation.ts` (bloqueio por assinatura/tamanho, não só
  extensão) — reaproveitar a disciplina, não necessariamente o código (contextos
  diferentes: upload de arquivo vs. payload de IA).
- **Custo abusivo / loops**: `maxCostUsdMicros` por chamada + orçamento por
  organização/tarefa (§9) + `maxFallbackAttempts` finito + Tool Layer futura nunca
  reentra no Gateway sem um teto de profundidade (contrato reservado para 10C, não
  implementado aqui).
- **SSRF por endpoint configurável**: **achado real do diagnóstico (§2.3)** —
  `AI_PROVIDER_BASE_URL` hoje não tem allowlist. O Gateway exige endpoint fixo por
  adaptador, validado em `runtimeConfig()` (não em `process.env` direto), com allowlist
  de host explícita — nunca URL arbitrária vinda de config de organização.
- **Redirects/timeout**: adaptadores nunca seguem redirect automático (mesmo princípio
  do storage local, que resolve path e rejeita fora do namespace); timeout obrigatório
  por chamada com `AbortSignal` (já existe `AbortSignal.timeout(45_000)` em
  `CompatibleHTTPAIProvider` — o Gateway generaliza isso para todos os adaptadores, com
  timeout por etapa: roteamento, chamada, validação).
- **Retry storms / circuit breaker / rate limiting**: reaproveitar integralmente
  `src/domain/integrations/{circuit-breaker,retry-policy,rate-limiter}.ts` (§2.5) — não
  recriar.
- **Idempotência/replay**: reaproveitar o padrão de `AIPendingAction.idempotencyKey`
  (SHA-256 de identidade lógica, `@@unique` por organização) para qualquer chamada do
  Gateway que tenha efeito (custo/orçamento) associado.
- **Tenant isolation**: `organizationId` do `AiRequest` vem sempre do contexto
  autenticado já validado (`AuthContext`), nunca de um campo aceito do cliente — mesmo
  princípio já aplicado em todo `src/application/**/*-service.ts` deste repositório.
- **Supply-chain de SDK**: preservar zero-SDK (§2.8); se um SDK proprietário for
  estritamente necessário no futuro, isolar atrás de um único adaptador, nunca importado
  fora de `src/infrastructure/ai-gateway/adapters/*`.

## 7. Privacidade e LGPD

Classificação obrigatória (`AiDataClassification`, enum fechado) antes de qualquer
roteamento: `PUBLIC | INTERNAL | CONFIDENTIAL | PERSONAL | PERSONAL_SENSITIVE | LEGAL |
FINANCIAL | TRADE_SECRET`. Regra: **ausência de classificação bloqueia o envio**
(fail-closed) — nunca um default "INTERNAL" silencioso.

Nunca enviados automaticamente a nenhum provedor (bloqueio estrutural, não só
convenção): CPF/CNPJ, e-mail/telefone, documento jurídico integral, credencial,
`storageKey`, URL assinada, dados bancários, conteúdo integral de contrato, evidência
protegida (`LegalEvidenceDocument`, `ContractDocument` etc.). Mecanismo: o mesmo padrão
já usado por `composeGroundedAnswer` — só texto **já resumido/agregado** (métricas,
frases, não o registro bruto) entra em `trustedContext`; o Gateway formaliza isso com um
allowlist de campos por categoria de tarefa, não uma lista de bloqueio (menos frágil:
"não listado = não enviado", nunca "não pensei em bloquear isso ainda").

Minimização/redação/pseudonimização: reaproveitar o padrão de redação já existente em
`logger.ts::sanitizeLogValue` (regex por valor — CPF/CNPJ/telefone/e-mail/JWT/Bearer/
string de conexão Postgres/query de URL temporária — e por nome de campo via
`SENSITIVE_KEY`, com truncamento a 2.000 caracteres por string e 50 itens por
array/objeto) como camada de defesa adicional *depois* do allowlist, nunca como única
defesa — um backstop por padrão nunca substitui a disciplina de nunca enviar o dado
em primeiro lugar (mesma lição da correção crítica final da 9S: um filtro por
padrão/hash não protege conteúdo que o padrão não previu). Retenção/exclusão/
residência: **decisão humana pendente** (ver §21, item 3) — o Gateway bloqueia envio
quando a política de
retenção/residência do provedor não está comprovada (`RETENTION_UNCONFIRMED`), nunca
assume "provavelmente está tudo bem". Base legal/consentimento: decisão humana/jurídica,
nunca inferida pelo código (mesmo princípio já declarado em
`docs/PHASE_9Q2B_LGPD_CHECKLIST.md`).

## 8. Saída estruturada

Toda chamada com `outputSchema` é validada com Zod (padrão já usado em todo o domínio —
`ArchitectureMD` cita Zod como contrato de entrada padrão; Red Team já valida com
`schema.parse` real). Regras: schema versionado (`schemaVersion` em `AiResponse`);
tamanho e profundidade máxima (`AiSafetyPolicy`); `.strict()`/rejeição de campos extras;
números finitos (`Number.isFinite`, nunca `NaN`/`Infinity` aceitos); valores financeiros
em `Decimal` (nunca `number` de ponto flutuante — mesmo princípio de todo o domínio
financeiro, ADR 1 de `ARCHITECTURE.md`); enums fechados; toda referência
(`evidenceRefs`) verificada contra uma fonte real antes de aceitar — mesmo padrão de
`validateEvidenceReferences` do Red Team. **Resposta inválida falha fechado**: vira
`AiGatewayError("INVALID_RESPONSE")`, nunca uma tentativa de "concerto" automático
promovida a fato (o único reparo aceitável é um *segundo pedido* explícito ao provedor
pedindo para corrigir o formato — o que o Red Team já faz com `repair: attempt > 0` —
nunca uma correção heurística no lado do Gateway).

## 9. Veracidade e evidência

O Gateway nunca declara uma saída "verdadeira". Todo `AiResponse` distingue: conteúdo
gerado (texto do provedor) vs. fatos fornecidos (o que estava em `trustedContext`) vs.
referências usadas (`evidenceRefs`) vs. campos sem evidência (sinalizados, nunca
omitidos silenciosamente) vs. incerteza (reaproveitar o enum já existente
`AIUncertainty` — `CONFIRMADO/PREMISSA/SIMULAÇÃO/ESTIMATIVA/NÃO VERIFICADO/EVIDÊNCIA
AUSENTE`) vs. limitações vs. versão de prompt/política/schema vs. provedor/modelo por
referência interna segura (nunca o nome real de SDK/modelo exposto fora dos logs
internos). Ausência nunca se transforma em zero/aprovado/concluído/sem risco — mesmo
princípio já aplicado em `gates.ts` da Fase 9S ("ausência de evidência nunca é tratada
como aprovação") e em `numericGroundingSafe` (nenhum número novo aceito sem já existir
no contexto fornecido). O Gateway generaliza esse guard de "grounding numérico" para
toda saída com `outputSchema` que contenha campos numéricos.

## 10. Custos e orçamentos

Reaproveitar `AIUsageBudget` como base, estendendo (schema futuro, não criado agora):
orçamento por organização (já existe) + por projeto/categoria de tarefa (gap) + diário
distinto de mensal (gap — hoje só mensal). Custo estimado antes da chamada (a partir de
`AiModelProfile`/tabela de preço versionada — nunca confiar só no preço informado pelo
provedor após a chamada); custo observado depois, reconciliado; **reserva explícita**
antes da chamada e liberação/ajuste depois — evita double-spend concorrente (dois
requests simultâneos do mesmo orçamento). Isso **exige** um mecanismo transacional (CAS
ou reserva com expiração) equivalente ao já usado em `enforceUsageLimits` combinado com
uma transação `Serializable`/constraint — decisão de schema explícita, não criada nesta
fase (ver §16 — proposta mínima, sem migration). Moeda: `AIUsageBudget.currency` já
existe; preço por unidade deve ser versionado (nunca hardcoded no adaptador). Alerta de
consumo: `warningThreshold` já existe em `AIUsageBudget` — reaproveitar. Bloqueio
hard/soft: proposto em `AiBudgetPolicy.hardBlock` (§4) — decisão de negócio por
organização, não fixa no código.

## 11. Auditoria

`AiGatewayAuditEntry` (conceito — sem nova migration nesta fase; pode reaproveitar
`AuditLog` genérico ou estender `AIExecutionLog`, ver §16) contém apenas:
`correlationId, requestRef, organizationId/projectId (refs, não payload), taskCategory,
policyVersion, routingDecision (provider/model por referência interna), capability,
status, latencyMs, usage (tokens/custo), reasonCode, promptVersion, schemaVersion`.
**Nunca**: prompt bruto, resposta bruta, PII, chave de API, headers, endpoint completo,
`storageKey`, documento, cadeia de raciocínio (chain-of-thought nunca solicitada,
armazenada ou exposta — nem para depuração). Este padrão já existe hoje em
`AIExecutionLog` (§2.2) — o Gateway preserva essa disciplina, não a relaxa.

## 12. Erros

Enum fechado (`AiGatewayErrorCode`, §4) — `CONFIGURATION, AUTHENTICATION, AUTHORIZATION,
POLICY_BLOCKED, BUDGET_EXCEEDED, RATE_LIMIT, TIMEOUT, PROVIDER_UNAVAILABLE,
INVALID_RESPONSE, SAFETY_BLOCKED, RETENTION_UNCONFIRMED, UNEXPECTED`. Permanente vs.
retryable: reaproveitar `RetryableErrorClass`/`isRetryableErrorClass` de
`retry-policy.ts`, mapeando `AUTHENTICATION`/`AUTHORIZATION`/`POLICY_BLOCKED`/
`SAFETY_BLOCKED`/`BUDGET_EXCEEDED` como permanentes (nunca retry automático — e nunca
contam como falha de disponibilidade para o circuit breaker, que deve medir só
`PROVIDER_UNAVAILABLE`/`TIMEOUT`/erro de rede real). `RATE_LIMIT` respeita
`Retry-After` sanitizado via `applyProviderRetryAfter` (já existe, §2.5). Nenhum erro
carrega prompt, resposta, endpoint completo ou credencial na mensagem — mesmo padrão já
aplicado no domínio (`safeError()` em `ai-service.ts`, `CompatibleHTTPAIProvider` já usa
só `AI_PROVIDER_HTTP_<status>` como mensagem, nunca o corpo da resposta).

Classificação de falha de transporte (rede/HTTP do adaptador, distinta da decisão de
negócio do Gateway como `POLICY_BLOCKED`/`BUDGET_EXCEEDED`): reaproveitar diretamente
`classifyProductionDependencyFailure`/`ProductionDependencyError`
(`src/infrastructure/security/production-dependency-error.ts`) — já mapeia HTTP
401→`MISSING_CREDENTIALS` (permanente), 403→`PERMISSION_DENIED` (permanente),
408→`TIMEOUT`, 429/5xx→`SERVICE_UNAVAILABLE` (retryable), com sanitização de nome de
classe de erro (`SAFE_ERROR_CLASS`), profundidade máxima de `cause` (12) e detecção de
ciclo — exatamente a disciplina que este contrato pede para 401/403 "nunca abrirem
circuit breaker como falha transitória". O adaptador do Gateway traduz o resultado
dessa classificação para `AUTHENTICATION`/`AUTHORIZATION`/`TIMEOUT`/
`PROVIDER_UNAVAILABLE` em `AiGatewayErrorCode`; nunca duplica essa lógica de
classificação de zero.

## 13. Resiliência

Reaproveitar integralmente (§2.5): circuit breaker por adaptador/provedor (`CLOSED→
OPEN→HALF_OPEN`, sonda única), retry com backoff+jitter respeitando `Retry-After`, rate
limiter por organização (estado já pensado para ser persistido/serializável entre
processos). Timeout por etapa com `AbortSignal` (roteamento nunca bloqueia
indefinidamente; chamada ao provedor sempre com timeout; validação de schema é local,
sem I/O, não precisa de timeout próprio). Bulkhead: limite de chamadas concorrentes por
organização (novo — não existe hoje um teto de concorrência, só de taxa por minuto).
Fila/dead-letter: só necessário quando 10B+ introduzir execuções assíncronas longas —
fora do escopo síncrono desta fase, mas o contrato de erro (`DEAD_LETTER` já existe em
`retry-policy.ts` para os conectores 9H) deve ser reaproveitado quando chegar a hora.
Cancelamento: `AbortSignal` passado explicitamente em `AiProviderAdapter.execute` (§4).
Nenhum fallback inseguro: ver §5.

## 14. Configuração e segredos

Migrar toda variável `AI_*` para dentro de `runtimeConfig()` (Zod, fail-closed em
produção) — hoje fora dela (§2.3), gap real a corrigir na implementação. Proposta de
forma (nomes indicativos, decisão final de implementação):
`AI_PROVIDER: "disabled" | "mock" | <nome-do-adaptador>` (nunca "real" genérico — cada
adaptador tem nome próprio, mesmo padrão do `STORAGE_PROVIDER: "local"|"s3"`),
`AI_ALLOWED_ENDPOINTS` (allowlist, nunca uma única URL livre), chaves por provedor via
`SECRET_PROVIDER`/`KMS_PROVIDER` já existentes (nunca uma nova forma de cofre paralela).
Produção fail-closed: `productionIssues()` passa a exigir `AI_PROVIDER` explícito
(`disabled` é uma resposta válida e correta — "não implementado ainda" não é a mesma
coisa que "esquecido"); produção nunca aceita `AI_PROVIDER=mock`. `AI_PROVIDER=disabled`
deve ser um estado de primeira classe, testado, não um efeito colateral de variáveis
ausentes. Nenhuma chave em banco, log ou `.env.example` real — mesmo princípio já
seguido por todo o repositório (`.env.example` só tem `KEY=` vazio).

## 15. Multitenancy e RBAC

Novas capabilities propostas (estendendo `read-capabilities.ts`, sem novo mecanismo):
`AI_USE` (chamar o Gateway), `AI_ADMIN` (gerenciar políticas de roteamento/segurança),
`AI_BUDGET_READ`, `AI_BUDGET_MANAGE`, `AI_AUDIT_READ`. Decisão humana pendente (§18):
quais papéis (`OWNER/ADMIN/ANALYST/REVIEWER/VIEWER`) recebem cada uma — recomendação
técnica (não aprovação): `AI_USE` para todos exceto `VIEWER` (mesma exclusão que
`AI_READ` já aplica hoje); `AI_ADMIN`/`AI_BUDGET_MANAGE` só `OWNER/ADMIN` (mesmo padrão
de `approvalRoles` já usado em `legal-service.ts`/`closure-service.ts`); `AI_BUDGET_READ`/
`AI_AUDIT_READ` mais amplo (leitura, não mutação). `VIEWER` nunca recebe via IA um dado
que não poderia ler direto na aplicação — o Gateway não introduz um segundo caminho de
autorização; ele **consulta** a mesma decisão de autorização já resolvida pela camada
de aplicação (reaproveitar `canViewConfidential`/`canMutate`/`canSimulate`, já calculados
em `context-builder.ts`), nunca recalcula RBAC por conta própria. `organizationId` do
`AiRequest` vem sempre de `AuthContext` já validado — nunca aceito solto do cliente
(mesmo princípio de todo `src/application/**/*-service.ts`).

## 16. Modelo de dados

**Reaproveitar sem alterar**: `AIExecutionLog`, `AITaskPolicy`, `AIUsageBudget`,
`AIPendingAction` (padrão de idempotência), `AIFeatureFlag` (candidato a
ligar/desligar por organização, hoje não consultado). **Lacunas genuínas** (não
implementadas nesta fase, apenas descritas):
- Orçamento por projeto/categoria de tarefa e limite diário — `AIUsageBudget` hoje só
  tem organização+mês.
- Reserva/reconciliação de custo para concorrência — nenhum mecanismo hoje; provavelmente
  exige uma tabela `AiCostReservation` (ou estender `AIExecutionLog`) com CAS
  (`updateMany` condicional, mesmo padrão já usado em `closure-service.ts`/
  `legal-evidence-service.ts` da Fase 9S) — **decisão de migration futura, não desta
  fase**.
- Nenhuma tabela audita explicitamente "decisão de roteamento"/"política aplicada" por
  versão — `AIExecutionLog` guarda `promptVersion/toolsVersion/contextBuilderVersion`
  mas não `routingPolicyVersion`/`safetyPolicyVersion` — extensão de colunas possível,
  não migration estrutural nova.
- Nenhuma tabela de classificação de dados por chamada — proposta mínima: coluna
  `dataClassification` em `AIExecutionLog` (ou equivalente do Gateway), nunca inferida
  depois do fato.

Nenhuma migration é criada nesta fase (proibido pelo pedido). Quando a implementação for
aprovada, a extensão recomendada é aditiva sobre os modelos já existentes, preservando
FKs/imutabilidade/índices já estabelecidos (mesmo padrão de todas as correções 9R/9S:
migration única, aditiva, com backup real antes).

## 17. Testes adversariais planejados (matriz, não implementados)

Provider disabled; configuração ausente/incompleta; token hostil; endpoint hostil (SSRF);
prompt injection direto e indireto (via `untrustedUserContent`); payload gigante;
Unicode de controle/bidi; resposta malformada (JSON inválido, campo extra, tipo errado);
JSON profundamente aninhado; `NaN`/`Infinity` em campo numérico; timeout; `401/403/408/
429/5xx`; `Retry-After` hostil (negativo, gigante, não numérico); redirect HTTP;
fallback proibido (política nega, Gateway não tenta mesmo assim); custo excedido (soft e
hard); corrida de orçamento (duas chamadas concorrentes, mesmo orçamento, mesmo
princípio dos testes de concorrência real já usados na Fase 9S);
duplicidade/idempotência; cross-tenant (organização A nunca vê política/orçamento/log de
B); RBAC (cada capability nova testada negativa e positiva); vazamento em logs (varredura
recursiva de todas as folhas, mesmo padrão já usado nos testes de redação da Fase 9S);
circuit breaker (abre, meio-aberto, fecha); cancelamento (`AbortSignal` real);
provider mock sem rede (nenhum teste desta fase deve tocar rede real — mesmo princípio já
seguido em todo o histórico da campanha).

## 18. Observabilidade

Métricas sem cardinalidade explosiva: contagem de requests, sucesso/falha, latência,
tokens/unidades, custo, bloqueios de orçamento, bloqueios de segurança, retries,
fallbacks usados, estado do circuit breaker, respostas inválidas — agregadas por
organização/tarefa/provedor-referência, nunca por `correlationId` individual em série
temporal de métrica (isso é para o log de auditoria, não para métrica). Tenant em
métrica usa referência hash, nunca o `organizationId` bruto em qualquer payload que possa
sair do sistema (dashboards internos podem mostrar o nome real; exportação externa não).

## 19. Riscos

- `AI_PROVIDER_BASE_URL` sem allowlist hoje é o maior risco técnico concreto
  encontrado — corrigível na implementação sem quebrar compatibilidade (adicionar
  validação, não remover a variável).
- Ausência de reserva de orçamento é um risco de double-spend sob concorrência real —
  hoje mitigado só pela baixa concorrência esperada em uso interno, não estruturalmente.
- Duas portas de IA paralelas (`AIProvider` e `LLMProvider`) precisam convergir para o
  mesmo Gateway sem quebrar o Red Team (que já está em produção fail-closed) nem a REDE
  AI (que já tem usuários reais de conversa) — risco de regressão se a migração não for
  cuidadosamente incremental.
- `AIToolCallLog`/`AIMessage` persistem dados estruturados de negócio (não PII adicional,
  mas nem sempre triviais) sem uma política de retenção declarada — item para a decisão
  humana de LGPD já pendente (`PHASE_9Q2B_LGPD_CHECKLIST.md`), não resolvido por este
  contrato.

## 20. Fora de escopo

Context Engine (10B), Tool Layer (10C — o contrato de `AiModelCapability.TOOL_USE` é só
reservado, não implementado), agentes especializados (10D), Red Team 2.0 (10E), Decision
Engine (10F), Investment Committee (10G), REDE Operator (10H), Autopilot (10I). Nenhuma
chamada real a provedor. Nenhuma migration. Nenhuma UI nova. Nenhum SDK novo instalado.

## 21. Decisões pendentes (humanas/comerciais/jurídicas)

1. **Provedores autorizados e modelos permitidos por tarefa.** Opções: (a) nenhum
   ainda — Gateway nasce em `DISABLED`/`MOCK`, sem provedor real habilitado; (b) um
   provedor piloto único, restrito a tarefas de baixa sensibilidade. Recomendação:
   (a) — consistente com `docs/REDE_CAMPAIGN_CHECKPOINTS.md` ("Na Fase 10, AI Gateway
   inicia em DISABLED/MOCK"). Impacto: adia qualquer custo/risco real até decisão
   explícita.
2. **Preço por unidade/moeda por provedor.** Não pode ser inventado — depende do
   contrato comercial real com o provedor escolhido. Recomendação: manter
   `AiModelProfile.pricing` como placeholder versionado, preenchido só quando um
   provedor for aprovado.
3. **Retenção e residência de dados no provedor.** Decisão jurídica/DPA, não técnica.
   Recomendação: `RETENTION_UNCONFIRMED` bloqueia por padrão até uma pessoa responsável
   confirmar por escrito (mesmo padrão de "nenhuma aprovação LGPD é declarada por
   agente" já em `PHASE_9Q2B_LGPD_CHECKLIST.md`).
4. **Base legal/consentimento para dados pessoais processados via IA.** Decisão
   jurídica pendente, mesma ressalva do item 3.
5. **Orçamento inicial (hard/soft) por organização.** Decisão comercial/produto.
   Recomendação: `hardBlock: true` por padrão até decisão em contrário — nunca soft por
   omissão.
6. **SLA de disponibilidade do Gateway e dos adaptadores.** Decisão de produto/operação,
   não inferível do código.
7. **Papéis exatos para as 5 capabilities novas (§15).** Recomendação técnica dada;
   decisão final é de produto/segurança.
8. **Escopo do piloto** (quais organizações, quais tarefas, por quanto tempo). Decisão
   comercial.
9. **Responsáveis** por aprovar políticas de segurança/roteamento em produção
   (equivalente ao "encarregado"/DPO já mencionado para LGPD). Decisão organizacional.

## 22. Critérios de aceite (para a futura implementação, não para este documento)

- Nenhuma chamada de rede a provedor de IA fora de um `AiProviderAdapter` registrado no
  Gateway.
- `AI_PROVIDER=disabled` funcional, testado, e é o estado padrão sem configuração
  adicional (mesmo comportamento fail-closed já observado hoje, agora explícito e
  auditável).
- Toda variável `AI_*` dentro de `runtimeConfig()`, com allowlist de endpoint e gate de
  produção equivalente ao de storage/secrets.
- `circuit-breaker.ts`/`retry-policy.ts`/`rate-limiter.ts` de `src/domain/integrations/`
  reaproveitados sem duplicação de lógica.
- Nenhum `AuditLog`/log do Gateway contém prompt bruto, resposta bruta, PII, credencial,
  endpoint completo ou `storageKey` — verificado por varredura recursiva de teste, mesmo
  padrão da Fase 9S.
- `VIEWER` nunca recebe via Gateway um dado que não recebe hoje direto da aplicação.
- Resposta inválida (schema) sempre falha fechado — nunca "consertada" e aceita.
- Nenhuma migration fora de uma única, aditiva, com backup real prévio, quando afinal
  aprovada.
