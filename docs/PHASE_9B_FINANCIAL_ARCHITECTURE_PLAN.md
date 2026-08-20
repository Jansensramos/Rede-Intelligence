# FASE 9B — FINANCEIRO E TESOURARIA
## Plano Arquitetural Profundo

**Data de Preparação:** 20 de Agosto de 2026  
**Status:** Planejamento Pré-Implementação (Contract Freeze Pendente da Fase 9A)  
**Preparado por:** Claude AI  
**Para Execução por:** Equipe de Desenvolvimento REDE  

---

## SUMÁRIO EXECUTIVO

A Fase 9B estabelecerá os alicerces financeiros e de tesouraria do REDE Intelligence, criando um sistema operacional único de verdade financeira onde:

1. **Um evento nasce uma única vez** e produz efeitos rastreáveis em múltiplos módulos
2. **Fluxos de caixa** conectam Base Aprovada → Orçamento → Cronograma → Realizado
3. **Multi-empresa e consolidação** funcionam nativamente desde a arquitetura
4. **Conciliação** é automática, não manual
5. **Integridade auditável** sem silos de informação

---

## A. ESTADO ATUAL DO REPOSITÓRIO

### A.1 Estrutura Prisma Atual

O schema.prisma (3.413 linhas) define:

#### Entidades de Tenant e Controle:
- `Organization` — tenant raiz, isolamento multi-empresa
- `User`, `OrganizationMembership` — acesso controlado
- `Session` — gestão de sessão

#### Entidades de Projeto e Estudo:
- `Project` — projeto imobiliário (organizacionId, nome, cidade, estado, moeda)
- `ViabilityStudy` — estudo de viabilidade por projeto
- `StudyVersion` — versionamento por snapshot

#### Entidades de Viabilidade Financeira (Fase Anterior):
- `AssumptionSnapshot` — inputs de projeto (VGV, unidades, áreas, custos, cronograma de pagamento)
- `AssumptionEntry` — granularity de assumptions
- `Scenario` — cenários base/conservador/agressivo/customizado
- `CalculationRun` — execução do engine financeiro
- `CashFlowEntry` — fluxo mensal de caixa (mês, vendas, custos, receitas, etc.)
- `FinancialResult` — resultado agregado (VGV, lucro, margem, IRR, ROI, NPV)
- `CalculatedMetric` — métricas derivadas do engine

#### Entidades de Análise e Descoberta:
- `RedTeamRun` — análise red team estruturada por 6 agentes
- `RedTeamAgentResult` — opinião de cada especialista
- `RedTeamFinding` — achados com severidade, confiança, status
- `RiskFinding`, `Recommendation` — findings e recomendações do engine

#### Entidades de Sensibilidade:
- `SensitivityAnalysis` — análise de sensibilidade
- `SensitivityCase`, `BreakEvenResult`, `StressTestResult` — resultados

#### Entidades de Investimento (Fase Atual):
- `InvestmentCase` — caso de investimento estruturado
- `InvestmentSnapshotBundle` — snapshot congelado para comitê
- `InvestmentReviewRound` — rodada de revisão
- `CommitteeDecision`, `CommitteeMember`, `CommitteeVote` — governança de comitê
- `InvestmentCondition` — condições aprovadas
- `ProjectDocument`, `DocumentChecklistItem` — data room e checklist

#### Entidades de Land/Urban (Fase Atual):
- `LandAsset`, `LandStudy`, `LandStudyVersion` — análise de terreno
- `UrbanScenarioRecord`, `BuildableEnvelopeRecord` — cenários urbanos
- `UrbanRestrictionRecord` — restrições regulatórias

#### Entidades de Design (Fase Atual):
- `DesignProjectPackage` — pacote de projeto
- `DesignFileContent` — arquivos BIM/projetos
- `DesignFinding` — achados de design
- Múltiplas tabelas de design: `DesignAlternative`, `DesignRequirement`, `DesignRuleCheckResult`, etc.

#### Entidades de IA Conversacional:
- `AIConversation` — conversa com contexto de projeto/study/investmentCase
- `AIMessage`, `AIResponseEvidence`, `AIFeedback` — interações

#### Auditoria:
- `AuditLog` — auditoria geral
- `InvestmentAuditLog` — auditoria de investimento

### A.2 Padrões Arquiteturais Observados

#### Multi-Tenant Safety:
- Toda entidade material tem `organizationId`
- Isolamento por organização é obrigatório
- Campos de criação/edição rastreiam userId

#### Versionamento e Snapshots:
- `StudyVersion.status` (DRAFT, SNAPSHOT)
- `InvestmentSnapshotBundle` congela estado completo para revisão
- Permite histórico completo sem dados flutuantes

#### Enums Estruturados:
- Estados bem definidos: `ProjectStatus`, `StudyStatus`, `InvestmentCaseStatus`
- Severidade: `FindingSeverity`, `RedTeamFindingSeverity`, `DesignFindingSeverity`
- Decisões: `CommitteeDecisionType`, `RedTeamDecision`

#### Decimal Precision:
- Uso de `Decimal` com db.Decimal(20, 2) para valores financeiros
- Suporta até R$ 999.999.999.999.999.999,99

#### Relacionamentos:
- Restrições de integridade referencial (onDelete: Restrict, Cascade, SetNull)
- Índices para performance em queries comuns

### A.3 Componentes de Aplicação Existentes

**src/application/budget/budget-service.ts**
- Serviço de orçamento (não inspecionado em detalhe, mas existe)

**src/domain/budget/budget-engine.ts**
- Engine de cálculo orçamentário (não inspecionado em detalhe)

**Componentes React** (src/components)
- `intelligence-workspace.tsx` — workspace principal
- `investment-suite-view.tsx` — views de investimento (comitê, studio, dataroom)
- `design-intelligence-view.tsx` — views de design
- `rede-ai-view.tsx` — interface de conversação IA

**Páginas Next.js** (src/app)
- `page.tsx` — página home com inicialização START BUTANTÃ

---

## B. DEPENDÊNCIAS DA FASE 9A

### B.1 O Que a Fase 9A Está Criando (via Codex)

Segundo a especificação da Fase 9A, serão criadas:

#### Estruturas de Grupo Econômico:
```
Grupo Econômico
  ├── Empresa (Incorporadora, Distribuidora, etc.)
  │   ├── SPE (Sociedade Propósito Específico)
  │   │   ├── Empreendimento (Projeto)
  │   │   │   ├── Torre/Bloco
  │   │   │   │   └── Unidade
  │   │   │   └── Centro de Custo
```

#### Base Aprovada (Aprovação Executiva)
- Responsável por projeto
- Data de aprovação executiva
- Vigência
- Status de rastreamento

#### Orçamento Oficial
- Ligado a Base Aprovada
- Por Centro de Custo e Item Orçamentário
- Valores: original, revisado, atual
- Status: planejado, autorizado, comprometido, gasto

#### EAP (Estrutura Analítica do Projeto)
- Pacotes de trabalho
- Vinculação a centros de custo

#### Cronograma Físico-Financeiro
- Atividades com data início/fim
- Marcos
- Dependências
- Curva S financeira
- Responsável

#### Autorização/Aprovação Estruturada
- Fluxo de aprovação de despesas
- Níveis de aprovação
- Rastreamento de quem aprovou o quê e quando

### B.2 Contratos que a Fase 9B Precisa Receber

Antes da Fase 9B iniciar, os seguintes contratos estruturais da Fase 9A devem estar **CONGELADOS**:

#### Entidades Obrigatórias (Devem Existir no Schema):

1. **Company**
   - Propriedades: id, organizationId, name, cnpj, type (HOLDING, OPERATOR, DEVELOPER, OTHER)
   - Relacionamento: Organization → Company (1:N)

2. **SPE**
   - Propriedades: id, companyId, name, cnpj, status
   - Relacionamento: Company → SPE (1:N)

3. **Empreendimento** (ou `DevelopmentProject`)
   - Propriedades: id, speId, projectId (FK para Project)
   - Propriedades: addressProjectName, status
   - Relacionamento: SPE → Empreendimento (1:N), Project (já existe)

4. **CostCenter** (Centro de Custo)
   - Propriedades: id, empreendimentoId, code, name, type (LAND, CONSTRUCTION, INDIRECT, MARKETING, OTHER)
   - Propriedades: managerUserId, status
   - Relacionamento: Empreendimento → CostCenter (1:N)

5. **ApprovedBase** (Base Aprovada)
   - Propriedades: id, empreendimentoId, approvedByUserId, approvedAt, validUntil
   - Propriedades: remarks, status (PENDING, APPROVED, EXPIRED, SUPERSEDED)
   - Relacionamento: Empreendimento → ApprovedBase (1:N)

6. **BudgetItem** (Item Orçamentário)
   - Propriedades: id, costCenterId, approvedBaseId, code, description
   - Propriedades: originalValue, revisedValue, currentValue, status
   - Relacionamento: CostCenter → BudgetItem (1:N), ApprovedBase (N:1)

7. **ScheduleActivity** (Atividade do Cronograma)
   - Propriedades: id, empreendimentoId, code, description
   - Propriedades: plannedStartDate, plannedEndDate, actualStartDate, actualEndDate
   - Propriedades: plannedCost, actualCost, responsibleUserId
   - Relacionamento: Empreendimento → ScheduleActivity (1:N)

#### Campos Críticos para a Fase 9B Acessar:

- `Company.cnpj` — para identificação bancária
- `SPE.cnpj` — para contas bancárias específicas
- `CostCenter.code` — para rastreamento de movimentações
- `BudgetItem.currentValue` — para comparação orçado vs. realizado
- `ScheduleActivity.actualCost` — para fluxo realizado
- `ApprovedBase.approvedAt` — para auditoria de quando aprovado

---

## C. RISCOS ARQUITETURAIS CRÍTICOS

### C.1 Risco: Informação Duplicada

**Problema:** Se Contas a Pagar se criarem independentemente de Orçamento, teremos dois "sources of truth".

**Mitigação:**
- ✅ Conta a Pagar SEMPRE originária de:
  - Contrato + BudgetItem + ScheduleActivity
  - OU importação bancária com vínculo posterior

### C.2 Risco: Multiempresa sem Isolamento

**Problema:** SPEs compartilhadas, contas bancárias compartilhadas, mas dados financeiros precisam ser isolados por SPE.

**Mitigação:**
- ✅ Toda Conta Financeira tem SPE (não apenas Company)
- ✅ Queries financeiras sempre filtram por speId
- ✅ Consolidação feita explicitamente, não implicitamente

### C.3 Risco: Perda de Auditoria

**Problema:** Deletar, emendar ou reverter uma Conta pode ser fraude.

**Mitigação:**
- ✅ Nenhum DELETE para entidades financeiras consolidadas
- ✅ Apenas CANCELAMENTO controlado com aprovação
- ✅ Reversão cria novo evento com vínculo ao anterior

### C.4 Risco: Conciliação Manual sem Mecanismo

**Problema:** Conciliação bancária feita manualmente no Sheets, sem rastreamento.

**Mitigação:**
- ✅ Motor de conciliação automática com heurísticas
- ✅ Toda reconciliação é auditável e rastreável

### C.5 Risco: Fluxo Atrasado pela Falta de Cronograma

**Problema:** Projeção de fluxo depende de cronograma, que pode não existir.

**Mitigação:**
- ✅ Fluxo projetado funciona com ou sem cronograma
- ✅ Se cronograma existe, incorpora; se não, usa heurísticas ou entrada manual

---

## D. CONTRACT FREEZE MÍNIMO DA FASE 9A

Antes da Fase 9B começar, **OBRIGATORIAMENTE**:

### Entidades (No Schema):

```prisma
model Company {
  id String @id @default(cuid())
  organizationId String @map("organization_id")
  name String
  cnpj String @unique
  type String // HOLDING | OPERATOR | DEVELOPER | OTHER
  status String @default("ACTIVE")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  spes SPE[]
  // ... outros relacionamentos
  @@unique([organizationId, cnpj])
  @@map("companies")
}

model SPE {
  id String @id @default(cuid())
  companyId String @map("company_id")
  name String
  cnpj String @unique
  status String @default("ACTIVE")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  company Company @relation(fields: [companyId], references: [id], onDelete: Restrict)
  // ... relacionamentos
  @@unique([companyId, cnpj])
  @@map("spes")
}

model CostCenter {
  id String @id @default(cuid())
  speId String @map("spe_id")
  projectId String? @map("project_id")
  code String
  name String
  type String // LAND | CONSTRUCTION | INDIRECT | MARKETING | TAX | FINANCING | OTHER
  description String?
  managerUserId String? @map("manager_user_id")
  status String @default("ACTIVE")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  spe SPE @relation(fields: [speId], references: [id], onDelete: Restrict)
  // ... relacionamentos
  @@unique([speId, code])
  @@map("cost_centers")
}

model ApprovedBase {
  id String @id @default(cuid())
  speId String @map("spe_id")
  approvedByUserId String @map("approved_by_user_id")
  approvedAt DateTime @map("approved_at")
  validUntil DateTime? @map("valid_until") @db.Date
  remarks String?
  status String @default("APPROVED") // PENDING | APPROVED | EXPIRED | SUPERSEDED
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  spe SPE @relation(fields: [speId], references: [id], onDelete: Restrict)
  // ... relacionamentos
  @@unique([speId, approvedAt])
  @@map("approved_bases")
}

model BudgetItem {
  id String @id @default(cuid())
  costCenterId String @map("cost_center_id")
  approvedBaseId String @map("approved_base_id")
  code String
  description String
  originalValue Decimal @db.Decimal(20, 2)
  revisedValue Decimal? @db.Decimal(20, 2)
  currentValue Decimal @db.Decimal(20, 2)
  status String @default("PLANNED") // PLANNED | AUTHORIZED | COMMITTED | SPENT | APPROVED
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  costCenter CostCenter @relation(fields: [costCenterId], references: [id], onDelete: Restrict)
  approvedBase ApprovedBase @relation(fields: [approvedBaseId], references: [id], onDelete: Restrict)
  // ... relacionamentos
  @@unique([costCenterId, code])
  @@map("budget_items")
}
```

### Validações:

- ✅ Toda `SPE` tem um `CNPJ` único
- ✅ Toda `CostCenter` tem código único dentro de uma SPE
- ✅ Toda `ApprovedBase` referencia uma SPE
- ✅ Toda `BudgetItem` referencia CostCenter e ApprovedBase
- ✅ Nenhum campo crítico é NULL (apesar de pode haver default)

---

## E. MODELO DE DOMÍNIO PROPOSTO

### E.1 Princípios de Design

1. **Single Source of Truth**: Um evento cria um registro primário que produz derivações
2. **Event Sourcing Light**: Registros financeiros são imutáveis após consolidação
3. **Multi-Entity Support**: Uma "Conta" vive no contexto de SPE → Projeto → CostCenter
4. **Competência vs. Caixa**: Rastrear ambos, nunca mesclá-los
5. **Idempotência**: Integrações financeiras não criam duplicatas

### E.2 Entidades Financeiras Propostas

#### TIER 1: Obrigações e Direitos Estruturados

##### Contrato (Contract) — Já existe, será potenciado

Ligações futuras:
- `ContractId` em Conta a Pagar (obrigação contratual)
- `ContractId` em Conta a Receber (direito de recebimento)

##### Obrigação (Obligation) — Nova

```
Obrigação estrutura uma dívida contratual antes do pagamento:

id, speId, contractId?, supplierId?
type: PAYMENT_OBLIGATION | INTEREST_OBLIGATION | TAX_OBLIGATION | FUNDING_REPAYMENT | INTERCOMPANY
amount: Decimal
dueDate: DateTime
reajusteIndex?: IPCA | INCC | IGP_M | CUSTOM
reajusteFormula?: String
status: PENDING | ACCRUED | PAID | WAIVED | DISPUTED
createdAt, updatedAt, cancelledAt?, cancelledReason?
```

#### TIER 2: Contas Operacionais

##### Conta a Pagar (PayableAccount) — Nova

```
Uma obrigação transformada em dívida operacional:

id, speId, obligationId?
costCenterId, budgetItemId?
supplierId?, invoiceNumber?, invoiceDate?
description: String
competenceMonth: DateTime (período de accrual)
dueDate: DateTime
originalAmount: Decimal
currentAmount: Decimal (com juros, multas, descontos)
grossAmount: Decimal (antes de descontos)
discountAmount: Decimal
interestAmount: Decimal
fineAmount: Decimal
withholdingAmount: Decimal
netAmount: Decimal (= original + juros + multas - desconto)

paymentTerms: SPOT | NET_7 | NET_14 | NET_30 | CUSTOM
status: PREVISTA | PROGRAMADA | APROVADA | PAGA_PARCIAL | PAGA | VENCIDA | CANCELADA | AJUSTADA
paymentMethod: TRANSFER | BOLETO | CHEQUE | CASH | CARD | OTHER
responsibleUserId?
createdAt, updatedAt, approvedAt?, approvedByUserId?
```

**Relacionamentos:**
- SPE (N:1)
- CostCenter (N:1)
- BudgetItem (N:1)
- Supplier (N:1) — new table
- Obligation (N:1, opcional)
- PayablePayment (1:N) — agregação de pagamentos
- BankTransaction (1:N) — possíveis conciliações

**Índices:**
- (speId, dueDate, status)
- (speId, competenceMonth, status)
- (costCenterId, status)
- (supplierId, dueDate)

##### Conta a Receber (ReceivableAccount) — Nova

```
Uma obrigação de cliente transformada em direito financeiro:

id, speId
clientId, unitId? (se venda de unidade)
contractId? (contrato de compra)
saleContractNumber?, invoiceNumber?
description: String
competenceMonth: DateTime
dueDate: DateTime
originalAmount: Decimal
currentAmount: Decimal
indexApplied?: IPCA | IGP_M | CUSTOM
indexValue?: Decimal
indexDate?: DateTime
interestAmount: Decimal
fineAmount: Decimal
discountAmount: Decimal
netAmount: Decimal

paymentPlan: Json (parcelas, datas, valores)
status: PREVISTA | EMITIDA | RECEBIDA_PARCIAL | RECEBIDA | VENCIDA | RENEGOCIADA | CANCELADA

remittanceMethod: BOLETO | PIX_STATIC | PIX_DINAMIC | EMAIL | WHATSAPP | CUSTOM
issuedAt?, issuedByUserId?
createdAt, updatedAt
```

**Relacionamentos:**
- SPE (N:1)
- Unit (N:1) — new table
- Customer/Client (N:1)
- Contract (N:1, opcional)
- ReceivablePayment (1:N)
- BankTransaction (1:N)

#### TIER 3: Movimentações Financeiras

##### Pagamento (PayablePayment) — Nova

```
Registro de uma ou mais movimentações para saldar uma Conta a Pagar:

id, payableAccountId
bankAccountId (de onde saiu o dinheiro)
amount: Decimal
paymentMethod: TRANSFER | BOLETO | CHEQUE | CASH | CARD
referenceNumber? (código banco, etc)
paidAt: DateTime
approvedByUserId?

status: PENDING | PROCESSED | CLEARED | FAILED | REVERSED
externalId?: String (ID do provedor de pagamento)
idempotencyKey: String (hash de origem + data + valor para evitar duplicata)
createdAt, updatedAt
```

**Relacionamentos:**
- PayableAccount (N:1)
- BankAccount (N:1)
- BankTransaction (1:1, após conciliação)
- Currency (N:1) — suportando múltiplas moedas futuramente

##### Recebimento (ReceivablePayment) — Nova

```
Registro de recebimento de uma Conta a Receber:

id, receivableAccountId
bankAccountId (para onde entrou)
amount: Decimal
receivedAt: DateTime
method: BOLETO | PIX | TRANSFER | CASH | CHEQUE | OTHER
referenceNumber?, proofDocument?

status: RECEIVED | RECONCILED | FAILED | REVERSED
externalId?, idempotencyKey
createdAt, updatedAt
```

---

## F. ENTIDADES DE SUPORTE

### F.1 Fornecedor (Supplier)

```
id, organizationId, speId?
name, cnpj, cpf? (para pessoa física)
email, phone, website?
bankData: Json {
  banco: String,
  agencia: String,
  conta: String,
  tipoConta: String
}
status: ACTIVE | INACTIVE | BLOCKED | DISPUTED
createdAt, updatedAt
```

### F.2 Conta Bancária (BankAccount)

```
id, speId
banco: ITAU | BRADESCO | SANTANDER | BB | NUBBANK | OTHER
agencia: String
conta: String
tipoConta: CHECKING | SAVING | INVESTMENT
titular: String
moeda: BRL | USD (expansão futura)
saldoLivre: Decimal
saldoRestrito: Decimal
ultimaAtualizacao: DateTime

integracao: OPEN_FINANCE | API_NATIVA | CNAB | OFX | MANUAL | WEBHOOK
externalId? (identificador do provedor)
credentialHash? (nunca plaintext)

status: ACTIVE | INACTIVE | CLOSED
createdAt, updatedAt
```

### F.3 Transação Bancária (BankTransaction)

```
id, bankAccountId, organizationId
dataMovimentacao: DateTime
valor: Decimal
tipo: DEBIT | CREDIT
descricao: String
contraparte: String
documento?: String
hash: String (para idempotência)

candidatosParaConciliacao: Json [
  {
    type: "payableAccountId" | "receivableAccountId",
    id: String,
    confianca: ALTA | MEDIA | BAIXA,
    matching: {
      valor: MATCH | CLOSE,
      data: MATCH | PROXIMO,
      descricao: MATCH | PARCIAL
    }
  }
]

status: RECEIVED | CANDIDATE | RECONCILED | MANUAL | UNRECONCILED | DISPUTED
reconciliadoCom?: String (referência para PayablePayment/ReceivablePayment)
reconciliadoAt?: DateTime

createdAt, updatedAt
```

### F.4 Índice Financeiro (FinancialIndex)

```
id, organizationId
nome: IPCA | INCC | IGP_M | CUSTOM
versao: Int
data: DateTime @db.Date
valor: Decimal(12, 8) (e.g., 1.00543 para +0.543%)
fonte: IBGE | FIPE | MANUAL | API_EXTERNA
confiabilidade: CONFIRMADA | PREVISTA | ESTIMADA

vigeriaAte?: DateTime
observacoes?: String
createdAt, updatedAt
```

### F.5 Unidade (Unit) — Para Venda

```
id, projectId, speId
numeroBlocoTorre: String
numeroUnidade: String
andar: Int?
areaPrivada: Decimal(10, 2)
areaComum?: Decimal(10, 2)
quartos: Int
suites: Int
banheiros: Int

statusConstrutivo: PLANEJADO | EM_CONSTRUCAO | ENTREGUE
statusVenda: DISPONIVEL | PLÁNOM INICIAL | RESERVADA | VENDIDA | DEVOLVIDA

valordoBSoEstrutura: Decimal(20, 2)
descricao?: String
createdAt, updatedAt
```

### F.6 Cliente (Customer/Client)

```
id, organizationId
nome: String
tipo: PESSOA_FISICA | PESSOA_JURIDICA
cpfCnpj: String @unique (por organização)
email, phone, celular
endereco: Json

status: ATIVO | INATIVO | BLOQUEADO
createdAt, updatedAt
```

---

## G. MÁQUINA DE ESTADOS FINANCEIRA

### G.1 Estados de Conta a Pagar

```
PREVISTA (padrão)
  └─ Criada a partir de Orçamento + Cronograma
  └─ Sem aprovação necessária ainda

PROGRAMADA
  └─ Aprovador financeiro revisou
  └─ Nota de empenho é possível

APROVADA (gate crítico)
  └─ Passou por workflow de aprovação
  └─ Pode gerar compromisso de despesa
  └─ Pode virar pagamento

PAGA_PARCIAL
  └─ Um ou mais pagamentos registrados
  └─ Saldo residual > 0

PAGA (terminal)
  └─ Saldo = 0
  └─ Todos os pagamentos reconciliados
  └─ Somente leitura

VENCIDA
  └─ DueDate < hoje E status ≠ PAGA
  └─ Flag de aviso, não muda outras lógicas

CANCELADA (via estorno controlado)
  └─ Criou novo registro de reversão auditável
  └─ Original fica com histórico

AJUSTADA
  └─ Revisão de valores (juros, multa, desconto)
  └─ Cria ajustamento auditado
```

### G.2 Estados de Conta a Receber

```
PREVISTA
  └─ Venda realizada, mas não faturada
  └─ Competência futura

EMITIDA
  └─ Nota fiscal / boleto criado
  └─ Cliente recebeu o documento

RECEBIDA_PARCIAL
  └─ Primeira parcela ou pagamento parcial
  └─ Saldo aberto

RECEBIDA (terminal)
  └─ Integral quitada
  └─ Reconciliada com banco

VENCIDA
  └─ Flag de aviso (overdue)
  └─ Fluxo de cobrança ativado

RENEGOCIADA
  └─ Prazo ou valor revisado
  └─ Cria novo plano de pagamento
  └─ Mantém referência ao original

CANCELADA
  └─ Via devolução de unidade
  └─ Registro de crédito criado como reversão
```

---

## H. TESOURARIA INTEGRADA

### H.1 Posição de Caixa

Entidade agregada (calculada, não armazenada):

```typescript
interface PositionEspacoCaixa {
  periodoReferencia: DateTime
  saldoTotalBancos: Decimal
  saldoLivre: Decimal
  saldoRestrito: Decimal
  
  byBankAccount: {
    [bankAccountId]: {
      banco: String
      saldo: Decimal
      data_ultima_conciliacao: DateTime
    }
  }
  
  bySpE: {
    [speId]: {
      saldo: Decimal
      contas_a_pagar_vencidas: Decimal
      contas_a_receber_vencidas: Decimal
    }
  }
  
  byCostCenter: {
    [costCenterId]: {
      saldo_projetado: Decimal
      saldo_realizado: Decimal
    }
  }
  
  consolidado: {
    grupo: Decimal
  }
  
  calculadoEm: DateTime
}
```

### H.2 Dashboard de Tesouraria

Métricas calculadas em tempo real:

- **Caixa Total**: Soma de todos os bancos
- **Caixa Livre**: Caixa - Restrições - Alocações
- **Aplicações**: Valores em investimentos
- **Funding**: Linhas de crédito disponíveis
- **Exposição**: Máximo de déficit projetado
- **Inadimplência**: Total de contas vencidas
- **Régua de Vencimentos**: D-21, D-14, D-7, D-3, D0

---

## I. FLUXO DE CAIXA PROJETADO vs. REALIZADO

### I.1 Fluxo Projetado

**Origem: Base Aprovada + Orçamento + Cronograma + Contas Estruturadas**

Entrada de dados:

1. Pega `BudgetItem.currentValue` por CostCenter
2. Obtém `ScheduleActivity.plannedStartDate/endDate`
3. Aplica distribuição mensal (linear, S-curve, customizada)
4. Cria `ProjectedCashFlowEntry` para cada período
5. Incorpora `PayableAccount` estruturadas (não pagadas ainda)
6. Incorpora `ReceivableAccount` estruturadas (não recebidas ainda)

Resultado: Fluxo esperado mês a mês, comparável com orçado.

### I.2 Fluxo Realizado

**Origem: Transações Bancárias Confirmadas**

Entrada de dados:

1. Pega `BankTransaction` com status RECONCILED
2. Obtém mês de movimento
3. Agrega por CostCenter (via BankAccount → SPE → CostCenter)
4. Cria `RealizedCashFlowEntry` para cada período
5. Histórico imutável após conciliação

### I.3 Projeção Atualizada (EAC)

**Fórmula: Realizado até Hoje + Previsão Atualizada Futura**

```
EAC_Mes_N = Realizado_até_(N-1) + Previsão_Atualizada_(N...Final)

Variações Suportadas:
- Mudança de cronograma → ajusta períodos
- Mudança de valor orçado → ajusta montantes
- Mudança de índice → recalcula valores corrigidos
```

---

## J. INTERCOMPANY

### J.1 Operações Intercompany

**Cenário Exemplo:**
```
Holding aporta R$ 10 milhões na SPE-A
```

**Sem Intercompany (INCORRETO):**
- Cria Despesa na SPE-A: Aporte (R$ 10M)
- Cria Receita na Holding: Aporte (R$ 10M)
- Problema: Dois registros independentes, desligados

**Com Intercompany (CORRETO):**
- Cria 1 evento `IntercompanyTransaction`:
  ```
  id, organizationId
  deLado: {tipo: "SPE", id: speA_id, efeito: RECEITA, conta: "10001"}
  paraLado: {tipo: "Company", id: holding_id, efeito: DESPESA, conta: "50001"}
  valor: 10_000_000
  data: ...
  status: PENDING → APPROVED → RECORDED → CONSOLIDATED
  ```
- Cria:
  - `IntercompanyPayable` na Holding (deve 10M)
  - `IntercompanyReceivable` na SPE-A (tem direito 10M)
  - Vínculo único entre os dois

### J.2 Conciliação Intercompany

Operação de "aperto":

```typescript
interface IntercompanyConciliation {
  periodo: DateTime
  entidades: String[] // lista de speIds/companyIds
  resultados: {
    [key: string]: {
      receivablesTotal: Decimal
      payablesTotal: Decimal
      diferenca: Decimal
      status: BALANCEADO | DESBALANCEADO
    }
  }
  acoes: String[] // lista de problemas encontrados
}
```

---

## K. CONCILIAÇÃO BANCÁRIA

### K.1 Motor de Conciliação Automática

**Fluxo:**

1. **Ingesta**: BankTransaction recebida
2. **Limpeza**: Normalização de descrições, valores
3. **Candidatos**: Query de PayableAccount/ReceivableAccount/IntercompanyTransaction com:
   - Valor MATCH ou CLOSE (±0.01)
   - Data MATCH ou PRÓXIMA (±3 dias)
   - Descrição MATCH ou PARCIAL
4. **Scoring**: Algoritmo de confiança
   - (Valor MATCH? +50) + (Data MATCH? +25) + (Descrição MATCH? +25)
5. **Sugestão**: Top candidate com score > 70
6. **Confirmação**: Usuário aprova ou rejeita
7. **Registro**: Cria relacionamento entre BankTransaction e PayablePayment/ReceivablePayment

### K.2 Heurísticas de Matching

```
1. Valor + Data Exata
   - Confiança: ALTA

2. Valor MATCH ± 2% + Data ± 1 dia
   - Confiança: MÉDIA

3. CNPJ Fornecedor na descrição + Valor ± 5%
   - Confiança: MÉDIA

4. Referência (NF, Pedido) na descrição + Valor exato
   - Confiança: ALTA

5. Apenas Data (sem valor)
   - Confiança: BAIXA
   
6. Nenhum match
   - Status: UNRECONCILED
   - Fila manual
```

---

## L. RÉGUA DE VENCIMENTOS

### L.1 Configuração

```
Período: D-21, D-14, D-7, D-3, D0

Para cada período, marcar:
- Contas a Pagar vencidas
- Contas a Receber vencidas
- Status: VERDE (OK), AMARELO (ATENÇÃO), VERMELHO (CRÍTICO)

Criticidade Configurável por:
- CostCenter
- Fornecedor
- Valor
- Tipo de obrigação
```

### L.2 Central de Alerta

Notificações automáticas:

- **D-7**: Aviso aos gestores de contas a pagar
- **D-3**: Aviso aos cobradores de contas a receber
- **D0**: Reporte de vencimentos do dia
- **D+1**: Reporte de atrasos

---

## M. INTEGRAÇÃO COM ORÇAMENTO E CRONOGRAMA

### M.1 Fluxo de Criação de Contas

```
BudgetItem (Fase 9A)
  ↓
(Quando Atividade do Cronograma inicia)
  ↓
Cria PayableAccount PREVISTA
  - speId, costCenterId, budgetItemId
  - amount = BudgetItem.currentValue
  - dueDate = ScheduleActivity.expectedPaymentDate (configurável)
  - description = "{ScheduleActivity.code} - {BudgetItem.description}"

(Quando aprovação executiva)
  ↓
Status → APROVADA
```

### M.2 Atualização de Contas

```
Se BudgetItem.currentValue muda:
  - Atualiza PayableAccount não-paga
  - Cria registro de auditoria
  - Marca para recalcular fluxo

Se ScheduleActivity.actualStartDate muda:
  - Recalcula dueDate projetada
  - Atualiza fluxo realizado
```

---

## N. CONTABILIDADE FUTURA

**Não implementar Contabilidade na Fase 9B.**

Mas preparar contrato:

Toda `PayableAccount` e `ReceivableAccount` deve ser capaz de fornecer:

```typescript
interface ContabilizableEvent {
  evento_id: String
  data_evento: DateTime
  data_competencia: DateTime
  natureza: "DESPESA" | "RECEITA"
  centro_custo_codigo: String
  centro_custo_nome: String
  
  lancamentos: [
    {
      tipo_lancamento: "DEBITO" | "CREDITO",
      conta_contabil_codigo: String,
      descricao: String,
      valor: Decimal
    }
  ]
  
  rastreabilidade: {
    origem: "payable_id" | "receivable_id",
    documento: String,
    referencia: String
  }
}
```

---

## O. PERMISSÕES E ROLES

### O.1 Roles Propostos

```
DIRETORIA
  ├─ Ver caixa consolidado
  ├─ Aprovar contas acima de limite
  ├─ Acesso a relatórios estratégicos

CONTROLADORIA
  ├─ Acesso completo a movimentações
  ├─ Fechar períodos
  ├─ Gerar relatórios consolidados

TESOURARIA
  ├─ Gerenciar contas bancárias
  ├─ Conciliar movimentações
  ├─ Programar pagamentos
  ├─ Acompanhar posição de caixa

CONTAS A PAGAR
  ├─ Criar/editar contas a pagar
  ├─ Programar pagamentos
  ├─ Aprovar contas até limite
  ├─ Rastrear fornecedores

CONTAS A RECEBER
  ├─ Criar/editar contas a receber
  ├─ Emitir boletos/Pix
  ├─ Registrar recebimentos
  ├─ Gerenciar cobrança

FINANCEIRO_OPERACIONAL
  ├─ Criar/editar transações
  ├─ Acompanhar fluxo
  ├─ Gerar projeções

CONSULTA
  ├─ Apenas visualização
  ├─ Sem alteração de dados
```

---

## P. SEGURANÇA FINANCEIRA

### P.1 Autenticação de Fornecedor

Nunca armazenar em plaintext:
- Senhas bancárias
- Tokens de API
- Chaves de criptografia

Usar:
- `.env` para desenvolvimento
- AWS Secrets Manager / Vault para produção
- Tokens com expiração curta

### P.2 Audit Trail

Toda transação financeira requer:
- `userId` (quem fez)
- `timestamp` (quando)
- `description` (por quê)
- `before` e `after` (o quê mudou)
- `ipAddress` (de onde)

### P.3 Segregação de Obrigações

```
Criar Conta a Pagar:       FINANCEIRO_OPERACIONAL
Aprovar Conta a Pagar:      CONTAS_A_PAGAR + Limite
Pagar Conta a Pagar:        TESOURARIA
Conciliar Pagamento:        CONTROLADORIA
```

Nunca permitir mesma pessoa em 2 passos críticos.

---

## Q. PERFORMANCE E ESCALABILIDADE

### Q.1 Dados Esperados (Primeira Geração)

- **SPEs por Organização**: 5-50
- **Contas a Pagar/Mês**: 500-5.000
- **Contas a Receber/Mês**: 100-1.000
- **Transações Bancárias/Mês**: 1.000-10.000
- **Períodos Financeiros**: 24-60 meses

### Q.2 Índices Críticos

```prisma
// PayableAccount
@@index([speId, status, dueDate])
@@index([speId, competenceMonth])
@@index([costCenterId])
@@index([supplierId, dueDate])

// ReceivableAccount
@@index([speId, status, dueDate])
@@index([speId, competenceMonth])
@@index([clientId])

// BankTransaction
@@index([bankAccountId, dataMovimentacao])
@@index([organizationId, status])

// ProjectedCashFlowEntry
@@index([speId, periodo])
@@index([costCenterId, periodo])

// RealizedCashFlowEntry
@@index([speId, periodo])
@@index([costCenterId, periodo])
```

### Q.3 Snapshots Periódicos

Arquitetura de performance:

```
// Mensal: Congelar saldos
model FinancialSnapshotMonthly {
  id, speId, periodo
  saldoBancos, saldoLivre, saldoRestrito
  contasAPagarVencidas, contasAReceberVencidas
  // precalculado, nunca recalculado
}

// Trimestral: Consolidação
model FinancialSnapshotQuarterly {
  id, speId, periodo
  // agregação de monthly
}
```

---

## R. PLANO DE MIGRATIONS

### R.1 Primeira Wave (Base)

```
1. Criar tabelas de Suporte:
   - Supplier
   - Customer
   - BankAccount
   - FinancialIndex

2. Criar tabelas de Obrigação:
   - Obligation
   - Contract (se não existir; hoje apenas em JSON)

3. Criar tabelas Tier 1 (Contas Estruturadas):
   - PayableAccount
   - ReceivableAccount
   - IntercompanyTransaction

4. Criar tabelas Tier 2 (Movimentações):
   - PayablePayment
   - ReceivablePayment
   - BankTransaction
   - BankTransactionCandidate (junction para matching)

5. Criar tabelas Tier 3 (Agregações):
   - ProjectedCashFlowEntry
   - RealizedCashFlowEntry
   - FinancialSnapshotMonthly
   - FinancialSnapshotQuarterly

6. Criar tabelas de Suporte:
   - IntercompanyReconciliation
   - FinancialPeriodClosure
   - FinancialApprovalQueue
```

### R.2 Validações Pré-Produção

```
Testar:
  ✓ Isolamento multi-organização
  ✓ Isolamento multi-SPE
  ✓ Cascade deletes seguem regras
  ✓ Integridade referencial
  ✓ Índices funcionam
  ✓ Queries <500ms mesmo com 1M de registros
```

---

## S. DIVISÃO EM SPRINTS

Após Contract Freeze da Fase 9A, proposta de divisão:

### **9B.1 — FUNDAÇÃO FINANCEIRA** (2-3 semanas)
- Migrations de entidades base
- Tabelas de Suporte (Supplier, Customer, BankAccount)
- Tabelas de Conta (PayableAccount, ReceivableAccount)
- CRUD de contas
- Testes unitários

### **9B.2 — TESOURARIA E BANCOS** (2-3 semanas)
- Gestão de contas bancárias
- Integração manual de transações
- Posição de caixa agregada
- Dashboard de tesouraria (simples)
- Permissões de tesouraria

### **9B.3 — FLUXO PROJETADO vs. REALIZADO** (2-3 semanas)
- Criar contas a partir de Orçamento + Cronograma
- Cálculo de fluxo projetado
- Cálculo de fluxo realizado
- Comparações e desvios
- Projeção atualizada (EAC)

### **9B.4 — CONCILIAÇÃO + INTERCOMPANY** (2 semanas)
- Motor de conciliação automática
- Heurísticas de matching
- Conciliação manual
- Transações intercompany
- Aperto de intercompany

### **9B.5 — COBRANÇA E VENCIMENTOS** (2 semanas)
- Régua de vencimentos (D-7, D-3, D0, etc.)
- Central de alertas
- Integração com Jurídico (mock)
- Reajustes contratuais (IPCA, IGP-M, etc.)
- API de Cobrança (stub para boleto/Pix)

### **9B.6 — FECHAMENTO MENSAL E AUDITORIA** (2 semanas)
- Fluxo de fechamento de período
- Aprovals estruturados
- Relatórios consolidados
- Auditoria completa
- Testes de scenario

---

## T. TESTES PROPOSTOS

### T.1 Suíte de Testes Unitários

```
PayableAccount
  ✓ Criar conta com orçamento
  ✓ Atualizar valores
  ✓ Transição de status
  ✓ Cálculo de multa/juros
  ✓ Isolamento por SPE
  
ReceivableAccount
  ✓ Criar conta de venda
  ✓ Plano de pagamento
  ✓ Recebimento parcial
  ✓ Atualização de índice
  
Conciliação
  ✓ Match por valor + data
  ✓ Match por CNPJ
  ✓ Match por referência
  ✓ Rejeição e fila manual
  
Intercompany
  ✓ Criar transação
  ✓ Reciprocidade
  ✓ Aperto de saldos
  ✓ Consolidação
  
Fluxo
  ✓ Criar a partir de orçamento
  ✓ Recalcular com mudança de cronograma
  ✓ Projeção vs. Realizado
  ✓ EAC
  
MultiEmpresa
  ✓ Isolamento de dados
  ✓ Sem vazamento de SPE-A para SPE-B
  ✓ Consolidação correta de múltiplas SPEs
```

### T.2 Testes de Integração

```
End-to-End Fluxo Completo:
  1. Criar BudgetItem (Fase 9A)
  2. Ligar ScheduleActivity
  3. Gerar PayableAccount (9B)
  4. Processar pagamento
  5. Reconciliar com banco
  6. Validar histórico completo
  
Cenários de Stress:
  - 10.000 contas a pagar/mês
  - Conciliação de 1.000 transações
  - Consolidação de 50 SPEs
  - Query de fluxo de 24 períodos
```

---

## U. RISCOS TÉCNICOS E MITIGAÇÕES

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| **Dados Duplicados** | Alto | One-to-one linkage entre Conta e Pagamento; imports com idempotency |
| **Performance Query** | Médio | Índices agressivos + snapshots mensais |
| **Perda de Auditoria** | Crítico | Nenhum DELETE; apenas CANCELAMENTO com auditoria |
| **Erro de Conciliação** | Médio | Motor automático + revisão manual obrigatória |
| **Erro Intercompany** | Alto | Criação de linked transactions, não independentes |
| **Deficit de Caixa Não Detectado** | Alto | Projeção EAC com alertas D-7, D-3 |
| **CNPJ Duplicado** | Médio | Unique constraints em (organizationId, cnpj) |
| **Isolamento Multi-Tenant** | Crítico | Filtros em TODA query; testes de isolamento |

---

## V. PONTOS QUE PRECISAM ESPERAR A FASE 9A

### Bloqueadores Críticos:

1. ✋ **Company, SPE, CostCenter Schema** — Aguardando migration 9A
2. ✋ **ApprovedBase Congelado** — Aguardando Contract Freeze 9A
3. ✋ **BudgetItem Schema** — Aguardando implementação 9A
4. ✋ **ScheduleActivity Schema** — Aguardando cronograma 9A

### Pontos de Ajuste (Esperados):

- Relacionamentos exatos entre as tabelas (FK paths)
- Valores default e constraints exatos
- Nomenclatura de campos (pode haver diferenças)
- Versões de Prisma e decoradores

---

## W. RELATÓRIO FINAL DE READINESS

### Arquivos Analisados:

✅ `prisma/schema.prisma` — 3.413 linhas, Enums + Models estudados  
✅ `src/app/page.tsx` — Home + inicialização START BUTANTÃ  
✅ `src/components/investment-suite-view.tsx` — Views de investimento  
✅ Estrutura de projeto TypeScript/Next.js  

### Arquivos NÃO Alterados:

✅ Schema Prisma — Intacto (apenas análise)  
✅ Migrations — Nenhuma criada  
✅ Models compartilhados — Nenhum modificado  
✅ Enums — Nenhum novo  
✅ Código-fonte — Nenhuma alteração  

### Dependências Críticas da Fase 9A:

1. ⏳ Entidades: Company, SPE, CostCenter, ApprovedBase, BudgetItem, ScheduleActivity
2. ⏳ Migrations da Fase 9A precisam ser executadas primeiro
3. ⏳ Schema de Fase 9A precisa estar em Contract Freeze

### Confiança de Arquitetura:

- **Isolamento Multi-Tenant**: ✅ Validado (pattern já existe)
- **Versionamento e Snapshots**: ✅ Validado (pattern já existe)
- **Auditoria**: ✅ Fundação presente (AuditLog já existe)
- **Performance**: ✅ Indexação estratégica (será aplicada)
- **Intercompany**: ⚠️ Novo conceito, mas arquitetura sólida
- **Conciliação**: ⚠️ Novo, complexidade média

---

## PRÓXIMOS PASSOS

### Imediato (Antes do Contract Freeze da 9A):

1. **Codex** (9A): Consolidar Schema com Company, SPE, CostCenter, ApprovedBase, BudgetItem, ScheduleActivity
2. **Equipe**: Revisar este documento e validar premissas
3. **Arquitetura**: Revisar relacionamentos entre domínios 9A ↔ 9B

### Após Contract Freeze da 9A:

1. **Claude** (9B): Criar migrations de Fase 9B.1 (Fundação)
2. **Claude** (9B): Implementar CRUD de PayableAccount, ReceivableAccount
3. **Testes**: Suite de testes unitários de contas

### Estratégia de Integração Contínua:

- Cada sprint da Fase 9B roda testes contra contracts da Fase 9A
- Se Fase 9A mudar um contract, Fase 9B detecta e falha (não silent breaking)
- Contract Freeze obrigatório para passar de sprint

---

## DOCUMENTAÇÃO DE REFERÊNCIA

Este documento é o **Single Source of Truth** para a Fase 9B.

Toda decisão de design, estrutura de dados, estado, permissão, teste, risco deve ser tracevel a uma seção deste documento.

**Versionamento:**
- v1.0 — 20.08.2026 — Planejamento inicial
- (futuras versões conforme evolução)

---

**Preparado por:** Claude AI  
**Repositório:** REDE Intelligence  
**Organização:** REDE  
**Data:** 20 de Agosto de 2026  

🔒 **Confidencial** — Apenas para equipe técnica REDE
