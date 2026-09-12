# Fase 9S — Contrato (Encerramento do Empreendimento, Governança e Resultado Realizado)

**Status: APROVADO com decisões definitivas — implementação concluída nesta sessão.**
Ver `docs/PHASE_9S_AUDIT_RECORD.md` para o registro de auditoria, QA e riscos residuais.

Branch: `codex/fase-9s`. HEAD-base: `f339ad0f2a9f11322a906d09f40f85e8a2db5725`. CI verde neste commit.

## Decisões definitivas do aprovador (substituem as propostas correspondentes de §14)

1. **Não** adicionar `DISSOLVED` a `CompanyStatus`. A decisão societária (manter ou
   encerrar a SPE) fica registrada exclusivamente em `LegalDecision` e nunca
   representa baixa oficial em órgão público.
2. `VIEWER` não acessa `ProjectClosureResult` nem `ProjectClosureDistribution` —
   `CLOSURE_READ` não foi adicionado à lista de capacidades de `VIEWER` em
   `src/domain/auth/read-capabilities.ts` (implementado: `VIEWER` permanece restrito
   às mesmas 4 capacidades de sempre).
3. Só `OWNER` pode solicitar reabertura — implementado em `assertReopener`
   (`closure-service.ts`). Exige justificativa (`reason`) e evidência
   (`evidenceRefs`, mínimo 1 item) pelo schema; cria nova versão vinculada
   (`supersedesId`); a linha `FINAL` anterior nunca é alterada (protegida por
   trigger, testado com SQL bruto).
4. Assistência impeditiva — implementado exatamente como especificado em
   `evaluatePostSaleImpediment` (`src/domain/closure/gates.ts`): `GARANTIA`/
   `OCORRENCIA` aberta bloqueia; qualquer categoria com SLA vencido sem resolução
   bloqueia; reincidência não resolvida bloqueia; ausência de responsável **e**
   fornecedor em chamado aberto bloqueia; custo material sem provisão bloqueia
   (limiar de `MaterialityPolicy.absoluteThreshold`; sem política ativa, qualquer
   custo > 0 é material — falha fechado); só deixa de bloquear quando
   simultaneamente há provisão ativa (`AccountingProvision`) **e**
   responsável/fornecedor **e** custo **e** prazo (`slaDueAt`) definidos.
   `OCORRENCIA`/`ASSISTENCIA` não vencidas e sem nenhuma outra condição não bloqueiam
   — só `OUTRO` foi citado explicitamente na decisão, mas o texto (`GARANTIA ou
   OCORRENCIA aberta bloqueia`) implica que as demais categorias seguem a mesma regra
   residual das genéricas; registrado aqui com honestidade por ser uma leitura
   interpretativa, não uma ambiguidade escondida.
5. `SEM_EVIDENCIA` bloqueia `FINAL` quando falta evidência para receita, custo,
   tributos, despesas financeiras, resultado ou margem — implementado em
   `missingCentralEvidence` (`src/domain/closure/result.ts`), verificado dentro da
   transação de aprovação. Despesas operacionais (`realizedExpenses`) não estão na
   lista de bloqueio explícita da decisão — entram como 0 na soma do resultado
   quando ausentes (nunca bloqueiam isoladamente), mas o campo continua marcado
   `SEM_EVIDENCIA` no snapshot, nunca escondido como se tivesse sido apurado.
6. Aportes e devoluções são registrados exclusivamente por
   `ProjectClosureDistribution` (natureza `CAPITAL_CONTRIBUTION`/`CAPITAL_RETURN`),
   exigindo beneficiário, data (`eventDate`), natureza, valor, origem (`sourceType`/
   `sourceId`) e evidência (`evidenceRefs`, mínimo 1 item) pelo schema — nenhum valor
   é inferido de nenhuma tabela existente.
7. Nomes definitivos usados em todo o código e na migration: `ProjectClosureResult`,
   `ProjectClosureDistribution`.
8. Distribuição simples implementada — sem waterfall, hurdle rate, preferência,
   catch-up ou carry. Cada linha é um beneficiário + uma natureza + um valor.

## Fontes usadas para recuperar o escopo (nenhum significado foi inventado)

- `work/master-report.txt` — seções 27, 28, 45, 46, 53 ("Fases 9R e 9S — fechamento do
  ciclo após venda e obra"): `9S - Encerramento` (medições finais, contratos, retenções,
  garantias, claims, financiamentos, recebíveis/estoque residual, arquivo permanente),
  `9S - Governança` (aportes, distribuições, waterfalls quando houver, prestação de
  contas, retorno previsto x realizado, fechamento societário/tributário), `9S - REDE
  Data` (custo, VGV, margem, TIR/ROI e forecast final previstos x realizados alimentam
  o aprendizado do próximo empreendimento).
- `docs/REDE_CAMPAIGN_CHECKPOINTS.md` — histórico completo de 9P.3A a 9R, lido
  integralmente; §"Fase 9R" confirma que 9S ainda não foi iniciada.
- `docs/PHASE_9R_CONTRACT.md` §8 (Limites entre 9R, 9S e Fase 10) — já define a
  fronteira: *"9S começa no encerramento: medições finais, retenções, garantias
  contratuais remanescentes em nível de obra/contrato (não de unidade individual),
  governança de sócios/investidores, distribuição, resultado previsto × realizado e
  arquivo permanente. 9S consome o histórico de assistência técnica da 9R (chamados
  fechados, custo real) como insumo do resultado realizado, mas não reabre o modelo de
  dados da 9R."* — este contrato honra essa fronteira integralmente.
- `docs/PHASE_9R_AUDIT_RECORD.md` — padrão de auditoria, migration aditiva com backup
  real, trigger de imutabilidade condicional, gate `APTO/PENDENTE/SEM_EVIDENCIA`,
  TOCTOU/Serializable/CAS, `correlationId` no servidor, RBAC/IDOR — todos reaproveitados
  aqui como precedente direto, não redesenhados.
- `docs/ROADMAP.md` — só confirma, em nível histórico (Fase 0-1), que "previsto x
  realizado" era fora do MVP original e amadurece nas fases 9-series (mesma leitura já
  registrada no contrato da 9R).
- `prisma/schema.prisma` (378 modelos, lido por seção) — usado para separar
  exaustivamente "o que a 9S estende" de "o que a 9S cria". Ver §5.

## 1. Definição executiva da 9S

A 9S é a fase que **fecha o ciclo do empreendimento**: depois que a 9R entregou as
unidades, implantou o condomínio e rastreou a assistência técnica, a 9S consolida o
resultado **efetivamente realizado** (nunca fabricado), fecha as pendências
operacionais/contratuais residuais, encerra o período contábil final com evidências,
decide — com aprovação humana, nunca automática — se a SPE é mantida ou encerrada,
registra a distribuição final de capital (decisão e evidência, **nunca movimentação
bancária real**) e produz um **snapshot histórico imutável** que alimenta o aprendizado
do próximo empreendimento (consumido pela Fase 10, que esta fase não implementa).

## 2. Problema de negócio resolvido

Hoje, depois da 9R, o REDE sabe que unidades foram entregues e chamados de assistência
foram tratados — mas não tem um ponto único, auditável e imutável que responda: *"este
empreendimento terminou — qual foi o resultado real, o que ainda está pendente, quem
aprovou o encerramento e o que ficou registrado para o próximo empreendimento
aprender?"* Sem isso, o REDE Data (9I) nunca tem um "realizado final" definitivo para
comparar com o "previsto" aprovado no início (`FinancialResult`), e a governança de
sócios/investidores não tem onde registrar a prestação de contas final.

## 3. Usuários e departamentos envolvidos

| Perfil | Uso principal |
|---|---|
| Diretoria/Sócios (Governança) | Aprova o encerramento final, a decisão sobre a SPE e a distribuição |
| Contabilidade/Controladoria (9G) | Fecha o período contábil final, registra provisões e saldos residuais |
| Jurídico (9D) | Conduz o checklist de encerramento societário/fiscal, registra decisão |
| Financeiro/Tesouraria (9B) | Confirma recebíveis/estoque residual, inadimplência, funding quitado |
| Comercial/Pós-venda (9R) | Confirma entregas, condomínio implantado, assistência sem pendência impeditiva |
| Engenharia/Obra (9C) | Confirma contratos/medições/retenções/garantias de obra encerrados |
| Investimento/Capital (9N) | Referencia o `InvestmentCase`/`FinancialResult` aprovados como "previsto" |
| Gestão Executiva (9K.2/9K.3) | Vê o gate de encerramento e exceções derivadas, sem nova tabela |
| Fase 10 (futura, não implementada aqui) | Consumirá o snapshot final como insumo de leitura |

## 4. Mapeamento do domínio existente (obrigatório antes de propor qualquer entidade nova)

Pesquisa feita por leitura direta do schema (378 modelos) e dos serviços de aplicação
de `accounting`, `capital`, `investment`, `legal`, `handover`, `executive` e
`data-intelligence`. Resumo por área:

### 4.1 Contábil (9G) — quase tudo já existe, reaproveitado sem alteração

- **`AccountingPeriod`** já tem uma máquina de estados completa de fechamento/reabertura:
  `status` (`OPEN/UNDER_REVIEW/CLOSED/REOPENED/ADJUSTMENT`), `closedById/closedAt`,
  `reopenedById/reopenedAt/reopeningReason` (segregação de função — quem reabre não pode
  ser quem fechou), `checklistSnapshot` (Json), `closeChecksum`. Serviço
  `closeAccountingPeriod`/`reopenAccountingPeriod`
  (`src/application/accounting/accounting-service.ts`) já bloqueia fechamento com
  eventos não classificados ou divergência material, exige checklist de 8 itens, grava
  `LedgerSnapshot` + `AuditLog`, tudo em uma transação. **A 9S não reabre nem duplica
  esse mecanismo — o "encerramento contábil" da 9S consome o(s) último(s)
  `AccountingPeriod` do(s) `Company` do empreendimento já em `CLOSED` como pré-condição
  do gate, mais `FinancialPeriodClosure` (fechamento mensal de tesouraria, 9B) no mesmo
  papel.**
- **`AccountingProvision`** (status `ACTIVE/REVERSED/SETTLED`, `evidence` Json,
  `confidence`) — reaproveitado diretamente para "provisões" do resultado final.
- **`RevenueRecognitionRun`/`RevenueRecognitionLine`** — já calcula, por projeto e por
  `cutoffDate`, `recognizedRevenue`/`recognizedCost`/margem por `SalesContract`,
  versionado e checksummado. **É a fonte oficial de receita/custo realizados** — a 9S
  lê a última run (ou pede uma nova com `cutoffDate` = data de encerramento), nunca
  recalcula por fora.
- **`TaxAssessment`/`TaxObligationLink`/`FiscalDocumentReference`** — tributos e
  obrigações fiscais já rastreados; reaproveitados para "tributos" e para o checklist
  fiscal do encerramento societário.
- **`ConsolidatedBalanceSnapshot`** (via `ConsolidationRun`) — se a SPE tiver relações
  intercompany, é a fonte de saldo consolidado; secundária, não obrigatória.
- **Gap real confirmado**: nenhuma tabela `accounting_*` tem trigger de imutabilidade
  no banco hoje (só proteção de aplicação) — mesma classe de achado que a 9R corrigiu
  para `BankFinancingDisbursement`/`CondominiumSetup`. Fora do escopo desta fase corrigir
  isso retroativamente; a 9S só garante que **as tabelas que ela cria** já nascem
  protegidas (ver §10).

### 4.2 Investimento/Capital/Funding (9N) — gap real e confirmado para distribuição

- `InvestmentCase` (+ satélites `CommitteeDecision`, `InvestmentCondition`,
  `DecisionLedgerEntry`) é um workflow de decisão **pré-investimento** (DRAFT →
  APROVADO/REJEITADO), sem estado pós-aprovação de "realizado"/"encerrado".
  `DecisionLedgerEntry` (título, decisão, racional, `evidenceRefs`) é reaproveitável
  como parte da trilha de "decisões relevantes" do snapshot histórico (§4.6).
- `InvestmentStakeholder` **não é** um investidor/sócio com capital — é um registro de
  mapeamento de stakeholder (nome, influência, interesse, plano de engajamento; ex.:
  "Prefeitura"). Não serve para distribuição.
- `DealStructure.capitalStack`/`sourcesAndUses` é um **JSON congelado da fase
  pré-investimento** (estrutura de capital candidata, com `isSelected`) — útil só como
  referência do que foi *planejado*, nunca como livro-razão vivo por investidor.
- `FundingProposal`/`FundingDisbursement`/... é **dívida bancária** (9N), não capital
  próprio — `FundingDisbursement.actualAmount` é deliberadamente só um cache de uma
  `BankTransaction` já `RECONCILED` (nunca fonte primária). Reaproveitado para "funding"
  no resultado final (soma de desembolsos conciliados), nunca para "aportes".
- **Gap real confirmado, sem exceção**: não existe, em nenhum lugar do schema,
  qualquer conceito de investidor/sócio/cotista com aporte de capital próprio, retorno
  ou distribuição. Isso é o que motiva a única entidade nova de fato "de negócio" desta
  fase (§5).

### 4.3 Jurídico (9D) — quase tudo já existe para o checklist de encerramento

- `LegalDueDiligenceCase` (`status: DRAFT/IN_PROGRESS/UNDER_REVIEW/COMPLETED/
  SUPERSEDED/CANCELLED`) com filhos `LegalChecklistItem`, `LegalDocumentRequest`,
  `LegalFinding`, `LegalDecision` — **reaproveitado integralmente** como o container do
  checklist de encerramento societário (não existe `caseType` para diferenciar de uma
  due diligence de aquisição de terreno; será diferenciado por convenção de `code`,
  ex.: `SPE-ENCERRAMENTO-<projectId>`, sem alteração de schema).
- `LegalChecklistItem` (`status: NOT_STARTED…COMPLIANT/NON_COMPLIANT/WAIVED/RESOLVED/
  CANCELLED`) — itens do checklist fiscal/societário, reaproveitado sem alteração.
- `LegalDocumentRequest` — já é a forma de "certidão"/documento solicitado e recebido
  (CND, certidão negativa etc.) — reaproveitado sem alteração.
- `LegalDecision` (`decision: PROCEED/PROCEED_WITH_CONDITIONS/HOLD/DO_NOT_PROCEED/
  INSUFFICIENT_EVIDENCE`, `findingSnapshot`, `decidedById/decidedAt`) — reaproveitado
  como o registro formal da decisão humana sobre manter ou encerrar a SPE (semântica
  "PROCEED" lida como "aprova o resultado do checklist e a decisão tomada", não como
  "prosseguir com um novo negócio" — documentado explicitamente no uso, sem alterar o
  enum).
- `LegalObligation` (`status: DRAFT/ACTIVE/DUE_SOON/OVERDUE/FULFILLED/WAIVED/
  CANCELLED`) — já tem estados terminais; o gate de encerramento conta qualquer
  obrigação do projeto **fora** de `{FULFILLED, WAIVED, CANCELLED}` como bloqueante,
  sem alteração de schema.
- `Company.status` (`ACTIVE/INACTIVE/ARCHIVED`) — **não tem estado de dissolução**.
  Ver §14 (decisão pendente) sobre se isso deve virar um novo valor de enum ou
  permanecer só como registro em `LegalDecision`, sem tocar `Company`.

### 4.4 Comercial/9R — insumo, não reabertura

- `SalesUnit.status = ENTREGUE`, `CondominiumSetup.status IN (IMPLEMENTED, CANCELLED)`,
  `PostSaleRequest.status` terminal (`RESOLVED`/`CLOSED`), `BankFinancingDisbursement.
  status = RECONCILED` — todos já existem e já são estados terminais protegidos por
  trigger de imutabilidade (9R). O gate operacional da 9S **lê** esses estados por
  `projectId`, nunca os altera.

### 4.5 Engenharia/Suprimentos (9C) — insumo para "medições finais, retenções, garantias"

- `OperationalContract.status`, `MeasurementCertificate`, `ContractAdvance`,
  `AdvanceAmortization`, `LegalGuarantee`/`LegalContractCondition` (ligados a
  `OperationalContract`) — já modelam medição final, adiantamento amortizado e garantia
  contratual. O gate de encerramento lê `OperationalContract`s do projeto sem status
  terminal como bloqueantes; nenhuma alteração de schema.

### 4.6 Previsto × Realizado e memória histórica — mecanismo já existe, não será duplicado

- **`ForecastEvaluation`** (9I) já é o motor genérico de previsto × realizado:
  `predictedValue`/`actualValue`, `absoluteError`/`percentError`, `bias`,
  `forecastSourceType/Id` + `actualSourceType/Id` (evidência de origem), por
  `MetricDefinition`. Produtor hoje: `evaluateForecasts()`
  (`src/application/data-intelligence/data-intelligence-service.ts`), só para
  `"desvio_contratual"`. **A 9S registra novos `MetricDefinition` (receita realizada,
  custo realizado, margem, TIR, ROI) e popula `ForecastEvaluation` pelo mesmo padrão de
  upsert já usado — nunca cria uma segunda tabela de desvio.**
- **`FinancialResult`** (ligado a `CalculationRun` aprovado) é o lado **previsto**:
  `vgv, netRevenue, totalCost, profit, marginOnVgv, marginOnNetRevenue, roi,
  annualIrr, npv, paybackMonth, equityCapitalRequired, fundingNeed, breakEvenVgv`. A
  nova entidade de resultado realizado (§5) espelha deliberadamente esse formato de
  campos para permitir comparação direta 1:1, sem transformação.
  **`ActualEntry` existe no schema mas está morto — zero uso em `src/` — não será
  usado como base.**
  **`PortfolioSnapshot`** existe (rollup por portfólio) — fora do escopo desta fase
  (9S é por empreendimento), citado só para não ser confundido com o snapshot da 9S.
- **`AssumptionSnapshot`** (premissas aprovadas, ligado a `StudyVersion`) e
  **`DecisionLedgerEntry`**/`CommitteeDecision`/`LegalDecision` (decisões relevantes) —
  já existem e são referenciados (nunca duplicados) pelo snapshot histórico final.
- **`ExecutiveException`** (`src/domain/workspace/exceptions.ts`) é um **read model
  derivado, nunca persistido** — confirma que exceções/pendências de encerramento
  também devem ser derivadas em runtime a partir dos gates, nunca uma tabela nova só
  para "pendências de encerramento".
- **Padrão de gate a copiar, não redesenhar**: `src/domain/handover/gates.ts` (9R) —
  `GateStatus = "APTO" | "PENDENTE" | "SEM_EVIDENCIA"`, cada subgate retorna
  `{status, reason, snapshot: {só ids seguros}}`, um agregador combina N subgates em
  `overall: "APTO" | "BLOQUEADO"`. A 9S usa exatamente essa forma para seu próprio gate
  de encerramento (§7), com subgates operacional/jurídico/financeiro/contábil.

## 5. Entidades novas propostas — só 2, cada uma com lacuna genuína confirmada

Depois do mapeamento acima, restam exatamente **duas** lacunas reais que nenhuma
combinação de modelos existentes cobre:

| Entidade nova | Por que é genuinamente necessária |
|---|---|
| **`ProjectClosureResult`** | Não existe hoje nenhum snapshot imutável, versionado, por projeto, que consolide o resultado **realizado** final (espelhando os campos de `FinancialResult`) junto com a memória histórica (referências a premissas, decisões, desvios, riscos materializados, lições aprendidas). `ForecastEvaluation` cobre o desvio *por métrica*, não o pacote consolidado; `RevenueRecognitionRun` cobre só receita/custo/margem, não o resultado final completo com tributos/funding/provisões/distratos/inadimplência. |
| **`ProjectClosureDistribution`** | Confirmado pela pesquisa: não existe **nenhum** modelo de investidor/sócio/cotista, aporte, retorno de capital ou distribuição em todo o schema. É o único jeito de cumprir o item 5 do escopo ("capital aportado, retorno, remuneração, distribuição, beneficiários autorizados, aprovação, evidência — sem movimentar dinheiro real") sem inventar uma contabilidade paralela. |

Nenhuma outra entidade nova é proposta. Especificamente, **não** serão criadas: uma
tabela de "checklist de encerramento" (reaproveita `LegalDueDiligenceCase` +
`LegalChecklistItem`), uma tabela de "exceção de encerramento" (derivada, como
`ExecutiveException`), uma tabela de "decisão de encerramento" separada (reaproveita
`LegalDecision`), uma segunda tabela de previsto × realizado (reaproveita
`ForecastEvaluation`).

### 5.1 `ProjectClosureResult` (campos propostos, nomes sujeitos a ajuste na implementação)

- Identidade: `id`, `organizationId`, `projectId`, `version` (int), `supersedesId`
  (self-relation, nulo na primeira versão — nunca sobrescreve a anterior).
- `status`: `DRAFT` → `FINAL` (terminal, imutável por trigger) — nunca volta a `DRAFT`;
  uma reabertura cria uma **nova linha** com `version + 1` e `supersedesId` apontando
  para a `FINAL` anterior (§8).
- Resultado realizado (todos `Decimal?` — nulo é **sempre** "sem evidência", nunca
  fica implícito como zero em nenhuma soma):
  `realizedVgv, realizedRevenue, realizedCost, realizedExpenses, realizedTaxes,
  realizedFinancialCosts, realizedFundingDisbursed, realizedCapitalContributed,
  realizedRefunds` (devoluções), `realizedRescissions` (distratos, em valor e
  contagem), `realizedDelinquency` (inadimplência), `realizedProvisions,
  realizedResult, realizedMarginOnVgv, realizedMarginOnNetRevenue, realizedRoi,
  realizedIrr`.
- `evidenceStatus: Json` — mapa campo → `{status: "COM_EVIDENCIA"|"SEM_EVIDENCIA",
  sourceType, sourceId, asOfDate}` para cada um dos campos acima — nenhum valor entra
  no documento sem essa contraparte.
- Referências (nunca duplicação de conteúdo): `revenueRecognitionRunId`,
  `financialResultId` (o `CalculationRun` previsto aprovado), `forecastEvaluationIds:
  Json` (lista dos `ForecastEvaluation` gerados para este fechamento),
  `accountingPeriodIds: Json`, `assumptionSnapshotId`, `decisionRefs: Json`
  (`DecisionLedgerEntry`/`CommitteeDecision`/`LegalDecision` relevantes),
  `materializedRiskRefs: Json` (`RiskFinding` ids com desfecho real anotado),
  `auditLogMilestoneIds: Json` (cronologia — referências, nunca conteúdo bruto de
  `AuditLog`).
- Memória qualitativa (texto humano, nunca gerado por IA nesta fase):
  `keyDeviationsNotes`, `lessonsLearned` — ambos opcionais, nunca obrigatórios para
  `FINAL` (ausência é "sem evidência qualitativa", não bloqueia o fechamento por si só
  — decisão a confirmar em §14).
- Auditoria: `correlationId`, `createdById/At`, `approvedById/At`.

### 5.2 `ProjectClosureDistribution` (uma linha por beneficiário por evento de distribuição)

- Identidade: `id`, `organizationId`, `projectId`, `closureResultId` (aponta para a
  versão do `ProjectClosureResult` — `DRAFT` ou `FINAL` — vigente no momento do
  registro; **correção pós-reauditoria REPROVADA, ver seção ao final deste
  documento**: a redação original desta linha dizia "FINAL que a originou", o que
  nunca correspondeu à implementação real, que sempre permitiu `DRAFT` também. O
  que muda com a correção não é essa permissão — é que, a partir da primeira
  distribuição `APPROVED` contra um `DRAFT`, essa versão fica congelada: não pode
  mais ser recalculada, só substituída por uma nova versão formal via
  `reopenProjectClosureResult`).
- Beneficiário (sem entidade "Investidor" nova — capturado diretamente, já que cada
  linha é por beneficiário): `beneficiaryName`, `beneficiaryTaxId`,
  `beneficiaryType` (`OWNER`/`PARTNER`/`INVESTOR`).
- Valores (`Decimal?`, mesma política de "sem evidência" do §5.1):
  `capitalContributed` (aporte), `capitalReturned` (retorno de capital),
  `remuneration`, `resultDistributed`, `amountRetained`, `provisionAmount`.
- `status`: `DRAFT` → `APPROVED` (terminal, imutável) — nenhuma transferência bancária
  é disparada; isso é só o registro da decisão e da evidência.
- Evidência: `evidenceRefs: Json` (referências a documentos já armazenados via o
  `StorageProvider` genérico já usado por 9K.4B/9R — nunca um novo mecanismo de
  upload).
- Auditoria: `correlationId`, `createdById/At`, `approvedById/At`.

## 6. Estados e transições

### 6.1 `Project.status` — um novo valor terminal, reaproveitando o enum existente

`DRAFT → UNDER_REVIEW → APPROVED → PAUSED/ARCHIVED` (já existentes) ganham um novo
valor terminal **`CLOSED`**, atingido só quando o `ProjectClosureResult` corrente
chega a `FINAL` **e** o gate de encerramento (§7) está `APTO`. Uma reabertura formal
(§8) move o projeto de volta a `UNDER_REVIEW` (reaproveitado, sem novo valor de enum)
enquanto a nova versão do `ProjectClosureResult` está em `DRAFT`.

### 6.2 `ProjectClosureResult.status`

`DRAFT` (em preparação, pode ser recalculado livremente) → `FINAL` (aprovado,
imutável). Nunca `FINAL → DRAFT`. Reabertura sempre cria uma linha nova.

### 6.3 `ProjectClosureDistribution.status`

`DRAFT` → `APPROVED` (imutável). Sem estado de "executado"/"pago" nesta fase — a 9S
não movimenta dinheiro (fronteira explícita, §12).

## 7. Gate de encerramento operacional — função pura, mesmo formato da 9R

Novo módulo `src/domain/closure/gates.ts` (pura, sem banco), espelhando
`src/domain/handover/gates.ts`:

```
type GateStatus = "APTO" | "PENDENTE" | "SEM_EVIDENCIA"
```

Subgates propostos, cada um lendo fatos já existentes (nenhum novo dado é criado só
para o gate):

1. **Operacional/Entrega (9R)** — todas as `SalesUnit` do projeto em `ENTREGUE` ou
   estado terminal aceitável; `CondominiumSetup` (quando existir) em `IMPLEMENTED` ou
   `CANCELLED`; nenhum `PostSaleRequest` impeditivo aberto (definição de "impeditivo"
   a confirmar em §14 — proposta: categoria `GARANTIA` sem `RESOLVED`/`CLOSED`, ou
   qualquer chamado com SLA vencido não tratado).
2. **Contratual/Obra (9C)** — nenhum `OperationalContract` do projeto em status
   não-terminal sem justificativa/provisão associada; garantias contratuais
   (`LegalGuarantee`) sem prazo residual bloqueante.
3. **Jurídico (9D)** — nenhuma `LegalObligation` do projeto fora de
   `{FULFILLED, WAIVED, CANCELLED}`; checklist de encerramento societário
   (`LegalDueDiligenceCase` code `SPE-ENCERRAMENTO-*`) em `COMPLETED` com
   `LegalDecision` registrada.
4. **Financeiro (9B)** — nenhuma `ReceivableInstallment`/`PayableInstallment`
   vencida sem provisão ou renegociação; `FundingDisbursement`s do projeto todos
   `RECONCILED` ou `CANCELLED`.
5. **Contábil (9G)** — os `AccountingPeriod`/`FinancialPeriodClosure` relevantes do(s)
   `Company` do projeto em `CLOSED`.

`overall: "APTO" | "BLOQUEADO"` exige os 5 subgates `APTO` — ausência de evidência em
qualquer subgate é `SEM_EVIDENCIA`, nunca tratada como aprovação (mesma convenção já
usada em 9I/9M/9K.4A/9R). O snapshot completo é gravado no `AuditLog` da transição
(`PROJECT_CLOSURE_EVALUATED`/`PROJECT_CLOSED`), nunca numa tabela própria.

## 8. Fórmulas do resultado final (nível de contrato — origem dos dados, não código)

| Campo | Fonte | Regra de "sem evidência" |
|---|---|---|
| `realizedRevenue`/`realizedCost` | Última `RevenueRecognitionRun` do projeto (`cutoffDate` = data de encerramento) | Nenhuma run → `SEM_EVIDENCIA`, nunca 0 |
| `realizedExpenses`/`realizedTaxes` | Saldos da(s) `LedgerSnapshot` (trial balance de fechamento) filtrados por categoria de despesa/tributo em `LedgerAccount` | Período não fechado → `SEM_EVIDENCIA` |
| `realizedFinancialCosts` | `FundingFinancialEvent` (juros/tarifas) reconciliados | — |
| `realizedFundingDisbursed` | Soma de `FundingDisbursement.actualAmount` só quando `status = RECONCILED` (nunca o cache sem checar) | — |
| `realizedCapitalContributed`/`realizedRefunds` | **Sem fonte de fato dedicada hoje** — primeiro registro formal vem do próprio `ProjectClosureDistribution`, com evidência documental anexada; não é derivável retroativamente de nenhuma tabela existente sem leitura humana de `BankTransaction`/`ReconciliationMatch` já conciliados | Decisão pendente — ver §14 |
| `realizedRescissions` | Contagem/soma de `Sale` com status de distrato/rescisão do projeto | — |
| `realizedDelinquency` | `ReceivableInstallment` vencida não recebida na data de corte | — |
| `realizedProvisions` | Soma de `AccountingProvision.amount` com `status = ACTIVE` do projeto | — |
| `realizedResult`/margens | `realizedRevenue − realizedCost − realizedExpenses − realizedTaxes − realizedFinancialCosts` (± ajustes documentados); margem = resultado / VGV realizado | Qualquer componente `SEM_EVIDENCIA` torna o agregado `SEM_EVIDENCIA` (ou `PARCIAL`, a confirmar §14) — nunca soma com 0 implícito |
| `realizedRoi`/`realizedIrr` | Mesmo motor de cálculo já usado para o previsto (`src/domain/capital/` — a confirmar o módulo exato na implementação), alimentado com o fluxo de caixa realizado (`ReceivableInstallment`/`PayableInstallment`/`FundingDisbursement` reais) em vez do projetado | Fluxo incompleto → `SEM_EVIDENCIA` |

Comparação previsto × realizado: para cada métrica acima com um par previsto
(`FinancialResult`), a 9S registra/atualiza um `MetricDefinition` + `ForecastEvaluation`
(§4.6) — `absoluteError`/`percentError` calculados pelo mecanismo já existente, nunca
recalculados em paralelo.

## 9. Política de "sem evidência" e provisões

- Nenhum campo monetário do resultado final é preenchido com `0` na ausência de dado —
  é `null` + `evidenceStatus["<campo>"] = "SEM_EVIDENCIA"`.
- Nenhum agregado (resultado final, margem) é calculado silenciosamente ignorando um
  componente ausente — o agregado herda o pior status de evidência dos componentes que
  usa.
- Provisões (`AccountingProvision`) cobrem incerteza conhecida (ex.: passivo
  contingente) — não substituem "sem evidência"; um valor provisionado é
  `COM_EVIDENCIA` (a provisão *é* a evidência), um valor simplesmente não apurado é
  `SEM_EVIDENCIA`.

## 10. Workflow de aprovação e reabertura

**Fechamento**: gate `APTO` (§7) → `ANALYST`/`ADMIN`/`OWNER` prepara o
`ProjectClosureResult` em `DRAFT` (popula a partir dos fatos reais, nunca digitado à
mão) → um segundo aprovador (`OWNER`/`ADMIN`, diferente de quem preparou — mesma
segregação de função já usada em `reopenAccountingPeriod`) aprova → `status = FINAL`
dentro de uma transação `Serializable` que também transiciona `Project.status =
CLOSED` e grava o `AuditLog` com o snapshot completo do gate — mesmo padrão CAS +
`correlationId` gerado no servidor + `before`/`after` já corrigido na reauditoria da
9R (nunca reaberto ou enfraquecido aqui).

**Reabertura**: exige papel elevado (`OWNER`, proposta — confirmar em §14) + motivo
obrigatório → cria uma **nova linha** de `ProjectClosureResult` (`version + 1`,
`supersedesId` = id da `FINAL` anterior) em `DRAFT` → `Project.status` volta a
`UNDER_REVIEW` → o ciclo de fechamento se repete. A linha `FINAL` anterior nunca é
alterada (protegida por trigger, §11) — só existe uma linha "atual" por ser a de maior
`version`, nunca por sobrescrita.

**`ProjectClosureDistribution`**: mesmo padrão — `DRAFT → APPROVED` com aprovador
diferente de quem preparou; uma distribuição errada nunca é editada, é corrigida por
uma nova linha (com referência à anterior via `evidenceRefs`/nota, a detalhar na
implementação).

## 11. RBAC e isolamento por organização

Mesmo princípio já vigente: nenhuma capacidade concedida implicitamente por papel
elevado; toda query filtrada por `organizationId` do contexto autenticado; IDOR
indistinguível (mensagem idêntica para inexistente vs. de outro tenant, mesmo padrão
`findFirst({id, organizationId})` já usado em toda a plataforma).

| Ação | OWNER | ADMIN | ANALYST | REVIEWER | VIEWER |
|---|---|---|---|---|---|
| Ver gate/preview de encerramento (`CLOSURE_READ`) | ✅ | ✅ | ✅ | ✅ | ❌ (decisão 2) |
| Preparar `ProjectClosureResult` (DRAFT) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Aprovar `ProjectClosureResult` (FINAL) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Reabrir encerramento | ✅ | ❌ (decisão 3 — só OWNER) | ❌ | ❌ | ❌ |
| Registrar decisão sobre a SPE | ✅ | ✅ (via `LegalDecision`, mesma regra da 9D) | ❌ | ❌ | ❌ |
| Preparar `ProjectClosureDistribution` (DRAFT) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Aprovar distribuição (APPROVED) | ✅ | ✅ | ❌ | ❌ | ❌ |

Implementado exatamente assim — mais restritiva que a matriz da 9R (nenhuma ação de
escrita para `REVIEWER`, aprovação final concentrada em `OWNER`/`ADMIN`, reabertura
só `OWNER`) — dado que encerramento/distribuição é decisão de maior consequência e
menor frequência que operações comerciais do dia a dia. Segregação de função também
implementada e testada: quem prepara/registra não pode ser quem aprova (mesma pessoa
recusada explicitamente em `approveProjectClosureResult`/
`approveProjectClosureDistribution`).

## 12. Imutabilidade

- `ProjectClosureResult`: trigger condicional a `OLD.status = 'FINAL'` (mesmo padrão
  da migration `20260910151500_phase_9r_structural_immutability`) — bloqueia
  `UPDATE`/`DELETE` só depois de `FINAL`, permite toda transição legítima antes;
  `TRUNCATE` bloqueado incondicionalmente.
- `ProjectClosureDistribution`: mesmo padrão, condicional a `OLD.status = 'APPROVED'`.
- Nenhuma exclusão física de evidência (`evidenceRefs`, documentos no
  `StorageProvider`) uma vez referenciada por uma linha `FINAL`/`APPROVED`.
- Nenhuma alteração retroativa do resultado final — corrigido só por nova versão
  (§6, §10), nunca por `UPDATE` na linha existente, nem por trigger nem por regra de
  aplicação.

## 13. Fronteira com a Fase 10

A 9S **produz** o `ProjectClosureResult` como snapshot de leitura; **não implementa**
IA, agentes, AI Gateway, Autopilot, recomendação cognitiva ou geração automática de
"lições aprendidas" — esse campo é texto humano opcional nesta fase. Um agente futuro
da Fase 10 poderá *ler* o snapshot (como lê qualquer outro domínio hoje), nunca
gravar nele nem alterar seu conteúdo — o snapshot já é imutável por trigger antes de
qualquer capacidade de Fase 10 existir.

## 14. Riscos e decisões humanas — histórico da proposta original (todas resolvidas, ver "Decisões definitivas" no topo)

As 8 decisões abaixo foram todas respondidas pelo aprovador e estão implementadas —
preservadas aqui como registro histórico do que foi perguntado, não como pendência.

1. **`Company.status = DISSOLVED`?** Recomendo **não** adicionar esse valor de enum —
   o sistema nunca declara baixa real de SPE em órgão público (regra explícita sua), e
   um campo `DISSOLVED` no banco pode ser mal interpretado por qualquer leitura futura
   como "a SPE não existe mais legalmente". Alternativa proposta: manter
   `Company.status` intocado; a decisão "manter" ou "encerrar" a SPE fica só registrada
   em `LegalDecision` (`decision` + `executiveConclusion`), com o texto deixando
   explícito que é uma recomendação/registro interno, não um ato societário real.
   **Decisão sua.**
2. **VIEWER pode ler o resultado final/distribuição?** Dado que envolve valores de
   distribuição a sócios/investidores (dado sensível), proponho VIEWER **sem** acesso
   de leitura a `ProjectClosureDistribution` por padrão, com acesso de leitura ao
   `ProjectClosureResult` (resultado consolidado, sem o detalhamento por beneficiário)
   condicionado a uma capacidade nova (`CLOSURE_READ`) que a matriz de
   `ProtectedReadCapability` hoje **não** concede a VIEWER por padrão (só
   `VIABILITY_READ`/`MARKET_PRODUCT_READ`/`ECOSYSTEM_READ`/`HELP_READ`). **Decisão
   sua**: adiciono `CLOSURE_READ` à lista de VIEWER, ou mantenho fora (só
   OWNER/ADMIN/ANALYST/REVIEWER leem)?
3. **`ADMIN` pode reabrir um encerramento `FINAL`, ou só `OWNER`?** Proposta acima:
   só `OWNER`, dado o peso da ação (reverte um estado terminal aprovado). **Decisão
   sua.**
4. **O que conta como "assistência técnica impeditiva"** (item 1 do escopo) —
   proposta: categoria `GARANTIA` sem `RESOLVED`/`CLOSED`, ou qualquer chamado com SLA
   vencido não tratado. Categorias `OCORRENCIA`/`OUTRO` bloqueiam ou só geram alerta
   informativo? **Decisão sua.**
5. **Um componente `SEM_EVIDENCIA` no resultado final bloqueia o fechamento, ou
   permite `FINAL` com o campo marcado como tal?** O escopo diz "ausência de dado deve
   aparecer como sem evidência, nunca como zero" — isso permite *aparecer* assim
   dentro de um resultado `FINAL`, ou exige que todo campo tenha evidência antes de
   `FINAL` ser permitido? Proposta: campos financeiros centrais (receita, custo,
   resultado) **bloqueiam** `FINAL` se `SEM_EVIDENCIA`; campos qualitativos
   (`lessonsLearned`) não bloqueiam. **Decisão sua** sobre onde exatamente traçar essa
   linha campo a campo.
6. **`realizedCapitalContributed`/`realizedRefunds` sem fonte de fato dedicada** (§8)
   — aceito registrar isso só a partir do próprio evento de distribuição (primeira vez
   que esse dado passa a existir no sistema), ou isso é um bloqueador que exige uma
   fonte de dados melhor antes de prosseguir? **Decisão sua.**
7. **Nome definitivo das duas entidades novas** — `ProjectClosureResult`/
   `ProjectClosureDistribution` são propostas, como `BankFinancingRelease` foi proposto
   e depois renomeado para `BankFinancingDisbursement` na 9R. **Decisão sua** antes de
   qualquer migration.
8. **Risco de escopo "waterfall"**: o relatório mestre diz "distribuições, waterfalls
   quando houver" — esta proposta cobre uma distribuição simples (aporte/retorno/
   remuneração/resultado por beneficiário), não uma estrutura de waterfall em camadas
   (hurdle rate, preferência, catch-up, carry). Se um piloto real exigir waterfall
   completo, é uma extensão de escopo, não implementada aqui. **Confirmar que isso é
   aceitável para esta rodada.**

## 15. Necessidade de migration

**Sim**, quando a implementação for aprovada: 2 tabelas novas
(`ProjectClosureResult`, `ProjectClosureDistribution`) + 1 valor novo em
`ProjectStatus` (`CLOSED`) +, dependendo da decisão do item 1 de §14, possivelmente
nada em `CompanyStatus`. **Nenhuma migration é criada nesta etapa.** Quando aprovada:

1. Backup real de dev **e** teste (mesmo padrão de
   `scripts/backup-local-database.mjs`), restaurado e validado em banco isolado,
   **antes** de qualquer `prisma migrate dev`/`deploy`.
2. Migration aditiva única (ou aditiva + uma segunda para os triggers de
   imutabilidade, seguindo exatamente o precedente da correção pós-reauditoria da 9R
   — `20260910131423` + `20260910151500`).
3. Proibido `migrate reset`, `DROP`, banco principal como shadow, ou edição de
   migration antiga.

## 16. Estratégia de testes adversariais (planejados para a implementação)

- Gate nunca retorna `APTO` com qualquer subgate `PENDENTE`/`SEM_EVIDENCIA`.
- Fechamento recusado com: `PostSaleRequest` impeditivo aberto; `CondominiumSetup` não
  terminal; `OperationalContract` não terminal sem provisão; `LegalObligation` fora
  dos estados terminais; `AccountingPeriod`/`FinancialPeriodClosure` não `CLOSED`;
  `FundingDisbursement` não `RECONCILED`/`CANCELLED`.
- TOCTOU/concorrência real (`Promise.all`, sem mocks) no fechamento — mesmo padrão
  `Serializable`+CAS+retry limitado da correção de `markUnitDelivered` na 9R;
  exatamente 1 `AuditLog` de fechamento mesmo sob chamadas simultâneas.
- Reabertura nunca sobrescreve a linha `FINAL` anterior — verificado por trigger e por
  tentativa direta de `UPDATE`/SQL bruto.
- IDOR: `ProjectClosureResult`/`Distribution` de outra organização recusados com a
  mesma mensagem de "não encontrado".
- VIEWER (e, conforme decisão de §14, `REVIEWER`) sem nenhuma mutação possível.
- Nenhum campo monetário do resultado final aparece como `0` quando a fonte real está
  ausente — teste direto com fixture sem `RevenueRecognitionRun`.
- Nenhuma chamada de rede/API externa em todo o código novo (mesmo teste
  arquitetural por `grep` já usado na 9R).
- Teste arquitetural: nenhum modelo novo fora de `ProjectClosureResult`/
  `ProjectClosureDistribution`; nenhuma escrita direta em `LegalObligation`/
  `AccountingPeriod`/`SalesUnit`/`CondominiumSetup` fora dos serviços que já os
  possuem (mesmo padrão de "sem domínio paralelo" da 9R).
- `TRUNCATE`/SQL bruto bloqueado nas duas tabelas novas após o estado terminal.

## 17. Encerramento desta etapa

**Status (2026-09-11)**: aprovado pelo usuário com as 8 decisões definitivas
registradas no topo deste documento e implementado integralmente sem exceder o
escopo aqui descrito — 2 entidades novas (`ProjectClosureResult`,
`ProjectClosureDistribution`), 1 valor novo em `ProjectStatus` (`CLOSED`), nenhuma
alteração em `CompanyStatus`. Detalhe completo de implementação, QA e auditoria
adversarial própria em `docs/PHASE_9S_AUDIT_RECORD.md`.

## 18. Correção pós-reauditoria REPROVADA

Uma auditoria adversarial independente reprovou a entrega descrita nas seções
1-17 (1 Bloqueador, 2 Altos, 2 Médios). O detalhe causa/correção/teste de cada
achado está em `docs/PHASE_9S_AUDIT_RECORD.md`, seção 8. Esta seção só registra,
de forma centralizada, os pontos em que a redação original deste contrato (acima)
não correspondia à implementação real e como cada critério passa a ser interpretado
depois da correção — nenhum texto das seções 1-17 foi apagado ou reescrito.

- **§4.5/§5.3 (checklist de encerramento societário "COMPLETED com LegalDecision
  registrada")** — essa frase, tomada literalmente, é exatamente a lacuna que
  produziu o achado Bloqueador: bastava *existir* uma decisão, de qualquer valor,
  para o gate liberar. A partir desta correção, o critério real e completo é:
  - `LegalDueDiligenceCase.status === "COMPLETED"`;
  - todo `LegalChecklistItem` e `LegalDocumentRequest` do caso em um estado
    terminal-bom (`COMPLIANT`/`WAIVED`/`RESOLVED`/`CANCELLED` — mesmo enum
    `LegalItemStatus` para os dois);
  - a `LegalDecision` de maior `version` do caso deve ser `PROCEED`, ou
    `PROCEED_WITH_CONDITIONS` com toda entrada de `conditions` marcada
    `resolved: true` (convenção documentada em `PHASE_9S_AUDIT_RECORD.md` §8.1,
    já que `conditions` é `Json` livre sem campo estrutural de resolução);
  - `HOLD`/`DO_NOT_PROCEED` bloqueiam (`PENDENTE`); `INSUFFICIENT_EVIDENCE` ou
    ausência de decisão vira `SEM_EVIDENCIA`, nunca aprovação.
- **§4.2 ("encerramento contábil... consome o(s) último(s) `AccountingPeriod`...
  já em `CLOSED` como pré-condição")** — passa a exigir também o `LedgerSnapshot`
  (`CLOSING_TRIAL_BALANCE`) de fechamento com `checksum` igual ao
  `AccountingPeriod.closeChecksum` — o período `CLOSED` sozinho não basta mais como
  evidência (achado Médio, `PHASE_9S_AUDIT_RECORD.md` §8.3).
- **§4.6/§5.1 (`financialResultId`/`forecastEvaluationIds`/`ForecastEvaluation`/
  `FinancialResult`)** — descreviam a intenção corretamente, mas nunca foram
  implementados na entrega original (sempre `null`); implementados agora
  (`PHASE_9S_AUDIT_RECORD.md` §8.4), com a fonte prevista restrita à `StudyVersion`
  `SNAPSHOT` mais recente + cenário `BASE` + `CalculationRun` mais recente — nunca
  qualquer run solto.
- **§5.2 (`closureResultId` "aponta para o `ProjectClosureResult` FINAL que a
  originou")** — corrigido inline acima (§5.2): sempre permitiu `DRAFT` também; o
  que muda é que, depois de uma distribuição `APPROVED`, essa versão (`DRAFT` ou
  `FINAL`) fica congelada (achado Alto, `PHASE_9S_AUDIT_RECORD.md` §8.5).

**Fase 10 continua não iniciada.** Nenhum commit, push, merge, rebase ou tag foi
executado nesta correção.

## 19. Correção focal final após segunda reauditoria REPROVADA

Uma segunda auditoria adversarial reprovou a correção da seção 18 por dois
motivos concretos, ambos detalhados com causa/correção/teste em
`docs/PHASE_9S_AUDIT_RECORD.md` §9:

1. **O guard descrito em §5.2/§18 contra recalcular um `DRAFT` com distribuição
   `APPROVED` não era atômico** — contagem e escrita em chamadas Prisma
   separadas, sem transação. Corrigido: agora é uma única transação
   `Serializable` (releitura + contagem + `updateMany` por CAS +
   `ForecastEvaluation`/`AuditLog`), com retry limitado exclusivamente a
   `P2034` e erro classificado (`ClosurePreparationError`/
   `DistributionApprovalError`, `reasonCode` + `correlationId`) em qualquer
   recusa de negócio ou esgotamento do retry.
2. **§4.5 ("checklist... `COMPLETED` com `LegalDecision` registrada") e a
   correção da seção 18 ainda permitiam que `LegalChecklistItem`/
   `LegalDocumentRequest` `CANCELLED` liberassem o gate sem revisor nem
   justificativa.** Corrigido: os dois modelos passam a ser avaliados por
   regras próprias — `LegalChecklistItem` só aceita `COMPLIANT` ou `WAIVED`
   com `reviewedById` + justificativa/evidência real; `LegalDocumentRequest`
   só aceita `RECEIVED` com `documentLinkId` efetivamente vinculado.
   `CANCELLED` nunca é evidência positiva para nenhum dos dois, com ou sem
   revisor — o schema não distingue as duas situações além dos mesmos campos
   que já bastam para `WAIVED`. **Superado pela §20** (última correção focal):
   nem `documentLinkId` nem `evidenceDocumentIds` referenciam qualquer
   entidade canônica comprovável — `RECEIVED` deixa de ser um caminho positivo
   até que uma migration futura seja autorizada.

Nenhuma migration foi necessária para nenhuma das duas correções (os campos
usados — `reviewedById`, `notes`, `evidenceDocumentIds`, `documentLinkId` —
já existiam no schema desde a 9D). A autorrevisão adversarial desta correção
encontrou e corrigiu um bug real adicional: no esgotamento do retry, um
`P2034` bruto do Prisma escapava sem classificação (código morto após o loop
de retry nunca era alcançado) — corrigido nos dois serviços
(`closure-service.ts`/`distribution-service.ts`), confirmado por 8 execuções
consecutivas da suíte real sem recorrência.

**Fase 10 continua não iniciada.** Nenhum commit, push, merge, rebase ou tag
foi executado nesta correção.

## 20. Última correção focal — determinismo do teste e validade da evidência jurídica

Detalhe causa/correção/QA completos em `docs/PHASE_9S_AUDIT_RECORD.md` §10.
Resumo:

1. **Teste intermitente** (`closure.database.integration.test.ts:925`) —
   regex case-sensitive contra mensagem começando com "N" maiúsculo. Corrigido
   validando classe do erro (`ClosurePreparationError`)/`reasonCode`/
   `correlationId`, nunca só o texto humano. Mensagem de produção inalterada.
   Validado: 10/10 execuções individuais do teste + 5/5 execuções da suíte
   focal completa sem recriar o banco.
2. **`documentLinkId`/`evidenceDocumentIds` nunca são strings livres
   suficientes** — mapeamento exaustivo (schema + código) confirmou que
   **nenhuma entidade canônica de documento existe** para
   `LegalDueDiligenceCase`/`LegalDocumentRequest`: o mesmo campo livre sem FK
   se repete em quatro modelos da 9D (`LegalAssetRegistration`,
   `LegalDocumentRequest`, `LegalLicense`, `LegalGuarantee`), nunca escrito
   nem lido por nenhum serviço de aplicação em todo o repositório. Seguindo a
   instrução explícita para esse caso, o gate passou a tratar essa evidência
   como estruturalmente inverificável: `LegalChecklistItem.WAIVED` só aceita
   `reviewedById` + `notes` (nunca `evidenceDocumentIds`);
   `LegalDocumentRequest.RECEIVED` nunca mais satisfaz — vira `SEM_EVIDENCIA`
   independente do conteúdo de `documentLinkId` (o que também garante, por
   construção, que uma referência inexistente e uma cruzada de outro
   tenant/projeto/caso sejam indistinguíveis — nenhuma consulta é feita).
   **Nenhuma migration foi criada.** A lacuna estrutural (tabela canônica de
   evidência documental jurídica, com `organizationId`/`projectId`/
   `diligenceCaseId`/`storageProvider`+`storageKey`/status/checksum) está
   registrada e aguarda autorização explícita antes de qualquer alteração de
   schema.

**Fase 10 continua não iniciada.** Nenhuma API externa, credencial real,
commit ou push. Organizações sintéticas residuais preservadas.

## 21. Correção estrutural final — evidência jurídica canônica (design, antes da migration)

Autorização explícita recebida para uma única migration aditiva. Design
registrado ANTES de qualquer SQL ser gerado, conforme exigido.

### 21.1 Entidade proposta

`LegalEvidenceDocument` (nome sugerido mantido — nenhuma convenção melhor
encontrada no domínio jurídico existente; `ContractDocument`/`SignatureRequest`
são o precedente de forma, não de nome, pois pertencem a domínios diferentes
— vendas/assinatura, não diligência jurídica).

### 21.2 Relacionamentos

- `organizationId` → `Organization` (RESTRICT).
- `projectId` → `Project` (RESTRICT).
- `diligenceCaseId` → `LegalDueDiligenceCase` (RESTRICT) — o caso jurídico
  (`SPE-ENCERRAMENTO-*` ou qualquer outro) ao qual a evidência pertence.
- `documentRequestId` (nullable) → `LegalDocumentRequest` (RESTRICT).
- `checklistItemId` (nullable) → `LegalChecklistItem` (RESTRICT).
- `uploadedById`/`reviewedById` (nullable)/`revokedById` (nullable) → `User`
  (RESTRICT) — três relações nomeadas distintas.
- **Exatamente um** de `documentRequestId`/`checklistItemId` deve estar
  presente (nunca os dois, nunca nenhum) — nenhuma justificativa de domínio
  comprovada foi encontrada para permitir ambos simultaneamente numa única
  linha de evidência; um upload que sirva aos dois precisa de duas linhas.

### 21.3 Estados

Enum dedicado `LegalEvidenceDocumentStatus`: `PENDING_REVIEW`, `VERIFIED`,
`REJECTED`, `REVOKED`. **Não reaproveitado** `DocumentStatus` (já existe,
usado por `ProjectDocument`/9L) — avaliado e descartado: falta o valor
`REVOKED`, e a semântica de "documento de data room de investimento" não é a
mesma de "evidência jurídica verificada para o gate de encerramento"; alterar
um enum compartilhado por um domínio não relacionado só para ganhar reuso
seria acoplamento sem benefício real. `LegalItemStatus` (usado por
`LegalChecklistItem`/`LegalDocumentRequest`) também foi avaliado — tem
`RECEIVED`/`RESOLVED`/`CANCELLED` mas nenhum `VERIFIED` com o significado de
"prova de existência/pertencimento comprovada por serviço", que é exatamente
o que esta tabela introduz; reaproveitá-lo confundiria dois conceitos
distintos (status da *solicitação* vs. status da *evidência* que a atende).

Transições permitidas: `PENDING_REVIEW → VERIFIED`, `PENDING_REVIEW → REJECTED`,
`VERIFIED → REVOKED`. Nenhuma outra transição existe. `REJECTED`/`REVOKED` são
terminais absolutos.

### 21.4 Invariantes

- `checksum`: formato SHA-256 hex validado por `CHECK` (`^[a-f0-9]{64}$`),
  mesmo padrão já usado em `signature_reconciliation_evidence`.
- `storageKey`/`contentType`: não vazios (`CHECK` de comprimento); o
  allowlist de MIME/extensão real é responsabilidade da camada de aplicação
  (`validateDocumentUpload`, já existente) — duplicar a lista num `CHECK` de
  banco arriscaria divergência silenciosa entre as duas fontes de verdade.
- `sizeBytes > 0` (`CHECK`); o limite máximo por tipo é responsabilidade da
  aplicação (`DOCUMENT_UPLOAD_LIMITS`, já existente).
- `VERIFIED`/`REJECTED` exigem `reviewedById`+`reviewedAt` não nulos
  (`CHECK`); `REVOKED` exige adicionalmente `revokedById`+`revokedAt`
  (`CHECK`); `PENDING_REVIEW` exige que nenhum desses campos esteja
  preenchido (`CHECK`) — nenhum estado inconsistente é representável.
- Pertencimento ao mesmo tenant/projeto/caso: **trigger estrutural**
  `BEFORE INSERT` (FKs simples não bastam, pois `documentRequestId`/
  `checklistItemId` apontam para linhas que já têm seu próprio
  `diligenceCaseId` — o trigger confirma que `LegalDueDiligenceCase.id =
  NEW.diligenceCaseId` tem `organizationId`/`projectId` iguais aos da nova
  linha, e que a solicitação/item referenciado (quando presente) pertence ao
  MESMO `diligenceCaseId` — nunca a outro caso).
- Camada que garante cada invariante: formato/tamanho/vínculo único →
  `CHECK` (Postgres, sempre); pertencimento cross-tenant/projeto/caso →
  trigger `BEFORE INSERT` (Postgres); MIME/extensão/assinatura binária/limite
  de tamanho real → aplicação (`validateDocumentUpload`/`inspectUpload`,
  reaproveitados, nunca reimplementados).

### 21.5 Imutabilidade

Trigger condicional (padrão B, já usado por `bank_financing_disbursements`/
`project_closure_results`), com uma extensão explícita para a única transição
extra permitida:

- `status = PENDING_REVIEW`: linha mutável (fluxo de revisão em andamento).
- `status = VERIFIED`: só uma escrita adicional é aceita — a transição para
  `REVOKED`, e SOMENTE alterando `status`/`revokedById`/`revokedAt`/
  `revokedReason`/`updatedAt`; qualquer outro campo alterado nessa transição
  é rejeitado (mesmo padrão de diff de colunas protegidas de
  `signature_reconciliation_evidence`/`signature_requests`). O snapshot
  original (quem enviou, quando, qual arquivo, qual checksum, qual revisor
  verificou) nunca é sobrescrito — a revogação só acrescenta metadados de
  revogação sobre a MESMA linha, preservando tudo o que já existia.
- `status ∈ {REJECTED, REVOKED}`: totalmente imutável, nenhuma escrita.
- `DELETE`: só permitido enquanto `PENDING_REVIEW` (corrige um upload
  indevido antes de qualquer revisão); bloqueado para os três estados
  restantes.
- `TRUNCATE`: bloqueado incondicionalmente, sempre.

### 21.6 Autorização e RBAC

Reaproveita `mutableRoles`/`approvalRoles` (`OWNER`/`ADMIN`/`ANALYST` para
enviar; `OWNER`/`ADMIN` para verificar/rejeitar/revogar — mesmo padrão de
`legal-service.ts`/`contract-service.ts`). Leitura reaproveita a capability
`LEGAL_READ` já existente em `read-capabilities.ts` — **nenhuma capability
nova**. Segregação de função: quem envia a evidência não pode ser quem a
verifica/rejeita (mesmo padrão de segregação já usado em
`recordLegalDecision`/`approveProjectClosureResult`).

### 21.7 Armazenamento

Reaproveita o `FileStorageProvider` genérico (`design-file-storage.ts`) via
uma nova instância de domínio dedicada (`legalEvidenceStorage =
createConfiguredFileStorage("legal-evidence")`) — mesmo padrão de
`contract-file-storage.ts`/`post-sale-evidence-storage.ts`, nenhum mecanismo
de storage novo. Conteúdo binário nunca entra no Postgres — só
`storageProvider`+`storageKey`+`checksum`+`sizeBytes` (metadado).

### 21.8 Checksum

SHA-256 hex, calculado pelo próprio `StorageProvider.put` (nunca recebido do
cliente), validado por `CHECK` no formato e nunca alterável após a criação
da linha (protegido pelo trigger de imutabilidade).

### 21.9 Ciclo de revogação

`VERIFIED → REVOKED` é a única transição pós-verificação. Revogação exige
`revokedById`+`revokedAt`+`revokedReason` (motivo obrigatório, texto livre,
nunca vazio na aplicação). Uma evidência revogada nunca mais satisfaz o gate;
se um novo documento válido for necessário, uma NOVA linha de
`LegalEvidenceDocument` é criada (histórico explícito, nunca sobrescrita —
decisão de design consistente com a preferência explícita do pedido desta
correção).

### 21.10 Compatibilidade com registros legados

Nenhum valor existente de `documentLinkId`/`sourceDocumentLinkId`/
`evidenceDocumentIds` é migrado automaticamente para `LegalEvidenceDocument`
— esses campos continuam existindo, intocados, e continuam sem qualquer
papel na decisão do gate (achado da correção anterior, mantido). Toda
solicitação/item jurídico já existente permanece `SEM_EVIDENCIA` até receber
uma evidência canônica real através do novo serviço.

## 22. Correção final pós-auditoria — redação e idempotência estrutural

Duas auditorias adversariais sobre a correção estrutural (§21) confirmaram a
superfície estrutural (migration, triggers, constraints, isolamento
cross-tenant) sólida, mas reprovaram por dois achados Altos, ambos corrigidos
nesta sessão: (1) `AuditLog` do serviço de evidência expunha `checksum`
integral e `storageKey` completo (e, num levantamento mais fino durante esta
própria correção, também o texto bruto do motivo de recusa/revogação); (2)
`registerLegalEvidenceDocument` não tinha nenhuma garantia estrutural de
idempotência — só um `findFirst` (check-then-act) antes do `create`, sem
constraint/índice único representando a identidade idempotente. Reproduzido
pela auditoria: 5 chamadas concorrentes idênticas criavam 5 linhas
`PENDING_REVIEW` distintas.

### 22.1 Redação estrutural do AuditLog

Nenhum `AuditLog` de evidência jurídica pode conter `storageKey`, checksum
integral, nome de arquivo, motivo em texto livre, URL ou qualquer outro
conteúdo jurídico — mesmo dentro de objetos aninhados. Helper central único
(`audit()` em `legal-evidence-service.ts`, reaproveitado por
register/verify/reject/revoke — nenhuma redação divergente entre os quatro
caminhos) produz um payload allowlisted:

- `evidenceRef` — SHA-256 de `legal-evidence-checksum:<checksum>`, truncado a
  16 hex. Determinístico (o mesmo checksum sempre produz a mesma referência,
  permitindo correlacionar duas entradas do MESMO arquivo, inclusive entre
  linhas diferentes de `LegalEvidenceDocument` após uma rejeição/revogação
  seguida de reenvio) e não reversível (SHA-256 truncado — não permite
  reconstruir o checksum original).
- `reasonCode` (só em reject/revoke) — **correção crítica final (§23): não é
  mais um hash do motivo.** Um dos dois valores ESTÁTICOS
  `LEGAL_EVIDENCE_REJECTION_REASON_PROVIDED`/
  `LEGAL_EVIDENCE_REVOCATION_REASON_PROVIDED`, nunca derivado do conteúdo. O
  texto bruto do motivo NUNCA entra no `AuditLog`, em nenhuma forma — nem
  texto, nem hash, nem prefixo/sufixo/fragmento; para `REVOKED`, o texto real
  continua na coluna canônica `revokedReason` da própria linha (imutável,
  protegida por trigger — não é log, é o registro de negócio em si, correto
  manter íntegro ali). Para `REJECTED` não existe coluna canônica de motivo
  no schema (fora do escopo desta correção — nenhuma migration para isso foi
  autorizada); o texto é usado só para validar que o chamador informou algo
  e descartado — o `reasonCode` no `AuditLog` é o único traço estrutural de
  que um motivo foi informado, nunca do seu conteúdo. Ver §23 para o motivo
  de `reasonRef` (hash determinístico do motivo) ter sido removido.
- `statusBefore`/`statusAfter`, `diligenceCaseId`, `documentRequestId`,
  `checklistItemId` — identificadores internos (cuids opacos) e valores de
  enum, nunca PII nem conteúdo jurídico; mantidos por serem essenciais a
  qualquer investigação real ("qual vínculo, qual transição").
- `storageProvider`/`storageKey` nunca entram em nenhuma forma — não são
  necessários para investigação (a chave real vive só na linha canônica).
- `correlationId` continua gerado no servidor (`randomUUID()`), nunca aceito
  do chamador, e vive em `metadata`, nunca em `after`.

Nenhum `console.*` do serviço recebe `checksum`/`storageKey`/motivo em
nenhum dos quatro caminhos (nunca havia `console.*` no arquivo; confirmado
que a correção não introduziu nenhum). Nenhum `Error` lançado pelo serviço
usa `cause` para carregar o erro bruto do Prisma (que poderia conter os
valores em conflito) — erros de conflito de identidade são sempre
reconstruídos como uma nova mensagem estática, descartando o erro original.

Nenhum `AuditLog` histórico foi reescrito ou apagado — fixtures locais
anteriores a esta correção podem conter `checksum`/`storageKey` em texto
pleno; isso é documentado aqui, não corrigido retroativamente.

### 22.2 Identidade idempotente definitiva

Extraída do contrato e do serviço já existentes (não inventada): a operação
lógica "registrar evidência" é a mesma quando organização, projeto, caso,
vínculo jurídico (`documentRequestId` XOR `checklistItemId` — já
mutuamente exclusivos por `CHECK`) e `checksum` (impressão digital SHA-256 do
conteúdo — já a "identidade do payload" usada desde a §21) coincidem, E a
evidência anterior ainda está ativa (`PENDING_REVIEW`/`VERIFIED`).
`REJECTED`/`REVOKED` são deliberadamente excluídos da identidade: são estados
terminais, e o próprio design da revogação (§21.9) já estabelece "nova
evidência = nova linha, nunca sobrescreve" — reenviar o mesmo arquivo depois
de uma rejeição ou revogação é uma NOVA operação lógica (uma correção, uma
segunda tentativa), nunca um retry da anterior, e deve poder criar uma nova
linha `PENDING_REVIEW`. Duas evidências genuinamente distintas para o mesmo
vínculo (checksums diferentes) nunca são bloqueadas — o design sempre
permitiu múltiplos documentos legítimos para o mesmo item/solicitação.

Não existe (nem foi criado) um `idempotencyKey` explícito separado do
`checksum` — o checksum SHA-256 já É a impressão digital do payload; um
campo adicional seria redundante e violaria "não invente a regra".

### 22.3 Migration e índices (39ª — aditiva)

`prisma/migrations/20260911235000_phase_9s_legal_evidence_idempotency/` cria
DOIS índices únicos parciais — nunca um único índice composto cobrindo as
duas colunas de vínculo simultaneamente: como `document_request_id` e
`checklist_item_id` são nullable e mutuamente exclusivas, um índice único
sobre as duas nunca pegaria duas linhas com o MESMO vínculo preenchido e a
OUTRA coluna `NULL` em ambas (Postgres não trata `NULL = NULL` como
duplicata para fins de unicidade, por padrão).

```sql
CREATE UNIQUE INDEX "legal_evidence_documents_active_request_identity_key"
  ON "legal_evidence_documents"("organization_id","project_id","diligence_case_id","document_request_id","checksum")
  WHERE "document_request_id" IS NOT NULL AND "status" IN ('PENDING_REVIEW','VERIFIED');

CREATE UNIQUE INDEX "legal_evidence_documents_active_checklist_identity_key"
  ON "legal_evidence_documents"("organization_id","project_id","diligence_case_id","checklist_item_id","checksum")
  WHERE "checklist_item_id" IS NOT NULL AND "status" IN ('PENDING_REVIEW','VERIFIED');
```

Nenhum backfill fabricado: os índices foram criados sobre os dados reais já
existentes (nenhuma duplicata ativa em dev nem em teste — verificado por
consulta direta antes de aplicar; se existisse, `CREATE UNIQUE INDEX` teria
falhado de forma visível — fail-closed, nunca silencioso).

### 22.4 Tratamento de conflito no serviço

`registerLegalEvidenceDocument` mantém o `findFirst` como atalho (evita um
`storage.put` supérfluo no caso comum, sem corrida), mas a garantia real sob
concorrência é o `catch` do `P2002` no `create()`: `isKnownIdentityConflict`
reconhece o conflito SOMENTE pelo conjunto EXATO de colunas em
`error.meta.target` (confirmado empiricamente contra Postgres real — o
Prisma reporta a lista de colunas, não o nome do índice, para índices criados
fora do `schema.prisma`) — nunca "qualquer P2002" genérico. Um `P2002` em
outra constraint (ex.: colisão de chave primária, `target: ["id"]`) propaga
sem reclassificação. No conflito reconhecido, o serviço relê o registro
vencedor pela mesma identidade e o devolve — idempotente, nunca duplica,
nunca inventa sucesso. Como `checksum` já é a identidade do payload, não
existe cenário de "mesma chave lógica, payload divergente" a classificar
como conflito: um checksum diferente é, por definição, uma nova operação
legítima, nunca um conflito.

## 23. Correção crítica final — remoção de fingerprint de motivo livre

Uma verificação focal independente sobre a correção §22 confirmou, por
ataque de dicionário real (não teórico), que `reasonRef` — o hash SHA-256
truncado que a §22 aplicava também ao motivo livre de recusa/revogação, "pela
mesma técnica" do `evidenceRef` — não protegia o conteúdo do motivo.

### 23.1 Causa

`evidenceRef` é seguro porque sua entrada (`checksum`, SHA-256 de 256 bits do
conteúdo do arquivo) tem entropia alta o bastante para tornar um ataque de
dicionário/força bruta inviável. `reasonRef` aplicava a MESMA técnica — hash
determinístico, sem chave, sem sal — a texto livre de domínio
jurídico/administrativo, que tem entropia baixa (frases previsíveis:
"Documento ilegível.", "Fora do prazo.", "Documento substituído por versão
mais recente." etc.) e cujo algoritmo é público (está no próprio código-fonte
deste repositório). Um hash sem chave sobre um segredo de baixa entropia não
protege o segredo — é a mesma classe de erro de "senha em texto claro com
SHA-256 sem sal". Confirmado experimentalmente: um dicionário local de 15
frases recuperou, byte a byte, os dois motivos reais usados em um teste real
contra PostgreSQL, comparando apenas os hashes.

### 23.2 Correção aplicada

`reasonRef` foi **removido** de `legal-evidence-service.ts` — nenhuma
derivação SHA-256/HMAC/hash aplicada a texto livre permanece no serviço.
`reject`/`revoke` agora gravam no `AuditLog` só um `reasonCode` ESTÁTICO e
allowlisted (`LEGAL_EVIDENCE_REJECTION_REASON_PROVIDED`/
`LEGAL_EVIDENCE_REVOCATION_REASON_PROVIDED`), nunca derivado do conteúdo —
dois motivos diferentes na MESMA operação sempre produzem o MESMO código
(é isso que distingue um código de categoria de um fingerprint). O texto do
motivo de recusa continua sendo validado como não vazio (regra de negócio
preexistente, inalterada) e depois descartado — `LegalChecklistItem`/
`LegalDocumentRequest`/`LegalEvidenceDocument` não ganharam nenhuma coluna
nova nesta correção (nenhuma migration). O texto do motivo de revogação
continua íntegro só na coluna canônica `revokedReason` (protegida por
trigger de imutabilidade, nunca reescrita, nunca copiada para log). `Error`
lançados pelo serviço nunca usam `cause` para carregar o motivo bruto.
`evidenceRef` **não foi alterado** — permanece derivado do `checksum` (alta
entropia) e serve exclusivamente como referência de correlação de auditoria,
nunca como chave de autorização, unicidade ou integridade.

### 23.3 Escopo desta correção

Só a redação do `AuditLog` foi alterada. Nenhuma regra de idempotência
(§22.2–22.4), gate (`gates.ts`), RBAC, storage ou imutabilidade foi tocada;
nenhuma migration nova foi criada (39 migrations, inalteradas); nenhum
`AuditLog` histórico foi reescrito ou apagado — registros gravados antes
desta correção podem conter `reasonRef` (hash do motivo, hoje comprovadamente
recuperável por dicionário); isso permanece documentado, não corrigido
retroativamente, pois `AuditLog` é histórico imutável por design.
