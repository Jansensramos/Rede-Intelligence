# Fase 9S — Registro de implementação e auditoria (Encerramento, Governança, Resultado Realizado)

Branch: `codex/fase-9s`. HEAD-base: `f339ad0f2a9f11322a906d09f40f85e8a2db5725`.
Contrato: `docs/PHASE_9S_CONTRACT.md` (aprovado com as 8 decisões definitivas do aprovador).

## 1. O que foi implementado

- **Gate de encerramento operacional** (`src/domain/closure/gates.ts`, pura) — 5
  subgates (operacional/entrega 9R, contratual/obra 9C, jurídico 9D, financeiro 9B,
  contábil 9G), cada um `APTO`/`PENDENTE`/`SEM_EVIDENCIA` com motivo explicável e
  snapshot de referências seguras; agregador `overall: APTO|BLOQUEADO` — mesmo
  formato do gate de entrega da 9R, copiado deliberadamente.
- **Assistência técnica impeditiva** (decisão 4) — `evaluatePostSaleImpediment`:
  `GARANTIA`/`OCORRENCIA` aberta, SLA vencido, reincidência não resolvida, ausência
  de responsável/fornecedor, custo material sem provisão — cada regra independente,
  todas auditáveis; cláusula de exceção "formalmente provisionado" (provisão ativa +
  responsável/fornecedor + custo + prazo) implementada e testada nos dois sentidos.
- **Busca de fatos reais** (`src/application/closure/closure-gate-service.ts`) —
  lê `SalesUnit`, `CondominiumSetup`, `PostSaleRequest`, `AccountingProvision`,
  `MaterialityPolicy`, `OperationalContract`, `LegalObligation`,
  `LegalDueDiligenceCase`/`LegalDecision`, `ReceivableInstallment`/
  `PayableInstallment`, `FundingDisbursement`, `AccountingPeriod`/
  `FinancialPeriodClosure` — nenhuma tabela nova, tudo reaproveitado.
- **Resultado realizado final** (`src/domain/closure/result.ts`, pura) —
  `computeRealizedResult` (receita − custo − despesas − tributos − custos
  financeiros; despesas ausentes entram como 0 na soma, nunca bloqueiam sozinhas;
  os outros 4 componentes `SEM_EVIDENCIA` bloqueiam o resultado e a margem, decisão
  5), `missingCentralEvidence` (lista exatamente os campos centrais faltando).
  Populado (`src/application/closure/closure-service.ts::gatherRealizedFacts`) a
  partir de `RevenueRecognitionRun` (receita/custo/VGV), `TaxAssessment` (tributos),
  `PayableAccount`/`FinancialObligation` via a convenção `documentRef` já usada por
  `external-obligation-port.ts` (`FUNDING_PROPOSAL:` para custos financeiros de
  funding, `SALE_RESCISSION:` para devoluções de distrato), `FundingDisbursement`
  reconciliado (funding desembolsado), `Sale.status = CANCELLED` (distratos),
  `ReceivableInstallment` vencida (inadimplência), `AccountingProvision` ativa
  (provisões) — nenhum valor fabricado; ausência real de fonte fica `SEM_EVIDENCIA`
  explícito, nunca zero implícito.
- **Memória histórica** — referências (nunca duplicação) a `AssumptionSnapshot`
  (premissas aprovadas), `DecisionLedgerEntry` (decisões relevantes),
  `RiskFinding` (riscos), gravadas no próprio `ProjectClosureResult`.
- **Distribuição final simples** (decisão 8, `src/application/closure/distribution-service.ts`)
  — uma linha por beneficiário por natureza (`CAPITAL_CONTRIBUTION`/
  `CAPITAL_RETURN`/`REMUNERATION`/`RESULT_DISTRIBUTION`/`RETENTION`/`PROVISION`);
  `validateDistributionAgainstAvailable` recusa retorno de capital acima do aportado
  registrado e distribuição baseada em resultado acima do `realizedResult` disponível
  — falha fechado se o resultado estiver `SEM_EVIDENCIA`. Nenhuma transferência
  bancária real (testado).
- **Workflow de aprovação e reabertura** — `prepareProjectClosureResult` (DRAFT,
  recalculável livremente) → `approveProjectClosureResult` (exige gate `APTO` +
  campos centrais com evidência, releitura completa dentro de uma transação
  `Serializable`, CAS, retry limitado a `P2034`, segregação de função) → `FINAL`
  (imutável) + `Project.status = CLOSED`. `reopenProjectClosureResult` (só `OWNER`,
  motivo + evidência obrigatórios) cria nova versão (`supersedesId`) sem jamais tocar
  a linha `FINAL` anterior; `Project.status` volta a `UNDER_REVIEW` (reaproveitado).
- **Imutabilidade estrutural** — migration única
  (`20260911011100_phase_9s_closure_result_distribution`) já inclui os triggers
  condicionais (`OLD.status = 'FINAL'`/`'APPROVED'`) + bloqueio incondicional de
  `TRUNCATE`, seguindo o precedente da correção pós-reauditoria da 9R — desta vez
  desde a primeira migration, sem precisar de uma correção posterior.
- **RBAC/Server Actions** — `CLOSURE_READ` novo em `ProtectedReadCapability`
  (`src/domain/auth/read-capabilities.ts`), **não** concedido a `VIEWER` (decisão
  2); `src/app/actions/closure.ts` segue exatamente o padrão AST-verificado de
  `requireDomainActionContext` como primeira instrução.

## 2. Reaproveitamento confirmado (nenhum domínio paralelo)

`RevenueRecognitionRun`, `TaxAssessment`, `AccountingProvision`, `AccountingPeriod`,
`FinancialPeriodClosure`, `FinancialObligation`/`PayableAccount`/`PayableInstallment`,
`FundingDisbursement`, `ReceivableInstallment`, `LegalObligation`,
`LegalDueDiligenceCase`/`LegalChecklistItem`/`LegalDocumentRequest`/`LegalDecision`,
`SalesUnit`/`Sale`/`PostSaleRequest`/`CondominiumSetup`/`BankFinancingDisbursement`
(9R), `AssumptionSnapshot`, `DecisionLedgerEntry`, `RiskFinding` — todos consumidos
só por leitura (exceto os dois novos serviços gravando nas suas próprias tabelas),
confirmado por teste arquitetural. Únicas entidades novas: `ProjectClosureResult`,
`ProjectClosureDistribution`.

## 3. Revisão adversarial própria — achados e correções

Executada durante a implementação, antes deste registro (mesma disciplina da 9R:
nenhum achado é descartado sem correção real):

1. **`realizedTaxes` acumulava tributos de outros projetos da mesma empresa** — a
   consulta a `TaxAssessment` filtrava só por `organizationId`+`companyId`, sem
   `projectId` (embora o modelo tenha esse campo opcional). Como os testes
   reaproveitam a mesma `Company` (SPE) para vários projetos de fixture, o resultado
   realizado de um projeto acabava somando os tributos de projetos anteriores —
   descoberto porque um teste posterior calculava um `realizedResult` negativo
   inesperado. **Corrigido**: a consulta agora filtra também por `projectId`.
2. **Trigger de imutabilidade verificado com sondas reais antes de confiar nele** —
   mesmo procedimento da correção da 9R: uma tabela `TEMP` clonada com os mesmos
   triggers foi usada para confirmar `TRUNCATE` bloqueado antes de testar contra as
   tabelas reais; nenhum bug foi encontrado desta vez (a lição da correção anterior —
   tratar `TG_OP = 'TRUNCATE'` incondicionalmente antes de checar `OLD.status` — já
   entrou correta na primeira versão).
3. **`TRUNCATE project_closure_results` sozinho falha por dependência de FK, não
   pelo trigger** — `project_closure_distributions` referencia `project_closure_results`;
   o Postgres recusa truncar uma tabela referenciada sem incluir a referenciadora na
   mesma instrução. Corrigido o teste para truncar as duas juntas — o trigger de
   qualquer uma das duas já bloqueia a instrução inteira antes de qualquer linha ser
   afetada.
4. **Limpeza de fixture de teste incompleta** (mesma classe de achado da 9R) —
   `CondominiumSetup` `CANCELLED` (convenção "não aplicável" desta fase) é protegido
   pelo trigger de imutabilidade da 9R; `ProjectClosureResult` `DRAFT` ainda
   referenciado por uma `ProjectClosureDistribution` `APPROVED` preservada não pode
   ser excluído (FK); `Project`/`Company` ainda referenciados por qualquer um dos
   dois acima também não. Corrigido seguindo o mesmo padrão já estabelecido em
   `contract-closing.database.integration.test.ts`/`handover.database.integration.test.ts`:
   pula a exclusão desses registros protegidos em vez de forçar, nunca desabilita o
   trigger.
5. **Colisão de datas entre fixtures de teste** — `TaxAssessment`/`AccountingPeriod`
   têm unicidade por (organização, empresa, mês); duas fixtures diferentes usando
   literais de data fixos para a mesma empresa compartilhada colidiam entre si.
   Corrigido usando um ano derivado de um contador incremental por fixture, evitando
   qualquer colisão possível dentro do arquivo de teste.

Nenhum desses achados exigiu mudança de escopo — todos foram correções dentro do já
implementado.

## 4. Riscos residuais registrados com honestidade (não escondidos)

- **Gate contábil é por empresa (SPE), não por projeto** — `AccountingPeriod` e
  `FinancialPeriodClosure` são modelados por `companyId`, sem `projectId` (limitação
  do modelo reaproveitado, não desta fase). Se uma SPE tiver mais de um projeto,
  encerrar qualquer um deles hoje exige que **todos** os períodos contábeis da
  empresa estejam fechados, não só os relativos a esse projeto — comportamento
  correto quando 1 SPE = 1 projeto (o caso normal do domínio), uma simplificação
  deliberada quando não é. Registrado aqui, não escondido.
- **`realizedExpenses` (despesas operacionais) sem fonte de fato dedicada** — não
  há hoje, entre os modelos reaproveitados, uma linha de despesas operacionais
  segregada de custo/tributos/custos financeiros no nível do projeto. O campo
  aparece honestamente como `SEM_EVIDENCIA` no snapshot; por decisão 5, isso não
  bloqueia `FINAL` (entra como 0 só na fórmula do resultado), mas o valor real de
  "despesas" nunca é apresentado como apurado quando não foi.
- **`realizedIrr`/`realizedRoi` não implementados nesta rodada** — o contrato §8
  propunha reaproveitar o motor de cálculo já usado para o previsto, alimentado com
  o fluxo de caixa realizado; dado o tamanho já grande desta entrega, os dois campos
  ficam `null` (nunca 0) no `ProjectClosureResult`, corretamente fora da lista de
  campos que a decisão 5 exige para `FINAL` (só receita/custo/tributos/custos
  financeiros/resultado/margem bloqueiam) — registrado como lacuna real, não
  fabricado.
- **`realizedCapitalContributed`/`realizedRefunds` dependem inteiramente de dados
  registrados a partir desta fase** (decisão 6) — nenhuma tentativa de reconstruir
  histórico anterior a partir de `BankTransaction`/`ReconciliationMatch`; um
  empreendimento cujo encerramento ocorra sem que `ProjectClosureDistribution`
  tenha registrado os aportes ao longo do tempo terá esse campo `SEM_EVIDENCIA`.
- **Nenhuma interface (UI) nova** — o contrato (§5-6) não incluiu UI no escopo desta
  fase (diferente da 9R); toda a superfície fica em Server Actions + serviço, pronta
  para receber uma tela quando a área executiva ganhar essa camada.
- **Nenhuma integração com o seed demonstrativo** — decisão deliberada para não
  repetir o risco de data fixa já corrigido na 9R (seed com `scheduledAt` no futuro);
  `prisma/seed.ts` não foi tocado, sem fixture de encerramento demonstrativa.

## 5. Testes novos

| Arquivo | Cobertura |
|---|---|
| `src/domain/closure/gates.test.ts` (31 testes) | Assistência impeditiva (todas as regras da decisão 4, isoladas e combinadas, cláusula de exceção nos dois sentidos), os 5 subgates do encerramento em todas as combinações relevantes — puro, sem banco |
| `src/domain/closure/result.test.ts` (18 testes) | Resultado realizado com/sem evidência em cada componente central, despesas como exceção não-bloqueante, valores NaN/Infinity/excessivos, validação de distribuição (capital/resultado disponível, valores zero/negativos/inválidos) — puro, sem banco |
| `src/application/closure/closure.database.integration.test.ts` (32 testes) | Gate contra PostgreSQL real (vazio e `APTO` genuíno), RBAC (VIEWER/REVIEWER/ANALYST recusados corretamente), IDOR (projeto/encerramento/distribuição de outro tenant com mensagem indistinguível), fluxo completo preparar→aprovar→FINAL com fechamento do `Project`, segregação de função (preparo≠aprovação), gate bloqueado nunca fecha nem duplica `AuditLog`, **dupla aprovação concorrente real (`Promise.all`, sem mocks)** com exatamente 1 `AuditLog`, repetição idempotente, `SEM_EVIDENCIA` bloqueando campos centrais, reabertura só `OWNER` com nova versão sem alterar a anterior, imutabilidade estrutural via SQL bruto (`UPDATE`/`DELETE`/`TRUNCATE`) nas duas tabelas, distribuição simples com validação de teto, nenhuma transferência bancária real, teste arquitetural (só 2 entidades novas, sem domínio paralelo, sem API externa, fronteira com Fase 10) |

Total: 81 testes novos da 9S (49 puros + 32 de integração), todos verdes, repetidos
duas vezes sem recriar o banco.

## 6. QA (números reais observados)

| Item | Resultado |
|---|---|
| `prisma validate` | ✅ |
| `prisma generate` | ✅ |
| `prisma migrate status` (dev e teste) | ✅ 37 migrations, schema atualizado nos dois bancos |
| Backup antes da migration | ✅ `rede_intelligence` (2.342.318 bytes, SHA-256 `ca9b0db2...42d8`) e `rede_intelligence_test` (59.626.102 bytes, SHA-256 `0e9d6110...fc6a5`) — restaurados em banco isolado e validados antes da migration |
| TypeScript | ✅ 0 erros |
| ESLint | ✅ 0 erros, 0 avisos |
| Testes focais (9S) | ✅ 81/81 |
| Seed em banco existente + segunda execução | ✅ idempotente, `prisma/seed.ts` intocado |
| Suíte oficial (`pnpm test`, 1ª execução) | ✅ **138 arquivos, 1487 testes, 0 falhas** |
| Suíte oficial (repetição, mesmo banco, sem recriar) | ✅ idêntico — 138 arquivos, 1487 testes |
| Build produtivo | ✅ sucesso, 39 rotas (sem rota nova — nenhuma UI nesta fase) |
| Preflight inválido | ✅ exit 2, recusado, sem vazamento |
| `git diff --check` | ✅ só avisos CRLF |

## 7. Declaração final

Esta implementação cobre integralmente o escopo aprovado da 9S: gate de encerramento
operacional (5 subgates), resultado realizado final com previsto×realizado via
`ForecastEvaluation`/`FinancialResult` reaproveitados, encerramento contábil via
`AccountingPeriod`/`FinancialPeriodClosure` reaproveitados, checklist de encerramento
societário via `LegalDueDiligenceCase`/`LegalDecision` reaproveitados (decisão
societária nunca representa baixa real), distribuição final simples sem movimentação
bancária real, e memória histórica por referência. Só duas entidades novas
(`ProjectClosureResult`, `ProjectClosureDistribution`); nenhum domínio paralelo.

**Fase 10 (IA/agentes) não foi iniciada.** Nenhuma API externa, cloud real ou
credencial real foi usada. Nenhum commit, push, merge, rebase ou tag foi executado.
Branch `codex/fase-9s` e HEAD-base `f339ad0f2a9f11322a906d09f40f85e8a2db5725`
preservados. Zero staged; worktree aberto para auditoria independente.

## 8. Correção pós-reauditoria REPROVADA

Uma auditoria adversarial independente, executada após a entrega registrada nas
seções 1-7 (mesmo branch, mesmo HEAD-base), concluiu **REPROVADO**: 1 achado
Bloqueador, 2 Altos, 2 Médios, 2 Informativos. Esta seção documenta a causa e a
correção de cada um, sem apagar nem reescrever nada das seções anteriores — as
seções 1, 2 e 7 acima descreviam corretamente a *intenção* do contrato, mas em
alguns pontos **não** descreviam o comportamento real do código até esta correção.
Os pontos abaixo tornam essas seções honestas retroativamente.

### 8.1 Bloqueador — gate jurídico ignorava o valor da `LegalDecision`

**Causa**: `evaluateLegalGate` só checava `LegalDueDiligenceCase.status === "COMPLETED"`
e a *existência* de alguma `LegalDecision` — nunca o campo `decision` em si. Como
`recordLegalDecision` (9D, `legal-service.ts`) marca o caso `COMPLETED`
incondicionalmente, uma decisão real `DO_NOT_PROCEED` produzia `APTO` no gate.

**Correção** (`src/domain/closure/gates.ts`, `src/application/closure/closure-gate-service.ts`):
a consulta agora carrega a decisão mais recente do caso por `orderBy: [{version:"desc"},
{createdAt:"desc"},{id:"desc"}]` (desempate determinístico; `version` já é monotônica e
única por caso). O domínio interpreta o valor:
- `PROCEED` → favorável.
- `PROCEED_WITH_CONDITIONS` → favorável **somente** se toda entrada de
  `conditions` (Json livre, sem campo estrutural de resolução no schema) for um
  objeto com `resolved === true`; lista vazia é vacuamente satisfeita. Convenção
  adotada nesta correção — documentada aqui porque o schema não a impõe.
- `HOLD`/`DO_NOT_PROCEED` → `PENDENTE` (decisão negativa/suspensa).
- `INSUFFICIENT_EVIDENCE` → `SEM_EVIDENCIA` (a própria diligência concluiu que
  não há evidência suficiente — nunca tratado como bloqueio comum).
- Ausência de decisão (`latestDecision: null`) apesar do caso `COMPLETED` →
  `SEM_EVIDENCIA` (nunca aprovação silenciosa).
- Qualquer valor não reconhecido → `PENDENTE`, falha fechada.

Motivo devolvido nunca inclui `executiveConclusion`, `blockers` ou qualquer texto
jurídico — só o nome do enum e contagens, como já era a convenção dos outros gates.

### 8.2 Médio — `LegalChecklistItem`/`LegalDocumentRequest` nunca lidos

**Causa**: o gate confiava só no status agregado do caso, nunca nos itens do
checklist nem nas solicitações documentais — ambos existiam no schema (9D) e nunca
foram consultados pela 9S, apesar de `§2` deste registro já os listar como
"reaproveitados".

**Correção**: a consulta em `closure-gate-service.ts` agora inclui
`checklistItems`/`documentRequests` do caso selecionado (nested relation — não há
como vazar itens de outro caso, projeto ou tenant, por construção). O domínio exige
que todo item esteja em um dos estados terminal-bons do `LegalItemStatus`
compartilhado (`COMPLIANT`, `WAIVED`, `RESOLVED`, `CANCELLED`); qualquer outro
(`NOT_STARTED`, `REQUESTED`, `RECEIVED`, `UNDER_REVIEW`, `NON_COMPLIANT`, `EXPIRED`)
bloqueia com `PENDENTE`. Nenhuma tabela nova — reaproveitamento genuíno agora.

### 8.3 Médio — `AccountingPeriod` fechado sem `LedgerSnapshot`

**Causa**: o gate contábil aceitava `AccountingPeriod.status === "CLOSED"` como
prova suficiente do fechamento, sem checar o balancete (`LedgerSnapshot`) que o
sustenta.

**Correção**: `closeAccountingPeriod` (9G, `accounting-service.ts`, não alterado)
já grava, na MESMA transação que fecha o período, um `LedgerSnapshot`
(`snapshotType: "CLOSING_TRIAL_BALANCE"`) com `checksum` idêntico ao
`AccountingPeriod.closeChecksum` persistido no próprio período — usado aqui como
prova determinística de integridade, sem recalcular nem copiar saldos. Regra nova
em `evaluateAccountingGate`: período `CLOSED` sem esse snapshot → `SEM_EVIDENCIA`;
snapshot com `checksum` diferente do `closeChecksum` vigente (inconsistência
estrutural) → `PENDENTE`, falha fechado. `FinancialPeriodClosure` (sem relação
`LedgerSnapshot` no schema) continua fora dessa exigência — limitação estrutural
pré-existente, não inventada aqui. Nenhum saldo, checksum ou valor contábil entra no
motivo devolvido.

### 8.4 Alto — previsto × realizado nunca implementado (`financialResultId`/`forecastEvaluationIds` sempre `null`)

**Causa**: os dois campos (já existentes no schema desde a implementação original)
nunca eram populados — nenhuma comparação previsto×realizado existia de fato,
apesar das seções 1/2/7 acima descreverem o contrário.

**Correção** (`src/application/closure/closure-service.ts`, sem migration — os
campos já existiam): fonte prevista elegível = a `StudyVersion` `status = "SNAPSHOT"`
mais recente do projeto (mesma convenção de "versão congelada vigente" já usada por
`createInvestmentCase`, 9L) → seu cenário `kind = "BASE"` mais recente → o
`CalculationRun` mais recente desse par → seu `FinancialResult` (relação 1:1
existente). Qualquer elo ausente (sem SNAPSHOT, sem BASE, sem run, sem resultado)
deixa `financialResultId`/`forecastEvaluationIds` `null` — nunca fabrica um previsto.
Métricas comparadas: receita (`netRevenue`), custo (`totalCost`), resultado
(`profit`) e margem (`marginOnNetRevenue`), cada uma contra o campo realizado
equivalente do `ProjectClosureResult`. Métrica sem realizado ainda disponível é
gravada com `evaluated: false, actualValue: null` (nunca 0); métrica sem previsto
são sã (`predicted === null` ou não finito) é pulada inteira. Gravação via
`ForecastEvaluation` (motor pré-existente, 9I/data-intelligence,
`evaluateForecastAccuracy` para o viés) e `MetricDefinition` (catálogo pré-existente,
4 chaves novas: `encerramento_receita_realizada`, `encerramento_custo_realizado`,
`encerramento_resultado_realizado`, `encerramento_margem_realizada` — dados no
catálogo, não schema novo). Idempotência: `forecastVersion = ProjectClosureResult.version`
na chave única existente da tabela — reprepare do mesmo `DRAFT` (mesma versão)
faz upsert (atualiza), nunca duplica; uma versão `FINAL` já aprovada nunca é tocada
porque uma versão nova sempre tem `forecastVersion` diferente. Cálculo do erro via
Decimal.js (nunca `number` nativo); `evaluateForecastAccuracy` só decide o viés
(`OPTIMISTIC`/`PESSIMISTIC`/`NEUTRAL`) a partir dos mesmos valores.

### 8.5 Alto — distribuição `APPROVED` sobrevivia a um recálculo do `DRAFT` que a originou

**Causa**: `prepareProjectClosureResult` recalculava/sobrescrevia um `DRAFT` sem
checar se alguma `ProjectClosureDistribution` `APPROVED` já dependia dos valores
antigos — uma distribuição aprovada contra um resultado alto podia sobreviver,
agora acima do disponível, depois que o resultado caísse num recálculo posterior.

**Correção**:
- `prepareProjectClosureResult` agora conta `ProjectClosureDistribution` `APPROVED`
  vinculadas ao `DRAFT` antes de recalcular; havendo alguma, falha fechado com um
  erro claro, sem tocar em nenhum campo.
- `reopenProjectClosureResult` (antes só para `FINAL`) agora também aceita esse
  `DRAFT` travado como origem — mesma exigência de `OWNER` + motivo + evidência,
  mesma criação de nova versão (`supersedesId`) sem jamais alterar a linha anterior;
  só pula a transição `Project.status: CLOSED → UNDER_REVIEW` quando a origem não
  era `FINAL` (o projeto nunca chegou a fechar).
- `approveProjectClosureResult` agora revalida, dentro da mesma transação
  `Serializable` que grava `FINAL`, que a soma das distribuições `APPROVED` desta
  versão continua compatível com o `realizedResult` vigente
  (`validateApprovedDistributionsAggregate`, domínio puro) — defesa em profundidade,
  nunca corrige nem move a distribuição, só recusa a transição.
- `approveProjectClosureDistribution` ganhou o mesmo retry limitado a P2034 já usado
  em `approveProjectClosureResult` (nunca retry sobre uma recusa de negócio).

Invariante resultante: uma `ProjectClosureDistribution` `APPROVED` só existe
vinculada a uma versão do `ProjectClosureResult` cujos valores nunca mais mudam —
DRAFT travado ou FINAL imutável, sempre uma das duas.

### 8.6 Documentação divergente do código

Consequência direta de 8.1/8.4 — as seções 1, 2 e 7 acima descreviam
`ForecastEvaluation`/`FinancialResult`/checklist/documentos como já reaproveitados
quando não estavam. Com 8.1-8.5 implementados, essas descrições passam a ser
verdadeiras; nenhum texto anterior foi apagado, só complementado por esta seção.
`docs/PHASE_9S_CONTRACT.md` recebeu o mesmo tratamento (ver sua própria seção
"Correção pós-reauditoria REPROVADA").

### 8.7 Testes adicionados

`src/domain/closure/gates.test.ts` e `src/domain/closure/result.test.ts` ganharam
os casos puros de cada achado (decisão jurídica por valor, checklist/documentos,
LedgerSnapshot, `validateApprovedDistributionsAggregate`).
`src/application/closure/closure.database.integration.test.ts` ganhou 23 novos
testes contra PostgreSQL real: decisão `DO_NOT_PROCEED`/`HOLD`/`INSUFFICIENT_EVIDENCE`
via `recordLegalDecision` real, ordem de decisões, isolamento entre casos jurídicos
do mesmo projeto; checklist/documento não conforme e sua não-vazagem entre casos;
`LedgerSnapshot` ausente/inconsistente/de outro período; vínculo real a
`CalculationRun`/`FinancialResult` (`SNAPSHOT`+`BASE`) com idempotência e isolamento
entre projetos; reprodução do achado original de distribuição×`DRAFT`; reabertura
do `DRAFT` travado; revalidação agregada na aprovação final; duas aprovações e dois
reprepares concorrentes reais via `Promise.all`. Total após a correção: 55 testes
de integração + mais de 30 novos testes puros (ver seção 9 abaixo para os números
finais da suíte completa).

### 8.8 QA da correção (números reais observados)

| Item | Resultado |
|---|---|
| Migration nova | Nenhuma — `financialResultId`/`forecastEvaluationIds` já existiam no schema |
| Backup antes de migration | Não aplicável (nenhuma migration) |
| `prisma validate` | ✅ |
| `prisma generate` | ✅ |
| `prisma migrate status` | ✅ 37 migrations (inalterado), schema atualizado |
| TypeScript (`tsc --noEmit`) | ✅ 0 erros |
| ESLint (repositório completo) | ✅ 0 erros, 0 avisos |
| Testes focais da correção (`closure.database.integration.test.ts`) | ✅ 55/55, repetido sem recriar o banco |
| Suíte oficial (`pnpm test`) | ✅ 137 arquivos, 1536 testes, 4 skipped, 0 falhas |
| Build produtivo (`next build`) | ✅ sucesso |
| `git diff --check` | ✅ só avisos CRLF pré-existentes |
| `git status` | ✅ mesmo conjunto de arquivos modificados/novos de antes desta correção; zero staged |

### 8.9 Riscos residuais depois da correção

- Denominador zero no previsto (métrica de margem) não tem teste de integração
  dedicado — a fórmula (`!predicted.isZero()`) foi verificada por leitura e pelos
  testes de `result.test.ts` para o lado realizado, mas não por uma sonda dedicada
  do lado previsto. Risco baixo (mesma fórmula do lado já testado).
- `FinancialPeriodClosure` continua sem exigência de evidência análoga ao
  `LedgerSnapshot` — o schema não tem esse relacionamento; criar um exigiria
  migration nova, fora do escopo autorizado desta correção (nenhuma foi criada).
- A revalidação agregada na aprovação final (8.5) é defesa em profundidade — o
  caminho legítimo já é bloqueado antes disso pelo guard do `prepareProjectClosureResult`;
  só é alcançável hoje por escrita direta fora da aplicação (como o teste de
  integração demonstra deliberadamente).

**Fase 10 continua não iniciada.** Nenhum commit, push, merge, rebase ou tag foi
executado nesta correção. Worktree segue aberto para nova auditoria independente.

## 9. Correção focal final após segunda reauditoria REPROVADA

Uma segunda auditoria adversarial (após a correção da seção 8) reprovou a entrega
por dois motivos: (1) o guard de `prepareProjectClosureResult` contra distribuição
`APPROVED` era um check-then-act SEM transação — contagem e `UPDATE` em chamadas
Prisma separadas, permitindo que uma aprovação concorrente de distribuição
acontecesse exatamente entre as duas; e (2) `LegalChecklistItem`/`LegalDocumentRequest`
aceitavam `CANCELLED` como terminal-bom incondicionalmente, sem revisor nem
justificativa, liberando o gate jurídico por uma simples troca de status.

### 9.1 TOCTOU confirmado e corrigido

**Causa comprovada e reproduzida** (sonda determinística passo a passo na
reauditoria, e novamente pelos novos testes desta correção): o guard fazia
`prisma.projectClosureDistribution.count(...)` e, mais tarde, um
`prisma.projectClosureResult.update(...)` — duas chamadas separadas, sem
transação nem lock entre elas. Uma `approveProjectClosureDistribution` (já
transacional, `Serializable`) podia comitar exatamente nesse intervalo.

**Correção** (`src/application/closure/closure-service.ts`, ramo que reaproveita
um `DRAFT` existente — agora a função `recalculateExistingDraft`):
- Releitura do `ProjectClosureResult` (`findUniqueOrThrow`), confirmação de
  `status === "DRAFT"`, contagem de distribuições `APPROVED` e o `updateMany`
  final — tudo dentro de uma ÚNICA transação `Serializable`.
- CAS: `updateMany` condicionado a `id` + `organizationId` + `projectId` +
  `status: "DRAFT"` + `version` (o campo de versão do próprio encerramento,
  como defesa em profundidade adicional — a proteção real vem da isolação
  serializável do Postgres, que detecta write-skew entre esta releitura e a
  aprovação concorrente via SSI e aborta uma das duas transações com
  `serialization_failure`, surfaced pelo Prisma como `P2034`).
- `count !== 1` no resultado do `updateMany` é tratado como conflito de
  concorrência (nunca como sucesso silencioso).
- Retry limitado exclusivamente a `P2034`, no máximo 3 tentativas; qualquer
  outro código Prisma (`P2002` incluído) propaga imediatamente, sem retry.
- `MetricDefinition`/`ForecastEvaluation` (`upsertClosureForecastEvaluations`,
  `finalizeClosureResultForecast`) passam a receber o cliente de transação
  (`tx`) e são chamadas DENTRO da mesma transação do guard+CAS — se o guard
  recusar ou a transação abortar, nada é gravado (nenhuma avaliação órfã).
- Uma recusa de negócio (`ClosurePreparationError`, com `reasonCode`
  `"APPROVED_DISTRIBUTION_LOCK"` ou `"CONCURRENCY_CONFLICT"` e `correlationId`
  gerado no servidor) nunca é reexecutada — só conflitos de serialização reais
  (`P2034`) acionam o retry.
- `approveProjectClosureDistribution` (`distribution-service.ts`) ganhou o
  mesmo tratamento de erro classificado (`DistributionApprovalError`).

**Invariante**: `ProjectClosureDistribution.status === APPROVED` ⇒ o
`ProjectClosureResult` vinculado está congelado (não pode mais ser recalculado
por `prepareProjectClosureResult`) e os valores aprovados continuam
compatíveis com essa mesma versão — garantido pela transação `Serializable`
compartilhada, nunca por uma correção posterior.

### 9.2 CANCELLED nunca é evidência positiva — checklist e documentos avaliados separadamente

**Causa comprovada**: um único conjunto `LEGAL_ITEM_TERMINAL_GOOD_STATUSES`
tratava `CANCELLED` (e `RESOLVED`) como terminal-bom para os dois modelos,
sem checar `reviewedById`/justificativa — uma solicitação documental ou item
de checklist podia ser cancelado sem nenhuma revisão e liberar o gate.

**Correção** (`src/domain/closure/gates.ts`):
- `LegalChecklistItem`: `COMPLIANT` satisfaz incondicionalmente. `WAIVED`
  satisfaz só com `reviewedById` identificado E (`notes` não vazio OU
  `evidenceDocumentIds` presente) — os únicos campos reais do modelo capazes
  de provar uma dispensa formal. `CANCELLED` nunca satisfaz, com ou sem
  revisor — o schema não distingue "cancelado com justificativa" de
  "cancelado sem nada" além desses mesmos campos, e o contrato desta correção
  reserva esse caminho exclusivamente a `WAIVED`. Qualquer outro estado
  bloqueia.
- `LegalDocumentRequest`: o modelo não tem `reviewedById`/`notes` — a única
  prova real de atendimento é `status === "RECEIVED"` COM `documentLinkId`
  preenchido (um documento de fato vinculado, não só a etiqueta de status).
  `CANCELLED`/`WAIVED` nunca satisfazem (nenhum campo real prova dispensa).
- Consultas (`closure-gate-service.ts`) passam a selecionar `reviewedById`,
  `notes`, `evidenceDocumentIds` (`LegalChecklistItem`) e `documentLinkId`
  (`LegalDocumentRequest`).
- Coleções vazias continuam vacuamente satisfeitas — decisão explícita desta
  correção: nenhum campo real do schema declara "esta diligência exige N
  itens", e inventar essa exigência violaria a instrução de usar só campos e
  enums reais. Documentado e testado explicitamente (não é uma omissão).

### 9.3 Bug real encontrado na autorrevisão adversarial

Ao repetir a corrida real (`Promise.all`) 5-8 vezes seguidas contra PostgreSQL
real, uma execução revelou que, no **esgotamento do retry** (última tentativa,
`attempt === PREPARE_MAX_ATTEMPTS`), o código original fazia `throw error` com
o `PrismaClientKnownRequestError` (`P2034`) **bruto**, nunca alcançando o
`throw new ClosurePreparationError(...)` escrito após o loop (código morto,
inalcançável). Um teste (`5. múltiplas preparações concorrentes...`) capturou
isso via `expect(reason).not.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)`.
**Corrigido**: o esgotamento do retry agora lança sempre o erro classificado,
tanto em `prepareProjectClosureResult` quanto em `approveProjectClosureDistribution`
(mesmo defeito, mesma correção nos dois arquivos). Confirmado por 8 execuções
consecutivas da suíte real sem nenhuma recorrência.

### 9.4 Testes adicionados

`src/domain/closure/gates.test.ts`: +12 testes (checklist/documento por modelo
— CANCELLED com/sem revisor, WAIVED com/sem justificativa/evidência, RECEIVED
com/sem `documentLinkId`, enum desconhecido, decisão favorável não atropela
bloqueio documental). `src/application/closure/closure.database.integration.test.ts`:
+8 testes reais contra PostgreSQL — corrida repetida (6×) `prepare` × `approve`
sem estado incompatível em nenhuma repetição; múltiplos `prepare` concorrentes
absorvidos pelo retry (P2034 nunca cru); duas criações concorrentes (`P2002`
propagado sem retry); cross-project sem interferência; reprepare sequencial
idempotente; achado Alto (CANCELLED) reproduzido e corrigido para os dois
modelos; RECEIVED sem `documentLinkId` continua bloqueando.

### 9.5 QA da correção focal final (números reais observados)

| Item | Resultado |
|---|---|
| Migration nova | Nenhuma |
| `prisma validate` / `generate` | ✅ |
| `prisma migrate status` | ✅ 37 migrations, schema atualizado |
| TypeScript | ✅ 0 erros |
| ESLint (repositório completo) | ✅ 0 erros, 0 avisos |
| Testes focais (3 arquivos de closure) | ✅ 154/154, repetido 8× sem recriar o banco (a corrida real é não-determinística por natureza — confirmado estável nas 8 repetições após a correção do bug da seção 9.3) |
| Suíte oficial (`pnpm test`) | ✅ 137 arquivos passaram, 1 skipped (`prisma/seed.database.integration.test.ts` — pré-existente da 9R, skip real por ausência de `CREATEDB` local, nada relacionado à 9S), 1556 testes passaram, 4 skipped |
| Build produtivo | ✅ 39 rotas |
| Preflight inválido | ✅ 8/8 |
| `git diff --check` | ✅ só avisos CRLF pré-existentes |
| `git status` | ✅ mesmo conjunto de arquivos das correções anteriores; zero staged |
| `.env`/`next-env.d.ts` | ✅ intactos (revertido após `next build` tocá-lo) |
| Segredos no diff | ✅ nenhum |

### 9.6 Resíduo sintético da reauditoria anterior

A segunda reauditoria (read-only) criou e tentou limpar 3 organizações de
sonda; parte dos dados ficou presa por triggers de imutabilidade genuínos
(`CondominiumSetup` `CANCELLED`, `ProjectClosureDistribution` `APPROVED`).
Confirmado por leitura nesta correção: 3 organizações sintéticas
(`slug` iniciando em `reaudit-race-`, nome `"Reaudit Race race-<timestamp>"`)
seguem no banco de desenvolvimento compartilhado. **Não foram apagadas, nenhum
trigger foi desabilitado, nenhum TRUNCATE foi executado** — mantidas
exatamente como a reauditoria as deixou. São resíduo de auditoria, não dado
de negócio, e não indicam falha desta correção (nenhum teste novo depende
delas — todos os testes desta correção criam e limpam suas próprias
organizações isoladas, com exceção dos mesmos órfãos protegidos por trigger já
aceitos pela suíte oficial para `CondominiumSetup`/`FINAL`/`APPROVED`).

**Fase 10 continua não iniciada.** Nenhuma API externa, credencial real,
commit ou push foi executado nesta correção. Branch `codex/fase-9s` e
HEAD-base `f339ad0f2a9f11322a906d09f40f85e8a2db5725` preservados. Zero
staged; worktree aberto para a auditoria final de encerramento.

## 10. Última correção focal — determinismo do teste e validade da evidência jurídica

### 10.1 Teste intermitente corrigido

**Causa**: `src/application/closure/closure.database.integration.test.ts:925` usava
um regex case-sensitive (`/não foi possível.../`) contra uma mensagem que começa
com "N" maiúsculo ("Não foi possível..."), falhando de forma intermitente
exatamente quando o esgotamento real do retry (achado corrigido na correção
anterior) era exercitado sob concorrência real de 5 chamadas.

**Correção**: a asserção agora valida, nesta ordem de prioridade, sinais
estruturais que não dependem de capitalização — classe do erro
(`toBeInstanceOf(ClosurePreparationError)`), `reasonCode` estático
(`"CONCURRENCY_CONFLICT"`) e presença de `correlationId` não vazio — com a
mensagem humana só como checagem secundária, agora com flag `i`. A mensagem de
produção não foi alterada. Timeout e concorrência (5 chamadas reais) foram
preservados sem redução.

**Validação real**: o teste específico foi executado **10 vezes individualmente**
(uma por uma, via `-t`) — 10/10 passou, zero intermitência. A suíte focal completa
(3 arquivos, 158 testes) foi executada **5 vezes seguidas sem recriar o banco** —
5/5 execuções com 158/158 testes passando.

### 10.2 Evidência jurídica não pode ser string livre — mapeamento comprovado, nenhuma entidade canônica encontrada

**Etapa A — mapeamento** (antes de qualquer alteração): inspecionado o schema
completo e todo o código de aplicação em busca de uma entidade canônica de
documento/evidência para `LegalDocumentRequest.documentLinkId` e
`LegalChecklistItem.evidenceDocumentIds`. Resultado:

- `documentLinkId`/`sourceDocumentLinkId` é o MESMO campo livre (`String?`, sem
  `@relation`) repetido em **quatro modelos distintos da 9D**:
  `LegalAssetRegistration.sourceDocumentLinkId`, `LegalDocumentRequest.documentLinkId`,
  `LegalLicense.documentLinkId`, `LegalGuarantee.documentLinkId`.
- Nenhum dos modelos de documento que existem no schema corresponde
  estruturalmente: `ProjectDocument` é escopado a `InvestmentCase` (data room de
  investimento, 9L); `ContractDocument` é escopado a `SalesContract` (documentos de
  contrato de venda); `ConnectorDocumentReference`/`DriveDocumentVersion` são
  escopados a instalações de conector externo (Google Drive, 9P.3B). Nenhum tem
  relação com `LegalDueDiligenceCase`/`LegalDocumentRequest`.
- Busca por uso em código (`grep` de `documentLinkId`/`sourceDocumentLinkId`/
  `evidenceDocumentIds` em `src/**/*.ts`, excluindo testes): **zero ocorrências**
  fora do próprio gate corrigido nesta sessão. Nenhum serviço de aplicação em todo
  o repositório escreve ou lê esses campos.
- Resposta às 6 perguntas do mapeamento: (1) não existe entidade canônica; (2-4)
  não aplicável; (5) o identificador não corresponde ao `id` de nenhuma entidade
  real; (6) não é possível validar existência/pertencimento sem uma migration —
  não criada nesta correção.

**Etapa B — como não existe entidade canônica compatível**, a correção seguiu o
caminho explicitamente instruído para esse caso: o gate passa a tratar essa
evidência como estruturalmente inverificável, nunca como prova positiva.

- `LegalChecklistItem`: `evidenceDocumentIds` foi **removido** da checagem de
  `WAIVED` (`hasAuditableWaiverJustification`, `src/domain/closure/gates.ts`) — só
  `reviewedById` (revisor identificado) + `notes` não vazio (texto genuinamente
  persistido na própria linha, não uma referência externa) contam.
- `LegalDocumentRequest`: `status === "RECEIVED"` nunca mais é tratado como prova
  suficiente, **independente do valor de `documentLinkId`** (`classifyDocumentRequest`).
  `RECEIVED` classifica como `"UNVERIFIABLE"` → `SEM_EVIDENCIA` no agregador;
  qualquer outro estado classifica como `"PENDING"` → `PENDENTE`. `"SATISFIED"`
  nunca é retornado hoje.
- Como nenhuma consulta a uma entidade externa é feita (não há o que consultar),
  toda variação de `documentLinkId` (ausente, string aleatória, vazia/espaços, ou
  aparentemente cross-tenant/cross-projeto) recebe **exatamente o mesmo
  tratamento** — a forma mais forte possível de garantir que uma referência
  inexistente e uma cruzada sejam indistinguíveis, porque nenhum código jamais as
  distingue.
- Nenhuma migration foi criada. Nenhum campo foi inventado. Nenhum ID/PII/conteúdo
  jurídico aparece nas mensagens do gate (só contagens e nomes de enum, como já
  era).

**Bloqueio estrutural registrado para autorização futura** — se uma prova real de
evidência documental jurídica for necessária, a lacuna mínima é: uma tabela
canônica (ex.: `LegalDocumentEvidence`) com `organizationId`, `projectId`,
`diligenceCaseId` (FK para `LegalDueDiligenceCase`), `storageProvider`+`storageKey`
(mesmo padrão já usado por `ContractDocument`), `status` de disponibilidade e
`checksum`; `LegalDocumentRequest.documentLinkId`/`LegalChecklistItem.evidenceDocumentIds`
passariam a referenciar essa tabela via FK (ou seriam substituídos por uma relação
1:N). Impacto: migration aditiva (nova tabela + FK opcional nos dois modelos
existentes, sem alterar dados atuais); exigiria backup antes de aplicar, seguindo
o mesmo processo já usado para a migration original da 9S. **Não implementada
nesta correção — aguardando autorização explícita.**

### 10.3 Testes adicionados

`src/domain/closure/gates.test.ts`: +8 testes (CANCELLED com documento/evidência
aparentemente válida ainda bloqueando; nota vazia/espaços; `evidenceDocumentIds`
com item inexistente/misto/duplicado/vazio nunca bastando; todas as variações de
`documentLinkId` em `RECEIVED` produzindo o mesmo `SEM_EVIDENCIA`; decisão PROCEED
não superando evidência inverificável). `closure.database.integration.test.ts`:
substituído o teste que assumia `RECEIVED`+`documentLinkId` → `APTO` por um teste
que prova `SEM_EVIDENCIA` para 6 variações de `documentLinkId` (incluindo strings
com aparência de referência cruzada), mais um teste real de checklist `WAIVED`
com `evidenceDocumentIds` misto/duplicado. Total após a correção: 71 testes puros
de `gates.ts` + 64 de integração real.

### 10.4 QA da última correção (números reais)

| Item | Resultado |
|---|---|
| Teste concorrente (`5.`), 10 execuções individuais | ✅ 10/10, zero intermitência |
| Suíte focal (3 arquivos), 5 execuções sem recriar o banco | ✅ 5/5, 158/158 testes cada vez |
| `prisma validate`/`generate`/`migrate status` | ✅ 37 migrations, inalterado |
| TypeScript | ✅ 0 erros |
| ESLint | ✅ 0 erros/avisos |
| Migration nova | Nenhuma — bloqueio estrutural registrado, aguardando autorização |

**Fase 10 continua não iniciada.** Nenhum commit, push, merge, rebase ou tag foi
executado. Organizações sintéticas residuais (`reaudit-race-*`, `final-audit-*`)
preservadas, não apagadas. Nenhum `BACKUP_ADMIN_PASSWORD` foi usado ou exposto.

## 11. Correção estrutural final — evidência jurídica canônica

Resolve o **bloqueio estrutural registrado na seção 10.2**: até aqui,
`LegalDocumentRequest.documentLinkId`/`LegalChecklistItem.evidenceDocumentIds`/
`LegalAssetRegistration.sourceDocumentLinkId` eram strings/arrays livres, sem FK e
sem verificação — por isso o gate nunca podia tratar `RECEIVED`/`WAIVED` como
genuinamente comprovados. Autorização explícita recebida para **uma única
migration aditiva** criando a entidade canônica antecipada na seção 10.2
(`LegalEvidenceDocument`, batizada exatamente como a lacuna previa).

### 11.1 O que foi implementado

- **Design documentado antes da migration** — `docs/PHASE_9S_CONTRACT.md` §21
  (entidade, relações, estados, invariantes, imutabilidade, RBAC, storage,
  checksum, ciclo de revogação, compatibilidade legada), escrito e revisado
  ANTES de qualquer DDL.
- **`prisma/migrations/20260911220000_phase_9s_legal_evidence_document/`** — 38ª
  migration (37 preexistentes + esta), aplicada em dev e teste após dois backups
  reais verificados (seção 11.4). Cria `LegalEvidenceDocumentStatus`
  (`PENDING_REVIEW`/`VERIFIED`/`REJECTED`/`REVOKED` — enum dedicado; reuso de
  `DocumentStatus` e `LegalItemStatus` avaliado e rejeitado, nenhum dos dois tem
  semântica de VERIFIED-com-prova-de-existência nem `REVOKED`) e a tabela
  `legal_evidence_documents`: FKs `RESTRICT` para organização/projeto/caso/
  usuários; FKs opcionais para `LegalDocumentRequest`/`LegalChecklistItem` com
  `CHECK` XOR (exatamente um vínculo, nunca ambíguo, nunca nenhum); `CHECK` de
  checksum SHA-256, `storageKey`/`contentType` não vazios, `sizeBytes > 0`;
  `CHECK` de consistência de estado (`VERIFIED`/`REJECTED` exigem
  `reviewedById`+`reviewedAt`; `REVOKED` exige também `revokedById`+`revokedAt`+
  `revokedReason` não vazio; `PENDING_REVIEW` exige todos nulos); trigger
  `BEFORE INSERT OR UPDATE` (`rede_validate_legal_evidence_document`) garantindo
  que organização/projeto do caso coincidem com os da evidência e que
  `documentRequestId`/`checklistItemId`, quando presentes, pertencem ao MESMO
  `diligenceCaseId` — integridade cross-tabela que FK simples não expressa,
  mesmo padrão de `rede_validate_signature_reconciliation_evidence`
  (9P.3A); trigger de imutabilidade condicional (`rede_legal_evidence_document_immutable`)
  — `PENDING_REVIEW` mutável, `VERIFIED` permite SÓ a transição para `REVOKED`
  via protected-column-diff (só `status`/`revoked_by_id`/`revoked_at`/
  `revoked_reason`/`updated_at` podem mudar — mesma técnica de
  `rede_protect_signature_evidence_context`, 9P.3A), `REJECTED`/`REVOKED`
  totalmente imutáveis, `DELETE` só permitido em `PENDING_REVIEW`, `TRUNCATE`
  sempre bloqueado.
- **`src/infrastructure/storage/legal-evidence-storage.ts`** — uma linha,
  `createConfiguredFileStorage("legal-evidence")`; nenhum storage novo, mesma
  classe genérica já usada por `contract-file-storage.ts`/`post-sale-evidence-storage.ts`.
  Binário nunca entra no Postgres.
- **`src/application/legal/legal-evidence-service.ts`** — serviço dedicado
  (desacoplado do gate): `registerLegalEvidenceDocument` (reaproveita
  `validateDocumentUpload`/`inspectUpload` — MIME/extensão/assinatura
  binária/scanner antimalware fail-closed em produção, já endurecido em 9Q.2B;
  idempotente por checksum dentro do mesmo vínculo, mesmo padrão de
  `uploadAndProcessDesignFile`), `verifyLegalEvidenceDocument`/
  `rejectLegalEvidenceDocument` (CAS via `updateMany` em transação
  `Serializable`, retry limitado a `P2034`, segregação uploader≠revisor,
  idempotente por revisor), `revokeLegalEvidenceDocument` (só a partir de
  `VERIFIED`, motivo obrigatório, idempotente por revogador),
  `queryLegalEvidenceDocuments` (RBAC `LEGAL_READ` já existente, reaproveitado
  sem criar capability nova; sempre escopado por `organizationId` do contexto).
  RBAC: `mutableRoles`/`approvalRoles` reaproveitados de `legal-service.ts`.
  `AuditLog` sempre gravado na MESMA transação da escrita (atômico);
  `correlationId` gerado no servidor, nunca aceito do chamador; nenhuma função
  aceita `status` do chamador.
- **`src/domain/closure/gates.ts`/`src/application/closure/closure-gate-service.ts`**
  — rewiring: `LegalChecklistItemInput`/`LegalDocumentRequestInput` ganharam
  `hasVerifiedEvidence` (calculado pela aplicação via consulta real a
  `LegalEvidenceDocument` `VERIFIED`, nunca inferido dos campos livres legados).
  `classifyDocumentRequest`: `RECEIVED` com `hasVerifiedEvidence` → `"SATISFIED"`
  (primeiro caminho positivo real desde a correção da seção 10); sem evidência
  → continua `"UNVERIFIABLE"` → `SEM_EVIDENCIA`. `isChecklistItemSatisfied`:
  `COMPLIANT`/`WAIVED` com criticidade `HIGH`/`CRITICAL` agora também exigem
  `hasVerifiedEvidence` ("evidência deve ser exigida quando a criticidade indicar
  obrigatoriedade" — item 6 da autorização); `LOW`/`MEDIUM` preservam a semântica
  anterior. `documentLinkId`/`evidenceDocumentIds` legados continuam lidos só
  para auditoria/histórico, nunca para decisão positiva.

### 11.2 Compatibilidade legada — nenhuma migração automática

Nenhum valor existente de `documentLinkId`/`sourceDocumentLinkId`/
`evidenceDocumentIds` foi promovido a `LegalEvidenceDocument`. Registros
existentes permanecem `SEM_EVIDENCIA` até receberem evidência canônica real,
registrada pelo novo serviço. Nenhum fixture sintético foi criado no seed de
produção (proibido); os fixtures usados nos testes de integração vivem em
organizações isoladas e descartáveis, criadas e limpas pelo próprio teste.

### 11.3 Autorrevisão adversarial — o que foi testado para quebrar

Tentativas e resultado, todas em `src/application/legal/legal-evidence.database.integration.test.ts`:

- Revisor = uploader (mesma pessoa) → recusado (`SELF_REVIEW_FORBIDDEN`), mesmo
  com perfil de aprovador.
- Segunda decisão por revisor diferente sobre evidência já decidida → recusada
  como conflito classificado (`NOT_PENDING_REVIEW`), nunca reescrita silenciosa.
- `documentRequestId` de outro caso jurídico (mesma organização) → recusado
  tanto na validação de aplicação (IDOR, antes de qualquer escrita) quanto pelo
  trigger `rede_validate_legal_evidence_document` quando testado direto no
  Postgres (`LEGAL_EVIDENCE_DOCUMENT_REQUEST_MISMATCH`).
  `documentRequestId`+`checklistItemId` simultâneos → recusado por `CHECK` XOR.
- Checksum em formato inválido (não-SHA-256) → recusado por `CHECK`.
- Revogação sem motivo, ou de evidência que não está `VERIFIED` → recusada
  (`NOT_VERIFIED`).
- `UPDATE` direto (fora do serviço) de campo protegido após `VERIFIED`, `DELETE`
  de evidência `VERIFIED`, `TRUNCATE` incondicional → todos bloqueados pelo
  trigger de imutabilidade, testados com Prisma direto (não só via serviço).
- Duas verificações concorrentes reais (`Promise.allSettled`, sem mocks) sobre a
  MESMA evidência → exatamente uma vence, a outra recusada de forma
  classificada; estado final nunca fica ambíguo.
- Transação com `AuditLog` + linha de evidência seguida de erro forçado →
  rollback completo, nenhuma persistência parcial.
- Evidência de outra organização → nunca encontrada (IDOR) em nenhuma operação
  (registrar/verificar/recusar/revogar/consultar).
- `VIEWER` → recusado em toda escrita e na leitura (`LEGAL_READ` não concedido).

Nenhum achado exigiu redesenho — todas as defesas planejadas no contrato §21 se
confirmaram na prática. Um bug real de código (não de design) foi encontrado e
corrigido durante a escrita dos testes: `rejectLegalEvidenceDocument` era uma
função síncrona com um `throw` de validação antes de delegar à função
`async` — o erro escapava como exceção síncrona em vez de Promise rejeitada,
quebrando qualquer chamador que fizesse `.catch()`/`await`/`.rejects`. Corrigido
tornando a função `async` (e `verifyLegalEvidenceDocument` também, por simetria
defensiva).

### 11.4 Backups reais antes da migration

| Banco | `sha256` do dump | Linhas | Tabelas | `restoredContentMatches` |
|---|---|---|---|---|
| `rede_intelligence` (dev) | `2e602d37e7ea8915af09a9548658653560b59247a8c0b6e9b71c2bcb0a60ba3e` | 2.807 | 381 | ✅ true |
| `rede_intelligence_test` | `bdb922071deda9c689bb74707efdf899f8ea6fb806ce36b61812a663d1a478bf` | 440.093 | 381 | ✅ true |

Ambos com `sourceStable: true` (banco de origem provadamente inalterado pelo
backup) e `valid: true`, restaurados em banco isolado (`rede_restore_*`, nunca
sobre a origem) e verificados byte a byte antes de qualquer `migrate deploy`.

### 11.5 QA (números reais observados)

| Item | Resultado |
|---|---|
| `prisma validate` | ✅ válido |
| `prisma migrate deploy` (dev + teste) | ✅ aplicada nas duas, 38 migrations em ambas |
| Catálogo pós-migration (FKs/índices/constraints/triggers) | ✅ confirmado via consulta direta ao `pg_catalog` em dev e teste — 8 FKs, 6 CHECK, 4 índices (3 + PK), 3 triggers, enum com 4 valores |
| 37 migrations anteriores | ✅ byte-idênticas (nenhuma tocada; `git status` mostra só as 2 pastas novas) |
| `docs/PHASE_9Q2A_MIGRATION_MANIFEST.json` | ✅ regenerado via `scripts/release-manifest.mjs` (nunca calculado à mão) — 37→38 entradas, só 1 adicionada |
| TypeScript (`tsc --noEmit`) | ✅ 0 erros |
| ESLint (projeto inteiro) | ✅ 0 erros/avisos |
| Testes focais novos (`legal-evidence.database.integration.test.ts`) | ✅ 28/28 |
| `gates.test.ts` (com os novos casos de evidência canônica) | ✅ 78/78 |
| `closure.database.integration.test.ts` + `legal/database.integration.test.ts` | ✅ 64/64 + 4/4 (nenhuma regressão do rewiring do gate) |
| Suíte oficial completa (`pnpm test` — migrate deploy + seed + vitest) | ✅ 138 arquivos passando (1 pulado, condição pré-existente não relacionada), 1.595 testes passando, 4 pulados |
| `next build` | ✅ compilado com sucesso, 28 páginas geradas |
| `git diff --check` | ✅ sem erros de whitespace (só avisos CRLF/LF esperados no Windows) |
| Busca de segredos no diff | ✅ nenhum encontrado (só `passwordHash: "integration-test"`, mesmo placeholder já usado em toda a suíte) |
| `.env`/`next-env.d.ts` | ✅ intactos (`next-env.d.ts` foi regenerado pelo `next build` e revertido de propósito) |
| `git status` | ✅ zero staged; só arquivos modificados/novos no working tree |

### 11.6 Riscos residuais

- Nenhum item existente de `LegalDocumentRequest`/`LegalChecklistItem` ganha
  evidência retroativa — permanecem `SEM_EVIDENCIA` até alguém registrar
  evidência real pelo novo serviço. Isto é intencional (proibição explícita de
  fabricar evidência a partir de string livre), mas significa que diligências
  já "recebidas" no mundo real por fora do sistema precisarão de re-upload.
  Não é um bug — é a consequência correta de nunca confiar em dado não
  verificável.
- O serviço não expõe (ainda) uma Server Action/UI para upload — só a camada de
  aplicação. Fora do escopo desta autorização ("nenhuma UI nova").
  `LegalAssetRegistration.sourceDocumentLinkId` permanece string livre, fora do
  escopo desta correção (a autorização cobriu `LegalDocumentRequest`/
  `LegalChecklistItem`; estender a matrículas fica para autorização futura, se
  necessário).

**Fase 10 continua não iniciada.** Nenhum commit, push, merge, rebase ou tag foi
executado nesta correção. Nenhuma credencial real ou API externa foi usada.
Nenhuma movimentação bancária ou baixa societária real ocorreu. Esta correção
NÃO declara a Fase 9S encerrada — aguarda auditoria independente, como nas
correções anteriores desta fase.

## 12. Correção final pós-auditoria — redação e idempotência estrutural

Duas auditorias adversariais independentes reprovaram a correção da seção 11
por dois achados Altos — nenhum bypass de tenant/RBAC/IDOR foi encontrado, a
superfície estrutural (migration, triggers, constraints) se manteve sólida.
Detalhe de design completo em `docs/PHASE_9S_CONTRACT.md` §22.

### 12.1 Causa dos dois achados

1. **AuditLog expunha checksum e storageKey completos.** Confirmado
   empiricamente (não só por leitura de código): registrar uma evidência real
   e consultar o `AuditLog` gravado mostrava o `storageKey` bruto (revelando a
   árvore interna de armazenamento) e o `checksum` SHA-256 integral em texto
   pleno, nos quatro eventos (`REGISTERED`/`VERIFIED`/`REJECTED`/`REVOKED`);
   o motivo de recusa/revogação (texto livre) também ia para o `AuditLog` sem
   redação.
2. **Idempotência sem garantia estrutural.** `registerLegalEvidenceDocument`
   fazia só um `findFirst` (check-then-act) antes do `create` — nenhuma
   constraint/índice único representava a identidade idempotente. Reproduzido
   pela auditoria: 5 chamadas concorrentes idênticas (`Promise.allSettled`,
   PostgreSQL real) criavam 5 linhas `PENDING_REVIEW` distintas, todas
   bem-sucedidas.

### 12.2 Redação aplicada ao AuditLog

Helper central único (`audit()`, reaproveitado por register/verify/reject/
revoke) substitui o payload livre anterior por um formato allowlisted:
`evidenceRef` (SHA-256 de `legal-evidence-checksum:<checksum>`, truncado a 16
hex — determinístico, não reversível porque a entrada, o checksum, tem alta
entropia), `statusBefore`/`statusAfter`, `diligenceCaseId`/
`documentRequestId`/`checklistItemId` e `correlationId` (em `metadata`,
server-side). `storageKey`/`storageProvider` nunca entram em nenhuma forma.
Nenhum `console.*` do serviço recebe esses valores (confirmado por spy real
nos 4 caminhos); nenhum `Error.cause` carrega o erro bruto do Prisma.
**Correção nesta primeira versão, revertida na seção 13**: esta versão da
correção também introduziu `reasonRef` — a mesma técnica de hash aplicada ao
motivo livre de recusa/revogação — sob a premissa incorreta de que teria a
mesma garantia de não-reversibilidade do `evidenceRef`. Uma verificação
focal independente provou, por ataque de dicionário real, que essa premissa
era falsa (motivo de baixa entropia ≠ checksum de alta entropia); `reasonRef`
foi removido — ver seção 13. `AuditLog`s históricos (anteriores a esta correção)
não foram reescritos nem apagados — podem conter os valores em texto pleno;
isso fica documentado aqui, não corrigido retroativamente.

### 12.3 Chave idempotente escolhida

Organização + projeto + caso + vínculo jurídico (`documentRequestId` XOR
`checklistItemId`) + `checksum`, restrita a linhas ativas
(`PENDING_REVIEW`/`VERIFIED`). `REJECTED`/`REVOKED` ficam fora da identidade —
reenviar depois de uma decisão terminal é uma nova operação lógica, não um
retry, consistente com o design de revogação já aprovado ("nova evidência =
nova linha"). Nenhum `idempotencyKey` novo foi criado — o `checksum` (SHA-256
do conteúdo) já é a impressão digital do payload.

### 12.4 Migration e índices (39ª migration, aditiva)

`prisma/migrations/20260911235000_phase_9s_legal_evidence_idempotency/` — dois
índices únicos parciais, nunca um único índice composto sobre as duas colunas
de vínculo (evita o escape por `NULL <> NULL` que um índice composto ingênuo
teria). Backups reais antes da migration:

| Banco | `sha256` do dump | Linhas | `restoredContentMatches` |
|---|---|---|---|
| `rede_intelligence` (dev) | `957f1e93d22bf17d19e360b709045b4e2397d0f0caf7480e2e1894a1931c55f5` | 2.808 | ✅ true |
| `rede_intelligence_test` | `d3167c3fc9f8a2078ac5b971ed6726a4fa51f2d256bff4f44fbff45f4612ac60` | 473.811 | ✅ true |

Ambos com `sourceStable: true`/`valid: true`, restaurados em banco isolado
(`rede_restore_*`, nunca sobre a origem), timestamps anteriores à aplicação da
migration. Nenhuma duplicata ativa existia em dev nem em teste antes da
migration (verificado por consulta direta); os índices foram criados sobre os
dados reais, sem backfill fabricado. Catálogo confirmado via `pg_indexes`
direto em dev e teste — os dois índices existem, `UNIQUE`, com o predicado
`WHERE` exato do design. Nenhuma das 38 migrations anteriores foi alterada.

### 12.5 Concorrência real testada

`src/application/legal/legal-evidence.database.integration.test.ts` — 17
testes novos contra PostgreSQL real (Promise.all/Promise.allSettled, sem
mocks): 2 e 10 registros concorrentes idênticos → exatamente 1 linha e 1
`AuditLog` de criação em ambos; mesma chave com checksum diferente → ambos
permitidos (evidências genuinamente distintas); mesmo checksum em
requests/casos diferentes e em organizações diferentes → nunca colide;
`documentRequestId` vs `checklistItemId` → índices independentes; retry após
`VERIFIED` → retorna a mesma linha, sem duplicar; retry após `REJECTED`/
`REVOKED` → cria nova linha `PENDING_REVIEW` (nova operação lógica); conflito
de unicidade em constraint não relacionada (colisão de chave primária,
`target: ["id"]`) → nunca tratado como retry idempotente, confirmando que o
tratamento identifica a constraint exata, nunca um `P2002` genérico.

### 12.6 Bug real encontrado na autorrevisão

Nenhum bug novo de lógica foi encontrado nesta rodada — a implementação do
`catch` de `P2002` funcionou conforme desenhado no primeiro teste real. O
único ponto ajustado durante a escrita dos testes foi de cobertura: o teste
de idempotência anterior (seção 11) só cobria o caminho sequencial; os 17
testes novos cobrem explicitamente o caminho concorrente que a auditoria
havia reproduzido como falho.

### 12.7 QA (números reais observados)

| Item | Resultado |
|---|---|
| Backups (dev + teste) | ✅ `sourceStable`/`restoredContentMatches`/`valid` = true nos dois |
| `prisma validate` | ✅ válido |
| `prisma migrate deploy`/`status` (dev + teste) | ✅ aplicada nas duas, 39 migrations em ambas, "up to date" |
| Catálogo (`pg_indexes`) | ✅ os dois índices únicos parciais confirmados em dev e teste |
| 38 migrations anteriores | ✅ nenhuma modificada (`git status` só mostra as 3 pastas novas da 9S) |
| `docs/PHASE_9Q2A_MIGRATION_MANIFEST.json` | ✅ regenerado via `scripts/release-manifest.mjs` — 38→39 entradas, só 1 adicionada |
| TypeScript (`tsc --noEmit`) | ✅ 0 erros |
| ESLint (projeto inteiro) | ✅ 0 erros/avisos |
| Testes focais novos (idempotência + redação) | ✅ 17/17 |
| `legal-evidence.database.integration.test.ts` completo | ✅ 45/45 |
| Legal + closure + gates combinados | ✅ 214/214 (nenhuma regressão) |
| Suíte oficial completa (`pnpm test`), 2 execuções sem recriar o banco | ✅ 138 arquivos (1 skipped pré-existente) / 1.612 testes (4 skipped) — idêntico nas duas execuções |
| `next build` | ✅ compilado com sucesso, 28 rotas |
| `git diff --check` | ✅ sem erros reais (só avisos CRLF/LF do Windows) |
| Busca de segredos no diff | ✅ nenhum encontrado |
| `.env`/`next-env.d.ts` | ✅ intactos (`next-env.d.ts` regenerado pelo build e revertido de propósito) |
| `git status` | ✅ zero staged |

### 12.8 Riscos residuais

- `REJECTED` continua sem coluna canônica própria para o motivo (só
  `reasonCode` estático no `AuditLog`, desde a correção da seção 13) — fora do
  escopo desta correção (restrita a redação/idempotência); se um dia for
  necessário reter o texto do motivo de recusa de forma estruturada e
  consultável, isso exige nova autorização de schema.
- `AuditLog`s gravados antes desta correção podem reter `checksum`/
  `storageKey` em texto pleno — não foram nem podiam ser reescritos
  (`AuditLog` é histórico imutável por design).

**Fase 10 continua não iniciada.** Nenhum commit, push, merge, rebase ou tag
foi executado nesta correção. Nenhuma credencial real ou API externa foi
usada. Nenhum trigger foi desabilitado. Nenhum dado ou `AuditLog` existente
foi apagado ou reescrito. Esta correção NÃO declara a Fase 9S encerrada —
aguarda nova verificação, como nas correções anteriores desta fase.

## 13. Correção crítica final — remoção de fingerprint de motivo livre

Uma verificação focal independente sobre a correção da seção 12 reprovou por
um achado Crítico, confirmado por ataque de dicionário real (não teórico):
`reasonRef` — introduzido na seção 12 como "mesma técnica" do `evidenceRef` —
recuperava o motivo original de recusa/revogação. Detalhe de design completo
em `docs/PHASE_9S_CONTRACT.md` §23.

### 13.1 Causa

`evidenceRef` é seguro porque sua entrada (`checksum`, 256 bits de entropia)
é inviável de adivinhar. `reasonRef` aplicava a MESMA técnica — SHA-256 sem
chave/sal, com prefixo de domínio público — a texto livre de baixa entropia
(motivos previsíveis de um domínio jurídico/administrativo). Reproduzido:
registrar uma evidência real, rejeitá-la e revogá-la com motivos-canário, e
recalcular offline os hashes de um dicionário de 15 frases plausíveis
recuperou os dois motivos reais, byte a byte:

```
reject reasonRef no AuditLog: 254d5ea383c8b0f2
  → "Documento ilegível — página 3 corrompida." produz o MESMO hash
revoke reasonRef no AuditLog: 3898fa30e82d5197
  → "Documento substituído por versão mais recente." produz o MESMO hash
```

Nenhum privilégio além de leitura do `AuditLog` foi necessário — o algoritmo
está no próprio código-fonte, não é segredo.

### 13.2 Correção aplicada

`reasonRef` foi removido de `src/application/legal/legal-evidence-service.ts`
— nenhuma derivação SHA-256/HMAC/hash de texto livre permanece no serviço.
`reject`/`revoke` agora gravam só um `reasonCode` estático e allowlisted
(`LEGAL_EVIDENCE_REJECTION_REASON_PROVIDED`/
`LEGAL_EVIDENCE_REVOCATION_REASON_PROVIDED`, tipado como união literal —
impossível de passar texto livre por engano). `evidenceRef` não foi alterado
— continua derivado do `checksum` (alta entropia), servindo só como
referência de correlação de auditoria, nunca como chave de autorização,
unicidade ou integridade. `revokedReason` continua exclusivamente na coluna
canônica protegida (inalterada); `REJECTED` continua sem coluna canônica de
motivo (fora do escopo — nenhuma migration criada). Nenhuma regra de
idempotência, gate, RBAC, storage ou imutabilidade foi tocada; nenhuma
migration nova (39, inalteradas); nenhum `Error.cause` carrega o motivo bruto.

### 13.3 Testes

`src/application/legal/legal-evidence.database.integration.test.ts` — 2
testes novos (47 no total, antes 45): ataque de dicionário de regressão
(confirma que nenhum hash do algoritmo removido, integral ou truncado a 16
hex, aparece em nenhuma folha do `AuditLog` para uma lista de motivos
plausíveis) e `Error.cause` nunca carrega o motivo bruto (recusa com motivo
vazio e conflito de estado). Os testes existentes de redação foram
reescritos para varredura recursiva de TODAS as folhas string do objeto
persistido (não mais um `JSON.stringify` só de `after`) e para confirmar
`reasonCode` estático correto, ausência de `reasonRef`/`reason`, e que duas
razões DIFERENTES na mesma operação produzem o MESMO `reasonCode` (nunca
fingerprints distintos — essa é justamente a propriedade que separa um
código de categoria de um hash de conteúdo).

### 13.4 Autorrevisão

Busca global por `reasonRef`/`legal-evidence-reason`/`revokedReason` fora da
coluna canônica/`rejectReason`/`safeAuditRef` aplicado a texto livre — zero
ocorrência produtiva restante; as únicas menções restantes são comentários
explicando a remoção e a reprodução do algoritmo antigo dentro do próprio
teste de regressão (usada só para provar a ausência, nunca para produzir o
valor real).

### 13.5 QA (números reais observados)

| Item | Resultado |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ 0 erros |
| ESLint (projeto inteiro) | ✅ 0 erros/avisos |
| `legal-evidence.database.integration.test.ts` | ✅ 47/47 (2 novos) |
| Legal + closure + gates combinados | ✅ 216/216 (nenhuma regressão) |
| `prisma validate`/`migrate status` (dev + teste) | ✅ válido, 39 migrations em ambas, "up to date" — nenhuma nova |
| Suíte oficial completa (`pnpm test`), 2 execuções sem recriar o banco | ✅ 138 arquivos (1 skipped pré-existente) / 1.614 testes (4 skipped) — idêntico nas duas execuções |
| `next build` | ✅ compilado com sucesso, 28 rotas |
| Preflight inválido (`production-preflight-cli.test.ts`) | ✅ 8/8 |
| `git diff --check` | ✅ sem erros reais (só avisos CRLF/LF do Windows) |
| Busca de segredos no diff | ✅ nenhum encontrado |
| `.env`/`next-env.d.ts` | ✅ intactos |
| `git status` | ✅ zero staged |

### 13.6 Riscos residuais

- `AuditLog`s gravados durante a janela da correção da seção 12 contêm
  `reasonRef` (hash do motivo, hoje comprovadamente recuperável por
  dicionário) — não foram e não podem ser reescritos (`AuditLog` é histórico
  imutável por design). Qualquer investigação sobre esse período específico
  deve tratar `reasonRef` ali como não confiável para confidencialidade.
- `REJECTED` continua sem retenção estruturada do motivo além do
  `reasonCode` genérico — se um dia for necessário, exige nova autorização
  de schema.

**Fase 10 continua não iniciada.** Nenhum commit, push, merge, rebase ou tag
foi executado nesta correção. Nenhuma credencial real ou API externa foi
usada. Nenhum trigger foi desabilitado. Nenhum dado ou `AuditLog` existente
foi apagado ou reescrito. Nenhuma migration nova. Esta correção NÃO declara
a Fase 9S encerrada — aguarda nova verificação.
