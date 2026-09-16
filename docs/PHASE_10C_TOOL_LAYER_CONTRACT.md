# Fase 10C — Tool Layer — Diagnóstico e contrato (Etapa 1 + decisões aprovadas)

**Etapa 1 (15/09/2026):** diagnóstico e contrato técnico. Nenhum código produtivo, teste ou migration foi criado nessa entrega.
**Adendo de aprovação (15/09/2026):** as 15 decisões da seção 20 foram aprovadas pelo usuário e passam a ser normativas para a implementação. Este arquivo foi atualizado para incorporá-las, corrigir a referência cruzada quebrada da seção 6.1 (apontava para "seção 19" sem numeração real) e numerar formalmente decisões que antes estavam apenas implícitas em prosa. A implementação em si é registrada em `docs/PHASE_10C_AUDIT_RECORD.md` quando concluída.
**Branch:** `codex/fase-10c-tool-layer`.
**Base obrigatória:** `f4586dcf2c005f32d02d47a202ed17d13502f0db` (Fase 10B — Context Engine, evidence-grounded).

## 1. Estado inicial e limites desta entrega

| Verificação | Resultado observado |
| --- | --- |
| Raiz real | C:\Users\Usuario\Documents\Codex\2026-09-03\rede-claude-9p3 |
| Branch criada | `codex/fase-10c-tool-layer`, a partir de `f4586dcf2c005f32d02d47a202ed17d13502f0db` |
| HEAD | `f4586dcf2c005f32d02d47a202ed17d13502f0db` (idêntico ao commit-base; nenhum commit criado nesta etapa) |
| Upstream | Não configurado (branch local nova; `origin` continua `https://github.com/Jansensramos/Rede-Intelligence.git`) |
| Worktree | Limpo antes desta entrega; a única alteração autorizada é este arquivo |
| GitHub Actions do commit-base | Verde — execução única "Validação contínua" (`run 34983403167`), `status: completed`, `conclusion: success` |
| Vercel do commit-base | Misto: o projeto principal **"Vercel – rede-intelligence"** está verde (`state: success`, "Deployment has completed"); três integrações adicionais (`rede-intelligence-jansen`, `rede-intelligence-v1`, `rede-intelligence-v2`) reportam `failure` |

O estado misto da Vercel **não é uma regressão desta base**: o commit anterior aceito (`54c9c905e08d505d1d994c929bee03c76d674018`, base da própria 10B) já apresentava exatamente o mesmo padrão — os mesmos três projetos secundários em `failure` e o mesmo projeto principal em `success`, verificado por consulta direta à API do GitHub (`GET /repos/.../commits/{sha}/status`) para os dois SHAs. Isso é consistente com integrações Vercel duplicadas/legadas não removidas do repositório GitHub, não com uma falha de build introduzida pela 10B. **Decisão 1 (seção 20): aprovada.** `rede-intelligence` é o projeto oficial; `rede-intelligence-jansen`, `rede-intelligence-v1` e `rede-intelligence-v2` são duplicados legados, ficam fora do gate da 10C e serão desativados administrativamente em ação separada, fora deste repositório/sessão.

Nenhum teste local, build, seed, migration ou chamada de provider foi executado nesta etapa além de leitura. Nenhuma credencial, API ou DNS externos foi usada, exceto a leitura pública de metadados de CI/deploy do GitHub explicitamente pedida pelo usuário.

## 2. Base documental e método

Lidos integralmente: `docs/REDE_CAMPAIGN_CHECKPOINTS.md`, `docs/ROADMAP.md`, `docs/PHASE_10A_AI_GATEWAY_CONTRACT.md`, `docs/PHASE_10A_AUDIT_RECORD.md` (seções 1, 2, 15, 16 e a correção do choke point de RBAC em detalhe; demais seções por título/escopo), `docs/PHASE_10B_CONTEXT_ENGINE_CONTRACT.md` (integral), `docs/PHASE_10B_AUDIT_RECORD.md` (integral), `prisma/schema.prisma` (modelos de IA, `DecisionLedgerEntry`, `ForecastEvaluation`, `ProjectClosureResult`, `LedgerSnapshot`, `RevenueRecognitionRun`, `ProjectStatus`, `MembershipRole`), `work/master-report.txt` linhas 1041–1171 (seções 47–49, a fonte mestre que nomeia a Fase 10C).

Código lido integralmente: `src/application/ai/tool-registry.ts` (285 linhas), `src/domain/ai/types.ts`, `src/domain/ai/intent.ts`, `src/application/ai-gateway/rbac.ts`, `src/domain/auth/read-capabilities.ts`, `src/domain/ai-gateway/types.ts`, `src/domain/context-engine/policy.ts`, `src/application/context-engine/readers.ts`, `src/application/context-engine/service.ts`, `src/application/ai-gateway/ledger-service.ts`, `src/application/ai-gateway/gateway.ts`, `src/domain/context-engine/contracts.ts`. Lidos por trecho relevante: `src/application/ai/ai-service.ts`, `src/app/actions/ai.ts`, `src/app/api/ai/chat/route.ts`, `src/application/ai-gateway/architecture.test.ts` (padrão de scanner/allowlist).

**Existente** significa observado diretamente no código/schema desta base. **Reaproveitado** significa mecanismo existente que o desenho proposto usa sem alterar sua forma. **Proposto** significa obrigação nova, ainda sem implementação. **Fora de escopo** significa explicitamente não tratado nesta fatia, com o motivo declarado. Nenhuma afirmação de segurança em produção é feita; esta etapa é diagnóstico estático mais leitura de CI, não auditoria dinâmica.

## 3. Problema, objetivo e fronteira entre fases

A REDE já executa 116 "ferramentas" determinísticas dentro de `askRedeAI`, mas **nenhum modelo de IA as escolhe hoje**: `planAIIntent` (`src/domain/ai/intent.ts`) é um roteador por expressão regular, 100% determinístico, que decide quais ferramentas rodar **antes** de qualquer chamada a um provider. O provider (quando configurado e disponível) só recebe o texto já composto a partir dos resultados — nunca decide qual ferramenta chamar, nunca recebe a lista de ferramentas, nunca vê `AIToolDefinition`. `AiModelCapability.TOOL_USE` existe em `src/domain/ai-gateway/types.ts:10` como valor do enum, mas nenhum código o usa; o Gateway da 10A não executa ferramentas (confirmado em `docs/PHASE_10A_AI_GATEWAY_CONTRACT.md:323` e `:730`).

A Fase 10C, conforme `work/master-report.txt:1085-1087`, deve "expor capacidades específicas e seguras da REDE" — não implementar tool-calling autônomo de LLM por si só. A fronteira desta fase, conforme já fixada pela 10B (`docs/PHASE_10B_CONTEXT_ENGINE_CONTRACT.md:64`), é: **"Execução de ferramentas [está] fora do escopo [da 10B]. Readers fixos de persistência não são ferramentas disponíveis ao modelo."** Ou seja: a 10B prova evidência; a 10C deve decidir e formalizar **como uma capacidade nomeada, validada e auditável é exposta e executada**, sem se tornar um segundo caminho de leitura paralelo ao Context Engine e sem se tornar um agente autônomo (10D).

Princípios normativos herdados de 10A/10B e aplicáveis à 10C: fail-closed; menor privilégio; nenhum SQL/organizationId/projectId/role/capability vindos do cliente; ausência nunca vira zero; ferramenta não decide, apenas executa o que foi autorizado; ferramenta não é agente (sem laço de planejamento, sem encadeamento autônomo de chamadas); toda leitura de negócio passa pela mesma barreira RBAC + tenant/projeto já estabelecida.

| Fase | Responsabilidade e limite (conforme 10B, seção 3) |
| --- | --- |
| 10A — AI Gateway | Roteamento, envelope, orçamento, ledger, transporte. A 10C não cria outro ledger nem outro transporte |
| 10B — Context Engine | Comprovação/seleção/minimização de evidências. A 10C consome bundles validados, nunca lê fonte diretamente |
| **10C — Tool Layer** | **Nomear, validar, autorizar e auditar a execução de capacidades específicas e delimitadas sobre 10A+10B. Sem planejamento autônomo, sem encadeamento de ferramentas decidido pelo modelo, sem escrita em domínio de negócio no perfil inicial** |
| 10D — Agent Framework | Agentes especializados, orquestração multi-passo, decisão de qual ferramenta chamar em sequência. A 10C não implementa isso — apenas prepara o catálogo que a 10D poderá um dia orquestrar |

A 10C **não** decide, nesta etapa, se o modelo algum dia escolherá ferramentas autonomamente (function calling real). Nenhum provider real está configurado (`AI_PROVIDER_*` ausente ⇒ `DeterministicAIProvider`); a hipótese de tool-calling autônomo de um provider real pertence à 10D e a uma decisão comercial futura. O que esta fatia deve formalizar é a **capacidade em si** — nomeada, validada, autorizada, auditada, idempotente — de modo que tanto o orquestrador determinístico atual quanto uma futura 10D possam invocá-la pelo mesmo caminho seguro.

## 4. O catálogo atual de ferramentas de IA

### 4.1 Contagem confirmada

`src/application/ai/tool-registry.ts:34-50` declara `capabilityGroups`, um array de 15 grupos de capability (`ProtectedReadCapability`) para nomes de ferramenta. Contagem direta (script Node sobre o próprio arquivo-fonte nesta sessão): **exatamente 116 nomes de ferramenta, todos únicos** — confirma o número citado pelo usuário e pelo `docs/PHASE_10A_AI_GATEWAY_CONTRACT.md:96-97`. O construtor de `AIToolRegistry` (`tool-registry.ts:119-126`) lança erro em tempo de boot se qualquer ferramenta registrada em `createTools()` não tiver uma capability mapeada — não há ferramenta "órfã" de RBAC.

| Grupo de capability | Nº de ferramentas | Exemplos |
| --- | --- | --- |
| EXECUTIVE_READ | 20 | `getScore`, `getRedTeam`, `getDocuments`, `createDecisionSimulation`, `changeContext` |
| ACCOUNTING_READ | 11 | `getAccountingResult`, `getTrialBalance`, `getTaxesDue` |
| FINANCIAL_READ | 13 | `getCashFlow`, `getSensitivity`, `runEngineSimulation` |
| COMMERCIAL_READ | 10 | `getSalesInventory`, `getDelinquentCustomers` |
| INTEGRATIONS_READ | 10 | `getIntegrationHealth`, `getMappingConflicts` |
| VIABILITY_READ | 12 | `getProject`, `getStudyVersion`, `runReverseZoningSolver` |
| MARKET_PRODUCT_READ | 6 | `getMarketOverview`, `getCompetitorBenchmark` |
| DATA_INTELLIGENCE_READ | 6 | `getCostBenchmark`, `getForecastAccuracy` |
| OPERATIONS_READ | 5 | `getOperationalBaseline`, `getOfficialBudget` |
| PROCUREMENT_READ | 5 | `getProcurementStages`, `getValidatedSaving` |
| ENGINEERING_READ | 8 | `getDesignReview`, `getCriticalPath` |
| PEOPLE_READ | 5 | `getOrganizationalStructure`, `getRootCauseInvestigations` |
| LEGAL_READ | 3 | `getLegalReadiness`, `getLegalDeadlines`, `getPropertyDueDiligence` |
| CAPITAL_READ | 1 | `calculateLandValueCeiling` |
| ACTIONS_READ | 1 | `getActionCenter` |
| **Total** | **116** | |

### 4.2 Real vs. mock

Todas as 116 ferramentas executam lógica real — **não há stub, mock ou descrição-apenas no registro atual**. Cada `execute(...)` ou (a) chama um serviço de workspace já existente e testado (`getOperationsWorkspace`, `getFinancialWorkspace`, `getProcurementWorkspace`, `getLegalWorkspace`, `getSalesWorkspace`, `getPeoplePerformanceWorkspace`, `getAccountingWorkspace`, `getIntegrationsWorkspace`, `getDataIntelligenceWorkspace`, `getMarketProductWorkspace` — `tool-registry.ts:18-27`), (b) lê diretamente de `c.workspace.bundle` (o `InvestmentSnapshotBundle` já carregado em memória para a conversa), ou (c) executa um motor determinístico puro do domínio (`calculateProject`, `calculateRedeScore`, `calculateSensitivity`, `analyzeRisk`, `solveReverseZoning`, `calculateCriticalPath`, `calculateDelayStress`, `calculateLandValueCeiling` — todos importados de `src/domain/*`, sem IA, sem rede).

Nenhuma ferramenta é uma "descrição para o modelo preencher": `validate()` sempre roda um schema Zod fechado (`emptyArgumentsSchema` como padrão) antes de `execute()`, e toda saída é `AIToolCallResult` tipado, nunca texto livre gerado pelo modelo.

### 4.3 Modo e caminhos de escrita

Distribuição por `AIToolMode` (`src/domain/ai/types.ts:15`, valores `READ_ONLY | SIMULATION | MUTATION`):

| Mode | Contagem | Escreve em negócio? |
| --- | --- | --- |
| `READ_ONLY` | 109 | Não, exceto uma exceção pontual descrita abaixo |
| `SIMULATION` | 6 (`createDecisionSimulation`, `runEngineSimulation`, `runSensitivitySimulation`, `calculateLandValueCeiling`, `calculateCostOfDelay`, `runReverseZoningSolver`) | `createDecisionSimulation` **persiste** uma linha em `DecisionSandbox` via `createDecisionSandbox` (`tool-registry.ts:237`, `application/investment/investment-service.ts`) — nunca no snapshot oficial, nunca em `InvestmentSnapshotBundle`, nunca aprova nada. As outras 5 são cálculo puro em memória, sem persistência |
| `MUTATION` | 1 (`generateStudioDraft`) | **Não escreve nada hoje** — retorna apenas `{ status: "PENDING_CONFIRMATION", data: { confirmationRequired: true } }` (`tool-registry.ts:243`); é um placeholder que nunca chega a gerar o artefato nesta base |

**Achado que muda o escopo desta fatia:** uma "ferramenta" `READ_ONLY` adicional, `changeContext` (`tool-registry.ts:84-117`), **escreve** — chama `persistContextSelection` para alterar a seleção de cenário/versão da conversa (`AIConversation`/seleção persistida). Está rotulada `READ_ONLY` no próprio registro (linha 116: `mode: "READ_ONLY"`), o que é uma classificação estruturalmente incorreta pelo próprio critério do sistema (mutação de estado persistido de conversa). Nenhuma ferramenta do catálogo atual grava em `Budget`, `PayableAccount`, `ReceivableAccount`, `LegalEvidenceDocument`, `ProjectClosureResult`, `Decision`/aprovação de comitê ou qualquer tabela de negócio terminal — a única escrita real observada em todo o catálogo é a preferência de contexto da conversa (`changeContext`) e o registro de simulação isolada (`createDecisionSimulation`).

**Consequência normativa para a 10C**: o catálogo legado já demonstra na prática o princípio "IA recomenda, engine calcula, humano aprova" — nenhuma ferramenta aprova, paga, assina ou fecha nada. **Decisão 9 (seção 20), aprovada**: `changeContext` é reclassificada para `mode: "MUTATION"` no registro legado (`tool-registry.ts`), sua lógica funcional permanece intacta (não é reescrita nem removida), ela fica fora do catálogo 10C (que é 100% `READ_ONLY`), e a implementação ganha uma regressão arquitetural que impede reclassificá-la como `READ_ONLY` no futuro. **Decisão 4 (seção 20), aprovada**: nenhuma ferramenta de escrita entra na 10C — nem mesmo o padrão "sandbox" de `createDecisionSimulation`, que pertence à superfície de simulação já existente e não é portado nem duplicado aqui.

### 4.4 Caminho de execução hoje (sem Gateway, sem Context Engine, sem ledger de custo)

`askRedeAI` (`src/application/ai/ai-service.ts`) chama `planAIIntent(question)` → obtém `plan.calls` (nomes + argumentos) → itera até `maxToolSteps` (padrão 8, de `AIUsageBudget.maxToolSteps`) chamando `toolRegistry.execute(context, call.name, call.arguments)` **antes** de qualquer chamada ao Gateway. O `context` é um `RelevantContextPackage` (`src/domain/ai/types.ts:30-43`) cujo campo `workspace: InvestmentCaseWorkspace` é o objeto de workspace **enriquecido** — o mesmo que a 10B já diagnosticou como não confiável para evidência de IA (`docs/PHASE_10B_CONTEXT_ENGINE_CONTRACT.md:109`: "Workspace enriquecido deixa de representar bytes congelados"). Nenhuma chamada de ferramenta hoje passa por `ContextBundle`, por `assertBundleScope` ou por qualquer commit do ledger da 10A: o custo de execução de ferramenta é **zero** no ledger (`AIExecutionLog` do Gateway só é criado depois, se e quando `askRedeAI` decide chamar `gateway.execute` para compor prosa). Auditoria de chamada de ferramenta hoje é só `AIToolCallLog` (existe no schema, `prisma/schema.prisma:3630-3650`, com FK para o `AIExecutionLog` de **orquestração**, não o do Gateway), escrita em `ai-service.ts:138`.

## 5. RBAC cumulativo — atual e requisito para a 10C

### 5.1 Estado atual, integral

`src/domain/auth/read-capabilities.ts`: `ProtectedReadCapability` é um enum fechado de 19 valores (`EXECUTIVE_READ` … `CLOSURE_READ`). `VIEWER` só tem `VIABILITY_READ`, `MARKET_PRODUCT_READ`, `ECOSYSTEM_READ`, `HELP_READ` — **não tem `AI_READ`**. `OWNER`/`ADMIN`/`ANALYST`/`REVIEWER` têm todas as 19.

`src/application/ai-gateway/rbac.ts`: `AiCapability` = `AI_USE | AI_ADMIN | AI_BUDGET_READ | AI_BUDGET_MANAGE | AI_AUDIT_READ`. Matriz: `AI_USE` → `OWNER/ADMIN/ANALYST/REVIEWER`; `AI_ADMIN`/`AI_BUDGET_MANAGE` → só `OWNER`; `AI_BUDGET_READ`/`AI_AUDIT_READ` → `OWNER/ADMIN` e `OWNER/ADMIN/REVIEWER` respectivamente. `assertAiUse(context, domainCapability?)` é o **choke point único**: exige, nesta ordem, `AI_READ` → `AI_USE` → `domainCapability` (quando informada) — nenhuma substitui a outra. É a única função chamada por `askRedeAI`, `tool-registry.execute`, a Server Action `authorizedAIContext` e a rota `/api/ai/chat` (confirmado em `rbac.ts:50-54` e `docs/PHASE_10A_AUDIT_RECORD.md:808-833`).

`tool-registry.ts:129-146` (`AIToolRegistry.execute`) já cumula, na ordem: `assertAiUse(context, toolCapabilities.get(name))` → checagem de `minimumRole` por ferramenta (`roleRank` — cada ferramenta pode exigir papel acima do mínimo de `AI_USE`) → checagem de `canSimulate`/`canMutate` por modo → checagem de consistência de projeto (`selection.projectId === workspace.bundle.projectId`) → checagem de fronteira da conversa (`AIConversation` pertence a `organizationId`+`createdById`+`projectId`+`investmentCaseId` exatos). Isso já é, em essência, RBAC cumulativo + isolamento de tenant/projeto — mas **local ao registro legado**, não ao Context Engine, e sem vínculo com `ContextBundle`/`ContextPolicy` da 10B.

Um teste arquitetural dedicado, `rbac-choke-point.test.ts`, varre `src/app/actions` e `src/app/api` e falha se qualquer arquivo importar um entry point nomeado explicitamente (`createOrganizationAiGateway`, `askRedeAI`, `aiToolRegistry`) sem também referenciar `assertAiUse` no mesmo arquivo.

### 5.2 Requisito cumulativo para ferramentas 10C — aprovado (Decisões 11 e 13)

Idêntico ao já estabelecido, sem criar mecanismo novo: `AI_READ` + `AI_USE` + `domainCapability` do propósito subjacente da ferramenta (herdado do `ContextPolicy.domainCapability` da 10B: `EXECUTIVE_READ`, `VIABILITY_READ`, `FINANCIAL_READ`, `LEGAL_READ`, `ENGINEERING_READ` já cobrem as 5 finalidades hoje existentes) + isolamento de organização/projeto/conversa já resolvido pelo `AuthContext`/Context Engine. Nenhuma ferramenta pode ampliar RBAC de negócio; nenhuma ferramenta pode ser chamada com uma `domainCapability` que o papel do ator não possua. `VIEWER` continua sem nenhuma capacidade de ferramenta de IA (não tem `AI_READ`).

**Decisão 13 (seção 20), aprovada**: `minimumRole = REVIEWER` para as quatro ferramentas do piloto — paridade com o padrão já usado pelas equivalentes legadas de leitura, cumulativo com membership ativa, `AI_READ`, `AI_USE` e a `domainCapability` do propósito. `VIEWER` permanece bloqueado (não tem `AI_READ`).

**Requisito estrutural novo (Decisão 6, seção 20, aprovada como pré-requisito obrigatório, não opcional)**: `rbac-choke-point.test.ts` é estendido para reconhecer o novo entry point de execução de ferramenta que a 10C introduzir — do contrário, uma nova superfície de ferramenta pode nascer sem o choke point cobri-la, repetindo exatamente o achado MÉDIO já corrigido na 10A (seção 11.5 do `PHASE_10A_AUDIT_RECORD.md`). Isso é tratado na seção 13 deste documento.

## 6. Arquitetura proposta

### 6.1 Decisão central: ferramenta 10C = invocação nomeada de um propósito já validado da 10B, nunca um novo caminho de leitura

O achado mais importante desta diagnose: **os únicos readers de contexto realmente prontos hoje** (`src/application/context-engine/readers.ts:35-110`) cobrem exatamente 4 dos 5 propósitos declarados em `src/domain/context-engine/policy.ts:13-19` — `EXECUTIVE_PROJECT_SUMMARY`, `RISK_REVIEW` (ambos via `readStudyEvidence`, que já inclui `STUDY_VERSION`, `ASSUMPTION_SNAPSHOT`, `FINANCIAL_RESULT` e `RISK_FINDING`), `LEGAL_EVIDENCE_SUMMARY` (`readLegalEvidence`) e `ENGINEERING_PROGRESS_REVIEW` (`readEngineeringEvidence`) — três funções de reader cobrindo quatro propósitos. `FINANCIAL_VARIANCE_EXPLANATION` é o único dos cinco **declarado na política mas sem reader** — nenhuma linha em `readContextCandidates` lê `ForecastEvaluation`, `LedgerSnapshot` ou `RevenueRecognitionRun`, os três tipos de fonte opcionais dessa finalidade.

Isso define a arquitetura recomendada: uma ferramenta 10C de leitura, no perfil inicial, é uma função fina que (1) recebe `context: AuthContext` + argumentos validados por Zod estrito, (2) chama `prepareContextBundle(context, { conversationId, purpose })` (já existente, `src/application/context-engine/service.ts:41-60` — já faz toda a autorização, seleção, minimização, auditoria `CONTEXT_PREPARED`), (3) chama `renderContextBundleForTransport(bundle)` (já existente, `src/domain/context-engine/policy.ts:189-198` — já produz a projeção JSON canônica com citações `E1/E2`), e (4) devolve o resultado como `AIToolCallResult`. **Nenhuma consulta Prisma nova, nenhum novo caminho de autorização, nenhuma nova regra de minimização** — a ferramenta é 100% uma casca de nomeação/validação/auditoria de ferramenta em cima de um propósito que a 10B já prova ponta a ponta.

Este ponto foi levantado como decisão pendente na etapa de diagnóstico — a referência original a "seção 19" estava quebrada (§19 é "Critérios de aceite", não a lista de decisões) e a pergunta nunca chegou a ser numerada em §20. Isso foi corrigido: a pergunta é agora a **Decisão 10 (seção 20), aprovada** com a opção mais conservadora. **Toda ferramenta, inclusive as quatro de leitura pura do piloto, usa o protocolo transacional completo de consumo da 10B** (`consumeContextBundleInTransaction`, CAS interno equivalente a `QUEUED→RUNNING`, binding persistido, revalidação imediatamente antes da execução), não apenas a metade "preparo". A alegação de que leitura pura poderia se contentar só com `prepareContextBundle` foi descartada: manter a mesma disciplina para toda leitura de contexto — mesmo a que nunca alimenta uma chamada de provider — fecha a janela residual entre preparo e uso sem depender de uma garantia estrutural adicional (o gate arquitetural da Decisão 6) para não degradar com o tempo. O custo aceito conscientemente é a contenção adicional sob a barreira `SHARE` já documentada como risco residual pela 10B — ver riscos residuais (§19.3) e Decisão 10.

### 6.2 Fluxo obrigatório

1. Entrada autenticada resolve `AuthContext` (sessão, organização, papel) e a conversa já autorizada — igual ao caminho já existente, nunca um `organizationId`/`role`/`capability` do corpo do cliente.
2. Servidor resolve o **nome da ferramenta** a partir de um registro fechado (não vindo do cliente como string livre interpretável — o nome é validado contra um enum fechado de nomes registrados, igual ao padrão já usado por `contextPolicyFor`/`ContextPurposeSchema`).
3. `assertAiUse(context, tool.domainCapability)` — choke point único, reaproveitado sem alteração de forma.
4. Argumentos do cliente passam por um schema Zod `.strict()` específico da ferramenta — fechado, sem campos livres, sem IDs de outra entidade aceitos sem validação de escopo.
5. Ferramenta invoca **exatamente um** propósito de Context Engine (ou, nas ferramentas READ_ONLY que não mapeiam 1:1 a um propósito hoje — nenhuma no perfil inicial recomendado, seção 15 — um reader dedicado seguindo o mesmo padrão transacional de `readers.ts`, nunca um `getXWorkspace` legado com efeito colateral).
6. Resultado é projetado (allowlist, citações opacas, `untrusted=true` para o texto recuperado) e devolvido como `AIToolCallResult` fechado.
7. Execução é registrada em `AIToolCallLog` (reaproveitado, sem alteração de schema) vinculada ao `AIExecutionLog` de orquestração da chamada corrente.
8. Nenhum adapter, nenhum provider, nenhuma rede é chamada nesta cadeia. Se o resultado for posteriormente enviado a um provider real, isso acontece só através de `AiGateway.execute` com `contextBundle` obrigatório, nunca dentro da própria ferramenta.

### 6.3 O que a 10C explicitamente não faz

Não escolhe SQL; não recebe `organizationId`/`projectId`/`role`/`capability` do cliente; não acessa banco/rede/filesystem/provider diretamente (só via os serviços/readers já existentes, sob transação); não altera decisão, aprovação, pagamento, contrato, evidência, snapshot ou estado terminal (zero ferramentas de escrita no perfil inicial); não executa comando arbitrário (nome de ferramenta é sempre de um registro fechado, nunca `eval`/`new Function`/interpretação de string); não fabrica ausência como zero (herda a mesma proibição absoluta da seção 11 do contrato 10B); não ultrapassa a fronteira da 10D (uma ferramenta 10C nunca decide sozinha encadear outra ferramenta — quem encadeia, hoje, é `planAIIntent` de forma determinística e auditável; um encadeamento decidido pelo próprio modelo é 10D, fora de escopo).

## 7. Contratos provider-neutral propostos

Nomes lógicos, não implementação. Seguem exatamente o padrão de rigor Zod `.strict()` + guarda de dados simples (`isPlainContextData`) já estabelecido em `src/domain/context-engine/contracts.ts`, que a 10C deve reaproveitar em vez de recriar.

### 7.1 `AiToolInvocationRequest`

`toolName` (enum fechado, nunca string livre não validada), `correlationId` (gerado no servidor), `organizationId`/`projectId`/`userId`/`conversationId` (resolvidos no servidor, nunca do payload), `arguments` (objeto plano, validado por `isPlainContextData` antes de Zod — mesma defesa contra getters/Proxy/prototype hostil da 10B), `requestedAt` (relógio do servidor).

### 7.2 `AiToolDefinition` (interno, nunca serializado ao cliente/modelo além de nome+descrição+schema de argumentos)

`name` (único, imutável entre versões — renomear é criar uma nova ferramenta), `description` (texto estático curto, não gerado), `mode` (`READ_ONLY` único valor aceito no perfil inicial — `SIMULATION`/`MUTATION` propostos como enum fechado mas **desabilitados** por política até decisão humana futura), `minimumRole`, `domainCapability` (`ProtectedReadCapability`), `contextPurpose` (referência a um `ContextPurpose` da 10B — obrigatório para toda ferramenta de leitura no perfil inicial; nenhuma ferramenta lê fonte fora de um propósito já aprovado pela 10B), `argumentsSchema` (Zod `.strict()` versionado), `toolsVersion` (reaproveita o campo já existente `AIExecutionLog.toolsVersion`).

### 7.3 `AiToolResult`

`name`, `status` (`COMPLETED | REFUSED | FAILED` — remove `PENDING_CONFIRMATION` do enum legado no perfil inicial, já que nenhuma ferramenta de mutação está habilitada), `data` (projeção allowlisted — literalmente a saída de `renderContextBundleForTransport` para ferramentas baseadas em Context Engine), `evidenceRefs` (citações opacas `E1/E2`, nunca ausentes quando `status: COMPLETED`), `correlationId`, `policyVersion`, `contextPolicyVersion`, `toolsVersion`, `durationMs`.

### 7.4 `AiToolError`

Código fechado, mensagem estática, `correlationId`, `retryable` por política — nunca stack, SQL, IDs não autorizados ou conteúdo de fonte. Códigos propostos: `TOOL_UNKNOWN`, `TOOL_ACCESS_DENIED`, `TOOL_ARGUMENTS_INVALID`, `TOOL_CONTEXT_REFUSED` (envelope opaco de qualquer `ContextEngineError` da 10B — nunca reexpõe o código interno de contexto além do que a política de exposição da 10B já permite), `TOOL_RATE_LIMITED`, `TOOL_TIMEOUT`, `TOOL_CONCURRENT_CHANGE`, `TOOL_UNAVAILABLE`. Mapeamento explícito: `TOOL_CONTEXT_REFUSED` nunca distingue "fonte de outro tenant" de "fonte inexistente" — herda a mesma indistinguibilidade de `CONTEXT_ACCESS_DENIED` da 10B (seção 7.7 do contrato 10B).

### 7.5 `AiToolAuthorization` (interno, não persistido como está)

Composição de `assertAiUse(context, tool.domainCapability)` + `roleRank[context.role] >= roleRank[tool.minimumRole]` + verificação de fronteira de conversa (organização/autor/projeto), exatamente como `tool-registry.ts:129-146` já faz — reaproveitada em forma, não em código (o código atual lê o workspace legado; a nova versão deve ler os mesmos campos a partir do `AuthContext`/Context Engine).

### 7.6 `AiToolExecutionRecord`

Mapeia 1:1 para o `AIToolCallLog` já existente no schema (`tool`, `mode`, `arguments` truncado, `resultSummary` truncado a 16 KB, `entityType`/`entityId` quando aplicável, `durationMs`, `status`, `errorCode`) — **nenhuma migration**, apenas reaproveitamento. O vínculo (`executionId`) deve continuar apontando para o `AIExecutionLog` de orquestração da chamada corrente, mesma semântica atual.

## 8. IDs e argumentos derivados exclusivamente no servidor

`organizationId`, `projectId`, `userId`, `conversationId`, `correlationId`, `role`, `domainCapability` de cada ferramenta: sempre do `AuthContext` resolvido pela sessão ou do registro fechado da ferramenta — nunca aceitos de `arguments`. `toolName` é validado contra um enum fechado de nomes conhecidos no servidor (rejeição antes de qualquer leitura, sem tentar "adivinhar" ferramenta por string parecida). Argumentos de negócio aceitos do cliente (ex.: `scenario`, `units`, número de meses) continuam existindo apenas quando a ferramenta explicitamente os usa para parametrizar uma **seleção dentro** de um conjunto já autorizado (ex.: qual cenário financeiro dentro do bundle já autorizado) — nunca para selecionar fonte, propósito, organização, projeto ou política.

## 9. Integração obrigatória com o Context Bundle (10B) e o ledger (10A) — aprovado (Decisões 10 e 11)

Toda ferramenta de leitura do perfil inicial invoca exatamente um `ContextPurpose` já existente via `prepareContextBundle`, **seguido do protocolo transacional completo de consumo** (`consumeContextBundleInTransaction` ou equivalente, com revalidação imediatamente antes da execução, binding persistido e CAS — Decisão 10, §20). Nenhuma ferramenta lê Prisma diretamente fora desse caminho no perfil inicial. Se uma ferramenta futura precisar de um propósito ainda não coberto por um reader da 10B (ver seção 15, "não prontas"), a extensão do reader/política pertence à 10B (mesmo padrão, mesma auditoria, mesma revisão adversarial) — a 10C nunca implementa um reader paralelo.

**Vínculo obrigatório (Decisão 11, §20, aprovada)**: cada execução de ferramenta é vinculada no servidor a ator, organização, projeto, conversa, finalidade (`ContextPurpose`), `ContextBundle`, `correlationId`, identidade da chamada (`toolName`+`arguments` validados) e o registro de ledger/auditoria correspondente. Nenhum desses valores é aceito de `arguments`, do modelo ou de qualquer campo do payload do cliente — todos são resolvidos ou gerados no servidor, exatamente como a 10B já faz para `ContextRequest`/`ContextConsumptionBinding`.

O ledger da 10A permanece o único lugar que grava custo e persiste `AIPendingAction`/`AIExecutionLog` de execução de provider. Uma chamada de ferramenta 10C, por si só, **não** cria uma reserva de orçamento nem um pending action de provider — é uma leitura autorizada, consumida e auditada pelo protocolo da 10B, sem custo de provider (mesma característica do catálogo atual, seção 4.4). Somente quando um resultado de ferramenta alimenta uma chamada real a `AiGateway.execute` (para o modelo compor texto a partir do resultado) é que o ledger, o binding e o CAS de **transporte** da 10A entram em jogo — usando o mecanismo já existente, sem duplicação.

## 10. Idempotência, timeout, limites, concorrência, cancelamento, falhas

| Aspecto | Mecanismo reaproveitado | Valor/observação |
| --- | --- | --- |
| Timeout de transação de leitura | `TRANSACTION_TIMEOUT_MS` já usado pelo ledger (`ledger-service.ts:41`) | 15.000 ms — reaproveitar o mesmo teto para a transação de preparo de contexto de uma ferramenta |
| Retry de conflito serializável | `MAX_SERIALIZABLE_RETRY_ATTEMPTS` (`ledger-service.ts:40`; também usado por `prepareContextBundle`, `service.ts:45`) | 3 tentativas, só para `P2034`; nunca reexecuta uma ferramenta já `COMPLETED` |
| Validade do bundle subjacente | `BUNDLE_MAX_LIFETIME_MS` (`policy.ts:11`) | 60.000 ms — uma ferramenta que devolve um bundle não pode ser cacheada além desse prazo pelo chamador |
| Limite de chamadas de ferramenta por resposta | `AIUsageBudget.maxToolSteps` (já existente, hoje lido em `ai-service.ts:87`, padrão 8) | Reaproveitar sem alterar; a 10C não introduz um teto novo — usa o já aprovado |
| Rate limit | `RATE_LIMIT_POLICY` do Gateway (`gateway.ts:54`, 20/60s) é específico de transporte a provider; ferramentas de leitura pura **não** têm rate limit dedicado hoje | **Decisão 7 (§20), aprovada**: reaproveitar `checkAndConsumeRateLimit` já existente, com chave de escopo própria por ferramenta (`ai-tool:<toolName>`), deliberadamente **sem** misturar com o orçamento/rate limit de transporte a provider da 10A |
| Concorrência | Mesma transação `Serializable` já usada por `prepareContextBundleInTransaction` | Nenhum mecanismo novo; múltiplas ferramentas concorrentes da mesma conversa competem pela mesma barreira já existente |
| Cancelamento | `AbortSignal` já é parte do contrato do adapter (`AiProviderAdapter.execute(request, signal)`); ferramentas de leitura pura, por não chamarem provider, não têm chamada de rede a cancelar — cancelamento aqui significa apenas respeitar o timeout de transação acima | Sem mecanismo novo |
| Classificação de falhas | Reaproveitar `RetryableErrorClass` de `src/domain/integrations/retry-policy.ts` (já usado por 9H, ainda não usado pelo caminho de IA per `docs/PHASE_10A_AI_GATEWAY_CONTRACT.md:176-191`) | Falha de autorização/validação = `PERMANENT`, nunca repetida; conflito serializável = retryable, até o teto acima; falha de leitura/infra = retryable com o mesmo padrão de backoff já testado em 9H |

**Idempotência e auditoria — aprovado (Decisão 12, §20)**: uma ferramenta de leitura pura, sobre o mesmo escopo autorizado e a mesma janela de validade, é idempotente por construção (mesma seleção semântica — herdado da seção 14 do contrato 10B). Nenhum `idempotencyKey` de ferramenta novo é criado, separado do já existente no binding de consumo da 10A/10B — mas replay ou concorrência sobre o mesmo consumo deve resultar em **no máximo uma execução** efetivamente contabilizada: como o consumo reaproveita o CAS transacional da 10B (Decisão 10), duas tentativas concorrentes sobre o mesmo bundle competem pela mesma transação `Serializable`/barreira, e apenas uma vence; a outra observa conflito e é tratada como leitura recusada/retentada conforme a mesma disciplina de `P2034` já usada pela 10A/10B (nunca como uma segunda execução "bem-sucedida" independente). `AIToolCallLog` é reaproveitado sem alteração de schema para o registro de auditoria de cada tentativa (vencedora ou recusada), sem payload sensível.

## 11. Minimização, proveniência e citações

Reaproveitar integralmente a minimização, classificação e citação já provadas pela 10B: `ContextItem` allowlisted, `untrusted=true`, `renderContextBundleForTransport` com citações opacas `E1/E2`, boundary `DATA_NOT_INSTRUCTION`. Uma ferramenta 10C **nunca** devolve um objeto Prisma completo, um `getXWorkspace()` bruto, PII, storageKey, checksum integral ou texto livre não minimizado — mesma allowlist de campos por fonte e propósito já definida na 10B (`docs/PHASE_10B_CONTEXT_ENGINE_CONTRACT.md`, seção 12). Isso implica que qualquer uma das 116 ferramentas legadas que hoje devolve `c.workspace.bundle`/`c.workspace.documents` brutos (ex.: `getDocuments`, linha 219, que filtra só por `confidentiality` mas devolve o objeto completo do documento) **não pode ser promovida como está** a uma ferramenta 10C sem antes passar pela mesma allowlist de projeção da 10B.

## 12. Prompt injection, tool injection, confused deputy, IDOR, cross-tenant

| Ameaça | Defesa herdada/proposta |
| --- | --- |
| Prompt injection via resultado de ferramenta | Resultado é sempre JSON canônico allowlisted (`canonicalContextJson`), nunca concatenado em `systemInstructions`; `untrusted=true` preservado até o envelope do Gateway (mesma defesa da 10B, seção 18) |
| Tool injection (nome de ferramenta ou argumento forjado para escapar do registro) | `toolName` validado contra enum fechado antes de qualquer leitura; `arguments` passa por `isPlainContextData` (recusa getters/Proxy/prototype hostil, mesma guarda da 10B) antes de Zod `.strict()` |
| Confused deputy (ferramenta usada para acessar dado que o ator não poderia ler diretamente) | `assertAiUse(context, tool.domainCapability)` é exatamente a mesma checagem que a rota/Server Action do domínio já usa — a ferramenta nunca amplia acesso além do que a UI já permitiria ao mesmo papel (mesmo princípio da decisão 12/2ª da 10A, `docs/PHASE_10A_AI_GATEWAY_CONTRACT.md:651-654`) |
| IDOR (projeto/conversa de outro tenant) | Herdado de `prepareContextBundleInTransaction`: verifica `membership.organizationId`, `conversation.organizationId/createdById/projectId`, `project.organizationId` antes de qualquer leitura de fonte; resposta indistinguível (`CONTEXT_ACCESS_DENIED`/`TOOL_ACCESS_DENIED`) para "não existe", "outro tenant" e "outro projeto" |
| Cross-tenant via argumento de ferramenta | Nenhum argumento de ferramenta pode conter um ID de fonte fora do escopo já autorizado da conversa/projeto — ferramentas do perfil inicial não aceitam `sourceId`/`documentId` livre nenhum, apenas parâmetros de seleção dentro do bundle (ex.: `scenario`) |
| Ferramenta usada para exfiltrar por acumulação (ex.: repetir com pequenas variações de argumento até reconstruir dado negado) | Mitigação parcial pelo `maxToolSteps` (8) e pelo rate limit proposto na seção 10; não é uma garantia absoluta — registrado como risco residual na seção 19 |

## 13. Arquitetura para impedir chamadas fora do registro autorizado

1. Nome de ferramenta é sempre resolvido contra um `Map`/enum fechado construído em boot (mesmo padrão de `AIToolRegistry`, que já lança erro em boot se uma ferramenta não tiver capability mapeada) — nunca uma string interpretada, nunca `eval`, nunca acesso dinâmico de propriedade não validado (`obj[userInput]` sem allowlist).
2. `assertAiUse` continua sendo o único ponto de entrada — nenhuma outra função monta a combinação `AI_READ + AI_USE + domainCapability` manualmente.
3. **Extensão obrigatória do gate arquitetural existente**: `rbac-choke-point.test.ts` precisa passar a reconhecer o novo entry point de execução de ferramenta 10C pelo nome exato que a implementação escolher, do mesmo jeito que hoje reconhece `createOrganizationAiGateway`/`askRedeAI`/`aiToolRegistry`. Sem essa extensão, uma nova Server Action/rota que chame o novo executor de ferramentas sem `assertAiUse` não seria pega pelo scanner atual.
4. Reaproveitar o padrão AST real (não regex) de `src/application/ai-gateway/architecture.test.ts` para um scanner equivalente da 10C: nenhum arquivo fora de `src/application/ai-tools/**` (nome proposto, a confirmar) pode importar Prisma diretamente para servir um resultado de ferramenta — toda leitura passa pelos readers já allowlisted da 10B.
5. O catálogo de ferramentas nunca é serializado por completo ao cliente com `execute`/lógica interna — só `list()` (nome, descrição, modo, papel mínimo, capability) é exposto, exatamente como `AIToolRegistry.list()` já faz hoje (`tool-registry.ts:127`).

## 14. Necessidade real de migration — aprovado (Decisão 14, §20)

**Decisão: nenhuma migration nesta fatia**, pelo mesmo raciocínio já aplicado pela 10B (seção 20 do contrato 10B). `AIToolCallLog`, `AIExecutionLog`, `AIPendingAction`, `AIUsageBudget` já existem e já cobrem auditoria, vínculo e limite de passos de ferramenta. Nenhuma nova tabela é necessária porque nenhuma ferramenta do perfil inicial persiste dado de negócio próprio — cada ferramenta delega inteiramente ao Context Engine (10B) e ao ledger (10A), que já têm sua persistência resolvida. **Se, durante a implementação, os modelos existentes não sustentarem alguma garantia exigida por este contrato, a implementação para e pede autorização explícita — nunca improvisa persistência alternativa em JSON dentro de um campo existente para contornar a ausência de uma coluna/tabela.** Se uma decisão humana futura exigir um catálogo de ferramentas administrável por UI (hoje o catálogo é só código), isso reabriria a análise de migration com caso concreto — não presumido aqui.

## 15. Reaproveitamento — mapa explícito

| Mecanismo | Existente | Reaproveitado como está | Proposto (novo) |
| --- | --- | --- | --- |
| RBAC cumulativo (`assertAiUse`) | ✅ `src/application/ai-gateway/rbac.ts` | ✅ Sem alteração de forma | — |
| Capabilities por domínio | ✅ `src/domain/auth/read-capabilities.ts` | ✅ Sem novo enum | — |
| Seleção/minimização/proveniência de evidência | ✅ `src/domain/context-engine`, `src/application/context-engine` | ✅ Reader e política reaproveitados 1:1 para 4 propósitos | Reader novo só para `FINANCIAL_VARIANCE_EXPLANATION` (ver seção 16 — fora do perfil inicial) |
| Ledger/orçamento/idempotência de provider | ✅ `src/application/ai-gateway/ledger-service.ts` | ✅ Sem alteração | Vínculo de propósito de ferramenta no `idempotencyKey` de uma chamada de Gateway subsequente, se e quando existir |
| Persistência de chamada de ferramenta | ✅ `AIToolCallLog` (schema) | ✅ Sem migration | — |
| Limite de passos de ferramenta | ✅ `AIUsageBudget.maxToolSteps` | ✅ Sem alteração | — |
| Gate arquitetural (scanner AST) | ✅ padrão em `ai-gateway/architecture.test.ts` | Padrão reaproveitado | Novo scanner específico de `src/application/ai-tools/**` |
| Guarda de dados simples (anti-getter/Proxy) | ✅ `isPlainContextData` (`domain/context-engine/contracts.ts`) | ✅ Reaproveitada para `AiToolInvocationRequest.arguments` | — |
| Catálogo de 116 ferramentas legadas (`tool-registry.ts`) | ✅ Existe, real, testado | ❌ **Não** reaproveitado como está — lê `workspace` enriquecido, não `ContextBundle` | 4 ferramentas do perfil inicial são reescritas do zero sobre Context Engine; as outras 112 permanecem no caminho legado atual, sem migração forçada nesta fatia |
| `planAIIntent` (roteador determinístico) | ✅ Existe | Continua servindo o caminho legado sem alteração | Decisão 5 (§20), aprovada: as novas ferramentas ficam isoladas do roteador determinístico nesta fase; integração produtiva é decisão humana futura, separada |

## 16. Relação exata com 10A, 10B e 10D

**Com a 10A**: a 10C nunca chama um provider diretamente; quando um resultado de ferramenta precisa virar texto para o usuário, isso passa por `AiGateway.execute` com `contextBundle` obrigatório — o mesmo caminho que `askRedeAI` já usa após a integração da 10B. A 10C não cria um segundo ledger, um segundo circuit breaker ou uma segunda política de orçamento.

**Com a 10B**: a 10C é uma consumidora, não uma extensão silenciosa. Toda ferramenta do perfil inicial mapeia 1:1 a um `ContextPurpose` já aprovado. Uma ferramenta que precisasse de um propósito/reader ainda não implementado (`FINANCIAL_VARIANCE_EXPLANATION`, `CLOSURE_EVIDENCE`, decisões — seção 17 desta diagnose) exige primeiro uma extensão da 10B, com sua própria revisão adversarial, antes de a 10C poder oferecer essa ferramenta — nunca o inverso.

**Com a 10D**: a 10C formaliza a capacidade; a 10D (fora de escopo) decidiria, no futuro, se um agente pode encadear várias chamadas de ferramenta autonomamente, com seu próprio orçamento de passos e sua própria auditoria de plano. Nada nesta fatia implementa loop de agente, memória de longo prazo entre execuções de ferramenta, ou decisão do modelo sobre qual ferramenta chamar — isso continua sendo `planAIIntent` (determinístico) no caminho legado. Decisão 5 (§20), aprovada: as novas ferramentas 10C não entram nesse roteador nesta fase; uma decisão humana futura, separada, definirá se/quando entram ou se aguardam a 10D.

## 17. Matriz inicial recomendada de ferramentas para um piloto seguro

Avaliação de prontidão real dos 7 candidatos sugeridos, cruzando com os readers/políticas que **já existem e já foram auditados** pela 10B (seção 4 do contrato 10B; `readers.ts`):

| Candidato | `ContextPurpose` correspondente | Reader existe? | Prontidão |
| --- | --- | --- | --- |
| Resumo da viabilidade aprovada | `EXECUTIVE_PROJECT_SUMMARY` | ✅ `readStudyEvidence` | **Pronto — sem novo trabalho de 10B** |
| Riscos ativos | `RISK_REVIEW` | ✅ `readStudyEvidence` (mesma fonte, política diferente) | **Pronto — sem novo trabalho de 10B** |
| Andamento de engenharia | `ENGINEERING_PROGRESS_REVIEW` | ✅ `readEngineeringEvidence` | **Pronto — sem novo trabalho de 10B** |
| Evidências jurídicas verificadas | `LEGAL_EVIDENCE_SUMMARY` | ✅ `readLegalEvidence` | **Pronto — sem novo trabalho de 10B** |
| Comparação previsto × realizado | `FINANCIAL_VARIANCE_EXPLANATION` | ❌ Política existe (`policy.ts:15`), **nenhum reader lê `ForecastEvaluation`/`LedgerSnapshot`/`RevenueRecognitionRun`** | Não pronto — exige extensão de reader na 10B primeiro |
| Situação financeira consolidada | Nenhum — dado de caixa/contas a pagar/receber vem hoje só de `getFinancialWorkspace` (workspace legado, fora do Context Engine) | ❌ Sem `ContextSourceType` nem reader | Não pronto — exige diagnóstico próprio de quais fontes financeiras consolidadas entram no Context Engine, incluindo se "situação financeira" deve incluir contas bancárias por empresa (a 10B já sinalizou isso como escopo mais amplo que um projeto, seção 5 do contrato 10B) |
| Histórico de decisões | Nenhum — `DecisionLedgerEntry` não está em nenhum `allowedSourceTypes` de nenhuma política atual | ❌ `DecisionLedgerEntry` não tem campo de versão/checksum próprio (`prisma/schema.prisma:3350-3364`); a 10B já registrou essa limitação (seção 4 do contrato 10B) | Não pronto — o candidato de maior novo trabalho e maior risco de proveniência |

**Recomendação para a primeira fatia**: as **4 ferramentas prontas** (resumo da viabilidade aprovada, riscos ativos, andamento de engenharia, evidências jurídicas verificadas) — todas leitura pura, todas sobre um `ContextPurpose` já implementado, testado e auditado pela 10B, **zero trabalho novo de reader/política**. Isso demonstra valor real (quatro áreas de domínio distintas: executivo, risco, engenharia, jurídico) com a menor superfície nova possível: só a casca de nomeação/validação/auditoria de ferramenta descrita na seção 6.

Os outros 3 candidatos (previsto×realizado, situação financeira consolidada, histórico de decisões) ficam **explicitamente fora desta primeira fatia — Decisão 3 (§20), aprovada** — não porque sejam menos valiosos, mas porque cada um abriria trabalho de 10B não auditado ainda (reader novo, ou até política/fonte nova). Nenhuma extensão paralela da 10B é iniciada nesta fase. Promovê-los no futuro exigiria primeiro uma extensão aprovada da 10B, seguindo o mesmo rigor (revisão adversarial, PostgreSQL real, IDOR) já usado pelos 3 readers existentes.

## 18. Plano de testes (planejado — nenhum criado nesta etapa)

| Grupo | Casos objetivos |
| --- | --- |
| Domínio puro | Validação de `AiToolInvocationRequest`/`arguments` via `isPlainContextData` + Zod estrito; enum fechado de `toolName`; nenhum getter/Proxy/prototype hostil executado (mesmos canários da 10B) |
| Registro/catálogo | Ferramenta sem `domainCapability` mapeada falha em boot (mesmo padrão de `AIToolRegistry`); `list()` nunca expõe `execute`/lógica interna; nome duplicado é rejeitado |
| RBAC cumulativo | Cada uma das 4 ferramentas do piloto: `OWNER/ADMIN/ANALYST/REVIEWER` autorizados, `VIEWER` sempre negado (sem `AI_READ`); capability de domínio errada negada; `minimumRole` por ferramenta testado nos dois sentidos |
| IDOR/cross-tenant | Outro tenant, outro projeto do mesmo tenant, conversa de outro autor, projeto inexistente/arquivado — todos com a mesma resposta indistinguível `TOOL_ACCESS_DENIED`, herdando os testes já existentes de `prepareContextBundleInTransaction` |
| Integração com Context Bundle | Ferramenta devolve exatamente a mesma projeção que `renderContextBundleForTransport` produziria para o mesmo propósito/escopo; bundle vencido (60s) recusado; fonte revogada durante a chamada recusada |
| Concorrência real, PostgreSQL real | `Promise.all` com `PrismaClient`s independentes chamando a mesma ferramenta simultaneamente sobre o mesmo projeto — nenhuma leitura inconsistente, nenhum vazamento entre tenants; corrida entre revogação de fonte e chamada de ferramenta (mesmo padrão de barreira/releitura já provado pela 10B) |
| Limites | `maxToolSteps` respeitado; timeout de transação (15s) respeitado; rate limit por ferramenta (proposto) testado com corrida real |
| Gate arquitetural | Scanner AST equivalente ao da 10A cobrindo `src/application/ai-tools/**`; `rbac-choke-point.test.ts` estendido falha se o novo entry point de execução de ferramenta for importado sem `assertAiUse` |
| Auditoria | `AIToolCallLog` grava exatamente uma linha por chamada, sem conteúdo bruto, sem PII, truncamento a 16 KB respeitado |
| Regressão 10A/10B | Nenhuma ferramenta nova reabre os achados já corrigidos (TOCTOU, autorização process-local, binding temporal, propriedades não enumeráveis, prova multi-instância) — reexecutar os testes existentes dessas correções como parte da suíte de aceite desta fatia |

## 19. Critérios de aceite, reprovação e riscos residuais

### 19.1 Aceite (cumulativo)

1. Base/SHA explícitos; CI verde no SHA de integração (GitHub Actions **e** o projeto Vercel oficial `rede-intelligence` — Decisão 1, §20).
2. As 4 ferramentas do perfil inicial mapeiam 1:1 a um `ContextPurpose` já existente, sem nenhum reader/política novos na 10B.
3. Zero ferramenta de escrita habilitada; `MUTATION`/`SIMULATION` continuam desabilitados por política explícita.
4. RBAC cumulativo idêntico ao já estabelecido, com `rbac-choke-point.test.ts` estendido cobrindo o novo entry point.
5. Nenhuma migration criada.
6. Testes puros, PostgreSQL real, concorrência e gate arquitetural aprovados, incluindo regressão da 10A/10B.
7. Nenhum resultado de ferramenta contém PII, storageKey, checksum integral ou objeto Prisma bruto.

### 19.2 Reprovar se

Qualquer ferramenta aceitar `organizationId`/`projectId`/`role`/`capability` do cliente; qualquer ferramenta de escrita for habilitada sem decisão humana explícita; uma ferramenta ler fonte fora de um `ContextPurpose` já aprovado; `VIEWER` conseguir executar qualquer ferramenta; uma resposta de ferramenta distinguir "outro tenant" de "inexistente"; o gate arquitetural for desabilitado para passar CI; uma ferramenta reintroduzir qualquer um dos achados já corrigidos na 10A/10B.

### 19.3 Riscos residuais

| Risco | Tratamento |
| --- | --- |
| CI Vercel misto (3 projetos legados em failure) | Resolvido — Decisão 1 (§20): `rede-intelligence` é o projeto oficial; os 3 secundários ficam fora do gate e serão desativados administrativamente fora desta sessão |
| Catálogo legado de 116 ferramentas continua fora do Context Engine | Aceito nesta fatia — Decisão 5 (§20): as novas ferramentas ficam isoladas, sem substituir `planAIIntent`/o catálogo legado; migração completa é trabalho maior, não presumido aqui; risco de duas superfícies de "ferramenta" coexistirem até decisão humana futura sobre convergência |
| `changeContext` classificado incorretamente como `READ_ONLY` no catálogo legado | Corrigido nesta implementação — Decisão 9 (§20): reclassificada para `MUTATION` (só o rótulo; lógica funcional intacta), excluída do catálogo 10C, com regressão arquitetural dedicada |
| Exfiltração por acumulação de pequenas variações de argumento | Mitigação parcial por `maxToolSteps`/rate limit; não é garantia absoluta — mesma limitação já reconhecida pela 10B para o risco equivalente de prompt injection |
| Nenhum provider real conectado hoje | O piloto de ferramentas de leitura funciona e é auditável independentemente disso; qualquer teste de "ferramenta escolhida pelo modelo" (function calling real) não é possível nesta base sem uma decisão comercial separada |

## 20. Decisões humanas — aprovadas em 15/09/2026

As 15 decisões abaixo foram apresentadas com pergunta objetiva, opções, recomendação técnica, impacto/risco por opção, efeito sobre as garantias da 10A/10B e necessidade de migration numa rodada de auditoria independente anterior a este adendo, e foram **aprovadas pelo usuário sem alteração** na resposta "FASE 10C — DECISÕES APROVADAS E AUTORIZAÇÃO DE IMPLEMENTAÇÃO". As decisões 9–13 eram apenas implícitas em prosa nas seções 4.3, 5.2, 6.1, 9 e 10 na etapa de diagnóstico; ganham aqui numeração formal, exigida para rastreabilidade.

1. **Projeto Vercel oficial.** `rede-intelligence` é o projeto oficial. `rede-intelligence-jansen`, `rede-intelligence-v1` e `rede-intelligence-v2` são duplicados legados, ficam fora do gate de aceite da 10C e serão desativados administrativamente em ação separada, fora deste repositório/sessão.
2. **Catálogo inicial de 4 ferramentas.** A primeira fatia contém exatamente quatro ferramentas `READ_ONLY`: resumo da viabilidade aprovada, riscos ativos, andamento de engenharia, evidências jurídicas verificadas — cada uma mapeada 1:1 a um `ContextPurpose` já implementado e auditado pela 10B (seção 17).
3. **Exclusão dos 3 candidatos não prontos.** Previsto × realizado, situação financeira consolidada e histórico de decisões ficam fora desta fatia. Nenhuma extensão paralela da 10B é iniciada nesta fase.
4. **Exclusão total de ferramentas de escrita.** Nenhuma ferramenta `SIMULATION` ou `MUTATION` entra na 10C. `createDecisionSimulation` e `generateStudioDraft` do catálogo legado não são portados nem duplicados.
5. **Isolamento do roteador legado.** `planAIIntent` não é alterado; o fluxo legado não é substituído. As quatro novas ferramentas ficam isoladas — sem integração produtiva no chat existente — até auditoria e autorização posterior explícita de integração.
6. **Gate arquitetural obrigatório.** A extensão de `rbac-choke-point.test.ts` e a criação de um scanner arquitetural dedicado (AST real, mesmo padrão da 10A/10B) são pré-requisito obrigatório desta entrega, não item opcional nem posterior.
7. **Rate limit dedicado por ferramenta.** Implementado nesta fatia, reaproveitando `checkAndConsumeRateLimit` com chave de escopo própria por ferramenta, deliberadamente sem se misturar com o orçamento/rate limit de transporte a provider da 10A.
8. **Nome do módulo.** `src/application/ai-tools` (com par de domínio em `src/domain/ai-tools`) é o nome definitivo.
9. **Destino de `changeContext`.** Reclassificada para `mode: "MUTATION"` no registro legado (`src/application/ai/tool-registry.ts`) — só o rótulo; sua lógica funcional (persistir a seleção de contexto da conversa) permanece intacta e inalterada nesta fase. Fica fora do catálogo 10C. Ganha regressão arquitetural dedicada que impede reclassificá-la (ou qualquer ferramenta com escrita Prisma alcançável) como `READ_ONLY` no futuro.
10. **Protocolo transacional completo para toda ferramenta.** Mesmo as quatro ferramentas de leitura pura usam o protocolo de consumo completo já existente na 10B — `prepareContextBundle` seguido de consumo transacional equivalente a `consumeContextBundleInTransaction` (revalidação imediatamente antes da execução, binding persistido, CAS) — não apenas a etapa de preparo. O risco de contenção adicional sob a barreira `SHARE` (já documentado como residual pela 10B) é aceito conscientemente, temporariamente, em vez de introduzir uma bifurcação de disciplina entre "ferramenta de leitura" e "transporte a provider".
11. **Vínculo obrigatório de execução.** Cada execução de ferramenta é vinculada no servidor a ator, organização, projeto, conversa, finalidade (`ContextPurpose`), `ContextBundle`, `correlationId`, identidade da chamada e o registro de ledger/auditoria correspondente. Nenhum desses valores é aceito do modelo ou do cliente.
12. **Idempotência e auditoria.** `AIToolCallLog` e os mecanismos existentes são reaproveitados sem alteração de schema. Nenhum `idempotencyKey` novo é criado para leitura. Replay ou concorrência sobre o mesmo consumo deve resultar em, no máximo, uma execução efetivamente contabilizada — garantido pelo mesmo CAS transacional da Decisão 10, nunca por uma segunda tabela ou mecanismo paralelo de deduplicação.
13. **Papéis e capabilities.** `minimumRole = REVIEWER` para as quatro ferramentas do piloto, cumulativo com membership ativa, `AI_READ`, `AI_USE` e a `domainCapability` do propósito correspondente. `VIEWER` permanece bloqueado.
14. **Nenhuma migration.** Confirmado. Se, durante a implementação, os modelos existentes não sustentarem alguma garantia exigida por este contrato, a implementação para e pede autorização explícita — nunca improvisa persistência alternativa em JSON para contornar a ausência de uma coluna/tabela.
15. **Fronteira de escopo confirmada.** Nenhuma integração produtiva, rota pública nova, ferramenta de escrita, provider externo ou qualquer parte das fases 10D–10I é criada, habilitada ou pressuposta nesta entrega.

Nenhuma decisão acima permanece pendente. Onde a implementação encontrar um caso não previsto por estas 15 decisões, o comportamento é recusa/exclusão de escopo até nova aprovação explícita — nenhum default permissivo é assumido.

## 21. Plano de implementação em fatias pequenas (proposto para a próxima etapa)

| Fatia | Entrega | Gate de saída |
| --- | --- | --- |
| 0 — Aprovação | Este documento aprovado; decisões da seção 20 resolvidas | Aprovação humana explícita |
| 1 — Contratos | `AiToolInvocationRequest`/`AiToolDefinition`/`AiToolResult`/`AiToolError` em domínio puro, Zod `.strict()`, sem Prisma | Testes puros; revisão adversarial |
| 2 — Registro e autorização | Registro fechado das 4 ferramentas do piloto + `AiToolAuthorization` reaproveitando `assertAiUse` | RBAC cumulativo testado, IDOR testado |
| 3 — Execução sobre Context Engine | Cada ferramenta invoca `prepareContextBundle`/`renderContextBundleForTransport` do propósito correspondente | PostgreSQL real; concorrência; nenhuma leitura fora do Context Engine |
| 4 — Auditoria e gate arquitetural | `AIToolCallLog` integrado; scanner AST dedicado; `rbac-choke-point.test.ts` estendido | Gate arquitetural comprovado; regressão 10A/10B verde |
| 5 — Encerramento | Revisão adversarial independente, QA completo, checkout limpo | Aceite humano; produção continua decisão separada |

## 22. Síntese final — existente, reaproveitado, proposto, fora de escopo

**Existente e confirmado nesta sessão**: 116 ferramentas reais (nenhum mock) no catálogo legado; RBAC cumulativo (`assertAiUse`) já é o choke point único e já testado; `AIToolCallLog`/`AIExecutionLog`/`AIPendingAction`/`AIUsageBudget` já cobrem persistência de tentativa/custo/passo; 4 de 5 `ContextPurpose` da 10B já têm reader funcionando (três funções de reader — `readStudyEvidence`, `readLegalEvidence`, `readEngineeringEvidence` — cobrindo `EXECUTIVE_PROJECT_SUMMARY`, `RISK_REVIEW`, `LEGAL_EVIDENCE_SUMMARY` e `ENGINEERING_PROGRESS_REVIEW`; só `FINANCIAL_VARIANCE_EXPLANATION` está sem reader); `AiModelCapability.TOOL_USE` é só um valor de enum reservado, sem implementação; nenhuma ferramenta de escrita real está habilitada hoje (a única `MUTATION` é um placeholder inerte); `changeContext` era, até este adendo, rotulada `READ_ONLY` apesar de gravar — corrigida pela Decisão 9; `planAIIntent` é 100% determinístico, sem modelo no laço de escolha de ferramenta.

**Reaproveitado sem alteração de forma**: RBAC, capabilities de domínio, ledger, orçamento, guarda anti-getter/Proxy, padrão de scanner AST, `AIToolCallLog`, protocolo transacional completo de preparo+consumo da 10B (Decisão 10).

**Aprovado nesta rodada, pronto para implementação**: os 7 contratos provider-neutral da seção 7; a casca de nomeação/validação/autorização/execução/auditoria de ferramenta da seção 6; a extensão do gate arquitetural e do choke point de RBAC (Decisão 6); rate limit dedicado por ferramenta (Decisão 7); o mapeamento 1:1 das 4 ferramentas do piloto aos propósitos já existentes da 10B (Decisão 2); a correção de rótulo de `changeContext` (Decisão 9); o nome do módulo `src/application/ai-tools` (Decisão 8).

**Fora de escopo desta fatia, explicitamente (Decisões 3, 4, 5, 15)**: os 3 candidatos não prontos (previsto×realizado, situação financeira consolidada, histórico de decisões); qualquer ferramenta de escrita/simulação; migração do catálogo legado de 116 ferramentas para o novo padrão; integração produtiva com `planAIIntent`/o chat existente; qualquer decisão sobre tool-calling autônomo de um provider real; toda a Fase 10D (agentes, planejamento autônomo, encadeamento decidido pelo modelo) e as fases 10E–10I.

## 23. Estado Git final

```
Branch: codex/fase-10c-tool-layer
HEAD:   f4586dcf2c005f32d02d47a202ed17d13502f0db (idêntico ao commit-base — nenhum commit criado)
Upstream: não configurado
Staged: nenhum
Working tree: 1 arquivo novo, não rastreado — docs/PHASE_10C_TOOL_LAYER_CONTRACT.md (este documento)
```

Nenhum commit, push, merge, rebase ou tag foi executado. Este estado reflete o momento imediatamente anterior ao início da implementação autorizada pelas 15 decisões aprovadas da seção 20; a implementação em si, seus testes e o resultado de QA são registrados separadamente, quando concluídos, em `docs/PHASE_10C_AUDIT_RECORD.md`, mantendo a mesma branch e o mesmo HEAD-base até nova instrução.

## 24. Correção focal pós-auditoria (16/09/2026) — invariantes finais

Uma auditoria adversarial independente sobre a implementação da seção 20 encontrou 5 achados reais (ALTO-1, ALTO-2, MÉDIO-4, MÉDIO-5, MÉDIO-6) na Tool Layer nova e 1 achado (ALTO-3) sobre o catálogo legado, fora do piloto. Nenhum achado permitia execução fora do registro, bypass de RBAC/tenant, escrita no piloto ou dado sensível vazado — a superfície de segurança central já resistia a sondas adversariais. Os achados eram sobre coerência de auditoria, superfície pública estrutural e isolamento de rate limit. Todos foram corrigidos nesta correção, sem ampliar o escopo da 10C, sem migration e sem alterar o comportamento funcional das quatro ferramentas aprovadas (mesmas 4, mesmos propósitos, mesmo RBAC, mesma saída). Detalhe completo da causa, reprodução e correção de cada achado em `docs/PHASE_10C_AUDIT_RECORD.md`, seção "Correção focal pós-auditoria".

Os invariantes abaixo passam a ser normativos, substituindo (não contradizendo) a descrição correspondente das seções 6, 9 e 10 acima, que descreviam a intenção original:

1. **Estado terminal monotônico (ALTO-1).** Toda transição do `AIExecutionLog` de uma tentativa de ferramenta é um CAS guardado pelo status anterior esperado (`updateMany` com `where: {status: {in: [...]}}`), nunca um `update` incondicional. Um `COMPLETED` gravado pelo vencedor de uma corrida nunca pode ser sobrescrito por um perdedor tardio — um perdedor cujo CAS não se aplica mais simplesmente não toca o `AIExecutionLog`, mas ainda registra sua própria tentativa em `AIToolCallLog`. As duas escritas (CAS do `AIExecutionLog` e criação do `AIToolCallLog`) ocorrem na mesma transação Prisma, atomicamente.
2. **Choke point estruturalmente único (ALTO-2).** `prepareAiToolInvocation` e `consumeAiToolInvocation` (as duas fases internas que `executeAiTool` compõe) nunca são reexportadas por `src/application/ai-tools/index.ts` — o barril público usa `export { executeAiTool } from "./service"` nomeado, nunca `export *`. Um gate arquitetural dedicado (`architecture.test.ts`) falha se qualquer arquivo fora de `src/application/ai-tools/**`/`src/domain/ai-tools/**` mencionar esses dois identificadores sob qualquer forma de import, e uma prova em runtime confirma que o módulo público não os expõe como propriedade. Uma preparação cujo processo é interrompido antes do consumo deixa um `AIExecutionLog` `QUEUED` órfão, reconciliado com segurança pelo reaper genérico já existente da 10A (`reapExpiredGatewayReservations`), sem nenhum código novo específico da Tool Layer.
3. **Rate limit isolado por ator (MÉDIO-4).** A chave de escopo de `checkAndConsumeRateLimit` é `ai-tool:<toolName>:<safeContextRef("actor", userId)>`, combinada com `organizationId` como parâmetro próprio da função — nunca o `userId` bruto, sempre uma referência determinística segura (mesmo primitivo `safeContextRef` já usado pela 10B). Um ator não pode esgotar o orçamento de outro; ferramentas e tenants nunca compartilham contador.
4. **`toolName` nunca persistido bruto quando inválido (MÉDIO-5).** Qualquer entrada que não resolva a uma das 4 ferramentas do registro fechado grava exclusivamente o sentinel estático `"UNKNOWN_TOOL_NAME"` em `AIToolCallLog.tool` — nunca o valor controlado pelo cliente/modelo, independentemente de tamanho, charset, controles, CRLF, NUL, bidi ou zero-width.
5. **Cobertura de replay explícita (MÉDIO-6).** O estado final do `AIExecutionLog` após replay concorrente (2, 5, 10 e 20 tentativas, repetido) é uma asserção de teste de primeira classe, não apenas o valor de retorno ou a contagem de `AIToolCallLog`.
6. **Catálogo legado: nominado, não alterado (ALTO-3).** Um manifesto fixo, mantido a mão (nunca gerado/auto-atualizado em teste), em `src/application/ai/tool-registry.regression.test.ts`, nomeia as 13 ferramentas legadas `READ_ONLY` cujo getter de workspace grava antes de ler (`getLegalReadiness`, `getLegalDeadlines`, `getPropertyDueDiligence` via `getLegalWorkspace`; `getSalesInventory`, `getUnitTypologyPerformance`, `getPricePerSquareMeter`, `getDiscountGranted`, `getExpiringProposals`, `getDelinquentCustomers`, `getReceivableCurve`, `getRescindedUnits`, `getPendingCommissions`, `getUnitsAwaitingDelivery` via `getSalesWorkspace`). Nenhuma delas foi reclassificada ou refatorada nesta correção — isso mudaria permissão/comportamento fora do piloto, decisão de produto separada. Um gate preventivo falha se uma ferramenta nova passar a chamar um desses dois getters impuros sem entrar no manifesto, e confirma que nenhuma das 13 está no catálogo novo.

## 25. Estado Git após a correção focal

```
Branch: codex/fase-10c-tool-layer
HEAD:   f4586dcf2c005f32d02d47a202ed17d13502f0db (inalterado — nenhum commit criado)
Upstream: não configurado
Staged: nenhum
```

## 26. Correção BLOQUEADORA final pós-reauditoria (16/09/2026) — retificação do invariante 2

Uma reauditoria focal independente sobre a correção da seção 24 reproduziu um **bypass
funcional** do choke point estrutural: o invariante 2 acima ("as duas fases internas
continuam `export`adas em `service.ts`, apenas não reexportadas por `index.ts`, e um gate
textual garante isso") permitia que um arquivo fora do pacote montasse o nome do identificador
em runtime (`["prepare","Ai","Tool","Invocation"].join("")`), fizesse `import()` dinâmico de
`./service` e acessasse a função por colchete — o gate textual (`content.includes(identifier)`)
não detectava porque o identificador nunca aparecia literalmente no arquivo ofensor, e a
chamada real confirmou que a função interna era de fato alcançável de fora do pacote.
Classificado ALTO/BLOQUEADOR pela própria reauditoria; impedia o veredito APROVADO PARA
COMMIT. Detalhe completo em `docs/PHASE_10C_AUDIT_RECORD.md`, seção "Correção BLOQUEADORA
final pós-reauditoria — ALTO-2".

**O invariante 2 da seção 24 fica retificado (não apenas re-testado) pelo texto abaixo, que
passa a ser normativo:**

2'. **Choke point estruturalmente único, por ausência de binding (ALTO-2, retificado).**
`prepareAiToolInvocation` e `consumeAiToolInvocation` deixaram de ser `export`adas de
`service.ts` — são funções privadas de escopo de módulo. Um módulo ES só expõe os bindings
que declara com `export`; não existe técnica de import (estática, dinâmica, `require`, acesso
computado, concatenação, reflexão) capaz de obter um binding não exportado a partir do objeto
de namespace do módulo, independentemente de como o identificador é escrito no arquivo
importador. Isto fecha a classe inteira de bypass, não só a instância reproduzida pela
reauditoria, e é a garantia real — não o gate. O gate arquitetural (`architecture.test.ts`)
foi reescrito de varredura textual para AST real (TypeScript Compiler API, mesmo padrão de
`ai-gateway/architecture.test.ts`), como defesa em profundidade e diagnóstico precoce, nunca
como a única garantia. Os testes de corrida do pacote passaram a usar um harness dedicado
(`__raceTestPrepare`/`__raceTestConsume`/`__raceTestConsumeInSubprocess`, definido no mesmo
arquivo, com acesso léxico direto às funções privadas) que nunca devolve o `ContextBundle` -
apenas status terminal e um handle opaco válido só no processo de teste corrente. Uma
preparação cujo processo é interrompido antes do consumo continua deixando um `AIExecutionLog`
`QUEUED` órfão, reconciliado pelo mesmo reaper genérico da 10A, sem nenhum código novo
específico da Tool Layer - comportamento inalterado por esta retificação.

Os invariantes 1, 3, 4, 5 e 6 da seção 24 permanecem válidos e inalterados por esta correção -
o escopo desta retificação é exclusivamente o invariante 2 (ALTO-2).

## 27. Estado Git após a correção bloqueadora final

```
Branch: codex/fase-10c-tool-layer
HEAD:   f4586dcf2c005f32d02d47a202ed17d13502f0db (inalterado — nenhum commit criado)
Upstream: não configurado
Staged: nenhum
```

Nenhum commit, push, merge, rebase ou tag foi executado por esta correção. Nenhuma migration foi criada. Parando para reauditoria focal independente, conforme solicitado.
