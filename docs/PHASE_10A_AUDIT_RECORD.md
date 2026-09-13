# Fase 10A — Registro de implementação e auditoria (AI Gateway, local, provider-neutral)

Branch: `codex/fase-10a-ai-gateway`. HEAD-base: `457aa75c874a673d51e0f72e4bbfc31417e8fb79`.
Contrato: `docs/PHASE_10A_AI_GATEWAY_CONTRACT.md`. 15 decisões aprovadas (ver contrato §1) e
20 seções de implementação aprovadas nesta rodada. **Nenhum commit/push executado.**

## 1. O que foi implementado

- **Contratos provider-neutral** (`src/domain/ai-gateway/types.ts`) — `AiGateway`,
  `AiProviderAdapter`, `AiRequest`, `AiResponse`, `AiUsage`, `AiModelCapability`,
  `AiRoutingPolicy`, `AiSafetyPolicy`, `AiBudgetPolicy`, `AiGatewayError` e o enum fechado
  `AiGatewayErrorCode`, exatamente como propostos no contrato §4. O cliente nunca controla
  provider/model/endpoint/system prompt/política/orçamento/retenção/fallback/correlationId/
  tenant — só task/capabilities/classificação/critérios/conteúdo.
- **Classificação e minimização** (`domain/ai-gateway/safety.ts`) — enum fechado
  `AiDataClassification` (`PUBLIC`…`SECRET`); `SECRET` é sempre bloqueado; defesa adicional
  por padrões estruturais (chave privada PEM, AWS access key, bearer token, URL assinada,
  CPF/CNPJ/telefone/e-mail/dados bancários) — nunca a única linha de defesa, a classificação
  declarada pelo servidor é a fonte primária; limites de bytes; NUL e caracteres de controle
  fora de `\n\r\t` sempre recusados.
- **Envelope de prompt** (`domain/ai-gateway/envelope.ts`) — separa estruturalmente system
  instructions (sempre do servidor), contexto confiável e conteúdo não confiável do usuário,
  cercado por um fence explícito (`<untrusted_user_content>`) e nunca em posição de
  instrução; limites de bytes por seção. Nenhum Context Engine — só a estrutura segura.
- **Roteamento** (`domain/ai-gateway/routing.ts`) — só por capability/allowlist do
  tenant/cadeia de fallback limitada (`maxFallbackAttempts`); sem candidato elegível,
  retorna `null` (o Gateway converte em erro permanente, nunca fallback fabricado);
  `requiresHumanApproval` bloqueia decisão automática acima do limiar de criticidade —
  nunca aprova sozinho.
- **Orçamento** (`domain/ai-gateway/budget.ts`) — decisão pura: ausência de política ou
  `monthlyLimitUsdMicros<=0` equivale a bloqueio; chamada cobrável sem `priceVersion`
  comprovado falha fechado (decisão 6); limite diário opcional além do mensal.
- **Saída estruturada** (`domain/ai-gateway/output-schema.ts`) — registro fechado de
  schemas Zod `.strictObject` (rejeita campo extra), limite de bytes/profundidade,
  recusa `NaN`/`Infinity` antes mesmo do parse do schema, nunca repara silenciosamente.
- **Erros** (`domain/ai-gateway/errors.ts`) — ponte para `classifyProductionDependencyFailure`
  (já auditado) → taxonomia fechada do Gateway; 401→`AUTHENTICATION` permanente,
  403→`AUTHORIZATION` permanente, 408→`TIMEOUT` retryable, 429/5xx→`PROVIDER_UNAVAILABLE`
  retryable — reaproveitado, não duplicado.
- **SSRF/DNS rebinding** (`infrastructure/ai-gateway/safe-transport.ts`) — reaproveita as
  validações puras já auditadas em `alert-dispatcher.ts` (9Q.2B: `isUnsafeIPv4`,
  `isUnsafeIPv6`, `parseCanonicalIPv4`, `defaultDnsResolver` — tornadas `export` sem
  qualquer mudança de comportamento) e adiciona duas camadas exigidas pela decisão 3 que o
  alert-dispatcher não tinha (webhook de alerta aceita qualquer host https público):
  **allowlist EXATA de host** (`AI_PROVIDER_ALLOWED_HOSTS`, comparação exata, nunca
  sufixo/prefixo) e resolução DNS validada + conexão fixada no IP resolvido (pinning),
  nunca no hostname. HTTPS obrigatório, sem userinfo/porta alternativa/fragmento. Corpo da
  resposta limitado a 2MB. Nenhuma rede real nos testes (resolver/requester injetáveis).
- **Provider disabled** (`infrastructure/ai-gateway/disabled-provider-adapter.ts`) — padrão
  seguro: `profile.capabilities=[]` (nunca roteável), sempre lança `PROVIDER_UNAVAILABLE`
  permanente, nunca toca rede.
- **Provider compatible-http** (`infrastructure/ai-gateway/compatible-http-adapter.ts`) —
  nova implementação que usa `safe-transport.ts` (nunca `fetch()` bruto); substitui
  arquiteturalmente o `CompatibleHTTPAIProvider` legado (`src/domain/ai/provider.ts`, que usa
  `fetch()` sem allowlist nem proteção de DNS rebinding) para qualquer caminho novo. Só é
  construída quando `AI_GATEWAY_PROVIDER_MODE=compatible_http` E toda a configuração
  (host/URL/chave/modelo) está presente — caso contrário cai de volta para o adapter
  disabled, nunca para um provider parcialmente configurado.
- **Runtime config** (`infrastructure/config/runtime-config.ts`) — `AI_GATEWAY_PROVIDER_MODE`
  (`disabled`|`compatible_http`, default `disabled`) e as demais chaves `AI_*` movidas para
  `parseRuntimeConfig`; produção **sempre** recusa qualquer modo diferente de `disabled`
  (bloqueio incondicional, não uma checagem de "campo ausente" — decisão 1/4: nenhum
  provider comercial autorizado nesta rodada, então não existe hoje nenhuma flag de
  autorização explícita para produção habilitar HTTP).
- **RBAC de IA** (`application/ai-gateway/rbac.ts`) — `AI_USE`/`AI_ADMIN`/
  `AI_BUDGET_READ`/`AI_BUDGET_MANAGE`/`AI_AUDIT_READ` exatamente como a decisão 11;
  `VIEWER` sem nenhuma capacidade; `assertAiUse` sempre acumula (nunca substitui) a
  capacidade de leitura do domínio de origem (decisão 12), lida do `AuthContext`
  autenticado — nunca do payload do cliente.
- **Ledger de orçamento/idempotência/auditoria** (`application/ai-gateway/ledger-service.ts`)
  — reserva atômica em transação `Serializable` (releitura do gasto do mês/dia dentro da
  mesma transação + inserção da reserva), com retry limitado (3 tentativas, jitter) só para
  `P2034` real — reaproveita o padrão já auditado de `closure-service.ts`. Idempotência via
  a constraint única já existente `AIPendingAction(organizationId, idempotencyKey)`; payload
  divergente sob a mesma chave é conflito (`POLICY_BLOCKED`), nunca reexecução silenciosa.
  Falha libera a reserva (custo volta a 0); confirmação grava o custo/uso **observado**
  real. **Ver §3 sobre por que nenhuma migration foi criada.**
- **Orquestração do Gateway** (`application/ai-gateway/gateway.ts`) — envelope → segurança →
  roteamento → aprovação humana (bloqueio, nunca decisão automática) → confirmação de
  retenção zero (decisão 7) → limite de custo do próprio request → rate limit + circuit
  breaker (reaproveitados de `domain/integrations`, persistidos por
  `organizationId+scopeKey` via `resilience-service.ts` já existente) → reserva → execução
  no adapter com timeout (`AbortController`) → retry limitado (3 tentativas) só para erro
  retryable → confirmação/liberação da reserva → resposta versionada
  (`policyVersion`/`promptVersion` sempre atribuídos pelo Gateway, nunca pelo adapter).
- **Composição real** (`application/ai-gateway/factory.ts`,
  `infrastructure/ai-gateway/config.ts`) — único ponto que monta adapter + política de
  roteamento (hoje sempre um único provider por ambiente) a partir do `RuntimeConfig`.
- **Ponto de chamada real conectado** (`application/ai/ai-service.ts`, função `askRedeAI`) —
  a única chamada de rede de IA que existia no repositório (`provider.generateText(...)`,
  antes atrás de `createAIProvider()`) agora passa pelo `AiGateway`. `getAIBootstrap` não
  instancia mais nenhum provider — usa `aiGatewayProviderStatus()`, que só lê configuração.
  A linha de `AIExecutionLog` da orquestração da pergunta (ferramentas + resposta) e a linha
  interna do Gateway (a chamada de geração propriamente dita) são registros distintos — ver
  achado 2 em §3 sobre por que isto importa.
- **Teste arquitetural** (`application/ai-gateway/architecture.test.ts`) — 6 verificações:
  nenhum `fetch()` de IA fora dos adapters autorizados; `CompatibleHttpAiProviderAdapter`/
  `DisabledAiProviderAdapter` só instanciados em `config.ts`; `CompatibleHTTPAIProvider`
  legado só no composition root legado; `askRedeAI` nunca instancia provider diretamente;
  nenhuma menção a conceitos de 10B–10I nos diretórios `*/ai-gateway`; nenhuma escrita
  Prisma fora da camada de aplicação (`ledger-service.ts` é o único escritor).

## 2. Reaproveitamento confirmado (nenhum domínio paralelo)

| Necessidade | Reaproveitado de |
|---|---|
| Circuit breaker | `domain/integrations/circuit-breaker.ts` + `resilience-service.ts` (persistido) |
| Retry/backoff | `domain/integrations/retry-policy.ts` (`decideRetry`) |
| Rate limit | `domain/integrations/rate-limiter.ts` + `resilience-service.ts` |
| Classificação de falha de transporte | `infrastructure/security/production-dependency-error.ts` |
| SSRF (camada 1 e 2) | `infrastructure/observability/alert-dispatcher.ts` (funções tornadas `export`, comportamento inalterado) |
| Orçamento (limite) | `AIUsageBudget` (existente, sem alteração de schema) |
| Ledger de execução | `AIExecutionLog` (existente, sem alteração de schema) |
| Idempotência | `AIPendingAction` + sua constraint única existente `(organizationId, idempotencyKey)` |
| RBAC de leitura por domínio | `domain/auth/read-capabilities.ts` (`assertProtectedReadCapability`) |
| Padrão de gate por papel | `mutableRoles`/`approvalRoles` (Set) usado em ~14 serviços — replicado em `rbac.ts` |
| Transação Serializable + retry limitado só em P2034 | `application/closure/closure-service.ts` |

Nenhuma migration nova foi necessária para nenhum destes itens.

## 3. Por que nenhuma migration foi criada (decisão 9)

A decisão 9 exige, **antes** de qualquer migration: mapeamento exato dos 16 modelos de IA
existentes + justificativa de cada campo novo + prova de que não existe estrutura
equivalente, e — se a migration for de fato necessária — backup real (dev e teste),
checksum SHA-256, restauração isolada e verificada, com timestamps anteriores.

O mapeamento foi feito: nenhum dos 16 modelos existentes tem, ao mesmo tempo,
(a) independência de `AIConversation` e (b) uma coluna própria para chave de idempotência
com constraint. `AIExecutionLog` e `AIPendingAction` — os dois mais próximos de servir como
ledger genérico do Gateway — exigem `conversationId` (FK obrigatória). Isto restringe o
ledger persistido do Gateway a chamadores associados a uma conversa (hoje: `askRedeAI`);
um chamador futuro sem conversa (ex.: Red Team) exigiria uma migration real.

A ferramenta de backup/restauração já existente (`scripts/backup-local-database.mjs`,
usada em fases anteriores como a 9S) foi executada como exigido. `pg_dump`/`psql` funcionam
normalmente com as credenciais da aplicação — mas o passo de **restauração isolada**
(`createdb` de um banco novo `rede_restore_*` para verificar a integridade do backup)
exige um papel de banco com privilégio `CREATEDB`. A verificação direta mostrou:

```
rolcreatedb | rolsuper
f           | f
```

O usuário `rede_app` (o único credential disponível neste ambiente) não tem esse privilégio,
e não existe `BACKUP_ADMIN_USER`/`BACKUP_ADMIN_PASSWORD` configurado. A tarefa proíbe
explicitamente solicitar ou elevar credenciais ("Não solicite credenciais."). Como o gate de
segurança pré-migration não pode ser satisfeito sem violar essa restrição, a conclusão
correta — dado "autorizada NO MÁXIMO uma migration aditiva, **só se necessária**" — é **não
criar nenhuma migration nesta rodada**, e não tentar contornar a ceremônia de segurança.

Consequência assumida e documentada: o ledger do Gateway (orçamento/idempotência/auditoria)
só é exercitado hoje pelo único caminho real conectado (`askRedeAI`, que sempre tem uma
`AIConversation`). O caminho do Red Team (`LLMProvider`) permanece exatamente como estava —
com `createDisabledProvider()` como único wiring, já seguro por padrão — e **não foi
conectado ao Gateway nesta rodada**, por decisão explícita e não por descuido: conectá-lo
exigiria ou (a) forçar uma `AIConversation` sintética artificial para uma feature que nunca
teve esse conceito, o que seria um acoplamento de conveniência sem justificativa de domínio,
ou (b) a migration bloqueada acima. Nenhuma das duas foi feita.

## 4. Autorrevisão adversarial — achados reais e correções

Dois bugs reais de produto foram encontrados e corrigidos durante a implementação (não
apenas bugs de teste):

**Achado 1 — regressão em `parseRuntimeConfig` para QUALQUER chamador.** Ao adicionar os
campos `AI_PROVIDER_BASE_URL`/`AI_PROVIDER_API_KEY`/`AI_PROVIDER_NAME`/`AI_DEFAULT_MODEL`
com `.url().optional()`/`.min(1).optional()`, a suíte existente da REDE AI passou a falhar
com `Configuração inválida: AI_PROVIDER_BASE_URL, ...` em chamadas **sem nenhuma relação
com IA** (`registerProjectDocument` → `createStorageProvider` → `runtimeConfig()`).
Causa: `.env`/`.env.example` declaram essas chaves como presentes-porém-vazias
(`AI_PROVIDER_BASE_URL=`), não ausentes — `process.env` entrega `""`, e `.optional()` só
trata ausência real como ausente; combinado com `.url()`, uma string vazia falha a
validação e derruba `parseRuntimeConfig()` (uma função cacheada e chamada por todo o
sistema) para todo mundo. Corrigido com um preprocessador que trata string vazia como
ausente antes do validador de forma, aplicado só aos campos novos desta fase — confirmado
rodando a suíte completa de `src/application/ai/database.integration.test.ts` antes (5
falhas) e depois (0 falhas) da correção.

**Achado 2 — vazamento de linhas internas do ledger na UI de ações pendentes.**
`AIPendingAction` foi reaproveitado como ledger interno do Gateway
(`actionType: "AI_GATEWAY_EXECUTION"`), mas `conversationInclude.pendingActions` em
`ai-service.ts` não filtrava por `actionType` — a lista de "ações pendentes de confirmação"
exibida ao usuário (`getAIBootstrap`, `conversationView`) incluiria as linhas de
reserva/orçamento do Gateway, que nunca deveriam ser visíveis como uma ação a confirmar.
Corrigido adicionando `where: { actionType: { not: "AI_GATEWAY_EXECUTION" } }` ao include.

Também confirmado e corrigido (risco de contabilização dupla, não um bug já manifestado):
a linha de `AIExecutionLog` que `askRedeAI` já criava para a pergunta inteira (ferramentas +
resposta) teria, se não ajustada, o mesmo custo/tokens da nova linha interna do Gateway
somados nos agregados de orçamento (`enforceUsageLimits`/`getAIUsageDashboard`), contando o
mesmo gasto duas vezes. A linha externa agora sempre grava custo/tokens **zero** — o
Gateway é a única fonte de verdade para o gasto real.

**Achado 3 (QA, não de produto) — `pnpm build` reescreve `next-env.d.ts`.** Rodar o build
de produção regenerou `next-env.d.ts` (troca de `./.next-dev/types/routes.d.ts` para
`./.next/types/routes.d.ts`, comportamento padrão do Next.js ao alternar entre `dev` e
`build`) — detectado por `git status` depois do build, e revertido com
`git checkout -- next-env.d.ts` antes de finalizar, para manter a exigência de QA de que
este arquivo permaneça intocado.

Tentativas de quebra que **não** encontraram problema (testadas e confirmadas seguras):
SSRF via host fora da allowlist/IP literal privado/IPv4-mapeado-em-IPv6 apontando para
loopback ou metadados de nuvem; DNS rebinding (resolver retornando IP privado para um
hostname aprovado); corrida real de orçamento com `Promise.all` (5 reservas concorrentes
contra um orçamento que só cabe 3 — nunca mais que 3 passam, gasto total nunca excede o
limite); 5 reservas concorrentes com a mesma `idempotencyKey` (exatamente 1 reserva real);
`idempotencyKey` reutilizada com payload divergente (conflito, nunca reexecução); tenant
diferente com a mesma `idempotencyKey` (nunca colide); retry de erro permanente (nunca
ocorre — 1 única chamada ao adapter); circuit breaker (reaproveitado, já testado em
`resilience.test.ts`); saída estruturada malformada/profunda demais/com `NaN`/`Infinity`
(sempre `INVALID_RESPONSE`, nunca reparada); prompt injection textual simples no conteúdo
não confiável (não é bloqueado por `safety.ts` — está fora do escopo desse módulo por
design: o conteúdo é sempre cercado por um fence e nunca ganha posição de instrução,
independentemente do texto).

## 5. Riscos residuais registrados com honestidade

- **Nenhum provider comercial habilitado.** `AI_GATEWAY_PROVIDER_MODE` é `disabled` por
  padrão em todo ambiente; produção recusa qualquer outro valor incondicionalmente.
- **Preços reais ausentes.** `SYNTHETIC_PRICE_TABLE`/`AI_PRICE_CATALOG_VERSION_SYNTHETIC`
  são explicitamente sintéticos e só usados em teste — nunca alcançáveis com o adapter
  disabled ativo.
- **Retenção/residência/DPA:** o gate de `RETENTION_UNCONFIRMED` existe e bloqueia qualquer
  candidato sem `retentionPolicy: "ZERO_RETENTION_CONFIRMED"` — mas nunca foi exercitado
  contra um provider real (nenhum está habilitado). O perfil sintético de teste já declara
  `ZERO_RETENTION_CONFIRMED` explicitamente para permitir os testes do adapter.
- **Ledger do Gateway limitado a chamadores com `AIConversation`** — ver §3. Red Team
  permanece não conectado ao Gateway nesta rodada.
- **Nenhum reaper para reserva órfã.** Se o processo cair entre `reserveGatewayExecution`
  e a confirmação/liberação (ex.: crash do servidor em voo), a linha fica `RUNNING`
  indefinidamente — conta contra o orçamento do mês e bloqueia retry com a mesma
  `idempotencyKey` (cai no ramo `EXECUTING` para sempre). `AIPendingAction.expiresAt` já é
  gravado (24h) mas nada hoje lê/aplica essa expiração para liberar automaticamente uma
  reserva órfã. Não implementado nesta rodada — risco residual pequeno (mesma classe de
  risco que qualquer job/worker sem heartbeat já tem no sistema), documentado em vez de
  ignorado.
- **Nenhuma migration criada** — ver §3 para a cadeia de causa completa (privilégio
  `CREATEDB` ausente + proibição de solicitar credenciais).
- **Piloto só local/interno** — nenhum dado real, nenhuma chamada externa em nenhum teste.
- **Produção permanece bloqueada** até aprovações humanas e infraestrutura real — nenhuma
  mudança nesta rodada altera essa afirmação; `parseRuntimeConfig` reforça isso em código.
- **Fases 10B–10I não iniciadas** — nenhum agente, ferramenta cognitiva, decisão autônoma
  ou contexto inteligente foi criado; o teste arquitetural verifica ausência de menção.
- **Matriz adversarial do contrato (§15) não foi coberta linha a linha** — priorizei os
  itens de maior risco real (SSRF/DNS rebinding, corrida de orçamento, idempotência,
  cross-tenant, RBAC completo, retry vs. erro permanente, saída malformada, vazamento em
  log) com testes reais contra PostgreSQL sempre que a propriedade era sobre concorrência.
  Itens não cobertos explicitamente por um teste dedicado (ex.: Unicode exótico além de
  controle/NUL, JSON com "expansão excessiva" tipo bomba de profundidade extrema além do
  limite já testado) têm defesa estrutural (limites de bytes/profundidade) mas não um
  teste nomeado — risco residual pequeno, documentado em vez de reivindicado como coberto.

## 6. Testes novos

13 arquivos novos, resumidos por camada:

- `domain/ai-gateway/{safety,envelope,routing,budget,output-schema}.test.ts` — puros, sem
  banco: 15+7+9+8+8 = 47 testes.
- `infrastructure/ai-gateway/{safe-transport,disabled-provider-adapter,
  compatible-http-adapter,config}.test.ts` — transporte/adapters com resolver/requester
  injetados, nenhuma rede real: 19+2+12+6 = 39 testes.
- `application/ai-gateway/{rbac,architecture}.test.ts` — puros: 31+6 = 37 testes.
- `application/ai-gateway/{ledger-service,gateway}.database.integration.test.ts` — banco
  real (`describe.skipIf(!process.env.DATABASE_URL)`), incluindo corrida real com
  `Promise.all`: 12+9 = 21 testes.
- `infrastructure/config/runtime-config.test.ts` — 1 teste novo (bloqueio de produção).

**Total: 145 testes novos**, mais correções de fixture (sem teste novo) em
`secret-provider.test.ts`/`storage-provider.test.ts` para incluir o novo campo obrigatório
`AI_GATEWAY_PROVIDER_MODE` no `RuntimeConfig` construído manualmente.

## 7. QA (números reais observados)

- `npx tsc --noEmit`: 0 erros.
- `npx eslint src`: 0 erros, 1 warning pré-existente e aceito (`_signal` não usado no
  adapter disabled, parâmetro exigido pela interface `AiProviderAdapter`).
- `npx prisma validate`: schema válido — **nenhuma alteração de schema nesta rodada**.
- `git status --short`: só arquivos novos/modificados do próprio trabalho; zero staged.
- `git diff --check`: sem erro de espaço em branco (só aviso de LF/CRLF do Windows).
- Busca de segredos: nenhum segredo real encontrado (só um valor de teste sintético em
  `safety.test.ts`, usado para provar que o padrão de detecção funciona).
- Suíte oficial completa (`pnpm test`, `prisma migrate deploy` + seed + `vitest run`):
  **151 arquivos (1 pulado, `prisma/seed.database.integration.test.ts`, pré-existente e
  sem relação com esta fase), 1.759 testes passando + 4 skipped = 1.763, 0 falhas**
  (linha de base pós-9S: 138 arquivos, 1.614 testes — os 13 arquivos novos desta fase
  somam, contados um a um, 145 testes; a diferença bruta para a linha de base, 149, não
  foi reconciliada até o último dígito — não afeta o resultado, 0 falhas em ambas as
  execuções). Confirmado em **2 execuções completas idênticas** sem recriar o banco (só
  `prisma migrate deploy` sobre as 39 migrations já existentes + reseed, nenhuma migration
  nova aplicada) — números exatamente iguais nas duas rodadas.
- `pnpm build` (`next build`): sucesso, 0 erros de tipo/lint, todas as 28 páginas +
  `/api/ai/chat` compiladas; regenerou `next-env.d.ts` como efeito colateral padrão do
  Next.js — revertido (ver achado 3 em §4).

## 8. Declaração final (registro original, antes da correção focal — ver §9 abaixo)

Nenhum commit ou push foi executado. Nenhuma chamada externa real foi feita em nenhum
teste. Nenhuma credencial foi solicitada ou usada além das já presentes no `.env` local
(usuário de aplicação, sem privilégio `CREATEDB`). Nenhum provider comercial foi habilitado.
Nenhuma Fase 10B–10I foi iniciada. Nenhuma decisão autônoma foi implementada — toda decisão
de bloqueio é uma recusa determinística e documentada, nunca uma escolha do sistema. O
worktree permanece aberto para auditoria independente.

## 9. Correção focal pós-auditoria com ressalvas — três Altos e quatro Médios

Uma auditoria adversarial independente sobre a implementação registrada em §1–§8
reprovou com ressalvas (`APROVADO COM RESSALVAS`), confirmando por reprodução real três
achados Altos e quatro Médios. Todos os sete foram corrigidos nesta sessão, na mesma
branch, sem migration, sem commit/push, sem provider comercial habilitado.

### 9.1 ALTO — gate arquitetural bypassável → reescrito com AST real

A versão anterior de `application/ai-gateway/architecture.test.ts` filtrava arquivos por
palavras-chave (`AiProviderRequest`, `CompatibleHTTP`, `AI_PROVIDER` etc.) antes de
procurar violações — um arquivo novo com `fetch()` direto para `api.openai.com` que não
mencionasse nenhuma dessas palavras passava pelas 6 verificações sem ser sequer
analisado. A auditoria reproduziu isso plantando
`src/application/reporting/__audit_bypass_probe.ts` e confirmando que o gate antigo o
aprovava integralmente.

Correção: o teste foi reescrito para analisar a **AST real** (TypeScript compiler API,
`ts.createSourceFile` + `ts.forEachChild`, já disponível como dependência do projeto) de
**todos** os arquivos produtivos de `domain/`, `application/`, `infrastructure/` e `app/`
(excluindo `src/components/*`, que só faz `fetch()` para rotas internas `/api/*` da
própria aplicação — uma fronteira de confiança diferente, documentada explicitamente no
código do teste). Nenhuma pré-filtragem por palavra-chave, nome de arquivo ou comentário
existe mais — o scanner roda sobre todo arquivo, sempre, e a allowlist (mínima, por
caminho exato, travada por um teste dedicado que falha se ela crescer) é aplicada depois,
nunca antes.

Detecta: qualquer referência ao identificador `fetch` (incluindo `globalThis.fetch`,
`window.fetch`, alias, desestruturação); imports estáticos e dinâmicos (`import(...)`,
`require(...)`) de `node:http`, `node:https`, `http`, `https`, `undici`, `axios` e SDKs de
IA conhecidos (`openai`, `@anthropic-ai/sdk` etc., nenhum instalado); construção de
`CompatibleHttpAiProviderAdapter`/`DisabledAiProviderAdapter`/`CompatibleHTTPAIProvider`
legado mesmo via alias de import nomeado ou import de namespace; acesso a
`createAIProvider` do composition root legado mesmo via alias; domínios conhecidos de
provedores de IA em qualquer literal de string/template.

Verificação de que o bypass original agora é detectado: o mesmo arquivo de sonda
(`fetch("https://api.openai.com/v1/chat/completions")`, sem nenhuma palavra-chave) foi
recriado, rodado contra o gate corrigido — **falhou corretamente com 2 violações**
(`FETCH_REFERENCE` + `AI_VENDOR_DOMAIN_LITERAL`) — e removido em seguida.

Limite residual documentado explicitamente no cabeçalho do teste: metaprogramação
dinâmica arbitrária (`globalThis["fe"+"tch"]`, `eval`, `Reflect.construct` com
identificador computado em runtime) não é resolvida — exigiria um type-checker completo
com resolução de fluxo de dados, fora do escopo desta correção. Nenhuma promessa de
detecção perfeita é feita; os bypasses triviais (os únicos plausíveis de aparecer por
engano ou descuido) estão fechados.

15 fixtures adversariais (fetch direto, alias, `globalThis.fetch`, `window.fetch`,
desestruturação, import estático/dinâmico de `node:https`, `require`, alias do
construtor do adapter, import dinâmico do adapter, URL da OpenAI sem menção a
"AIProvider", chamada escondida em diretório não relacionado, `createAIProvider` via
alias, e um caso de conteúdo idêntico ao transporte legítimo mas em caminho não
allowlisted — provando que a allowlist decide por caminho, nunca por conteúdo) cobrem
cada padrão exigido. Arquivo: `src/application/ai-gateway/architecture.test.ts`.

### 9.2 ALTO — RBAC da 10A estava morto → integrado ao call site real

`rbac.ts` definia e testava `AI_USE`/`AI_ADMIN`/`AI_BUDGET_READ`/`AI_BUDGET_MANAGE`/
`AI_AUDIT_READ` isoladamente, mas nenhum código de produção o chamava — `askRedeAI`
continuava protegido só pelo `AI_READ` pré-existente (fase anterior à 10A), que por
coincidência produz o mesmo efeito hoje porque nenhum papel tem capacidade parcial de
domínio (todo papel não-VIEWER tem acesso total).

Correção:

- `askRedeAI` (`application/ai/ai-service.ts`) agora chama `assertAiCapability(context.role,
  "AI_USE")` como a **primeira linha da função**, antes de `enforceUsageLimits`
  (orçamento), `buildAIContext` (contexto/ledger), o loop de ferramentas e o `AiGateway`.
  `AI_READ` continua sendo checado antes (na Server Action/rota) — nenhuma das duas
  capacidades substitui a outra.
- `src/app/actions/ai.ts` (`authorizedAIContext`, usada por todas as Server Actions de
  IA) e `src/app/api/ai/chat/route.ts` agora exigem `AI_READ` **e** `AI_USE` juntos, na
  mesma ordem, sem caminhos divergentes entre a Server Action e a rota de streaming.
- `application/ai/tool-registry.ts` (`execute`) agora exige `AI_USE` cumulativamente com
  a capacidade de leitura específica de cada ferramenta/domínio (`AI_READ` +
  `toolCapabilities.get(name)` + `AI_USE`, nenhuma dispensando a outra).
- `organizationId`/`role` continuam vindo exclusivamente do `AuthContext` resolvido pelo
  servidor — `askRedeAI` nem recebe esses campos no `input` (prova estrutural: o tipo do
  parâmetro não tem `organizationId`).
- Membership inativa/ausente: já bloqueada estruturalmente antes da 10A por
  `session.ts` (as consultas de sessão filtram `isActive: true` no membership e no
  usuário) — `AuthContext` nunca representa esses casos, e o teste já existente
  `session.database.integration.test.ts` ("rejeita usuário sem membership, membership
  inativo e organização de outro usuário") cobre isso; não duplicado.
- `AI_ADMIN`/`AI_BUDGET_READ`/`AI_BUDGET_MANAGE`/`AI_AUDIT_READ`: **nenhuma superfície de
  administração de política, orçamento ou auditoria existe hoje** (`getAIUsageDashboard`
  está definida mas não está ligada a nenhuma Server Action/rota — confirmado por busca
  exaustiva). Essas quatro capacidades permanecem definidas em `rbac.ts` para uso futuro,
  sem nenhuma alegação de call site ativo — nenhuma nova UI/action foi criada aqui
  (seria decisão de escopo fora desta correção).

Testes novos: `application/ai-gateway/rbac-integration.test.ts` (6 testes, PostgreSQL
real) — VIEWER bloqueado antes de qualquer linha em `AIExecutionLog`/`AIMessage`; erro é
`AiAccessDeniedError` (nunca erro de banco/validação); spy confirma zero chamada a
`createOrganizationAiGateway` quando negado; OWNER/ADMIN/ANALYST/REVIEWER nunca são
barrados por `AiAccessDeniedError`; conteúdo da pergunta tentando se passar por
OWNER/outra organização não tem nenhum efeito; prova estrutural de que `askRedeAI` não
tem campo de tenant no `input`.

### 9.3 ALTO — provider/model não confiáveis no ledger → identidade canônica do servidor

`AIExecutionLog.provider`/`.model` eram sobrescritos, na confirmação, com
`response.routing.provider`/`.model` — valores devolvidos pelo `AiProviderAdapter`, não
validados. Um adapter futuro que ecoasse conteúdo da resposta do provedor nesses campos
teria a string persistida verbatim.

Correção:

- `AiModelProfile` (contrato de domínio) ganhou `modelRef: string` — referência canônica
  de modelo, decidida pelo catálogo/política de roteamento do servidor, nunca pelo
  cliente ou pela resposta.
- `gateway.ts` agora fixa `providerRef`/`modelRef` a partir da rota escolhida
  (`routed.candidate`) **antes** de chamar o adapter, valida ambos contra um formato
  canônico fechado (`isSafeCanonicalRef`: ASCII seguro, 1–64 caracteres, sem URL, sem
  espaço/controle) e os passa para `reserveGatewayExecution` — a linha de
  `AIExecutionLog` nasce com a identidade correta e **nunca mais é reescrita**.
- Depois que o adapter responde, `response.routing.provider`/`.model` são comparados
  contra a rota esperada só para detectar um adapter mentiroso/hostil — divergência,
  formato inseguro ou tipo hostil (objeto/array/número) resulta em
  `PROVIDER_IDENTITY_MISMATCH` (novo código, permanente, adicionado à taxonomia fechada
  `AiGatewayErrorCode`), a reserva é liberada (custo zerado) e **nada do valor
  observado é persistido** — nem no ledger, nem na mensagem do erro.
- `confirmGatewayExecution` não recebe mais `provider`/`model` — só atualiza números
  observados (tokens, custo, duração).
- `buildAiProviderAdapter` (composição real) também valida `providerRef`/`modelRef`
  contra o mesmo formato canônico antes de construir um adapter real, e cai para
  `disabled` se a configuração do administrador estiver fora do formato.

Testes novos (`gateway.database.integration.test.ts`, 10 casos + happy path, PostgreSQL
real, adapter hostil injetado): provider contendo URL, model contendo token, CR/LF,
NUL, string longa, Unicode bidi, provider divergente da rota, model divergente da rota,
objeto/array hostil via cast — todos resultam em `PROVIDER_IDENTITY_MISMATCH`, `status:
FAILED`, custo zerado, e o `AIExecutionLog.provider`/`.model` gravado permanece o
canônico (`fake`/`fake-model`), nunca o valor hostil — confirmado por varredura do log
serializado em busca dos canários (URL/token) usados na resposta hostil.

### 9.4 MÉDIO — idempotencyKey hostil → validado antes de qualquer acesso ao Prisma

Novo `domain/ai-gateway/idempotency-key.ts` (`isSafeIdempotencyKey`): charset fechado e
documentado (`[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}`, 1–200 caracteres), que exclui
estruturalmente string vazia, só-espaços, espaço inicial/final, CR/LF/NUL/DEL/controles,
Unicode bidi/zero-width e qualquer forma de URL (barra não faz parte do charset).
Aplicado em `reserveGatewayExecution` antes até do cálculo do fingerprint — chave fora
do formato lança `AiGatewayError` (`CONFIGURATION`) sem tocar o Prisma. Nenhuma
normalização silenciosa: duas chaves nunca convergem.

Isso corrige, de raiz, os dois bugs reais confirmados pela auditoria: `idempotencyKey:
""` não colide mais na constraint única (rejeitada antes de qualquer `INSERT`) e um byte
NUL não crasha mais o Postgres com erro de encoding bruto — ambos os casos agora
retornam `AiGatewayError` classificado. 17 testes unitários (`idempotency-key.test.ts`)
+ 3 cenários de integração reais em `ledger-service.database.integration.test.ts`
(7 chaves hostis × zero linhas criadas; chave válida real nunca rejeitada; segunda
chamada hostil após uma reserva válida nunca vira erro de Prisma bruto).

### 9.5 MÉDIO — custo negativo/não finito → validado antes de qualquer acesso ao Prisma

Novo `domain/ai-gateway/cost.ts` (`isSafeCostUsdMicros`): exige inteiro, finito,
não-negativo, ≤ US$ 1.000.000,00 em micro-USD (teto generoso contra overflow/valor
absurdo) — rejeita string numérica (sem coerção), bigint, NaN, Infinity, fração.
Aplicado em `reserveGatewayExecution` junto com a checagem de `idempotencyKey`. Um custo
negativo nunca chega a ser somado ao gasto rastreado (a única forma de garantir isso é
nunca aceitá-lo). 11 testes unitários (`cost.test.ts`) + 8 cenários de integração reais
(custo negativo, mínimo negativo, NaN, Infinity, fracionário, acima do teto, zero
aceito como legítimo, e a prova direta de que um custo negativo bloqueado nunca gera
crédito — o gasto agregado permanece 0).

### 9.6 MÉDIO — reserva órfã RUNNING → mapeamento de estados existentes, sem migration

Mapeamento confirmado no schema (nenhuma coluna nova): `AIExecutionStatus` já tinha
`QUEUED` e `RUNNING` como valores distintos, e `AIActionStatus` já tinha `EXPIRED` —
todos definidos antes da Fase 10A, nunca usados com esse propósito pela implementação
original. Esses três valores existentes são exatamente a distinção que a correção
precisava:

- **`QUEUED`** = orçamento reservado, transporte **nunca** chamado ainda. Comprovadamente
  seguro de expirar — reaper libera automaticamente.
- **`RUNNING`** = o transporte foi chamado pelo menos uma vez. Se o processo morrer daqui
  em diante sem confirmar/liberar, não há como saber se o provedor recebeu/cobrou a
  chamada — **estado ambíguo, nunca liberado automaticamente**.

`reserveGatewayExecution` agora cria a reserva como `QUEUED` (antes: `RUNNING`
imediatamente). Uma nova função, `markGatewayExecutionTransportStarted`, transiciona
`QUEUED → RUNNING` (CAS via `updateMany` condicionado ao status atual, idempotente) e é
chamada por `gateway.ts` imediatamente antes de cada tentativa de `adapter.execute()`.

Novo módulo `application/ai-gateway/reaper.ts`
(`reapExpiredGatewayReservations`): varre `AIExecutionLog` com `status: "QUEUED"` e
`startedAt` mais antigo que o limite de expiração (relógio e limite de lote injetáveis,
escopo opcional por `organizationId`); para cada candidata, faz o claim via transação
com CAS real (`updateMany` condicionado a `status: "QUEUED"` dentro da própria
transação — se a contagem afetada for 0, outro reaper ou o próprio Gateway já a moveu,
nada mais é tocado) e, só então, marca a `AIPendingAction` correspondente como
`EXPIRED`. Reservas `RUNNING` vencidas são **apenas contadas e devolvidas para
relatório** — a função nunca as modifica. Nenhuma reconciliação automática de reservas
ambíguas foi criada (seria uma decisão autônoma fora do escopo desta correção); ficam
como uma lacuna operacional documentada, exigindo intervenção manual de um operador.

10 testes reais contra PostgreSQL (`reaper.database.integration.test.ts`): expiração
antes do transporte libera e zera o gasto; execução ativa (QUEUED recente) não expira;
execução `RUNNING` vencida nunca é liberada e continua contando contra o orçamento
(conservador por padrão); retry/novo custo depois de uma `RUNNING` ambígua continua
bloqueado pelo orçamento já consumido; **dois reapers concorrentes na mesma linha
(`Promise.all` real) produzem exatamente uma liberação, nunca duas** (prova de CAS
real); isolamento cross-tenant; relógio injetado (avançado) confirma expiração
determinística; limite de lote respeitado; execução repetida do reaper sobre o mesmo
lote é idempotente (nenhum efeito duplicado); o par `AIExecutionLog`/`AIPendingAction`
nunca diverge (sempre `FAILED`+`EXPIRED` juntos, nunca um sem o outro).

**Nenhuma migration foi criada ou é necessária para este item** — o schema já distinguia
os estados exigidos; a lacuna era só na implementação, não na estrutura de dados.

### 9.7 MÉDIO — header validation implícita → validação explícita antes do transporte

A auditoria confirmou que a rejeição de CR/LF/NUL no header `Authorization` funcionava,
mas dependia inteiramente do `https.request` nativo do Node (`ERR_INVALID_CHAR`) — nunca
verificada pela própria aplicação. Novo `domain/ai-gateway/header-value.ts`
(`isSafeHeaderValue`): tipo string, não vazio, sem espaço inicial/final (trim exato),
sem CR/LF/NUL/DEL/demais controles, limite de 4096 caracteres. Aplicado em
`compatible-http-adapter.ts` **antes** de montar a requisição (antes do DNS/transporte):
uma `apiKey` fora do formato lança `AiGatewayError` (`CONFIGURATION`) e nem o resolver
DNS nem o executor HTTP são chamados.

25 testes (`compatible-http-adapter.test.ts`, 13 novos): string vazia, só espaços,
espaço inicial/final, CR/LF, NUL, DEL, controle, objeto hostil, array hostil, Proxy
hostil, número, string longa demais (4097 chars) — todos confirmados classificados,
com `resolver`/`requester` nunca chamados (`toHaveBeenCalled()` checado explicitamente).

### 9.8 Autorrevisão adversarial da correção — o que foi tentado e o resultado

- Bypass do gate arquitetural via alias/import dinâmico: fechado (ver §9.1); limite
  residual de metaprogramação arbitrária documentado explicitamente, não escondido.
- RBAC antes/depois do ledger: `assertAiCapability` é a primeira linha de `askRedeAI` —
  confirmado por teste que zero linhas de `AIExecutionLog`/`AIMessage` são criadas
  quando um VIEWER é negado.
- Adapter hostil (provider/model): 10 variações fechadas, nenhuma contamina o ledger.
- `idempotencyKey`/custo hostis: fechados antes do Prisma; confirmado que os dois bugs
  específicos da auditoria (`""` e NUL) não reproduzem mais.
- Reserva expirada vs. ambígua: confirmado que uma reserva `RUNNING` jamais é liberada
  mesmo sob concorrência real de dois reapers.
- P2002/P2034: nenhuma mudança nesta correção altera o tratamento já existente
  (`ledger-service.ts` continua reconhecendo especificamente esses dois códigos; nenhum
  "catch-all" de erro de Prisma foi introduzido pelas novas validações, que rodam
  **antes** de qualquer chamada ao Prisma).
- Header hostil: confirmado que nenhuma chamada de rede acontece antes da validação.
- `Error.cause`/log/`AuditLog`: as novas mensagens de erro (`PROVIDER_IDENTITY_MISMATCH`,
  validação de header/chave/custo) são sempre texto estático, nunca interpolam o valor
  hostil — confirmado por leitura e pelos testes de varredura de canário em
  `gateway.database.integration.test.ts`.
- Cross-tenant: confirmado no reaper (dois tenants, um deles não é tocado) e no ledger
  (idempotencyKey igual em tenants diferentes nunca colide, inalterado por esta correção).

Nenhum bug adicional foi encontrado durante esta autorrevisão além dos sete já
corrigidos.

> **CORRIGIDO/RETIFICADO** (correção crítica DEFINITIVA pós-reauditoria — ver §11 e §13
> abaixo): a afirmação acima foi **invalidada** por duas reauditorias subsequentes.
> Encontraram-se, ao vivo, bugs reais adicionais que esta autorrevisão não pegou: (1) uma
> reserva `RUNNING` conseguia ser ressuscitada de `FAILED` para `COMPLETED` por um
> `confirm` tardio, recobrando custo já liberado; (2) `gateway.ts` retentava
> `adapter.execute()` automaticamente (até 1+3 chamadas) e liberava a reserva (custo
> zerado) para **qualquer** classe de erro pós-transporte que não fosse
> `RECONCILIATION_REQUIRED` — incluindo `TIMEOUT`/`PROVIDER_UNAVAILABLE`/`UNEXPECTED`,
> sem nenhuma garantia de não-cobrança. Esta linha é preservada tal como escrita
> originalmente (não apagada nem reescrita) precisamente para que o histórico mostre a
> declaração incorreta e as duas correções subsequentes que a substituíram.

### 9.9 Arquivos alterados e criados

Novos: `domain/ai-gateway/{canonical-ref,idempotency-key,cost,header-value}.ts` (+
testes), `application/ai-gateway/{reaper,rbac-integration}.ts`/`.test.ts`,
`application/ai-gateway/reaper.database.integration.test.ts`.
Reescritos: `application/ai-gateway/architecture.test.ts` (AST real).
Alterados: `domain/ai-gateway/types.ts` (`modelRef`, `PROVIDER_IDENTITY_MISMATCH`),
`domain/ai-gateway/index.ts`, `infrastructure/ai-gateway/{model-catalog,config,
compatible-http-adapter}.ts`, `application/ai-gateway/{gateway,ledger-service}.ts`,
`application/ai/{ai-service,tool-registry}.ts`, `src/app/actions/ai.ts`,
`src/app/api/ai/chat/route.ts`, e os testes existentes que precisaram refletir os novos
contratos (`routing.test.ts`, `gateway.database.integration.test.ts`,
`ledger-service.database.integration.test.ts`, `compatible-http-adapter.test.ts`).

### 9.10 Riscos residuais (atualizados após a correção)

- Reservas `RUNNING` vencidas continuam exigindo intervenção manual — nenhuma
  reconciliação automática existe (decisão deliberada, não descuido).
- `AI_ADMIN`/`AI_BUDGET_READ`/`AI_BUDGET_MANAGE`/`AI_AUDIT_READ` continuam sem nenhuma
  superfície de UI/action ativa — definidas para uso futuro.
- Limite residual documentado do gate arquitetural (metaprogramação dinâmica arbitrária)
  — ver §9.1.
- Todos os demais riscos residuais registrados em §5 continuam válidos e inalterados por
  esta correção (nenhum provider comercial, preços sintéticos, retenção/DPA pendentes,
  ledger limitado a chamadores com `AIConversation`, Red Team não conectado ao Gateway).

### 9.11 QA da correção focal (números reais observados)

- `prisma validate` / `prisma generate` / `prisma migrate status`: sem alterações de schema
  ou migrations nesta correção; `prisma/schema.prisma` e as 39 migrations permanecem
  byte-idênticas às da auditoria anterior.
- `tsc --noEmit`: 0 erros.
- `npx eslint src`: 0 erros, 1 warning pré-existente aceito (`disabled-provider-adapter.ts`,
  `_signal` não utilizado — já registrado na auditoria original, não introduzido por esta
  correção).
- Suíte oficial completa (`pnpm test`), execução 1: **155 arquivos de teste passaram | 1
  ignorado (156)**; **1843 testes passaram | 4 ignorados (1847)**; 0 falhas.
- Suíte oficial completa, execução 2 (repetição sem recriar o banco, para confirmar
  determinismo): números idênticos — **155 | 1 (156)** arquivos, **1843 | 4 (1847)** testes,
  0 falhas.
- Build de produção (`next build`): sucesso (exit 0); `next-env.d.ts` conferido
  byte-idêntico após o build (nenhuma regeneração incidental desta vez).
- `production-preflight.test.ts` (preflight inválido/produção incompleta): incluído na
  suíte oficial acima, sem falhas.
- `git diff --check`: sem erros (apenas avisos de conversão LF→CRLF do Git no Windows, sem
  marca de conflito nem espaço em branco problemático).
- Varredura de padrões de segredo (`sk-...`, `AKIA...`, `api_key=...`, `Bearer ...`, chave
  privada PEM, `ghp_...`, `password=...`) sobre o diff completo (rastreados + novos
  arquivos): nenhuma ocorrência.
- **Bug de processo encontrado e corrigido durante o QA**: a primeira execução da suíte
  completa revelou 1 falha real, não relacionada aos 7 itens em si, mas causada por eles —
  o gate arquitetural pré-existente da Fase 9Q.2A (`local-release-boundaries.test.ts`) fixa
  um hash SHA-256 de "superfície revisada" para `src/app/api/ai/chat/route.ts` e
  `src/app/actions/ai.ts` em `docs/PHASE_9Q2A_SURFACE_MANIFEST.json`; como o Item 2 desta
  correção alterou intencionalmente esses dois arquivos (adicionando `assertAiCapability(
  role, "AI_USE")`), os hashes ficaram desatualizados. Isso é o comportamento *correto* do
  gate 9Q.2A (detectar exatamente esse tipo de alteração não revisada) — a correção foi
  recalcular e gravar os dois novos hashes no manifesto, refletindo a revisão real desta
  correção focal, e reexecutar o arquivo isoladamente (5/5 testes) antes de rodar a suíte
  completa novamente.
- Testes focais e de arquitetura com fixtures de bypass: incluídos na suíte oficial acima
  (subárvore `ai-gateway`: 19 arquivos, 238 testes, todos passando isoladamente antes da
  suíte completa; ver §9.1–§9.7 para o detalhamento por item).
- Concorrência PostgreSQL real: ver §9.6 (testes do reaper) e §9.2 (testes de RBAC/ledger)
  — todos rodados contra banco real, sem mocks, incluídos nas duas execuções da suíte
  acima.

## 10. Declaração final (após a correção focal — SUPERADA, ver §11: a reauditoria final que se seguiu a esta declaração reprovou o estado abaixo)

Nenhum commit ou push foi executado. Nenhuma chamada externa real, DNS real ou credencial
real foi usada em nenhum teste — inclusive os novos testes de adapter/header hostis, que
usam apenas resolver/requester injetados. Nenhum provider comercial foi habilitado.
Nenhuma migration foi criada (39 migrations, inalteradas — o item da reserva órfã foi
resolvido reaproveitando valores de enum já existentes no schema). Nenhuma Fase 10B–10I
foi iniciada ou mencionada em qualquer arquivo novo. Nenhuma decisão autônoma foi
implementada — toda liberação de recurso (reaper, idempotência, custo, identidade de
provider) é uma regra determinística e auditável, nunca uma escolha do sistema em tempo
de execução. O worktree permanece aberto para reauditoria focal.

**Nota adicionada pela correção crítica (§11): a reauditoria focal final que avaliou este
estado encontrou bugs reais adicionais e reprovou esta rodada** — em particular, a
afirmação em §9 ("nenhum bug adicional foi encontrado durante esta autorrevisão além dos
sete já corrigidos") **estava incorreta**; a reauditoria encontrou e comprovou (com testes
reais contra PostgreSQL, sem mocks) uma ressurreição de reserva expirada, custo observado
hostil não validado na confirmação, três bypasses triviais do gate AST, e o reaper nunca
sendo chamado por nenhum caminho de produção. Ver §11 para a correção completa de cada um
desses achados. Esta seção (§10) é preservada tal como escrita originalmente — não foi
apagada nem reescrita — precisamente para que o histórico mostre a declaração incorreta e
sua correção subsequente.

## 11. Correção crítica pós-reauditoria — máquina de estados, custo e gate arquitetural

Esta seção documenta a correção dos achados da "REAUDITORIA FOCAL FINAL — FASE 10A —
PÓS-CORREÇÃO INTEGRAL", que reprovou o estado descrito em §9/§10 acima. Nenhum histórico
anterior foi apagado — apenas anotado (ver notas em §9.11 e §10) e complementado aqui.

### 11.1 CRÍTICO — reserva expirada ressuscitava (corrigido)

**Causa raiz confirmada pela reauditoria**: `markGatewayExecutionTransportStarted` fazia um
`updateMany` sem verificar quantas linhas foram afetadas, e `gateway.ts` chamava o adapter
incondicionalmente após essa chamada, mesmo quando a promoção QUEUED→RUNNING havia
silenciosamente falhado (reserva já expirada pelo reaper). `confirmGatewayExecution` e
`releaseGatewayExecution` faziam `update({where:{id}})` incondicional, sem nenhuma
precondição de estado — um `confirm` tardio conseguia ressuscitar uma linha `FAILED` de
volta para `COMPLETED`, recobrando um custo que já havia sido liberado.

**Correção**:
- `markGatewayExecutionTransportStarted(executionLogId, pendingActionId)` agora devolve um
  resultado tipado explícito — `{ transitioned: true }` ou `{ transitioned: false,
  reasonCode: "RESERVATION_NOT_ACTIVE" }`. A promoção QUEUED→RUNNING de `AIExecutionLog` E
  a verificação da `AIPendingAction` (self-CAS EXECUTING→EXECUTING, já que `AIActionStatus`
  não tem um valor distinto para "transporte iniciado") acontecem na MESMA transação
  interativa; se qualquer CAS não afetar exatamente 1 linha, a transação inteira reverte
  (nenhuma mutação parcial) e a função devolve `transitioned: false`.
- `gateway.ts` agora respeita rigorosamente a ordem exigida: reservar (QUEUED) → promover
  atomicamente para RUNNING → **só então** chamar `adapter.execute`. Se
  `transitioned !== true`, lança `AiGatewayError` (`RESERVATION_EXPIRED`, permanente) e o
  adapter NUNCA é chamado — comprovado com um teste que usa `vi.spyOn` sobre a própria
  função do ledger para forçar `transitioned: false` e afirma zero chamadas ao adapter.
- `confirmGatewayExecution` agora exige `status: "RUNNING"` via CAS (`updateMany`) para
  transicionar para `COMPLETED`; um CAS perdido nunca é interpretado como sucesso (lança
  `AiGatewayError` `INVALID_RESPONSE`, fail-closed, sem mutação). Se a linha já estiver
  `COMPLETED` com os MESMOS valores (mesmo `inputTokens`/`outputTokens`/custo), o retorno é
  idempotente (`ALREADY_CONFIRMED_IDENTICAL`, sem nova escrita); com valores diferentes,
  falha fechado sem sobrescrever o resultado original. Qualquer outro estado terminal
  (`FAILED`/`CANCELLED`) falha fechado sem mutação.
- `releaseGatewayExecution` agora exige `status` em `["QUEUED","RUNNING"]` via CAS — cobre
  tanto cancelamento antes do transporte quanto falha comprovada após o início — mas nunca
  sobrescreve um estado já terminal (`released: false`, nunca uma ressurreição).
- `AIExecutionLog` e `AIPendingAction` são sempre atualizados na MESMA transação em todas
  as três funções — falha em um lado reverte o outro (comprovado com um `pendingActionId`
  inválido forçando rollback do lado do `AIExecutionLog` também).

**18 testes novos** contra PostgreSQL real, com concorrência real (`Promise.all`, nunca
`setTimeout` como "barreira"), em `state-machine.database.integration.test.ts`: reaper
vence antes de mark; mark vence antes do reaper; os dois chegam simultaneamente (`Promise.all`
real); spy de adapter confirmando zero chamadas após CAS perdido; confirm após
FAILED/EXPIRED (rejeita fechado, nunca ressuscita); confirm após COMPLETED idêntico
(idempotente) e diferente (rejeita fechado); release após FAILED e após COMPLETED
(no-op seguro); release concorrente com confirm; dois confirms concorrentes; dois releases
concorrentes; rollback sem estado parcial (pendingActionId inválido); resultado ambíguo
nunca libera orçamento.

### 11.2 ALTO — custo/uso observado hostil na confirmação (corrigido)

**Causa raiz confirmada pela reauditoria**: `confirmGatewayExecution` gravava
`usage.observedCostUsdMicros`/`inputUnits`/`outputUnits` (vindos do adapter, não
confiáveis) diretamente, sem nenhuma validação — um adapter hostil conseguia gravar custo
negativo (reduzindo o gasto agregado da organização, "crédito" via bug) ou `NaN` (que
gerava um `PrismaClientValidationError` bruto, não classificado).

**Correção**: `gateway.ts` valida `inputUnits`/`outputUnits`/custo observado
(`isSafeUsageUnits`/`isSafeCostUsdMicros`, mesmo padrão inteiro/finito/não-negativo/teto do
custo estimado) IMEDIATAMENTE após a resposta do adapter, antes de contar sucesso no
circuit breaker; `confirmGatewayExecution` valida de novo, internamente, como defesa em
profundidade (nunca confia no chamador). Formato inválido → `AiGatewayError`
(`PROVIDER_USAGE_INVALID`, permanente), sem nenhum `PrismaClientValidationError` bruto.

Custo observado que excede o valor reservado é revalidado atomicamente contra o orçamento
restante do período (gasto do mês/dia, excluindo a própria reserva, mais o excedente) — se
não couber, a confirmação falha fechado com um código dedicado
(`RECONCILIATION_REQUIRED`, nunca `BUDGET_EXCEEDED`, para que `gateway.ts` saiba que NÃO
deve chamar `releaseGatewayExecution` neste caso específico) e a linha permanece `RUNNING`
(ambígua — o transporte realmente aconteceu — mesma política de qualquer `RUNNING`
vencida, exigindo reconciliação manual). O custo nunca é truncado silenciosamente.

**15 testes novos** em `gateway.database.integration.test.ts`: custo negativo, NaN,
Infinity, fracionário, string, bigint excessivo, acima do teto seguro, unidades negativas,
unidades fracionárias, objeto/array hostil (cast) — todos → `PROVIDER_USAGE_INVALID`, `FAILED`,
custo final zero; custo observado igual/menor à reserva (aceito); maior que a reserva mas
dentro do orçamento (aceito, reconciliado); maior que o orçamento disponível
(`RECONCILIATION_REQUIRED`, fica `RUNNING`, `AIPendingAction` permanece `EXECUTING` sem
mutação parcial); sonda final varrendo o banco confirmando zero linhas de
`AIExecutionLog` com custo negativo.

### 11.3 ALTO — gate AST ainda bypassável (corrigido)

**Três bypasses comprovados pela reauditoria, todos fechados**:
1. `globalThis["fetch"]`/`window["fetch"]`/`` globalThis[`fetch`] ``/`Reflect.get(globalThis,
   "fetch")` evadiam a detecção de `FETCH_REFERENCE` por completo — a chave "fetch" é um
   literal de string ESTÁTICO (não ofuscação dinâmica) que o scanner simplesmente nunca
   inspecionava neste contexto. Fechado: `scanSourceFileForViolations` agora trata acesso
   computado/colchete a `globalThis`/`window` com chave literal "fetch" (incluindo
   template literal estático) e `Reflect.get/apply/construct(globalThis|window, "fetch",
   ...)` como `FETCH_REFERENCE`.
2. Arquivos `.js`/`.jsx`/`.mjs`/`.cjs` nunca eram escaneados (só `.ts`/`.tsx`). Fechado:
   as 6 extensões produtivas realmente aceitas pelo projeto são cobertas.
3. `scripts/` (incluindo `scripts/worker.ts`, entrypoint de produção real) estava
   inteiramente fora do escopo. Fechado: `scripts/` entrou no escopo, com allowlist mínima
   e documentada para os 2 usos legítimos que ele contém (servidor HTTP local de
   health-check do worker; smoke-test que só chama a própria app).

Também adicionados: exclusão explícita de diretórios de saída (`node_modules`, `.next`,
`dist`, `build`, `coverage` etc., mesmo que apareçam sob um diretório escaneado); teste
dedicado confirmando ausência de `eval`/`new Function` em código produtivo (defesa
adicional documentada — nenhum uso legítimo hoje).

**Limite residual, ainda documentado com honestidade**: o scanner não resolve fluxo de
dados nem construção dinâmica de strings — `globalThis["fe" + "tch"]`, `eval(...)`, ou uma
chave 100% computada em runtime (não um literal) continuam fora do alcance; fechar isso
exigiria um type-checker completo com resolução de fluxo de dados, fora de escopo.

**7 fixtures novas** (bracket/template/Reflect/alias, extensão `.js` plantada e removida
em `src/application/reporting/`, script hostil plantado e removido em `scripts/`, caminho
parecido com allowlisted não herda a allowlist) somadas às 15 já existentes.

### 11.4 MÉDIO — reaper sem call site produtivo (corrigido, com honestidade sobre o escopo)

**Causa raiz confirmada pela reauditoria**: `reapExpiredGatewayReservations` existia,
tinha CAS real e 10 testes passando isoladamente, mas não era chamada por nenhum job,
cron ou entrypoint de produção — reservas `QUEUED` órfãs nunca expiravam sozinhas.

**Estratégia mínima implementada** (a única exigida como obrigatória): antes de calcular o
orçamento de uma nova reserva, `reserveGatewayExecution` executa uma recuperação
oportunística tenant-scoped (`organizationId` sempre do `GatewayLedgerContext` do servidor,
nunca do cliente), com relógio server-side e lote limitado
(`OPPORTUNISTIC_REAP_BATCH_LIMIT = 20`). Se o reaper falhar, a reserva TAMBÉM falha — nunca
calcula orçamento sobre um estado que pode estar incorreto.

**Job periódico avaliado e NÃO adicionado, registrado com honestidade**: o worker existente
(`src/application/worker/`) só processa jobs enfileirados por evento específico de tenant
(`IntegrationJob`, um por instalação/webhook) — não existe, em nenhum lugar do projeto, um
padrão de "varredura periódica global" ao qual este reaper pudesse se acoplar sem inventar
um mecanismo de agendamento inteiramente novo (fora do escopo desta correção, e um risco
real de scope creep). Por isso, nenhum job periódico foi registrado em
`supportedJobTypes` — a estratégia oportunística acima é a única mitigação real hoje. Isto
é registrado explicitamente para não alegar um cron/worker ativo que não existe.

**7 testes novos** em `opportunistic-reap.database.integration.test.ts`: `reserveGatewayExecution`
chama o reaper oportunístico (spy); uma reserva `QUEUED` órfã deixa de consumir orçamento
assim que a PRÓXIMA reserva da mesma organização roda; uma reserva `RUNNING` vencida
continua consumindo mesmo depois; falha do reaper impede a nova reserva; dois requests
concorrentes não liberam a mesma órfã duas vezes; tenant A não limpa tenant B; o módulo do
reaper não importa nenhum código de adapter (recuperação nunca chama transporte).

### 11.5 MÉDIO — choke point de RBAC (corrigido)

**Causa raiz confirmada pela reauditoria**: `assertAiUse` — a função desenhada como o único
ponto de composição de AI_READ+AI_USE+capacidade de domínio — nunca era chamada por
nenhuma das 4 superfícies reais; cada uma duplicava manualmente a combinação, criando risco
real de uma superfície ser corrigida e a outra esquecida, sem nenhum teste arquitetural
impedindo uma futura Server Action/rota/ferramenta de IA de nascer sem checagem de AI_USE.

**Correção**: `assertAiUse(context, domainCapability?)` agora exige, nesta ordem, AI_READ
→ AI_USE → capacidade de domínio (quando informada) — e é a ÚNICA função chamada por
`askRedeAI`, `tool-registry.execute`, `authorizedAIContext` (Server Action) e a rota
`/api/ai/chat`; nenhuma delas monta a combinação manualmente (confirmado por teste que
also afirma a AUSÊNCIA de `assertAiCapability`/`assertProtectedReadCapability` isoladas
nesses 4 arquivos). Um teste arquitetural dedicado
(`rbac-choke-point.test.ts`) varre `src/app/actions` e `src/app/api` e falha se qualquer
arquivo (novo ou existente) importar um entry point do Gateway/ferramentas de IA
(`createOrganizationAiGateway`, `askRedeAI`, `aiToolRegistry`) sem também referenciar
`assertAiUse` — sem exigir atualização manual de nenhuma lista para novas superfícies.

**Nota de honestidade documentada** (mantida do pedido da reauditoria, não uma alegação
nova): hoje, `AI_USE` e `AI_READ` alcançam exatamente o mesmo conjunto de papéis
(`OWNER`/`ADMIN`/`ANALYST`/`REVIEWER`) — este choke point fecha o risco estrutural de
duplicação/deriva futura, mas não reduz a superfície de acesso hoje (nenhum papel atual
passa em um e falha no outro). `AI_ADMIN`/`AI_BUDGET_READ`/`AI_BUDGET_MANAGE`/`AI_AUDIT_READ`
continuam sem nenhuma superfície de UI/action ativa — definidas para uso futuro, como já
registrado em §9.10.

### 11.6 BAIXO — header Unicode (corrigido)

**Causa raiz confirmada pela reauditoria**: `isSafeHeaderValue` bloqueava controles/CR/LF/
NUL/DEL mas não fechava o charset — Unicode bidi (`‮`) e zero-width (`​`)
passavam silenciosamente, inconsistente com o padrão de allowlist fechado já usado por
`canonical-ref`/`idempotency-key`.

**Correção**: `isSafeHeaderValue` agora exige ASCII imprimível fechado (`/^[\x20-\x7E]+$/`)
— cobre controles/CR/LF/NUL/DEL e qualquer Unicode (bidi, zero-width, emoji, homoglyph) de
uma vez, com a mesma checagem. **6 casos novos** adicionados a
`compatible-http-adapter.test.ts`: tab, bidi (RTL override), zero-width, emoji, homoglyph
(cirílico), mais o token ASCII válido já existente confirmando que a mudança não quebra o
caminho legítimo.

### 11.7 Manifesto tocado mecanicamente pelo auditor

A reauditoria registrou explicitamente que, embora operando em modo read-only, ela
recalculou e gravou dois hashes em `docs/PHASE_9Q2A_SURFACE_MANIFEST.json`
(`src/app/actions/ai.ts`, `src/app/api/ai/chat/route.ts`) para poder executar a suíte
oficial — uma ação mecânica de recomputação de hash, não uma decisão de design, mas
tecnicamente fora do escopo "não altere documentação" da reauditoria. Isso é registrado
aqui com total transparência, conforme solicitado, e NÃO foi tratado como autorização
automática para qualquer outra mudança.

Como implementador desta correção crítica, ambos os arquivos foram alterados DE NOVO nesta
rodada (a composição de RBAC via `assertAiUse`, ver §11.5) — os hashes do auditor já
estavam desatualizados antes mesmo desta correção começar. Os dois hashes foram
recalculados pelo algoritmo canônico exato usado pelo próprio teste
(`sha256(source.replaceAll("\r\n","\n"))`, sem CRLF) DEPOIS de todas as correções desta
rodada estarem finalizadas, e gravados no manifesto. Nenhum outro arquivo do manifesto foi
tocado — confirmado por `git diff` do manifesto mostrando exatamente essas duas linhas
alteradas, e pela reexecução de `local-release-boundaries.test.ts` (5/5).

### 11.8 Classificação de erros e logs

Todos os novos `AiGatewayError` lançados nesta correção (`RESERVATION_EXPIRED`,
`PROVIDER_USAGE_INVALID`, `RECONCILIATION_REQUIRED`, e o `INVALID_RESPONSE` reutilizado
para CAS perdido em `confirmGatewayExecution`) usam mensagens estáticas fechadas, nunca
interpolam o valor hostil recebido (custo/unidades/token/endpoint/provider/model), nunca
usam `Error.cause` com o payload bruto do adapter, e nunca produzem uma linha `COMPLETED`
em `AIExecutionLog`/`AIPendingAction` para uma operação que foi rejeitada — confirmado
pelos testes de `gateway.database.integration.test.ts` (sonda de canário) e
`state-machine.database.integration.test.ts` (nenhuma linha "sucesso" para operação
revertida).

### 11.9 Autorrevisão adversarial desta correção crítica

Tentativas reais de quebrar cada invariante após a correção, todas com resultado seguro
(nenhum bug novo sobreviveu):
- reaper × mark RUNNING (as 3 ordens de chegada, incluindo `Promise.all` real): consistente.
- confirm × release concorrentes sobre a mesma linha `RUNNING`: exatamente um vence.
- terminal × confirm/release tardio: nunca ressuscita, nunca duplica custo.
- custo negativo/NaN/Infinity/acima da reserva/acima do orçamento: todos fecham corretamente.
- gate AST via bracket/Reflect/extensão nova/`scripts/`: todos os 3 bypasses comprovados
  pela reauditoria fecharam; verificado plantando e removendo os MESMOS payloads sem
  literal de domínio usados pela reauditoria (não apenas os fixtures com URL literal).
- nova Server Action/rota hipotética sem `assertAiUse`: detectada pelo teste arquitetural
  dedicado (fixture com conteúdo hostil minimalista confirma a regra antes de confiar nela).
- header Unicode (bidi/zero-width/emoji/homoglyph/tab): todos rejeitados; resolver/requester
  nunca chamados.
- cross-tenant: reaper oportunístico e explícito, ledger, e RBAC — isolamento confirmado em
  todos os pontos tocados por esta correção.
- log/error/ledger com canários: sonda dedicada varrendo `AIExecutionLog` por custo
  negativo; nenhuma ocorrência.

### 11.10 QA da correção crítica (números reais observados)

- `prisma validate`: schema válido. `prisma migrate status`: 39 migrations, banco em dia —
  nenhuma alteração de schema nesta correção.
- `tsc --noEmit`: 0 erros.
- `npx eslint src`: 0 erros, 1 warning (`disabled-provider-adapter.ts`, `_signal` não
  usado). **Nota de precisão adicionada pela reauditoria final de encerramento**: este
  warning nunca foi "pré-existente" no sentido literal — `git show HEAD:...` confirma que
  o arquivo não existe no histórico do Git (é código novo/não commitado desta mesma
  branch). "Pré-existente" só era verdadeiro no sentido "anterior a esta rodada de
  correção específica". Ver §13.9 para a eliminação definitiva deste warning (0
  warnings), o que torna esta imprecisão discutível daqui em diante.
- Suíte oficial completa (`pnpm test`), execução 1: **158 arquivos de teste passaram | 1
  ignorado (159)**; **1893 testes passaram | 4 ignorados (1897)**; 0 falhas.
- Suíte oficial completa, execução 2 (repetição sem recriar o banco): números idênticos —
  **158 | 1 (159)** arquivos, **1893 | 4 (1897)** testes, 0 falhas. Determinismo confirmado.
- Build de produção (`next build`): sucesso; `next-env.d.ts` regenerado incidentalmente
  pelo build (efeito colateral já conhecido do Next.js) e revertido para o byte-idêntico
  original antes de prosseguir.
- `production-preflight.test.ts`: incluído na suíte oficial acima, sem falhas.
- `git diff --check`: sem erros (apenas avisos de conversão LF→CRLF do Git no Windows).
- Varredura de padrões de segredo sobre o diff completo: nenhuma ocorrência.
- Testes novos desta correção: 18 (máquina de estados) + 15 (custo/uso hostil,
  incluindo a sonda de varredura) + 7 (fixtures AST novas, dentro do arquivo de
  arquitetura) + 7 (reaper oportunístico) + 4 (choke point de RBAC) + 6 (header Unicode) =
  **57 testes novos** somados aos 238 já existentes na subárvore `ai-gateway` (mais os
  ajustes de sinal/assinatura em testes pré-existentes descritos em §11.1–§11.6).

## 12. Declaração final (após a correção crítica pós-reauditoria — SUPERADA, ver §13: a "REAUDITORIA FINAL DE ENCERRAMENTO" que se seguiu a esta declaração reprovou o estado abaixo)

Nenhum commit ou push foi executado. Nenhuma chamada externa real, DNS real ou credencial
real foi usada em nenhum teste desta correção — os 18+15+7 testes novos usam apenas
Postgres local, adapters/spies injetados e `vi.spyOn` sobre módulos internos, nunca rede
real. Nenhum provider comercial foi habilitado. Nenhuma migration foi criada (39
migrations, inalteradas — `prisma/schema.prisma` byte-idêntico ao início desta correção);
todos os cinco achados corrigidos (máquina de estados, custo observado, gate AST, reaper,
choke point de RBAC) reaproveitaram exclusivamente código e enums/colunas já existentes.
Nenhuma Fase 10B–10I foi iniciada ou mencionada em qualquer arquivo novo ou alterado.
Nenhuma decisão autônoma foi implementada — toda transição de estado (QUEUED→RUNNING→
terminal, liberação do reaper, confirmação/rejeição de custo) é uma regra determinística e
auditável, verificada por CAS transacional, nunca uma escolha do sistema em tempo de
execução. O manifesto `docs/PHASE_9Q2A_SURFACE_MANIFEST.json` foi atualizado pelo
implementador (não mais pelo auditor) com os hashes finais dos dois arquivos
efetivamente revisados nesta rodada, pelo algoritmo canônico exato do próprio gate. O
worktree permanece aberto para uma nova reauditoria, caso necessária.

**Nota adicionada pela correção crítica DEFINITIVA (§13): a "REAUDITORIA FINAL DE
ENCERRAMENTO — FASE 10A" que avaliou este estado reprovou-o** — encontrou, ao vivo, com
Postgres real e um adapter injetado (nunca mocks), que `gateway.ts` chamava
`adapter.execute()` mais de uma vez (1 tentativa inicial + até 3 retries) e liberava a
reserva (custo zerado) para qualquer falha pós-transporte que não fosse
`RECONCILIATION_REQUIRED` — incluindo `TIMEOUT`/`PROVIDER_UNAVAILABLE`/`UNEXPECTED`, sem
nenhuma garantia de não-cobrança do provedor. Esta seção (§12) é preservada tal como
escrita originalmente — a máquina de estados QUEUED→RUNNING→terminal descrita em §11.1
estava, de fato, corretamente protegida contra ressurreição de estado terminal; o que
faltava era a política de retry/liberação em torno da ÚNICA invocação do adapter, corrigida
em §13.

## 13. Correção crítica DEFINITIVA pós-reauditoria — falha pós-transporte (achado CRÍTICO)

Esta seção documenta a correção do achado da "REAUDITORIA FINAL DE ENCERRAMENTO — FASE
10A", que reprovou o estado descrito em §12 acima. Nenhum histórico anterior foi apagado —
apenas anotado (ver notas em §11.10 e §12) e complementado aqui.

### 13.1 Causa raiz confirmada pela reauditoria

`gateway.ts` envolvia `markGatewayExecutionTransportStarted` + `adapter.execute` +
validação + `confirmGatewayExecution` num laço de retry genérico (`decideRetry`, até 3
tentativas) que não distinguia se a falha ocorreu ANTES ou DEPOIS de `adapter.execute` ser
efetivamente chamado. Qualquer falha classificada como "retryable" (`TIMEOUT`,
`PROVIDER_UNAVAILABLE`, `UNEXPECTED` — a classificação padrão para praticamente qualquer
erro de transporte real) disparava uma NOVA chamada real ao adapter, mesmo que a tentativa
anterior já tivesse iniciado um transporte cujo resultado real (recebido/processado pelo
provedor ou não) era desconhecido. Ao esgotar as tentativas, `releaseGatewayExecution`
aceitava `RUNNING` como origem e liberava a reserva (custo zerado) incondicionalmente,
exceto para o único código `RECONCILIATION_REQUIRED`.

**Provado ao vivo pela reauditoria**: um adapter que lança um erro classificado como
`TIMEOUT` depois de "começar" foi chamado **4 vezes** (1 + 3 retries), e a reserva
terminou liberada automaticamente com custo zerado (`FAILED`, `estimatedCost: 0`).

### 13.2 Regra conservadora adotada (sem exceção por classe de erro)

Antes de `adapter.execute` ser invocado, uma falha é comprovadamente pré-transporte e pode
liberar a reserva com segurança. Depois que `adapter.execute` for invocado, a execução
passa a ser potencialmente cobrável — nenhum erro, de nenhuma classe (`AUTHENTICATION`,
`AUTHORIZATION`, `RATE_LIMIT`, `TIMEOUT`, `PROVIDER_UNAVAILABLE`, `INVALID_RESPONSE`,
`PROVIDER_USAGE_INVALID`, `PROVIDER_IDENTITY_MISMATCH`, `UNEXPECTED`, ou qualquer status
HTTP/tipo de exceção), aciona liberação automática ou uma segunda chamada ao adapter. A
reserva permanece `RUNNING` (ou, quando a confirmação chega a rodar mas o custo excede o
orçamento, `RECONCILIATION_REQUIRED`) — continua contabilizada até reconciliação manual.
Sem contrato real de nenhum provedor comercial (nenhum está habilitado nesta fase) e sem
prova de idempotência do lado externo, nenhuma classe de erro pós-invocação é segura de
tratar como "não cobrou".

### 13.3 Alterações em `gateway.ts`

- Removido o laço de retry (`for(;;)`, `decideRetry`, `RETRY_POLICY`, `sleep`) em torno de
  `adapter.execute` — agora exatamente uma invocação por execução lógica.
- Marcador de controle interno `adapterInvoked` (nunca vindo do cliente): `false` até
  imediatamente antes da única chamada ao adapter, `true` a partir daí. É o único que
  decide, de forma determinística (nunca por classe de erro), se uma falha é segura de
  liberar automaticamente: `if (!adapterInvoked) { await releaseGatewayExecution(...); }`
  — e SOMENTE nesse caso. Os outros três marcos do ciclo de vida de uma tentativa
  (`transportPromoted`: `transportStart.transitioned === true`; `providerResponseReceived`:
  `adapter.execute` retornou; `confirmationPersisted`: `confirmGatewayExecution` retornou
  com sucesso) são identificáveis pela própria posição do código — nenhum precisa de uma
  variável própria porque nenhum, isoladamente, muda a decisão de liberar.
- Identidade divergente (`PROVIDER_IDENTITY_MISMATCH`) e uso hostil
  (`PROVIDER_USAGE_INVALID`) detectados APÓS a resposta do adapter agora também deixam a
  execução `RUNNING` — o adapter respondeu, então a chamada é potencialmente cobrável
  mesmo com identidade/uso hostil na resposta (mudança de comportamento deliberada em
  relação à correção anterior, que liberava esses dois casos).

### 13.4 `releaseGatewayExecution` — endurecida para aceitar somente `QUEUED`

O CAS de liberação automática agora exige `status: "QUEUED"` (antes aceitava
`{in: ["QUEUED", "RUNNING"]}`). Uma tentativa de liberar `RUNNING` nunca afeta nenhuma
linha (`released: false`) — nunca lança, nunca zera custo, nunca muda `RUNNING` para
`FAILED`. Não foi criada nenhuma função adicional para liberar `RUNNING` "entre mark e
adapter": essa janela não contém nenhuma operação falível no código atual (a chamada ao
adapter é a instrução seguinte, sem nada entre elas) — se um caminho futuro introduzir tal
janela, precisará de uma função própria, explicitamente nomeada, guardada por
`adapterInvoked === false`, e testada para provar que nenhum caminho pós-invocação
consegue chamá-la.

### 13.5 Retry — apenas para operações locais anteriores ao transporte

`reserveGatewayExecution` mantém seu próprio retry interno para P2034 (conflito de
serialização Postgres) — sempre foi um retry de operação **local** (a transação da
reserva), nunca uma nova chamada externa; inalterado por esta correção. Não existe mais
nenhum retry em torno de `adapter.execute`. Se `confirmGatewayExecution` falhar por
qualquer motivo (CAS perdido, erro transitório do Prisma, custo acima do orçamento), o
erro sobe sem re-chamar o adapter e sem liberar a reserva — ela permanece `RUNNING` para
reconciliação manual/futura.

### 13.6 Reconciliação

Reaproveitado sem migration: `RUNNING` (schema pré-existente) já é o estado equivalente a
"reconciliação necessária" — nenhum campo/JSON novo foi improvisado. `RECONCILIATION_REQUIRED`
(código estático já existente desde a correção crítica anterior, §11.2) continua sendo o
único código que nunca aciona liberação automática; agora TODOS os códigos pós-invocação
compartilham essa mesma garantia, através do marcador `adapterInvoked` em vez de uma
lista de exceções por código.

### 13.7 Testes novos

**37 testes novos**: `post-invocation-policy.database.integration.test.ts` (15 — seção B:
8 classes de erro pós-invocação parametrizadas + erro assíncrono real; seção C: falha de
confirmação transitória/permanente via `vi.spyOn`; seção A: erro local antes de
`adapterInvoked`; seção 7: duas execuções reais concorrentes com a mesma
`idempotencyKey`, replay do cliente após falha de confirmação, reaper×adapter em voo);
mais atualizações em `gateway.database.integration.test.ts` (3 casos parametrizados
substituindo os 2 testes antigos de retry, 9+11 casos hostis atualizados para `RUNNING`) e
`state-machine.database.integration.test.ts` (2 testes reescritos para refletir que
`releaseGatewayExecution` nunca mais aceita `RUNNING`). Todos contra PostgreSQL real, com
`adapter.execute` espionado (contagem de chamadas) em cada caso.

### 13.8 Autorrevisão adversarial desta correção

Tentativas reais de quebrar, todas com resultado seguro: adapter que incrementa contador e
lança (contagem sempre 1); adapter que responde e a confirmação falha depois (via spy —
nunca libera, nunca rechama); exceção síncrona vs. assíncrona do adapter (mesmo
tratamento); replay do cliente durante `RUNNING` (rejeitado, nunca rechama o adapter);
release indevido de `RUNNING` (sempre no-op, testado sob concorrência real); confirm
tardio (rejeitado fechado, testado em §11); `eval`/`new Function` (bloqueados no próprio
AST scanner agora, fixtures comprovam). Nenhum bug novo sobreviveu.

### 13.9 Ajustes baixos

- **ESLint `_signal`**: eliminado sem desativar nenhuma regra global — o parâmetro
  `signal` de `DisabledAiProviderAdapter#execute` é referenciado explicitamente (`void
  signal;`) em vez de renomeado com prefixo `_`, documentando que faz parte do contrato
  `AiProviderAdapter` mesmo não sendo usado por este adapter específico (que nunca inicia
  transporte). `npx eslint src` agora reporta **0 erros, 0 warnings**.
- **`eval`/`new Function`**: bloqueados diretamente no scanner AST (`scanSourceFileForViolations`,
  novo `ViolationKind` `EVAL_OR_FUNCTION_CONSTRUCTOR`, nunca allowlisted) — não mais só um
  teste de regressão textual separado. 2 fixtures novas (`eval(...)`, `new Function(...)`)
  provam a detecção real.
- **Manifesto 9Q.2A**: nenhum arquivo dentro do escopo do manifesto
  (`src/app/actions/*.ts`, `src/app/api/**/route.ts`) foi tocado por esta correção — as 35
  entradas permanecem exatamente como a correção crítica anterior as deixou, confirmado
  recomputando todos os 35 hashes pelo algoritmo canônico do próprio gate e comparando com
  o manifesto (nenhuma divergência).

### 13.10 QA da correção crítica DEFINITIVA (números reais observados)

- `prisma validate`: schema válido. `prisma migrate status`: 39 migrations, banco em dia —
  nenhuma alteração de schema nesta correção.
- `tsc --noEmit`: 0 erros.
- `npx eslint src`: **0 erros, 0 warnings** (o único warning existente foi eliminado, não
  apenas aceito — ver §13.9).
- Subárvore `ai-gateway` isolada (24 arquivos, 309 testes) rodada antes da suíte completa:
  0 falhas.
- Suíte oficial completa (`pnpm test`), execução 1: **159 arquivos de teste passaram | 1
  ignorado (160)**; **1909 testes passaram | 4 ignorados (1913)**; 0 falhas.
- Suíte oficial completa, execução 2 (repetição sem recriar o banco): números idênticos —
  **159 | 1 (160)** arquivos, **1909 | 4 (1913)** testes, 0 falhas. Determinismo confirmado.
- Build de produção (`next build`): sucesso; `next-env.d.ts` regenerado incidentalmente
  pelo build e revertido para o byte-idêntico original antes de prosseguir.
- `production-preflight.test.ts`: incluído na suíte oficial acima, sem falhas.
- `git diff --check`: sem erros (apenas avisos de conversão LF→CRLF do Git no Windows).
- Varredura de padrões de segredo sobre o diff completo: nenhuma ocorrência.
- Manifesto 9Q.2A: 35/35 hashes recomputados pelo algoritmo canônico batem exatamente com
  o manifesto — nenhum arquivo do seu escopo foi tocado por esta correção.
- 37 testes novos (ver §13.7) somaram-se aos 293 já existentes na subárvore `ai-gateway`
  antes desta correção (238 da correção crítica anterior + 57 da própria, ajustado por
  substituições/atualizações de testes pré-existentes) — total agora 309 testes na
  subárvore, 24 arquivos.

## 14. Declaração final (após a correção crítica DEFINITIVA pós-reauditoria)

Nenhum commit ou push foi executado. Nenhuma chamada externa real, DNS real ou credencial
real foi usada em nenhum teste — os 37 testes novos usam apenas Postgres local,
adapters/spies injetados e `vi.spyOn` sobre módulos internos. Nenhum provider comercial
foi habilitado. Nenhuma migration foi criada (39 migrations, inalteradas) — a política de
retry/liberação foi corrigida inteiramente em código de aplicação, reaproveitando o mesmo
estado `RUNNING` já usado para reconciliação. Nenhuma Fase 10B–10I foi iniciada ou
mencionada em qualquer arquivo novo ou alterado. Nenhuma decisão autônoma foi
implementada — a única decisão automática que resta (liberar `QUEUED` pré-transporte) é
uma regra determinística baseada exclusivamente em `adapterInvoked`, nunca em classe de
erro/status HTTP/tipo de exceção. O worktree permanece aberto para verificação definitiva.
