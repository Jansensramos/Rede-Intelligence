# Fase 10C — Tool Layer — registro de implementação

**Data:** 15/09/2026
**Branch:** `codex/fase-10c-tool-layer`
**HEAD-base:** `f4586dcf2c005f32d02d47a202ed17d13502f0db`
**Estado:** implementação local concluída conforme as 15 decisões aprovadas (`docs/PHASE_10C_TOOL_LAYER_CONTRACT.md` §20); sem staging, commit ou push; sujeita a auditoria independente antes de qualquer integração produtiva.

## 1. Escopo entregue

Um novo módulo isolado (decisão 5), `src/domain/ai-tools` + `src/application/ai-tools`, expõe exatamente 4 ferramentas `READ_ONLY` (decisão 2): `getApprovedViabilitySummary`, `getActiveRisks`, `getEngineeringProgress`, `getVerifiedLegalEvidence`. Cada uma mapeia 1:1 a um `ContextPurpose` já implementado e auditado pela 10B — nenhum reader novo, nenhuma consulta Prisma de negócio própria. Nenhuma ferramenta de escrita, simulação, rota pública ou integração com `planAIIntent`/o chat existente foi criada (decisões 4, 15, 5).

Arquivos novos:

| Arquivo | Conteúdo |
| --- | --- |
| `src/domain/ai-tools/contracts.ts` | 7 contratos provider-neutral Zod `strict` + guarda `isPlainContextData` reaproveitada da 10B; `AiToolError` |
| `src/domain/ai-tools/ai-tools.test.ts` | Testes de domínio puro — canários de getter/Proxy/prototype/Symbol, forma estrita, códigos de erro fechados |
| `src/domain/ai-tools/index.ts` | Reexport |
| `src/application/ai-tools/catalog.ts` | Registro fechado das 4 ferramentas; `domainCapability` derivada de `contextPolicyFor`, nunca digitada a mão |
| `src/application/ai-tools/service.ts` | `executeAiTool` (entry point único) + `prepareAiToolInvocation`/`consumeAiToolInvocation` (fases exportadas para testes de corrida) |
| `src/application/ai-tools/architecture.test.ts` | Gate arquitetural: dependências proibidas, allowlist fechado de escrita Prisma, isolamento do registro legado |
| `src/application/ai-tools/ai-tools.database.integration.test.ts` | 19 testes PostgreSQL real: golden path×4, RBAC, IDOR, confused deputy, revogação em corrida, replay 2/5/10 mesmo processo e 2/5/10 subprocessos independentes |
| `src/application/ai-tools/index.ts` | Reexport |
| `src/application/ai/tool-registry.regression.test.ts` | Regressão dedicada da decisão 9 (`changeContext`) |
| `docs/PHASE_10C_TOOL_LAYER_CONTRACT.md` | Atualizado nesta sessão com as 15 decisões aprovadas, referência cruzada corrigida |

Arquivos modificados (mínimos, cirúrgicos):

| Arquivo | Mudança |
| --- | --- |
| `src/application/ai-gateway/ledger-service.ts` | `export` em `CONTEXT_MUTATION_BARRIER_SQL`, `MAX_SERIALIZABLE_RETRY_ATTEMPTS`, `TRANSACTION_TIMEOUT_MS` — reaproveitados pelo Tool Layer sem duplicar valores; nenhuma lógica alterada |
| `src/application/ai-gateway/rbac-choke-point.test.ts` | `executeAiTool` adicionado a `GATEWAY_ENTRY_POINTS` (decisão 6); teste dedicado confirmando que `service.ts` usa `assertAiUse` exclusivamente |
| `src/application/ai/tool-registry.ts` | `changeContext` reclassificada de `READ_ONLY` para `MUTATION`, no registro e no valor de retorno (decisão 9) — lógica funcional da função inalterada |

Nenhuma migration foi criada. Nenhum arquivo de schema foi tocado. Nenhuma rota, Server Action ou integração produtiva nova foi adicionada.

## 2. Como cada decisão aprovada foi implementada

| # | Decisão | Implementação |
| --- | --- | --- |
| 1 | Vercel oficial | Documental — sem ação de código; registrado em `PHASE_10C_TOOL_LAYER_CONTRACT.md` §1 |
| 2 | Catálogo de 4 ferramentas | `catalog.ts`, 4 `AiToolSpec` fechados |
| 3 | Exclusão dos 3 candidatos não prontos | Nenhum reader/política nova criada; nenhuma extensão da 10B iniciada |
| 4 | Exclusão de ferramentas de escrita | `AiToolModeSchema = z.literal("READ_ONLY")` — nenhum outro valor é aceito nem pelo Zod nem pelo TypeScript |
| 5 | Isolamento do roteador legado | `planAIIntent`, `ai-service.ts` e `tool-registry.ts` não foram importados nem alterados (exceto a correção pontual da decisão 9); nenhuma rota nova referencia `executeAiTool` |
| 6 | Gate arquitetural obrigatório | `architecture.test.ts` (5 testes) + extensão de `rbac-choke-point.test.ts` (2 testes novos), entregues na mesma fatia que o código |
| 7 | Rate limit dedicado | `checkAndConsumeRateLimit(organizationId, "ai-tool:<toolName>", {limit:30, windowMs:60_000})` — mesma infraestrutura de `IntegrationRateLimitState`, chave de escopo própria, nunca compartilhada com `RATE_LIMIT_POLICY` do Gateway |
| 8 | Nome do módulo | `src/application/ai-tools` + `src/domain/ai-tools`, exatamente como aprovado |
| 9 | `changeContext` → `MUTATION` | Rótulo corrigido em `tool-registry.ts` (registro e retorno); lógica da função `changeContext` não tocada; regressão dedicada em `tool-registry.regression.test.ts` (4 testes) prova a reclassificação e generaliza a checagem para qualquer futura ferramenta delegada por referência com escrita Prisma |
| 10 | Protocolo transacional completo | `prepareAiToolInvocation` chama `prepareContextBundle`; `consumeAiToolInvocation` roda dentro de uma transação `Serializable` que adquire `CONTEXT_MUTATION_BARRIER_SQL` (reaproveitado do ledger da 10A), faz CAS `QUEUED→RUNNING` no `AIExecutionLog` próprio, e chama `consumeContextBundleInTransaction` (10B) — revalidação, reconstrução do fingerprint e auditoria `CONTEXT_CONSUMED` sem nenhuma alteração de código na 10B |
| 11 | Vínculo obrigatório | Todo `AiToolResult` carrega `correlationId` gerado no servidor; `AIExecutionLog`/`AIToolCallLog` gravam organizationId/userId/conversationId/tool a partir do `AuthContext` e do registro fechado, nunca de `arguments` |
| 12 | Idempotência e auditoria | Nenhum `idempotencyKey` novo — reaproveita `bundle.requestRef`; `AIToolCallLog` sem alteração de schema; exatamente uma execução comprovada por 5 testes de replay (mesmo processo 2/5/10 + subprocessos independentes 2/5/10) |
| 13 | Papéis e capabilities | `minimumRole: "REVIEWER"` nas 4 specs; `ROLE_RANK` local (sem importar o registro legado); `domainCapability` derivada de `contextPolicyFor` |
| 14 | Nenhuma migration | Confirmado — `prisma validate` aprovado, 39 migrations inalteradas, `git status` limpo em `prisma/` |
| 15 | Fronteira de escopo | Nenhuma rota, nenhum provider externo, nenhuma menção a 10D–10I em `src/application/ai-tools`/`src/domain/ai-tools` (verificado pelo próprio gate arquitetural) |

## 3. Autorrevisão adversarial observada nos testes

- **RBAC cumulativo**: OWNER/ADMIN/ANALYST/REVIEWER completam; VIEWER recusado com `TOOL_ACCESS_DENIED` em toda ferramenta testada.
- **Confused deputy**: um `AuthContext` com papel forjado (`OWNER`) sobre uma membership real `REVIEWER` é recusado — a revalidação de `prepareContextBundleInTransaction` confere o papel real armazenado, nunca confia no `AuthContext` do chamador isoladamente.
- **Ferramenta não registrada**: `TOOL_UNKNOWN`, zero linhas novas de `CONTEXT_PREPARED` — nenhuma leitura de negócio ocorre antes da validação do nome.
- **IDOR — outro tenant**: conversa de outra organização recusada de forma genérica (`TOOL_ACCESS_DENIED`), sem distinguir "não existe" de "outro tenant".
- **IDOR — outro autor**: conversa do mesmo tenant criada por outro usuário é recusada.
- **Projeto suspenso**: `PAUSED` aplicado após a conversa existir bloqueia o preparo (reaproveita `isContextProjectStatusActive` da 10B, sem redefinição local).
- **Revogação entre preparo e consumo**: `LegalEvidenceDocument` revogado em um `PrismaClient` independente entre `prepareAiToolInvocation` e `consumeAiToolInvocation` é detectado — a ferramenta recusa, zero novo `CONTEXT_CONSUMED`, e o documento permanece `REVOKED` (a revogação não é desfeita).
- **Replay/concorrência, mesmo processo (2, 5, 10)**: exatamente uma execução `COMPLETED`, as demais perdem o CAS (`TOOL_CONCURRENT_CHANGE`); exatamente uma linha `AIToolCallLog` com status `COMPLETED` por `executionLogId`.
- **Replay/concorrência, subprocessos independentes (2, 5, 10)**: mesmo resultado com `PrismaClient`s genuinamente independentes — prova a durabilidade do CAS além do processo único.
- **Escopo de escrita**: uma chamada `COMPLETED` não altera a contagem de `RiskFinding` da fonte lida; nenhum campo sensível (`password`/`secret`/`storageKey`) aparece no `AIToolCallLog.arguments` persistido.

## 4. QA observado

- **TypeScript** (`tsc --noEmit`): aprovado, zero erros, em cada etapa da implementação.
- **ESLint** (`eslint .`, repositório completo): aprovado, zero erros, zero avisos.
- **Prisma** (`prisma validate`): schema válido; 39 migrations inalteradas; `git status` limpo em `prisma/`.
- **Testes focais do Tool Layer**: 4 arquivos, 35 testes (7 domínio + 5 arquitetura + 19 PostgreSQL real + 4 regressão de `changeContext`), **zero falhas**.
- **`rbac-choke-point.test.ts` estendido**: 6 testes (5 originais + 1 novo), zero falhas.
- **Suíte oficial, primeira passagem** (`npm test` — migrate + seed + vitest no banco de teste): concluída com exit code 0, sem falhas (agregado exato não capturado pelo terminal devido ao reporter padrão; confirmado pela segunda passagem abaixo, idêntica em conteúdo e ambiente).
- **Suíte oficial, segunda passagem** (mesmo banco, sem recriação, `vitest run --reporter=default`): **166 arquivos aprovados, 1 arquivo oficialmente ignorado (167 total); 2.032 testes aprovados, 4 skips oficiais (2.036 total)**, zero falhas, 408,64 s. Os 4 skips permanecem exclusivamente em `prisma/seed.database.integration.test.ts` (gate `dbReady`, fase 9R) — nenhum pertence à 10C. O incremento sobre a linha de base pré-10C (162 arquivos/1.996 testes) é de exatamente +4 arquivos/+36 testes, correspondendo 1:1 aos arquivos novos listados na seção 1.
- **Build produtivo** (`next build`): aprovado, 28/28 páginas estáticas geradas; `next-env.d.ts` alterado automaticamente pelo Next.js e restaurado ao conteúdo do HEAD logo em seguida.
- **Preflight produtivo inválido** (ambiente vazio): recusado antes de qualquer dependência externa, exit code 2, status `CONFIGURACAO_INVALIDA`, valores não exibidos.
- **Manifesto de superfícies 9Q.2A**: verificado por leitura (sem escrever o arquivo) — **35/35 hashes conferem, zero divergências**; as 2 entradas adicionais existentes hoje em disco (`closure.ts`, `handover.ts`) são de fases anteriores (9R/9S) fora deste manifesto, não uma introdução desta sessão.
- **`git diff --check`**: aprovado; apenas avisos informativos de conversão LF/CRLF do Git no Windows.
- **Busca de segredos** no diff desta fatia: zero segredo real encontrado.

## 5. Riscos residuais (honestos, não absolutos)

- A barreira `CONTEXT_MUTATION_BARRIER_SQL` é compartilhada entre o ledger da 10A e o Tool Layer — cada chamada de ferramenta agora também disputa esse lock `SHARE`, ampliando (não introduzindo) o risco de contenção já documentado pela 10B. Aceito conscientemente pela decisão 10.
- O rate limit de ferramenta (`ai-tool:<toolName>`, 30/60s) é uma política inicial conservadora, não validada contra volume real de uso; pode exigir ajuste após observação em ambiente real.
- `resolveConversationProjectId` é uma leitura Prisma estreita e não-transacional feita antes do preparo, para obter o `projectId` real necessário por `consumeContextBundleInTransaction` (que só recebe uma referência opaca do bundle). Isso é seguro porque `consumeContextBundleInTransaction` revalida tudo transacionalmente logo em seguida (TOCTOU inofensivo — a decisão final é sempre a da transação), mas é uma leitura adicional que não existia antes desta fase; documentado aqui para transparência, não uma migration nem um novo padrão de autorização.
- O catálogo legado de 116 ferramentas continua operando fora da disciplina 10A/10B, sem nenhuma alteração além da correção pontual de `changeContext`. A convergência (se/quando as 4 novas ferramentas substituem as equivalentes legadas) permanece decisão humana futura, não resolvida aqui (decisão 5).
- `changeContext` reclassificada para `MUTATION` agora exige `context.permissions.canMutate` (OWNER/ADMIN) para ser executada por `AIToolRegistry.execute`, onde antes (rotulada `READ_ONLY`) REVIEWER/ANALYST também podiam chamá-la sem essa checagem. Este é um efeito colateral necessário e de segurança positiva da correção de rótulo (a ferramenta sempre gravou; o rótulo agora finalmente corresponde à execução), não uma nova funcionalidade — mas é uma mudança real de quem pode acionar essa ferramenta específica no catálogo legado, e está sinalizada aqui explicitamente para que não passe despercebida.

## 6. Estado Git final

```
Branch: codex/fase-10c-tool-layer
HEAD:   f4586dcf2c005f32d02d47a202ed17d13502f0db (idêntico ao commit-base — nenhum commit criado)
Upstream: não configurado
Staged: nenhum
Working tree: 13 caminhos alterados/novos (listados na seção 1), nenhum fora do escopo aprovado
```

Nenhum commit, push, merge, rebase ou tag foi executado nesta sessão. Nenhuma parte das fases 10D–10I foi iniciada, mencionada em código ou pressuposta. Parando aqui para auditoria independente, conforme solicitado.

---

# Correção focal pós-auditoria (16/09/2026)

**Estado:** correção completa dos achados novos de uma auditoria adversarial independente sobre a entrega acima. Mesma branch, mesmo HEAD-base, zero staged, zero migration, nenhum comportamento funcional das 4 ferramentas alterado. Sem commit/push. Parando para reauditoria focal independente.

## A. Escopo da auditoria e classificação original dos achados

A auditoria (read-only, sondas próprias temporárias, removidas ao final) classificou: **ALTO-1** (estado terminal do `AIExecutionLog` podia ser sobrescrito de `COMPLETED` para `FAILED` por um perdedor tardio de uma corrida de replay — reproduzido em 15/15 tentativas com uma sonda dedicada), **ALTO-2** (`prepareAiToolInvocation`/`consumeAiToolInvocation` eram reexportadas publicamente por `index.ts`; chamar só a fase de preparo, sem nunca consumir, já entregava evidência completa sem passar pelo CAS/auditoria — reproduzido empiricamente), **ALTO-3** (pelo menos 13 ferramentas legadas `READ_ONLY`, fora do piloto, gravam via getters de workspace impuros — já documentado pela 10B mas não coberto pela regressão original, que só detecta delegação por referência nomeada), **MÉDIO-4** (rate limit sem isolamento por ator — chave só continha organização+ferramenta), **MÉDIO-5** (`toolName` bruto persistido em `AIToolCallLog.tool` quando a ferramenta era desconhecida, sem limite de tamanho/charset), **MÉDIO-6** (nenhum teste verificava o estado final do `AIExecutionLog` após replay, o que permitiu ALTO-1 passar despercebido). Nenhum critério de reprovação automática foi atingido (sem bypass de RBAC/tenant, sem segunda execução do handler, sem dado sensível vazado, sem escrita no piloto) — veredito da auditoria: **aprovado com ressalvas**, correção obrigatória antes de um aceite pleno.

## B. Causa e correção de cada achado

| Achado | Causa raiz | Correção |
| --- | --- | --- |
| ALTO-1 | `finalizeAndAudit` fazia `prisma.aIExecutionLog.update(...)` incondicional — qualquer chamador (vencedor ou perdedor) podia sobrescrever o status, e por construção os perdedores (que fazem menos trabalho) tendiam a finalizar depois do vencedor | `finalizeAndAudit` agora recebe uma `transition: {from: AIExecutionStatus[], to}` explícita por call site (`QUEUED→FAILED` para quem nunca possuiu `RUNNING`; `RUNNING→COMPLETED`/`RUNNING→FAILED` apenas para quem venceu o CAS interno de `consumeWithCas`) e faz `updateMany` guardado por `status: {in: from}` — 0 linhas afetadas é um no-op seguro, nunca um erro. A escrita do `AIToolCallLog` acontece na mesma transação |
| ALTO-2 | `index.ts` fazia `export * from "./service"`, reexportando as duas fases internas | `index.ts` agora usa `export { executeAiTool } from "./service"` nomeado; as fases internas continuam `export`adas em `service.ts` (necessário para o teste de corrida importar via caminho relativo `./service`, de dentro do próprio pacote) mas nunca alcançam o barril público. Gate arquitetural dedicado escaneia todo `src/` fora de `ai-tools/**` procurando os dois identificadores, sob qualquer forma de import, e uma prova em runtime confirma que `@/application/ai-tools` não os expõe |
| ALTO-3 | Regressão original só detectava ferramentas delegadas por referência nomeada (`execute: nomeDaFuncao`), não chamadas indiretas via `getXWorkspace(...)` inline | Manifesto fixo de 13 entradas em `tool-registry.regression.test.ts` (nunca gerado/auto-atualizado), cruzando cada ferramenta com o getter impuro (`getLegalWorkspace`/`getSalesWorkspace`) que ela chama; gate preventivo falha se uma ferramenta fora do manifesto passar a chamar um desses getters; teste confirma que nenhuma das 13 está no catálogo novo. Nenhuma das 13 foi reclassificada ou refatorada — dívida técnica registrada, não resolvida aqui |
| MÉDIO-4 | Chave de rate limit `ai-tool:<toolName>` não incluía o ator | Chave passa a ser `ai-tool:<toolName>:<safeContextRef("actor", userId)>` — referência determinística segura, nunca o `userId` bruto |
| MÉDIO-5 | `toolName` inválido era gravado verbatim em `AIToolCallLog.tool` | Substituído por um sentinel estático `"UNKNOWN_TOOL_NAME"` sempre que o nome não resolve a uma das 4 ferramentas registradas — nunca o valor bruto |
| MÉDIO-6 | Nenhum teste verificava `AIExecutionLog.status` pós-replay | Nova função `assertRaceInvariants` (reutilizada por todos os testes de corrida) verifica explicitamente o status final do `AIExecutionLog`, a contagem de `AIToolCallLog` por resultado, `CONTEXT_CONSUMED` e ausência de `AIPendingAction` |

## C. Invariantes finais (ver também `docs/PHASE_10C_TOOL_LAYER_CONTRACT.md` §24)

Estado terminal monotônico e atômico com a auditoria; choke point estruturalmente único e comprovado por gate + runtime; rate limit isolado por organização+ferramenta+ator; nomes inválidos nunca persistidos brutos; cobertura de replay explícita; catálogo legado nomeado e gateado sem reclassificação silenciosa.

## D. Testes adicionados/reescritos nesta correção

| Arquivo | Antes | Depois | O que mudou |
| --- | --- | --- | --- |
| `src/application/ai-tools/ai-tools.database.integration.test.ts` | 19 testes | 28 testes | Reescrito para usar `executeAiTool` (API pública) na maioria dos casos, reservando o import relativo `./service` só para os testes de corrida; replay 2/5/10/**20**, cada um repetido **3 vezes**; teste de "perdedor tardio nunca sobrescreve"; 3 testes de isolamento de rate limit (ator/ferramenta/tenant) + 1 de limite sequencial real (30/33) + 1 documentando honestamente o comportamento sob rajada verdadeiramente concorrente da infraestrutura reaproveitada; teste de nomes hostis (50KB, CRLF, NUL, bidi, zero-width, `__proto__`); prova estrutural de que o módulo público não expõe as fases internas; teste do reaper genérico reconciliando `QUEUED` órfão |
| `src/application/ai-tools/architecture.test.ts` | 5 testes | 8 testes | +3: nenhuma menção às fases internas em `index.ts` fora de comentário; nenhum arquivo fora do pacote referencia as fases internas; prova estrutural em runtime |
| `src/application/ai/tool-registry.regression.test.ts` | 4 testes | 9 testes | +5: manifesto de 13 exceções legadas, premissa de impureza dos getters, gate preventivo, ausência no catálogo novo |
| `src/application/ai-gateway/rbac-choke-point.test.ts` | 5 testes (1 novo da 10C) | 5 testes (inalterado nesta correção) | — |
| `src/domain/ai-tools/ai-tools.test.ts` | 7 testes | 7 testes (inalterado) | — |

Total de testes novos/incrementais desde a linha de base pré-10C: **53** (era 36 na entrega original da 10C) — número real observado na suíte oficial (1.996 + 53 = 2.049), não mais "35" nem "36".

## E. QA observado (correção focal, execução independente)

- **TypeScript** (`tsc --noEmit`): aprovado, zero erros, a cada etapa.
- **ESLint** (`eslint .`, repositório completo): aprovado, zero erros, zero avisos.
- **Prisma**: `validate` aprovado; `generate` aprovado; `migrate status` aprovado em **ambos** os bancos configurados (`rede_intelligence` e `rede_intelligence_test`) — 39 migrations, schema atualizado, sem pendências.
- **Testes focais do Tool Layer**: 5 arquivos, **57 testes**, zero falhas (28 integração + 9 regressão/manifesto legado + 8 arquitetura + 7 domínio + 5 choke point).
- **Suíte oficial, primeira passagem** (`npm test`): exit code 0.
- **Suíte oficial, segunda passagem** (mesmo banco, sem recriação, `vitest run --reporter=default`): **166 arquivos aprovados, 1 ignorado (167 total); 2.049 testes aprovados, 4 skips oficiais (2.053 total)**, zero falhas, 527,97 s. Os 4 skips permanecem exclusivamente em `prisma/seed.database.integration.test.ts` (gate `dbReady`, fase 9R) — nenhum pertence à 10C.
- **Build produtivo** (`next build`): aprovado, 28/28 páginas; `next-env.d.ts` alterado automaticamente pelo Next.js e restaurado ao HEAD.
- **Preflight produtivo inválido**: exit code 2, `CONFIGURACAO_INVALIDA`, valores não exibidos.
- **Manifesto de superfícies 9Q.2A**: 35/35 hashes conferem (lido sem escrever), zero divergências.
- **`git diff --check`**: aprovado, só avisos LF/CRLF.
- **Busca de segredos**: zero encontrado no diff completo.

## F. Riscos residuais atualizados

- O rate limit por ator/ferramenta (`checkAndConsumeRateLimit`, infraestrutura reaproveitada e não modificada, decisão 7) não é atômico sob rajada verdadeiramente concorrente (leitura+cálculo+upsert, sem transação própria) — comprovado e **documentado explicitamente** por um teste dedicado que não finge uma garantia que a infraestrutura reaproveitada não oferece. O caso sequencial/realista (uso humano normal de um Tool Layer) permanece corretamente protegido, comprovado por teste. Corrigir a atomicidade exigiria alterar `src/application/integrations/resilience-service.ts`, fora do escopo desta fatia (módulo compartilhado com 9H, não exclusivo da 10C).
- As 13 ferramentas legadas do manifesto (ALTO-3) continuam gravando ao ler — dívida técnica explicitamente registrada, não resolvida; tornar os getters puros ou reclassificar essas ferramentas exige decisão de produto/RBAC separada, fora desta correção.
- Demais riscos residuais da entrega original (barreira `SHARE` compartilhada com a 10A; `resolveConversationProjectId` não-transacional, inofensivo por TOCTOU; convergência do catálogo legado com o novo registro) permanecem válidos e inalterados — ver seção "Riscos residuais" acima.

## G. Estado Git final da correção

```
Branch: codex/fase-10c-tool-layer
HEAD:   f4586dcf2c005f32d02d47a202ed17d13502f0db (inalterado — nenhum commit criado)
Upstream: não configurado
Staged: nenhum
```

---

# Correção BLOQUEADORA final pós-reauditoria (16/09/2026) — ALTO-2

**Estado:** correção do único achado BLOQUEADOR de uma reauditoria focal independente sobre a
correção acima (seções A–G). Mesma branch, mesmo HEAD-base, zero staged, zero migration,
comportamento funcional das 4 ferramentas inalterado. Sem commit/push. Escopo estritamente
limitado a este achado — ALTO-1, o reaper, o manifesto das 13 exceções legadas, o rate limit
por ator e a sanitização de `toolName` não foram tocados.

## H. Achado da reauditoria

A reauditoria (read-only, sondas próprias temporárias, removidas ao final) reproduziu um
**bypass funcional** do gate arquitetural do ALTO-2. A correção da seção B acima fechou a
reexportação por `index.ts`, mas manteve `prepareAiToolInvocation`/`consumeAiToolInvocation`
como bindings `export`ados de `service.ts` (necessário, na época, para o teste de corrida
importar via caminho relativo `./service`), confiando num gate que varria o texto de cada
arquivo procurando o identificador literal (`content.includes(identifier)`). A reauditoria
montou o nome em tempo de execução — `["prepare","Ai","Tool","Invocation"].join("")` — fez
`import()` dinâmico de `./service` a partir de um arquivo fora do pacote, e acessou a função
por colchete com a chave computada. O gate textual não continha o identificador literal em
nenhum lugar do arquivo ofensor e não detectou; a chamada real confirmou (`typeof === "function"`)
que a função interna foi de fato obtida de fora do pacote. Classificado **ALTO/BLOQUEADOR**
pela própria reauditoria, por critério definido nesta sessão: ausência de enforcement
estrutural real. Vedava o veredito **APROVADO PARA COMMIT**.

## I. Causa raiz e correção

A causa raiz não era a ausência de um gate melhor — era a **presença do `export`** em si. Um
gate textual/AST, por mais sofisticado, nunca é uma garantia completa contra ofuscação
arbitrária (o próprio scanner AST desta correção documenta esse limite explicitamente, seção
"Limite residual" em `architecture.test.ts`). A única garantia que não depende de nenhum
scanner "acertar" a técnica de ofuscação é a semântica do próprio ECMAScript: um módulo só
expõe os bindings que declara com `export` — não existe reflexão, `Proxy`, `import()` dinâmico
ou acesso computado capaz de obter um binding não exportado a partir do objeto de namespace do
módulo, **independentemente** de como o identificador é escrito no arquivo importador.

Duas mudanças independentes, nesta ordem de força:

1. **Fechamento estrutural (a garantia real).** `prepareAiToolInvocation` e
   `consumeAiToolInvocation` deixaram de ter a palavra-chave `export` em `service.ts` —
   tornaram-se funções privadas de escopo de módulo. Isto fecha a **classe inteira** de bypass
   (qualquer técnica de ofuscação de identificador ou de `import()`), não apenas a instância
   reproduzida pela reauditoria.
2. **Gate AST real (defesa em profundidade), mesmo padrão já auditado de
   `ai-gateway/architecture.test.ts`.** O antigo gate por substring
   (`content.includes(identifier)`) foi substituído por um scanner via TypeScript Compiler API
   (`src/application/ai-tools/architecture.test.ts`) que reconhece: import estático nomeado/
   aliased/namespace; `require(...)`; `import(...)` dinâmico (caminho relativo ou alias `@/`);
   acesso computado/por colchete cuja chave resolve — por "constant folding" — a um
   identificador interno, cobrindo literal, template literal (com ou sem interpolação
   resolvível), concatenação binária `+`, `[...].join(separador)` **e referência a uma
   variável `const` cujo inicializador é ele mesmo resolvível** (propagação de constante de um
   salto — necessário porque o bypass real atribui o nome concatenado a uma `const` antes de
   usá-lo, nunca inline); reexport direto ou indireto (`export *`/`export { x } from`).
   Examina `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs`. O scanner deliberadamente NÃO tenta resolver
   `eval(...)`, `new Function(...)` ou uma string construída a partir de entrada verdadeiramente
   dinâmica em runtime (leitura de arquivo, variável de ambiente, resposta de rede) — fechar
   isso exigiria um interpretador completo de fluxo de dados, fora de escopo de qualquer
   scanner estático (mesmo princípio já aceito pelo scanner de referência da 10A). Isto não
   enfraquece a proteção real: como o fechamento estrutural (item 1) independe totalmente de
   detecção textual/AST, mesmo essa metaprogramação arbitrária nunca teria um binding para
   obter — `mod[identificadorComputadoEmRuntime]` sempre resolve para `undefined`.

**Preservação da cobertura de teste (ALTO-1).** Os testes de corrida do pacote (arquivo
diferente de `service.ts`, mesmo sem `export` não podem acessar as funções privadas
diretamente) passaram a usar um harness dedicado, definido ao final de `service.ts` (mesmo
escopo de módulo, acesso léxico direto às funções privadas): `__raceTestPrepare` (prepara uma
vez, devolve um `handle` opaco — UUID aleatório resolvível só por um `Map` privado deste
processo Node, nunca serializável, nunca o `ContextBundle`), `__raceTestConsume` (consome pelo
handle, devolve só o status terminal) e `__raceTestConsumeInSubprocess` (preserva a corrida
entre processos Node/PrismaClient genuinamente independentes — serializa o estado preparado
inteiramente DENTRO da função, entrega-o ao subprocesso exclusivamente por variável de
ambiente process-local, nunca por valor de retorno; o subprocesso importa `service.ts` só pelo
efeito colateral de um bloco top-level gatilhado por essa mesma variável, nunca por um binding
nomeado). Nenhuma composição das três funções do harness permite obter evidência/`ContextBundle`
sem passar pelo fluxo real de `consumeAiToolInvocation` (CAS + `AIToolCallLog` + auditoria
`CONTEXT_CONSUMED`) — a mesma garantia central que fechou o ALTO-2 original. `node:child_process`
é usado exclusivamente dentro deste harness, documentado e allowlisted por caminho exato em
`architecture.test.ts` (mesmo padrão de `TRANSPORT_ALLOWLIST` da 10A), nunca invocado por
nenhum caminho de produção.

## J. Testes adicionados/reescritos nesta correção final

| Arquivo | Antes (correção anterior) | Depois | O que mudou |
| --- | --- | --- | --- |
| `src/application/ai-tools/service.ts` | — (não é arquivo de teste) | — | `export` removido de `prepareAiToolInvocation`/`consumeAiToolInvocation`; harness de teste de corrida adicionado (3 funções + gatilho de subprocesso) |
| `src/application/ai-tools/architecture.test.ts` | 8 testes | 13 testes | Gate ALTO-2 reescrito de substring para AST real (TypeScript Compiler API); +5: prova estrutural via import profundo (`./service`) com reprodução da concatenação; fixtures adversariais completas (import nomeado/aliased/namespace, require, import() relativo/alias, colchete literal/concatenado/template, reexport `*`/nomeado); extensão `.cjs`; sonda funcional (subprocesso real) reproduzindo o bypass e confirmando `undefined` |
| `src/application/ai-tools/ai-tools.database.integration.test.ts` | 28 testes | 29 testes | Testes de corrida migrados de `prepareAiToolInvocation`/`consumeAiToolInvocation` (não mais exportadas) para o harness `__raceTestPrepare`/`__raceTestConsume`/`__raceTestConsumeInSubprocess`; +1 teste reproduzindo o bypass da reauditoria contra `./service` (caminho profundo, não só o barril) |
| `src/application/ai/tool-registry.regression.test.ts` | 9 testes | 9 testes (inalterado) | — |
| `src/application/ai-gateway/rbac-choke-point.test.ts` | 5 testes | 5 testes (inalterado) | — |
| `src/domain/ai-tools/ai-tools.test.ts` | 7 testes | 7 testes (inalterado) | — |

Total de testes focais do Tool Layer: **63** (era 57) — 29 integração + 13 arquitetura + 9
regressão/manifesto legado + 7 domínio + 5 choke point.

## K. QA observado (correção bloqueadora final, execução independente)

- **TypeScript** (`tsc --noEmit`): aprovado, zero erros.
- **ESLint** (`eslint .`, repositório completo): aprovado, zero erros, zero avisos.
- **Prisma**: `validate` aprovado; `generate` aprovado; `migrate status` aprovado em ambos os
  bancos (`rede_intelligence` e `rede_intelligence_test`) — 39 migrations, sem pendências.
- **Testes focais do Tool Layer**: 5 arquivos, 63 testes, zero falhas (inclui a sonda funcional
  via subprocesso real e o teste de corrida entre 2/5/10 subprocessos independentes,
  reconfirmando que o novo harness preserva a mesma cobertura de ALTO-1 de antes).
- **Suíte oficial, duas passagens no mesmo banco, sem recriação manual**: ambas idênticas —
  ver estado real reportado na sessão de reauditoria correspondente.
- **Build produtivo** (`next build`): aprovado; `next-env.d.ts` restaurado ao HEAD quando tocado
  mecanicamente pelo build.
- **`git diff --check`**: aprovado, só avisos LF/CRLF.
- **Busca de segredos**: zero encontrado no diff completo.

## L. Riscos residuais (inalterados desta correção, reafirmados)

Idênticos aos da seção F acima (rate limit não-atômico sob rajada verdadeiramente concorrente,
documentado e não corrigido por decisão de escopo; as 13 ferramentas legadas do manifesto
ALTO-3 continuam gravando ao ler, dívida técnica registrada) — nenhum deles foi tocado por
esta correção final, que é estritamente escopada ao achado ALTO-2.

**Novo limite residual, documentado honestamente (não é um bypass estático trivial):** o gate
AST não resolve `eval(...)`, `new Function(...)`, nem uma string construída a partir de
entrada verdadeiramente dinâmica em runtime. Isto é aceitável porque a garantia real (item I.1)
não depende do gate: mesmo essa metaprogramação arbitrária jamais encontraria um binding
exportado para obter.

## M. Estado Git final da correção bloqueadora

```
Branch: codex/fase-10c-tool-layer
HEAD:   f4586dcf2c005f32d02d47a202ed17d13502f0db (inalterado — nenhum commit criado)
Upstream: não configurado
Staged: nenhum
```

Arquivos modificados por esta correção: `src/application/ai-tools/service.ts`, `src/application/ai-tools/index.ts`, `src/application/ai-tools/architecture.test.ts`, `src/application/ai-tools/ai-tools.database.integration.test.ts`, `src/application/ai/tool-registry.regression.test.ts`, `docs/PHASE_10C_TOOL_LAYER_CONTRACT.md`, `docs/PHASE_10C_AUDIT_RECORD.md`, `docs/REDE_CAMPAIGN_CHECKPOINTS.md`. Nenhum arquivo fora desta lista foi tocado. Nenhuma migration, commit, push, merge, rebase ou tag. Parando para reauditoria focal independente.
