# REDE Intelligence — Fase 9I implementada

## REDE Data: Inteligência de Dados, comparativos, previsto x realizado e Orçamento Inteligente

> Este documento descreve o que foi efetivamente implementado na Fase 9I, em cima do plano em
> `docs/PHASE_9I_REDE_DATA_PORTFOLIO_INTELLIGENCE_PLAN.md` (preservado sem alterações). A 9I é
> camada analítica: lê, normaliza, compara e aprende com os módulos 9A–9H, mas nunca é uma segunda
> fonte de verdade — todo fato aponta de volta ao registro operacional original.

## A. Analytics Contracts

`AnalyticsDataContract` (modelo Prisma) + `ensureAnalyticsContracts()`. Cinco contratos ativos e
versionados cobrindo 9A (orçamento), 9C (compras, contrato, medição) e 9H (preço observado
externo), cada um com `key`, `version`, `sourceModule`, `sourceEntities`, `grain`, `dimensions`,
`measureDefinition`, `temporality`, `owner`, `status` e `checksum`. Mudança incompatível cria nova
versão (campo `version` já suporta; nenhuma versão 2 foi necessária nesta fase).

## B. Dimensions / Facts

Dimensões conformadas reaproveitadas sem duplicação: `Organization`, `Project`, `EconomicItem`,
`CostCenter`, `ProjectOperatingUnit` (todas já existentes em 9A). `AnalyticsFact` é um fato
polimórfico único (não 12 tabelas físicas separadas) com `factType` (`COST`, `PROCUREMENT_PRICE`,
`MEASUREMENT`, `PRICE_OBSERVATION`, mais `SALES`/`SCHEDULE_PROGRESS`/`FORECAST`/`PRODUCTIVITY`/
`LEGAL_CYCLE`/`ACCOUNTING` reservados no enum para uso futuro), `economicStage` explícito
(`BUDGETED`→`CONTRACTED`→`MEASURED`→…), `grainKey` e lineage leve via `sourceModule` +
`sourceEntityType` + `sourceEntityId` (sem FK rígida entre domínios transacionais — decisão de
design documentada no comentário do schema). Idempotência garantida por
`@@unique([organizationId, factType, sourceEntityType, sourceEntityId])`. `refreshAnalyticsFacts()`
constrói fatos reais a partir de `BudgetLineItem`, `PurchaseOrderItem`, `OperationalContractItem`
(já somando aditivos aprovados), `MeasurementLine` e `ExternalPriceObservation` do START BUTANTÃ —
11 fatos reais, nenhum número inventado.

## C. Catálogo de Métricas

`MetricDefinition` + `ensureMetricCatalog()`. Cinco métricas ativas (`custo_unitario_item`,
`desvio_contratual`, `avanco_fisico_medido`, `margem_bruta_projeto`, `absorcao_comercial`), cada
uma com definição, fórmula em texto, `engineVersion`, unidade, agregação, grão e dimensões
válidas. Nenhuma fórmula foi hardcoded em componente React — a UI e a REDE AI só leem valores já
calculados pelo motor.

## D. Camada semântica

`src/domain/data-intelligence` é o motor determinístico puro (sem I/O): `statistics.ts`
(mediana/percentil/desvio-padrão/outliers IQR e MAD), `normalization.ts` (unidade e moeda/índice),
`comparability.ts` (gate + similaridade), `confidence.ts`, `forecast-accuracy.ts`, `auto-budget.ts`.
`src/application/data-intelligence/data-intelligence-service.ts` orquestra esse motor contra o
Postgres real e é a única porta de leitura/escrita usada pela UI, seed e REDE AI —
`DATA_INTELLIGENCE_ENGINE_VERSION` (`9i-engine-1.0.0`) é persistido em todo cálculo.

## E. Normalização de índices/unidades

`normalizeCurrency()` reutiliza `FinancialIndex` (9B) por nome/data mais próxima; preserva sempre o
valor nominal e só produz `CORRECTED` quando há série de índice suficiente — nunca sobrescreve o
nominal. `convertUnit()`/`unitDimension()` têm registro canônico por dimensão física (MASS, VOLUME,
AREA, LENGTH, COUNT, TIME); "verba"/"lote"/"unidade de serviço" ficam presos à dimensão COUNT e
nunca convertem para uma grandeza física. Unidades incompatíveis retornam `compatible: false` em
vez de lançar exceção, permitindo ao chamador excluir o dado com motivo visível.

## F. Comparativos (custo/compras/comercial/cronograma/financeiro/jurídico/fornecedor)

Implementado de fato nesta fase: **comparativo de custo por item econômico** (`runCostBenchmark`),
rodado sobre o item real "Construção MCMV" do START BUTANTÃ, comparando a linha orçada (R$/m²), o
pedido de compra de aço (R$/t) e a observação externa de preço do mesmo aço (R$/t, mapeada nesta
fase). Comparativos comercial/cronograma/financeiro/jurídico/fornecedor têm o mesmo motor
(`checkEligibility` + `calculateSimilarity` + `calculateConfidence`) disponível e testado
unitariamente, mas **não foram instanciados com um segundo `subjectType` na fundação** porque o
tenant de demonstração tem um único empreendimento — instanciar um comparativo comercial/jurídico
real exigiria inventar um segundo projeto, o que o prompt original proíbe explicitamente. Fica
como pendência real (seção AZ).

## G. Comparability Gate

`checkEligibility()` — recusa moeda incompatível, região fora do filtro e idade acima do limite
configurado na `ComparabilityPolicy`; motivo sempre visível (`reasons: string[]`). No benchmark
real da 9I, a linha orçamentária (m²) é automaticamente excluída da estatística por unidade
incompatível com a linha de aço (t) — comprovado em teste de integração.

## H. Índice de Similaridade

`calculateSimilarity()` decompõe região, estágio econômico, padrão/produto e recência em fatores
com peso, contribuição e nota textual — nunca um número sem explicação. Pesos vêm de
`ComparabilityPolicy.similarityWeights`, versionados.

## I. Nível de Confiança

`calculateConfidence()` combina amostra, recência, dispersão, similaridade e proveniência.
Regra explícita: amostra abaixo do mínimo configurado nunca produz `HIGH`, mesmo com todos os
outros fatores perfeitos (testado unitariamente). No comparativo real (N=2, aço orçado x aço
observado), o nível resultante nunca é `HIGH`.

## J. Pontos Fora do Padrão

`detectOutliersIqr`/`detectOutliersMad`. Exigem amostra mínima (4 para IQR, 3 para MAD) — com N=2
no comparativo real, nenhum outlier é sinalizado automaticamente, o que é o comportamento correto
(não estatisticamente defensável apontar outlier com 2 pontos), não um bug. `BenchmarkOutlier` tem
`decision` (`PENDING`/`VALID`/`ERROR`/`EXTRAORDINARY`/`DIFFERENT_SCOPE`/`EXCLUDED`) e nunca remove
o ponto automaticamente — testado com um cenário sintético de outlier real no domínio.

## K. Qualidade dos Dados

Quatro `DataQualityRule` ativas (unidade inválida, proveniência ausente, observação externa
desatualizada >180 dias, EconomicItem sem fato) rodando contra dados reais via
`runDataQualityChecks()`, gerando `DataQualityRun` + `DataQualityIssue` por execução (histórico
auditável, uma execução por rodada — não sobrescreve a anterior). Na base atual, as 4 regras não
encontraram achados (dados legitimamente limpos), o que é reportado honestamente abaixo.

## L. Linhagem e Catálogo de Dados

Lineage: `AnalyticsFact.sourceModule/sourceEntityType/sourceEntityId/provenance` → registro
operacional original; `AnalyticsFact.contractId` → `AnalyticsDataContract`; `BenchmarkMember.factId`
→ `AnalyticsFact`; `ForecastEvaluation.forecastSourceType/forecastSourceId` →
`OperationalContract`/`ContractAmendment`. Não foi criado um `DatasetDefinition` separado — o
catálogo mínimo (nome, owner, grain, freshness, classificação) já está coberto por
`AnalyticsDataContract` + `AnalyticalDatasetVersion` (schema criado, motor de geração não
implementado nesta fase — ver seção AZ).

## M. Carteira de Empreendimentos

`PortfolioSnapshot` + `buildPortfolioSnapshot()`. Hierarquia Grupo→Empresa→SPE→Projeto já existe em
9A (`EconomicGroup`/`Company`/`Project`); o snapshot é gerado no grão `PROJECT` (único nível
demonstrável com um projeto). Orçado, contratado (com aditivos) e medido calculados a partir de
fatos reais.

## N. Scorecard multidimensional

Sete dimensões separadas e não combinadas em nota única: Financeiro (margem do motor de
viabilidade, reutilizada, não recalculada), Comercial (absorção real de `SalesUnit`), Engenharia
(avanço físico da medição), Jurídico (diligências abertas), Cronograma (fundação declarada, sem
métrica própria ainda), Capital (exposição máxima do `FinancialResult`), Dados (achados de
qualidade abertos).

## O. Previsto x Realizado

Núcleo da 9I. `evaluateForecasts()` — como `OperationalForecast.projectedResult` está vazio na base
atual (0 registros, não populado por nenhuma fase até 9H), o previsto x realizado real foi
construído sobre `OperationalContract.originalAmount` (previsto) vs valor após `ContractAmendment`
aprovado (realizado) — um evento genuinamente real do seed (aditivo de R$ 50 mil por "condição
geotécnica imprevista"). A previsão original nunca é sobrescrita: `predictedValue` e `actualValue`
ficam lado a lado no mesmo registro.

## P. Precisão de previsões (Forecast Accuracy)

`evaluateForecastAccuracy()` calcula erro absoluto e percentual (retorna `null` em vez de dividir
por zero quando o previsto é zero) e classifica o viés. No caso real do contrato de fundações e
estrutura: erro absoluto R$ 50.000, viés `PESSIMISTIC` (custo subiu além do previsto).

## Q. Bias

`summarizeBias()` — contagem de avaliações otimistas/pessimistas/neutras e erro percentual médio,
sem linguagem acusatória. Testado unitariamente com um caso “sempre subestima”.

## R. Ciclo de Aprendizado

Fundação estrutural presente (fatos → benchmark/forecast evaluation → decisão de outlier →
proposta de Orçamento Inteligente referencia o benchmark), mas **não há ainda um segundo ciclo**
(nenhum modelo/benchmark foi recalculado a partir de um resultado realizado subsequente) porque
isso exigiria um horizonte de tempo que a base de demonstração não tem. Versionamento que
sustentaria o ciclo (chave `version` em métricas, contratos, políticas) já existe.

## S. Motor de Recomendações (fundação)

Não há um "motor de recomendações" genérico e separado nesta fase — a recomendação explicável
concreta implementada é a sugestão de Orçamento Inteligente (`suggestUnitCost()`), que já produz
amostra, faixa, confiança, fonte e justificativa em texto. Um motor de recomendação mais genérico
(ex.: "este fornecedor está X% acima do comparável") fica como pendência (seção AZ).

## T. Fundação do Orçamento Inteligente

`AutoBudgetProposal` + `AutoBudgetProposalLine` + `createAutoBudgetProposal()`. Sugestão pela
mediana do benchmark (mais robusta a outliers que a média), faixa P25–P75, confiança e exceções
sempre visíveis (`suggestUnitCost()` sinaliza amostra pequena e confiança baixa como exceção
textual). Nunca grava direto em orçamento aprovado — é uma entidade própria, DRAFT por padrão.

## U. Proposta de orçamento e revisão humana

Estados `DRAFT → REVIEW → APPROVED/REJECTED/SUPERSEDED` (`moveAutoBudgetProposalToReview`,
`decideAutoBudgetProposal`). `AutoBudgetProposalLine.reviewedUnitCost`/`reviewNote` ficam em campos
separados de `suggestedUnitCost` — a sugestão original nunca é sobrescrita, mesmo após aprovação.
Testado: tentar aprovar uma proposta que não está em `REVIEW` é rejeitado.

## V. Fundação de Quantidades/Composições

**Não implementada nesta fase**, por decisão explícita do prompt original (seção 79: "Quantities
BIM completas" e composições/SINAPI ficam para depois). O schema de `AnalyticsFact` já suporta
`quantity`/`unit` por fato, o que é compatível com uma futura ligação a `BimElement.quantities` (9A/
8), mas nenhum contrato ou tabela de composição foi criado.

## W. Explicabilidade

Toda saída relevante (benchmark, forecast evaluation, proposta de Orçamento Inteligente) carrega
amostra, fatores decompostos, política/versão usada, data-base e justificativa em texto — nunca só
um número. A UI mostra a mesma decomposição que o motor calculou, sem reformular.

## X. UI — REDE Data / Inteligência de Portfólio

Nova área "Inteligência de Dados" em `src/components/data-intelligence-view.tsx`, integrada em
`intelligence-workspace.tsx` (nova aba no menu principal, ícone `Database`). Seis sub-visões, todas
em português claro conforme a diretriz de nomenclatura recebida: **Visão Geral**, **Carteira de
Empreendimentos**, **Comparativos**, **Previsto x Realizado**, **Qualidade dos Dados**, **Orçamento
Inteligente**. Tabelas e cartões determinísticos (sem biblioteca de gráficos nova), como orientado
para não comprometer prazo.

## Y. Benchmark UI

Aba "Comparativos": mostra métrica, amostra elegível, mediana, faixa P25–P75, desvio-padrão, nível
de confiança (badge "Confiança Alta/Média/Baixa"), tabela de membros com valor bruto, valor
normalizado, índice de similaridade, elegibilidade e motivo de exclusão, e pontos fora do padrão
com método/score/decisão.

## Z. Previsto x Realizado UI / Qualidade dos Dados UI / Orçamento Inteligente UI

Três abas dedicadas com tabelas determinísticas: previsto, realizado, erro absoluto/percentual,
viés e estágio; execuções de qualidade com regra, dimensão, severidade e resultado, mais achados
em aberto; propostas de Orçamento Inteligente com item, quantidade, custo sugerido, faixa,
confiança e o campo de revisão humana lado a lado com a sugestão original.

## AA. Central Executiva

Novo cartão "Inteligência de Dados" na Visão Executiva (`intelligence-workspace.tsx`), com fatos
analíticos, comparativos calculados, confiança do último comparativo, erro % médio previsto x
realizado, achados de qualidade abertos e status da proposta de Orçamento Inteligente — sem
reconstruir a Central existente.

## AB. REDE AI

Seis ferramentas somente leitura novas em `tool-registry.ts`: `getCostBenchmark`,
`getForecastAccuracy`, `getPortfolioScorecard`, `getDataQualityFindings`,
`getAutoBudgetSuggestion`, `getMetricCatalog`. Todas chamam `getDataIntelligenceWorkspace` (o mesmo
motor usado pela UI) — a IA nunca recalcula benchmark, forecast ou orçamento.

## AC. Multi-tenancy

Toda tabela nova tem `organizationId` obrigatório; todo acesso passa por `assertProjectScope`
(projeto precisa pertencer à organização do contexto) e capabilities por `MembershipRole`. Testado
em integração: organização isolada ("Grupo Atlas") tem zero `AnalyticsFact`, e
`getDataIntelligenceWorkspace`/`refreshAnalyticsFacts` chamados com organização errada ou sem
capacidade lançam erro.

## AD. Governança futura para benchmark cross-tenant

Nenhum benchmark cross-tenant foi implementado ou habilitado — `BenchmarkRun` sempre filtra por
`organizationId`. O design deixa espaço (campo `subjectType`/`policyId` versionado) para uma futura
política agregada, mas isso está fora de escopo desta fase por decisão explícita do prompt.

## AE. Dataset/IA/Reprodutibilidade

`AnalyticalDatasetVersion` foi criado no schema (chave, versão, população, filtros, schema,
classificação, tratamento de PII, checksum, aprovação) mas **nenhum dataset foi de fato gerado**
nesta fase — é fundação de tabela, não motor de geração. Reprodutibilidade está garantida onde há
cálculo real: todo `BenchmarkRun`/`MetricRun`/`ForecastEvaluation` grava `engineVersion` e
`checksum`.

## AF. Refresh/Versionamento

`refreshDataIntelligence()` é o orquestrador único, idempotente e usado tanto pelo seed quanto (via
mesma função) pela futura ação "Atualização" da UI. `AnalyticsRefreshRun` registra cada execução
(status, linhas processadas, fatos criados/atualizados, erros). Fatos, contratos, métricas, política
e proposta são upsert (idempotentes); `BenchmarkRun`/`DataQualityRun`/`AnalyticsRefreshRun` são
tabelas de histórico de execução por natureza — cada rodada gera um novo registro auditável, sem
sobrescrever nem duplicar o fato subjacente (mesmo padrão de `CalculationRun` já usado no motor de
viabilidade).

## AG. RBAC/LGPD/Auditoria

`src/domain/data-intelligence/capabilities.ts`: 14 capacidades (`DATA_VIEW`,
`DATA_CONTRACT_MANAGE`, `ANALYTICS_REPROCESS`, `METRIC_MANAGE`, `METRIC_APPROVE`, `BENCHMARK_VIEW`,
`BENCHMARK_MANAGE`, `DATA_QUALITY_VIEW`, `DATA_QUALITY_MANAGE`, `DATASET_EXPORT`,
`AUTOBUDGET_VIEW`, `AUTOBUDGET_BUILD`, `AUTOBUDGET_REVIEW`, `AUTOBUDGET_APPROVE`), com segregação
intencional testada: `ANALYST` constrói mas não aprova; `REVIEWER` aprova mas não constrói. LGPD:
nenhum dado pessoal novo foi introduzido pela 9I — os fatos analíticos referenciam IDs de
fornecedor/cliente já existentes em 9C/9E, sem copiar CPF/telefone/e-mail. Auditoria: reaproveita
`AuditLog` existente (nenhuma tabela de auditoria paralela criada); toda decisão humana (outlier,
aprovação/rejeição de proposta) grava `decidedById`/`reviewedById`/`approvedById` e timestamp.

## AH. Migration e ambiente

Migration nova `20260822230000_phase_9i_rede_data_portfolio_intelligence` (aditiva, 20 tabelas + 11
enums), UTF-8 sem BOM. Nenhuma migration 9A–9H foi alterada. `.env` permanece local e fora do
controle de versão (não tocado nesta fase).

## AI. Incidente de infraestrutura durante a implementação

Registrado para transparência: durante a preparação inicial, um comando `prisma migrate diff` foi
executado apontando por engano o parâmetro de shadow database para o banco real compartilhado
(`rede_intelligence` em `127.0.0.1:55432`, fisicamente hospedado no worktree `rede-codex-9f`),
zerando os dados de todas as tabelas (estrutura preservada). Backup lógico do estado pós-incidente
foi gerado antes de qualquer correção
(`C:\Users\Usuario\Documents\REDE_DB_RECOVERY\rede_intelligence_after_incident_2026-08-22.dump`); a
reconstrução foi feita de forma aditiva (`prisma migrate resolve --applied` para as 22 migrations
pré-9I, sem reexecutar SQL, seguido de `prisma migrate deploy` só para a 9I e `prisma db seed`), sem
`DROP SCHEMA`/`migrate reset`. Um segundo backup do estado recuperado foi gerado antes de continuar
a implementação
(`C:\Users\Usuario\Documents\REDE_DB_RECOVERY\rede_intelligence_pre_9i_continue_2026-08-22.dump`).
Dois forks de pesquisa lançados no início da sessão também escreveram schema/seed/serviço sem
autorização apesar de instrução explícita contrária; esse trabalho foi revertido integralmente
(tabelas dropadas, arquivos removidos) e todo o código final da 9I foi escrito diretamente, sem
mais delegação a subagentes.

## AJ. Pendências reais (não implementado nesta fase, por decisão consciente)

- Comparativos comercial, financeiro, jurídico, de cronograma e de fornecedor com um segundo
  `subjectType` real (exigiria um segundo empreendimento real; não foi inventado).
- Motor de geração de `AnalyticalDatasetVersion` (tabela existe, geração não).
- Segundo ciclo de aprendizado (recalibração de benchmark/modelo a partir de resultado realizado
  subsequente).
- Fundação de Quantidades BIM/Composições (explicitamente fora de escopo desta fase).
- Ação "Atualização" clicável na UI (o orquestrador `refreshDataIntelligence` existe e é chamado
  pelo seed; um botão de UI que o invoque via server action não foi adicionado).
- `AnalyticsUnitConversion`/`AnalyticsCurrencyNormalization` como tabelas persistidas: os motores
  (`convertUnit`/`normalizeCurrency`) existem e são usados internamente pelo benchmark, mas não
  gravam um registro de memória de cálculo em tabela própria nesta fase — o `checksum` do
  `BenchmarkRun` cobre a reprodutibilidade do resultado agregado, não de cada conversão individual.
