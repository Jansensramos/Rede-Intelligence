# Fase 9R — Registro de implementação e auditoria (Repasse, Chaves e Assistência Técnica)

Branch: `codex/fase-9r`. HEAD-base: `69d00f0e1207d0e3b2cab4118695d977bd50f29c`.
Contrato: `docs/PHASE_9R_CONTRACT.md` (aprovado com as 5 decisões do aprovador).

## 1. O que foi implementado

- **Repasse bancário** (`BankFinancingDisbursement`, nome definitivo do aprovador):
  criação, solicitação, registro de liberação, conciliação (gera `ReceivablePayment`
  oficial via `registerReceivablePayment`, 9B/9E) e cancelamento.
  `src/domain/handover/repasse.ts` (regra pura de conciliação),
  `src/application/handover/repasse-service.ts`.
- **Chaves — gate de entrega**: `src/domain/handover/gates.ts` (regra pura,
  técnico/jurídico/financeiro) + `src/application/handover/delivery-gate-service.ts`
  (busca os fatos: `SalesUnitInspection`, `LegalLicense` 9D, `ReceivableInstallment`
  vencida, `BankFinancingDisbursement` pendente). `markUnitDelivered` (9E, estendida)
  usa esse gate; o snapshot dos 3 gates é gravado no `AuditLog` da transição
  `SALES_UNIT_DELIVERED` — é o "termo de entrega" (decisão 4 do contrato).
- **Chaves — condomínio** (`CondominiumSetup`): criação e transição de estado
  (`PLANNED → IN_PROGRESS → IMPLEMENTED`, ou `CANCELLED`), estados terminais
  protegidos. `src/application/handover/condominium-service.ts`.
- **Assistência técnica**: extensão de `PostSaleRequest`/`PostSaleUpdate` (9E) com
  fornecedor responsável (`Supplier`, 9C), custo estimado/real, reincidência
  (auto-relação validada por `isValidPostSaleRecurrence`) e evidência antes/depois
  (`validateDocumentUpload` + `StorageProvider` genérico). SLA sempre derivado
  (`evaluatePostSaleSla`), nunca persistido. `evaluatePostSaleSlaBreaches` emite
  `SLA_ASSISTENCIA_VENCIDO`; `reconcileBankFinancingDisbursement` emite
  `REPASSE_DIVERGENTE` — ambos via `operational-alerts.ts` (9Q.2B), payload
  allowlisted, dedup e circuit breaker reaproveitados sem alteração.
- **Migration única e aditiva**: `20260910131423_phase_9r_repasse_chaves_assistencia`
  — 2 tabelas novas + 4 enums + 8 colunas novas em `post_sale_requests`/
  `post_sale_updates`. Nenhuma migration antiga tocada.
- **Server Actions**: `src/app/actions/handover.ts` — RBAC no servidor
  (`requireDomainActionContext("COMMERCIAL_READ")` como primeira instrução de cada
  função exportada, satisfazendo o gate arquitetural de `local-release-boundaries.test.ts`
  sem precisar de entrada no manifesto de superfícies revisadas).
- **UI**: nova aba "Repasse, Chaves e Assistência (9R)" em `src/components/sales-view.tsx`
  (leitura, em português) — mesmo nível de maturidade das demais abas comerciais
  desta área (nenhuma mutação da 9E tem formulário interativo ainda; a 9R não inventa
  esse padrão, só o segue).

## 2. Reaproveitamento confirmado (nenhum domínio paralelo)

`SalesUnitInspection`, `PostSaleRequest`, `PostSaleUpdate`, `Supplier`,
`ReceivableAccount`/`Installment`/`Payment`, `FinancialInstitution` — todos
reaproveitados sem duplicação, confirmado por teste arquitetural (ver §4).
Únicas entidades novas: `BankFinancingDisbursement`, `CondominiumSetup`.

## 3. Revisão adversarial própria — achados e correções

Executada após a implementação inicial, antes deste registro:

1. **Concorrência real na conciliação de repasse** — `Promise.all` com 4 chamadas
   simultâneas de `reconcileBankFinancingDisbursement` para o mesmo repasse
   revelou que `registerReceivablePayment` (9B/9E, reaproveitada, não alterada) só é
   idempotente para chamadas *sequenciais*: duas transações verdadeiramente
   concorrentes colidem na criação do mesmo `ReceivablePayment` com uma violação de
   unicidade (P2002) em vez do retorno idempotente normal. **Corrigido**: uma única
   retentativa após capturar especificamente `P2002` — o Postgres só libera essa
   exceção depois que a transação concorrente vencedora já commitou, então a
   retentativa sempre encontra o pagamento já existente pela mesma chave de
   idempotência. Teste de concorrência (`Promise.allSettled` com 4 chamadas)
   confirma: nenhuma rejeição, exatamente 1 `ReceivablePayment` criado.
2. **Indireção de RBAC incompatível com o gate arquitetural** — o padrão copiado de
   `app/actions/capital.ts` (`const requireAuthContext = () => requireDomainActionContext(...)`)
   só passa no teste de `local-release-boundaries.test.ts` porque aqueles arquivos
   já estão no manifesto de superfícies revisadas (`PHASE_9Q2A_SURFACE_MANIFEST.json`).
   Um arquivo novo precisa satisfazer o gate diretamente. **Corrigido**: cada Server
   Action chama `requireDomainActionContext("COMMERCIAL_READ")` diretamente como
   primeira instrução, sem indireção — não foi adicionada nenhuma entrada
   autoaprovada ao manifesto de revisão.
3. **Manifesto de migrations desatualizado** — a nova migration precisava do
   checksum registrado em `docs/PHASE_9Q2A_MIGRATION_MANIFEST.json` (usado por
   `local-release-safety.test.mjs`, `local-readiness.database.integration.test.ts` e
   pela leitura de prontidão do worker/web). **Corrigido**: checksum calculado pelo
   mesmo algoritmo do gerador oficial (`scripts/release-manifest.mjs`) e registrado.
4. **Contagem fixa de migrations em `PHASE_9Q_RELEASE_CONTRACT.md`** — a linha já
   dizia "nunca fixar um número no texto", mas ainda citava "34" literalmente.
   **Corrigido**: número removido, mantendo só a instrução de conferir contra
   `prisma/migrations`.
5. **Asserção de teste com formatação de Decimal errada** (`"300000.00"` vs.
   `"300000"` — `Prisma.Decimal.toString()` não preenche zeros decimais à direita)
   — corrigido no teste, não no código de produção.
6. **Cleanup de fixture de teste incompleto** — `FinancialObligation` (criada
   internamente por `approveSale`) não estava sendo apagada antes do `Project`,
   violando `financial_obligations_project_id_fkey` no `afterAll`. Corrigido.

Nenhum desses achados exigiu nova migration ou mudança de escopo — todos foram
correções dentro do já implementado.

## 4. Testes novos

| Arquivo | Cobertura |
|---|---|
| `src/domain/handover/gates.test.ts` (23 testes) | Gate técnico/jurídico/financeiro, todos os status de `LegalLicense`, `SEM_EVIDENCIA`, combinações, SLA, reincidência — puro, sem banco |
| `src/domain/handover/repasse.test.ts` (5 testes) | Conciliação exata, divergência, tolerância, precisão decimal |
| `src/application/handover/handover.database.integration.test.ts` (22 testes) | Repasse completo (criar→solicitar→liberar→conciliar), divergência + alerta, **concorrência/idempotência real**, cancelamento, RBAC (VIEWER recusado), **IDOR** (venda/instituição/repasse/condomínio de outra organização recusados com mensagem indistinguível de "não existe"), gates de entrega (todos os 3, incluindo `SEM_EVIDENCIA` e o snapshot do "termo de entrega" no `AuditLog`), condomínio (ciclo completo + estado terminal + duplicata recusada), assistência (fornecedor, custo, reincidência com unidade errada recusada, evidência com checksum, upload hostil recusado, SLA vencido com alerta), **teste arquitetural** (nenhum modelo Prisma com nome de domínio paralelo; nenhuma escrita direta em `SalesUnitInspection`/`PostSaleRequest` fora de `application/sales`) |

Total: 50 testes novos da 9R (28 puros + 22 de integração), todos verdes.

## 5. QA (números reais observados)

| Item | Resultado |
|---|---|
| `prisma validate` | ✅ |
| `prisma generate` | ✅ |
| `prisma migrate status` (dev e teste) | ✅ 35 migrations, schema atualizado nos dois bancos |
| Backup antes da migration | ✅ `rede_intelligence` (2.314.955 bytes, SHA-256 `2639de35...38d2a`) e `rede_intelligence_test` (29.838.601 bytes, SHA-256 `5fe1e2ff...15b`) — restaurados em banco isolado (`rede_restore_*`) e conteúdo validado (`valid:true`) antes de qualquer migration |
| TypeScript | ✅ 0 erros |
| ESLint | ✅ 0 erros |
| Testes focais (9R) | ✅ 50/50 |
| Suíte oficial (`pnpm test`, 1ª execução) | ✅ **134 arquivos, 1374 testes, 0 falhas** |
| Suíte oficial (repetição, mesmo banco) | ✅ idêntico |
| Build produtivo | ✅ sucesso, 40 rotas (sem rota nova — a 9R usa a aba já existente de `/comercial`) |
| `next-env.d.ts` | churn mecânico do build, restaurado, diff confirmado vazio |
| Preflight inválido | ✅ exit 2, recusado, sem vazamento |
| `git diff --check` | ✅ só avisos CRLF |

## 6. Riscos residuais e limites explícitos

- **SLA vencido não integra ainda `ExecutiveException`/Central de Ações (9K.3)** —
  emite `SLA_ASSISTENCIA_VENCIDO` via `operational-alerts.ts` (call site produtivo
  real), mas não aparece como cartão na Central de Ações. Integrar exigiria estender
  `src/application/actions/action-service.ts`/`executive-service.ts` — subsistema
  grande, fora do escopo desta rodada; registrado aqui em vez de forçar uma
  integração não testada.
- **UI é somente leitura** — mesma maturidade das demais mutações comerciais desta
  área (nenhuma tem formulário interativo ainda); as mutações da 9R estão completas
  e testadas na camada de serviço/Server Action, prontas para receber formulário
  quando a UI comercial ganhar essa camada de forma geral.
- **Gate jurídico é por projeto, não por unidade** — decisão deliberada: habite-se/
  licença de ocupação é tipicamente um fato do empreendimento inteiro, não da
  unidade individual. Se um piloto precisar de granularidade por unidade, é uma
  decisão de negócio nova, não implementada aqui.
- **`quarantineDuplicateConflict`-style TOCTOU em `registerReceivablePayment`
  sob concorrência **muito** alta** (mais de 2 chamadas verdadeiramente simultâneas
  poderiam, em teoria, gerar mais de uma retentativa em cascata) — mitigado (uma
  retentativa é suficiente pela ordem de commit do Postgres, confirmado por teste
  com 4 chamadas concorrentes), mas não testado além de 4 chamadas simultâneas.

## 7. Declaração final (Fase D — implementação inicial)

Esta implementação cobre integralmente o escopo aprovado da 9R: repasse bancário,
gates de entrega, implantação do condomínio e assistência técnica rastreada. **9S
(encerramento, governança, resultado realizado) e Fase 10 (IA/agentes) não foram
iniciadas.** Nenhuma API externa, cloud real ou credencial real foi usada. Nenhum
commit, push, merge, rebase ou tag foi executado — worktree aberto para auditoria
independente.

---

## 8. Correção focal pós-reauditoria (2026-09-10) — achados Alto/Médio corrigidos

Uma reauditoria adversarial independente e completa (não incluída neste registro —
executada em sessão separada, só leitura) revisou a implementação acima e devolveu o
veredito **REPROVADO**, com um achado Alto e quatro achados Médio confirmados. Esta
seção registra, com honestidade, cada achado e a correção real aplicada — nenhum foi
descartado ou reclassificado sem uma mudança de código correspondente.

### 8.1 Achado Alto — gate técnico reaproveitava uma vistoria antiga aprovada

**O problema**: `evaluateUnitDeliveryReadiness` buscava `salesUnitInspection.findFirst`
sem `orderBy` e com um filtro por resultado aceito — na prática, "existe alguma
vistoria aceita alguma vez", nunca "qual foi a vistoria mais recente". Uma vistoria
antiga ACCEPTED liberava o gate técnico mesmo que uma vistoria mais recente tivesse
sido REJECTED.

**Correção**: `src/domain/handover/gates.ts` foi reescrito — `evaluateTechnicalGate`
agora recebe só `mostRecentInspection` (a decisão de "qual é a mais recente" sai do
domínio e vira responsabilidade exclusiva da consulta) e nunca olha para uma segunda
vistoria como fallback. `src/application/handover/delivery-gate-service.ts` busca essa
vistoria com `orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]`
(desempate totalmente determinístico) e `scheduledAt: { lte: now }` (vistoria futura
nunca decide, mesmo se, por inconsistência de dado, já tiver `outcome`).
`ACCEPTED_WITH_PENDING` com `nextInspectionAt` ainda aberto passou a contar como
`PENDENTE` (antes liberava incondicionalmente). Cobertura real contra PostgreSQL:
rejeição recente vence aprovação antiga, aprovação recente vence rejeição antiga, três
vistorias sequenciais, empate de `scheduledAt`, vistoria de outra unidade, chamada com
`organizationId` de outro tenant, vistoria futura, pendência bloqueante, e chamadas
repetidas/concorrentes — 9 testes novos em
`Gate técnico — vistoria mais recente decide (achado Alto da reauditoria)`.

### 8.2 Achado Médio — TOCTOU entre a leitura dos gates e o commit da entrega

**O problema**: `markUnitDelivered` lia os três gates (técnico/jurídico/financeiro)
FORA da transação que efetivava `status = ENTREGUE`. Uma revogação de licença, uma
vistoria rejeitada ou uma reversão de repasse entre a leitura e o commit não eram
detectadas — a entrega podia ser efetivada com um snapshot que já não correspondia ao
estado real.

**Correção**: `src/application/handover/delivery-gate-service.ts` passou a aceitar
`PrismaClient | Prisma.TransactionClient`. `markUnitDelivered`
(`src/application/sales/sales-service.ts`) releem o status da unidade e os três gates
inteiramente DENTRO de uma transação `Serializable`, e só então grava o status +
termo de entrega (`AuditLog`). Duas chamadas concorrentes só produzem 1 sucesso real —
a que perde o conflito serializável (Postgres SSI, `P2034`) é reexecutada (até 3
tentativas, com jitter — mesmo padrão de `ensureInvestmentCase`, 9K.1) e, ao reler,
encontra a unidade já `ENTREGUE` e devolve o mesmo resultado, idempotente. Testado
contra PostgreSQL real com concorrência genuína (`Promise.all`/`Promise.allSettled`,
sem mocks): duas entregas simultâneas (exatamente 1 termo gravado), revogação de
licença concorrente, vistoria rejeitada concorrente, reversão de pagamento concorrente
(as três seguintes pelo invariante "só fica ENTREGUE se o snapshot do termo mostrar os
3 gates APTO" — verificável independentemente de qual lado venceu a corrida), gate
bloqueado não deixa termo parcial, e repetição após sucesso não duplica o termo — 6
testes novos em `markUnitDelivered — concorrência e TOCTOU (achado Médio da reauditoria)`.

### 8.3 Achado Médio — trilha de auditoria sem `correlationId`/estado anterior

**O problema**: os `AuditLog` da 9R gravavam só `after`, sem `correlationId` nem
`before` — dificultava reconstruir o "antes/depois" de uma transição e correlacionar
múltiplas linhas de uma mesma operação.

**Correção**: `correlationId` (sempre `randomUUID()` gerado no servidor — nunca aceito
de entrada do cliente) e `before` (estado anterior real da entidade, nunca texto do
cliente) foram adicionados a todo `AuditLog.create` de operação crítica da 9R: criação/
solicitação/liberação/divergência/conciliação/cancelamento de repasse; avaliação e
efetivação do gate de entrega; criação/transição de condomínio; atribuição de
fornecedor, custo, reincidência e evidência da assistência técnica (`addPostSaleEvidence`
passou a gravar `AuditLog`, o que antes não fazia). `metadata` continua allowlisted
(só `{correlationId, operationType}` — nunca PII, URL, token, payload bruto ou ID
externo). Em `sales-service.ts` (compartilhado com toda a 9E pré-existente), o helper
`audit()` ganhou um 7º parâmetro opcional (`{before, correlationId}`) — os pontos de
chamada da 9E anteriores ao 9R continuam byte-a-byte idênticos.

### 8.4 Achado Médio — imutabilidade só em aplicação, sem espelho no banco

**O problema**: `RECONCILED` (repasse) e `IMPLEMENTED`/`CANCELLED` (condomínio) eram
tratados como terminais só pela camada de aplicação (`updateMany` com filtro de
status) — um `UPDATE`/`DELETE` direto via SQL, fora do Prisma, não era bloqueado.

**Correção**: nova migration aditiva **`20260910151500_phase_9r_structural_immutability`**
(a migration original da 9R, `20260910131423`, não foi tocada). Segue o padrão já
adotado em `20260905220000_phase_9p3a_immutable_signature_evidence`
(`RAISE EXCEPTION ... USING ERRCODE = '23514'`), com uma diferença deliberada: as duas
tabelas da 9R misturam linhas terminais e não-terminais, então o trigger de
`UPDATE`/`DELETE` só bloqueia quando `OLD.status` já é terminal (permite toda transição
legítima anterior e a própria transição PARA o estado terminal); `TRUNCATE` é
bloqueado incondicionalmente, como no precedente. **Backups reais antes da migration,
com horário/tamanho/SHA-256 e restauração validada em banco isolado**:

| Banco | Horário | Tamanho | SHA-256 | Restauração |
|---|---|---|---|---|
| `rede_intelligence` (dev) | 2026-09-10T15:09:45.076Z | 2.327.027 bytes | `e4065136e6bf6e3d1bdf681925753a655119ecd21d9efd83e11b2752fab78af7` | `rede_restore_6f7ecc5355704266bfe8bd52fd1709b9`, `valid:true`, `restoredContentMatches:true` |
| `rede_intelligence_test` | 2026-09-10T15:10:50.788Z | 46.714.986 bytes | `daeae4a14f700037b3b918622fcd9b37e9a2f857249e8efbcf239b6f6442cd3c` | `rede_restore_c7ea8cc199ad4935b97c701e2cfb3897`, `valid:true`, `restoredContentMatches:true` |

Ambos os backups precedem a nova migration (aplicada só depois, `prisma migrate deploy`
em dev e teste). **Bug real encontrado e corrigido durante a própria implementação
desta correção**: a primeira versão da função de trigger só verificava
`TG_OP IN ('UPDATE','DELETE')` — para `TG_OP = 'TRUNCATE'` (trigger de statement, sem
`OLD`), a condição nunca era verdadeira e o `TRUNCATE` passava sem ser bloqueado.
Detectado por inspeção antes de qualquer execução real de `TRUNCATE`; corrigido
adicionando um ramo explícito `IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION ...` antes da
checagem de status, e verificado com uma tabela `TEMP` isolada (`LIKE ... INCLUDING
ALL` + os mesmos triggers) antes de confiar a proteção às tabelas reais. Também
descoberto durante a verificação: o `SetNull` automático do Postgres ao excluir um
`Supplier` referenciado por uma `CondominiumSetup` terminal é, para o Postgres, um
`UPDATE` na linha do condomínio — e por isso também é corretamente bloqueado pelo
trigger (achado a favor da proteção, não uma regressão; exigiu ajustar o `afterAll` do
teste de integração para nunca tentar excluir um fornecedor referenciado por uma
implantação terminal). Cobertura real contra PostgreSQL, incluindo SQL bruto (a
proteção precisa valer também fora do Prisma): transições legítimas antes do estado
terminal continuam permitidas; `UPDATE`/`DELETE` via Prisma E via `$executeRaw` são
bloqueados depois de `RECONCILED`/`IMPLEMENTED`/`CANCELLED`; `TRUNCATE` bloqueado nas
duas tabelas — 5 testes novos em `Imutabilidade estrutural (achado Médio da reauditoria)`.

### 8.5 Achado Médio — `P2002` tratado genericamente na reconciliação concorrente

**O problema**: `reconcileBankFinancingDisbursement` tratava qualquer `P2002` (de
qualquer constraint, de qualquer tabela) como "o pagamento concorrente já existe" —
um `P2002` de outra causa seria mascarado como sucesso.

**Correção**: `isIdempotencyKeyConflict` (agora exportada de `repasse-service.ts`) só
reconhece a colisão exata esperada — `error.meta.modelName === "ReceivablePayment"` e
`error.meta.target` contendo `idempotency_key`. O formato real foi confirmado por
introspecção direta do Postgres (fixture real, inserção duplicada proposital, erro
capturado e inspecionado antes de escrever a função — não foi assumido). Qualquer
outro `P2002` ou qualquer outro código é propagado sem tratamento especial. Após a
retentativa, o código releva o registro concorrente e valida organização (via o
próprio `installment` já tenant-escopado), parcela (`payment.installmentId`) e valor
(`evaluateDisbursementReconciliation` revalidado com o `installment` relido) antes de
marcar `RECONCILED` — falha fechado se a divergência aparecer na revalidação. Testes:
reconhecimento exato da constraint esperada (2 variações de `target`), rejeição de
`P2002` de outro modelo/outra constraint/outro código/erro genérico (não reconhecido),
e o teste de concorrência real pré-existente (4 chamadas simultâneas, 1 pagamento) —
3 testes em `Reconciliação — P2002 restrito à constraint exata (achado Médio da reauditoria)`.

### 8.6 Regressão e arquitetura (item 6 da correção) — confirmado sem regressão

- Só 2 modelos Prisma novos continuam existindo (`BankFinancingDisbursement`,
  `CondominiumSetup`) — teste arquitetural inalterado, ainda verde.
- Nenhum domínio paralelo foi criado; `LegalLicense` (9D) continua a única fonte do
  gate jurídico; 9S e Fase 10 não foram antecipadas (nenhuma referência a "9S" em
  `src/domain/handover`, `src/application/handover` ou `src/app/actions/handover.ts`).
- RBAC/IDOR seguem só no servidor (`assertMutable`/`assertApprover` +
  `requireDomainActionContext`); VIEWER continua sem nenhuma mutação.
- Nenhuma entrada nova foi adicionada a `PHASE_9Q2A_SURFACE_MANIFEST.json` — só o
  manifesto de checksums de migration (`PHASE_9Q2A_MIGRATION_MANIFEST.json`) recebeu a
  entrada da nova migration estrutural.
- Nenhuma chamada a API externa, `fetch`/`axios`/`http.request` em todo o código da 9R.

### 8.7 QA desta correção (números reais observados, substituem o §5 para o estado atual)

| Item | Resultado |
|---|---|
| `prisma validate` | ✅ |
| `prisma generate` | ✅ |
| `prisma migrate status` (dev) | ✅ 36 migrations, schema atualizado |
| `prisma migrate status` (teste) | ✅ 36 migrations, schema atualizado |
| Backups antes da migration estrutural | ✅ ver tabela §8.4 — ambos `valid:true`/`restoredContentMatches:true`, anteriores à migration |
| Seed (`DEMO_SEED_PASSWORD`/`INTEGRATION_SECRET_KEY` efêmeros gerados na hora) | ✅ concluído, exercitou o próprio fluxo de entrega (`TOR-A-1301 ENTREGUE`) |
| TypeScript (`tsc --noEmit`) | ✅ 0 erros |
| ESLint (projeto inteiro) | ✅ 0 erros |
| Testes focais desta correção | ✅ 23 novos (9 gate técnico + 6 TOCTOU + 3 P2002 + 5 imutabilidade) |
| Todos os testes da 9R | ✅ 78/78 (28 `gates.test.ts` + 5 `repasse.test.ts` + 45 `handover.database.integration.test.ts`) |
| Suíte oficial (`pnpm test`, 1ª execução) | ✅ **134 arquivos, 1402 testes, 0 falhas** |
| Suíte oficial (repetição, mesmo banco, sem recriar) | ✅ idêntico — 134 arquivos, 1402 testes |
| Build produtivo | ✅ sucesso, 39 rotas (sem rota nova) |
| Preflight de produção com config inválida | ✅ recusa com `CONFIGURACAO_INVALIDA`, exit 2, nenhum valor exposto |
| `git diff --check` | ✅ só avisos de normalização CRLF, sem erro |
| `next-env.d.ts` | churn mecânico do build, revertido (`git checkout --`) |

### 8.8 Declaração final desta correção

Todos os achados Alto e Médio da reauditoria foram corrigidos com mudança de código
real e teste real contra PostgreSQL — nenhum foi descartado, reclassificado ou
"documentado como aceito" sem correção. A migration original da 9R
(`20260910131423`) não foi editada; a proteção estrutural entrou por uma segunda
migration aditiva. Branch `codex/fase-9r` e HEAD-base
`69d00f0e1207d0e3b2cab4118695d977bd50f29c` preservados — nenhum commit, push, merge,
rebase ou tag foi executado nesta correção. 9S e Fase 10 continuam não iniciadas.
Nenhuma API externa, cloud real ou credencial real foi usada. Worktree aberto para
reauditoria focal independente.
