# FASE 9E — VENDAS, CLIENTES, UNIDADES, CONTRATOS DE VENDA, RECEBÍVEIS E PÓS-VENDA
## Plano Arquitetural Profundo (Planejamento — Não Implementado)

**Data de preparação:** 21 de agosto de 2026
**Status:** Planejamento pré-implementação
**Branch:** `planning/fase-9e-vendas-recebiveis`
**Base:** `rede-phase-9c-complete-2026-08-21` (commit `d933e83`)
**Preparado por:** Claude AI — análise do repositório real, nenhum código alterado

---

## SUMÁRIO EXECUTIVO

A Fase 9E conecta o produto imobiliário (unidade) ao cliente, à venda, ao contrato e ao plano de pagamento, e entrega os recebíveis à Fase 9B pelo **mesmo mecanismo idempotente que a Fase 9C já usa e comprovou em produção** para gerar contas a pagar a partir de medições. Não há financeiro paralelo: a 9E decide o evento comercial, a 9B executa o efeito financeiro.

Achado mais importante desta análise: **o padrão de integração que a 9E precisa já existe, funciona, e tem testes passando** — `FinancialIntegrationEvent` + `src/application/financial-ops/external-obligation-port.ts` (`createExternalPayableObligation`/`reverseExternalPayableObligation`), usado por `src/application/procurement/procurement-service.ts` para levar uma `MeasurementCertificate` aprovada até um `PayableAccount`. A 9E deve **espelhar esse padrão para o lado do recebível**, não inventar um novo.

---

## A. ESTADO ATUAL DO REPOSITÓRIO

### A.1 Schema (5.921 linhas, 189 models)

Confirmado por leitura direta de `prisma/schema.prisma` nesta branch (base 9C):

- **Fase 9A** (operacional): `Project`, `Company` (tipo `SPE|HOLDING|INCORPORATOR|SERVICE_PROVIDER|ADMINISTRATOR|OTHER`), `EconomicGroup`, `ProjectOperatingUnit` (hierarquia livre de fase/torre/bloco/etapa), `CostCenter`, `EconomicItem`, `OperationalBaseline(Line)`, `Budget`/`BudgetLineItem`, `OperationalSchedule`/`ScheduleActivity`/`ScheduleAllocation`.
- **Fase 9B** (financeiro): `Supplier`, `Customer`, `BankAccount`, `FinancialInstitution`, `FinancialObligation`, `PayableAccount/Installment/Payment`, `ReceivableAccount/Installment/Payment`, `BankTransaction`, `ReconciliationMatch`, `FinancialTransfer`, `IntercompanyTransaction`, `FinancialIndex`, `CorrectionRule`, `InstallmentAdjustment`, `FinancialPeriodClosure`.
- **Fase 9C** (compras/contratos/medições): `SupplierQualification`, `ProcurementNeed`, `PurchaseRequisition(Item)`, `ProcurementSpecification`, `QuotationProcess/Invitation`, `SupplierProposal(Item)`, `ProposalComparisonFinding`, `ProcurementDecision`, `ValidatedSaving`, `ApprovalPolicy/Request/DecisionRecord`, `PurchaseOrder(Item)`, `OperationalContract(Item)`, `ContractAmendment`, `ContractAdvance`, `MeasurementCertificate/Line/Adjustment`, `AdvanceAmortization`, **`FinancialIntegrationEvent`**, `ProcurementDocumentLink`.
- **Fase 6** (Investment/Data Room): `ProjectDocument`/`DocumentChecklistItem` — escopados por `investmentCaseId`, **não** genéricos.
- **Fase 8** (Design/BIM): `DesignProjectPackage`/`DesignRevision`, `DetectedUnit` (unidade detectada por IA em plantas/IFC: `unitKey`, `unitType`, `floor`, `tower`, `privateArea`, `balconyArea`, `rooms`, `bathrooms`, `parkingAssociation`, `confidence`, `origin`, `geometryRef`).

### A.2 Não existe hoje

- Qualquer entidade de **unidade comercial/estoque** (`Unit`, `Apartment`, `Lot`). `ProjectOperatingUnit` é uma **estrutura de agrupamento** (torre/bloco/etapa), não um estoque individual vendável. `DetectedUnit` é uma **leitura geométrica derivada do projeto** (Design/BIM), não um objeto comercial com preço/status de venda.
- Qualquer entidade de **cliente comprador dedicado** além de `Customer` (9B) — que já existe e já é usado exatamente para o papel de "quem recebe" (`receivableAccounts ReceivableAccount[]`).
- Qualquer **corretor/imobiliária/comissão**.
- Qualquer **proposta, reserva, venda, contrato de venda, plano de pagamento comercial**.
- **Correção de parcela do lado do recebível.** `applyPayableInstallmentCorrection` existe em `financial-service.ts`; **não existe** `applyReceivableInstallmentCorrection`. Isso é uma lacuna real da 9B que a 9E vai expor com força total, porque correção monetária de parcela de venda (INCC/IPCA/IGP-M) é o caso de uso mais comum de correção no imobiliário — muito mais do que correção de conta a pagar.

### A.3 Padrões arquiteturais confirmados por leitura de código (não por suposição)

1. **Multi-tenant**: toda entidade material carrega `organizationId`; toda query de serviço filtra por ele; testes de isolamento cruzado existem para cada fase (`rejects.toThrow("não encontrado nesta organização")`).
2. **Versionamento imutável**: `Budget.version`, `OperationalSchedule.version`, `OperationalBaseline.version`, `ApprovalRequest.entityVersion`, `MeasurementCertificate.version` (inferido pelo uso em `procurement-service.ts`) — nunca sobrescrita, sempre nova linha com `previousXId`.
3. **RBAC de 5 papéis** (`MembershipRole`: `OWNER, ADMIN, ANALYST, REVIEWER, VIEWER`) — **não mudou desde a 9A**. Toda fase até agora mapeou papéis de negócio (financeiro, tesouraria, controladoria, comprador, aprovador) para esses 5 papéis técnicos combinados com **alçada por valor/categoria** (`ApprovalPolicy`), não com papéis dedicados.
4. **Motor de alçadas genérico e reutilizável**: `ApprovalPolicy` (por `actType`, faixa de valor, `requiredRole`, `requiredApprovals`, `segregationRequired`) + `ApprovalRequest` (polimórfico via `entityType/entityId/entityVersion`, `@@unique` nesses quatro campos + `actType` — impede duplo pedido de aprovação para a mesma versão da mesma entidade) + `ApprovalDecisionRecord`. **Isto é exatamente o motor de alçada que os itens 13 e 21 do briefing pedem.** Não deve ser recriado.
5. **Padrão de integração financeira idempotente** (o achado central desta análise, detalhado na Seção Q).
6. **Documentos**: dois padrões coexistem hoje, com escopos diferentes —
   - `ProjectDocument`/`DocumentChecklistItem`: escopado a `InvestmentCase`, não genérico, não reutilizável fora do Data Room de investimento.
   - `ProcurementDocumentLink`: **genérico** (`entityType/entityId`, org-scoped, versionado, com checksum, `isPrivate`) — nasceu na 9C mas seu formato não tem nada específico de compras. Este é o padrão certo para a 9E reutilizar.
7. **REDE IA**: ferramentas somente-leitura, nomenclatura `get*`/`compare*`, sempre lendo de um workspace de leitura consolidado (`getFinancialWorkspace`, `getProcurementWorkspace`, `getOperationsWorkspace`) — nunca recalculando no LLM. Evidência sempre anexada via `evidence({sourceType, entityType, entityId, evidenceRef, label, value})`.
8. **`Supplier`** já é, na prática, um modelo de **contraparte de serviço genérica** (nome, `personType` PF/PJ, `taxId`, dados bancários, status) — usado por 9B (fornecedor de conta a pagar) e 9C (fornecedor de compra/contrato). É o candidato natural para representar **corretor/imobiliária** (Seção J), não uma nova entidade.

---

## B. DEPENDÊNCIAS 9A/9B/9C (CONTRATOS QUE A 9E CONSOME, NÃO ALTERA)

| Da fase | Entidade | Uso pela 9E |
|---|---|---|
| 9A | `Project` | Empreendimento — toda Unidade/Venda pertence a um `projectId` |
| 9A | `Company` (tipo `SPE`) | Empresa vendedora — toda Venda/Contrato carrega `companyId` |
| 9A | `ProjectOperatingUnit` | Torre/bloco/etapa — pai estrutural opcional da Unidade comercial |
| 9A | `AssumptionSnapshot` | `units`, `unitPrice`, `salesVelocityUnitsMonth`, `salesStartDelayMonths`, `downPaymentRate`, `duringConstructionRate`, `onDeliveryRate` — base de comparação Previsto × Realizado (Seção AA/46) |
| 9A | `CostCenter`, `EconomicItem` | Rastreabilidade de comissão como custo comercial, quando aplicável |
| 9B | `Customer` | **Reutilizado como está** para comprador |
| 9B | `Supplier` | **Reutilizado como está** para corretor/imobiliária |
| 9B | `ReceivableAccount/Installment/Payment` | Destino final de todo recebível de venda — 9E nunca cria uma tabela paralela |
| 9B | `FinancialObligation` (nature `RECEIVABLE`, origin `SALE`) | Já suporta `origin: SALE` no enum `ObligationOrigin` — confirmado no schema |
| 9B | `FinancialIndex`, `CorrectionRule`, `InstallmentAdjustment` | Motor de correção — 9E aciona, não duplica (ver lacuna real na Seção A.2/S) |
| 9B | `BankAccount`, `BankTransaction`, `ReconciliationMatch` | Cobrança/recebimento — 9E nunca implementa conciliação própria |
| 9B | `FinancialIntegrationEvent`, `external-obligation-port.ts` | **Mecanismo de integração a espelhar** (Seção Q) |
| 9C | `ApprovalPolicy/Request/DecisionRecord` | Motor de alçada a reutilizar para desconto/venda/distrato/comissão |
| 9C | `ProcurementDocumentLink` | Padrão de documento genérico a reutilizar |
| 9C | `OperationalContract` (modelo, não a tabela) | Referência de forma para `SalesContract` — campos análogos: número, título, contraparte, empresa, valor original/atual, moeda, vigência, status, versão |

**Nenhum desses contratos precisa mudar para a 9E existir.** A única extensão necessária em código já existente (não em migration nova da 9E, mas coordenada com quem mantém a 9B) é a função simétrica `applyReceivableInstallmentCorrection` em `financial-service.ts` — ver Seção S.

---

## C. DEPENDÊNCIAS DA 9D (EM IMPLEMENTAÇÃO PARALELA)

**Não inspecionado.** A 9D está sendo implementada em um worktree separado (`rede-codex-9d`, branch `feature/fase-9d-juridico-diligencia`) por outro agente, em paralelo a esta análise. Por isolamento de responsabilidade e para não gerar condição de corrida conceitual com trabalho em andamento, esta análise **não leu o código da 9D** — apenas seu escopo nominal (Jurídico, Diligência, Obrigações e Licenças) conforme descrito no prompt.

A relação correta, por design, é **9E não bloqueada por 9D**: a 9E decide o evento comercial (venda, distrato) e usa `ProcurementDocumentLink` (ou equivalente) para anexar documentos desde o primeiro dia — sem depender de nenhuma entidade jurídica. Quando a 9D existir, os pontos de integração serão referências opcionais (FK nullable), nunca obrigatórias. Detalhamento nas Seções AO/AP.

---

## D. DOMÍNIO COMERCIAL — VISÃO GERAL

```text
Produto (Design/Engine) ─┐
                          ├─→ Unidade (estoque) ─→ Tabela de Preços ─→ Preço da Unidade
ProjectOperatingUnit ────┘                                                    │
                                                                                ▼
Cliente (Customer 9B) ──┐                                                  Proposta
Corretor (Supplier 9B) ─┤                                                     │
                         └─────────────────────────────────────────────→  Reserva
                                                                                │
                                                                                ▼
                                                                    Aprovação Comercial (9C engine)
                                                                                │
                                                                                ▼
                                                                              Venda (congela tudo)
                                                                                │
                                                                                ▼
                                                                Contrato de Venda + Plano de Pagamento
                                                                                │
                                                            ┌───────────────────┴────────────────────┐
                                                            ▼                                          ▼
                                            Recebíveis na 9B (idempotente,                    Comissão → Obrigação
                                            via FinancialIntegrationEvent)                     a pagar na 9B (idempotente)
                                                            │
                                                            ▼
                                            Cobrança/Recebimento/Conciliação (100% 9B)
                                                            │
                                                            ▼
                                            Renegociação / Distrato (evento comercial 9E,
                                            efeito financeiro 9B)
                                                            │
                                                            ▼
                                            Entrega → Vistoria → Pós-venda
```

---

## E. UNIDADES

Nova entidade proposta: **`SalesUnit`** (nome de trabalho — evitar `Unit` puro por colidir semanticamente com `ProjectOperatingUnit`/`DetectedUnit` em buscas de código).

Campos conceituais: `projectId`, `companyId`, `operatingUnitId?` (torre/bloco via `ProjectOperatingUnit`, opcional), `detectedUnitId?` (proveniência BIM/Design via `DetectedUnit`, opcional — ver Seção AR/49), `code` (número/identificador único no empreendimento), `floor`, `typology`, `privateAreaM2`, `totalAreaM2?`, `parkingSpaces`, `storageUnits`, `position` (ex.: "leste", "vista mar"), `characteristics` (Json — features livres), `status` (máquina de estados, Seção F), `basePriceListId?` (tabela vigente), `createdById`, timestamps.

**Vínculo com Design/BIM (não duplicar)**: quando o projeto tem `DetectedUnit` processada, `SalesUnit.detectedUnitId` referencia a leitura geométrica (área, tipologia, torre/pavimento já extraídos por IA). A `SalesUnit` **não recopia** área/tipologia da `DetectedUnit` — lê por referência; se a `DetectedUnit` for reprocessada (nova revisão de projeto), a `SalesUnit` mantém sua própria FK e a UI sinaliza divergência, sem sobrescrever silenciosamente. Quando não há BIM processado (a maioria dos casos no início), os campos são preenchidos manualmente e `detectedUnitId` fica nulo — **a 9E nunca deve exigir BIM para vender**.

**Vínculo com o Engine**: `SalesUnit` é o detalhamento por unidade do que `AssumptionSnapshot.units`/`unitPrice` representa de forma agregada. A soma de `SalesUnit` vendidas não precisa (e não deve) ser forçada a bater com `AssumptionSnapshot.units` em tempo real — é comparação (Seção AA), não substituição.

---

## F. STATUS DA UNIDADE (MÁQUINA DE ESTADOS)

```text
DISPONIVEL
  → EM_RESERVA (reserva criada, ainda não confirmada — janela curta)
  → RESERVADA (reserva confirmada/paga sinal, se política exigir)
  → EM_PROPOSTA (proposta formal em análise)
  → VENDIDA (venda aprovada e registrada)
  → BLOQUEADA (ver Seção G — origem/motivo obrigatórios; pode ocorrer a partir de DISPONIVEL, EM_RESERVA, EM_PROPOSTA)
  → PERMUTA (reservada para operação de permuta, tratada como sub-caso de BLOQUEADA com origem="PERMUTA")
  → DISTRATADA (a partir de VENDIDA; ver Seção W — venda original preservada como histórica)
  → ENTREGUE (a partir de VENDIDA, terminal para a unidade em si; a venda segue existindo)

Reversões permitidas: EM_RESERVA/RESERVADA/EM_PROPOSTA → DISPONIVEL (expiração ou cancelamento)
                       DISTRATADA → DISPONIVEL (após efeitos financeiros resolvidos — Seção W)
Transições proibidas: qualquer→VENDIDA fora do fluxo de Venda aprovada; VENDIDA→DISPONIVEL direto (deve passar por DISTRATADA)
```

Cada transição grava em `AuditLog`/log próprio: de, para, ator, timestamp, motivo (obrigatório para `BLOQUEADA`, `DISTRATADA`, reversões).

---

## G. BLOQUEIOS

`SalesUnitBlock` (registro, não apenas um enum de status): `salesUnitId`, `origin` (`PERMUTA|JURIDICO|DIRETORIA|INCORPORACAO|COMERCIAL|TECNICA|OUTRO`), `responsibleId`, `reason`, `startedAt`, `endedAt?`, `createdById`. Histórico completo — bloqueios nunca são apagados, apenas encerrados (`endedAt`). A `SalesUnit.status = BLOQUEADA` é a projeção do bloqueio ativo mais recente; o registro é a fonte de verdade auditável.

---

## H. TABELA DE PREÇOS

`SalesPriceTable`: `projectId`, `companyId`, `version` (int, sequencial, nunca reaproveitado), `validFrom`, `validUntil?`, `responsibleId`, `status` (`DRAFT|ACTIVE|SUPERSEDED|EXPIRED`), `discountPolicyId?` (Seção M), `notes`. `@@unique([projectId, version])`. Igual ao padrão `Budget`/`OperationalSchedule`: **nova versão, nunca update destrutivo**. Ativar uma versão marca a anterior como `SUPERSEDED` (mesmo padrão de `approveOperationalBaseline` em `operations-service.ts`).

`SalesPriceTableLine`: `priceTableId`, `salesUnitId`, `listPrice`, `pricePerM2` (derivado, não armazenado — calculado em domínio puro), `minimumAuthorizedPrice?`. `@@unique([priceTableId, salesUnitId])`.

---

## I. PREÇO DA UNIDADE (POR VENDA/PROPOSTA)

Nunca um único campo "preço" — cada estágio guarda seu próprio valor, todos rastreáveis até a tabela de origem:

- `listPrice` (da `SalesPriceTableLine` vigente no momento).
- `proposedPrice` (na `SalesProposal`).
- `minimumAuthorizedPrice` (da tabela — trava para alçada, Seção M/N).
- `soldPrice` (congelado na `Sale`, nunca recalculado depois).
- `discountAmount`/`discountPercentage` (derivado de `listPrice` e `soldPrice`, mas persistido explicitamente para auditoria — não recalculado silenciosamente se a tabela mudar depois).
- `incentiveAmount?`, `tradeInValue?` (permuta), `specialConditionNotes?`.

---

## J. PREÇO POR M² (INDICADORES — CÁLCULO, NÃO ARMAZENAMENTO)

Funções puras de domínio (`sales-engine.ts`, análogo a `financial-ops/engine.ts`): `pricePerM2(price, privateAreaM2)`, agregações por tipologia/torre/pavimento/estoque a partir de `SalesUnit` + `SalesPriceTableLine`/`Sale`. Nenhum campo `pricePerM2` armazenado — mesmo princípio já usado em toda a base (saldo de conta, posição de caixa: sempre calculado).

---

## K. POLÍTICA DE DESCONTO (ALÇADA — REUTILIZAR 9C, NÃO CRIAR NOVA)

**Não criar uma tabela de política de desconto dedicada.** Usar `ApprovalPolicy` (9C) com `actType` novo (`SALE_DISCOUNT`, a adicionar ao enum `ApprovalActType` em migration futura da 9E) e faixas por `minimumAmount`/`maximumAmount`/`requiredRole` — exatamente o mesmo mecanismo que já governa alçada de compra. Exemplo: política `actType=SALE_DISCOUNT, maximumAmount=5% do listPrice, requiredRole=ANALYST` (vendedor), outra com `requiredRole=ADMIN` (gerente), outra sem teto com `requiredRole=OWNER` (diretoria). A "trava de percentual configurável, não hardcoded" do item 13 já é exatamente o que `ApprovalPolicy` oferece.

---

## L. CLIENTE

**Decisão: reutilizar `Customer` (9B) sem criar nova entidade.** Já suporta `personType` (PF/PJ), `taxId`, `email`, `phone`, `status`, isolamento por `organizationId`. Extensões necessárias (campos adicionais, não nova tabela) a propor para uma migration futura coordenada com 9B: endereço estruturado, dados de contato adicionais, campo de origem (`leadSource`).

**Co-compradores e representantes**: não modelar como campos múltiplos em `Customer`. Modelar como tabela de junção `SaleParty` (`saleId`, `customerId`, `role`: `BUYER|CO_BUYER|REPRESENTATIVE|GUARANTOR`, `ownershipPercentage?`) — permite N compradores por venda sem duplicar `Customer`, e permite que a mesma pessoa seja `Customer` em uma venda e `REPRESENTATIVE` em outra.

**Evitar cadastro duplicado**: antes de criar `Customer`, buscar por `taxId` dentro da organização (`@@unique([organizationId, taxId])` já impõe isso no banco — a camada de serviço deve fazer `findFirst` antes de `create` e oferecer reaproveitar o registro existente, como já é convenção em outras fases desta base (`upsert` no seed, `findFirst` antes de criar em todos os serviços lidos).

---

## M. LGPD / PRIVACIDADE

- **Minimização**: não copiar documentos de identidade para múltiplas tabelas — um único local (Sala de Documentos, Seção AD) com referência, nunca duplicação de arquivo.
- **Mascaramento**: `taxId`/dados bancários nunca expostos em texto pleno em telas de listagem — padrão já usado (nenhuma fase anterior expõe `bankData` em massa; `Supplier.bankData` é `Json?` acessado pontualmente, não listado).
- **Acesso**: leitura de dados de `Customer` sujeita ao mesmo RBAC/tenant isolation de toda a base — nenhuma exceção.
- **Retenção**: fora de escopo desta fase definir política de expurgo; documentar como pendência para uma fase de conformidade dedicada (não inventar prazo agora).
- **Logs**: toda leitura sensível (documento de identidade, dados bancários) deveria, no futuro, gerar `AuditLog` de acesso, não só de mutação — hoje `AuditLog` só registra mutações em toda a base; **isto é uma lacuna pré-existente, não uma criação da 9E**, mas a 9E deve não piorá-la.

---

## N. LEAD / CRM — ESCOPO DELIBERADAMENTE PEQUENO

A 9E **não** é um CRM de marketing. Objetos mínimos propostos: `SalesLead` (`name`, `contact`, `source`, `channel`, `brokerId?`, `stage`: `NOVO|EM_ATENDIMENTO|PROPOSTA|PERDIDO|CONVERTIDO`, `lostReason?`). Um `SalesLead` convertido gera (ou se vincula a) um `Customer` — nunca os dois coexistem como fontes de verdade da mesma pessoa. Funil de marketing, automação de nutrição, scoring de lead: **fora de escopo**, ficam para fase posterior se o negócio pedir.

---

## O. CORRETOR / IMOBILIÁRIA

**Decisão: reutilizar `Supplier` (9B/9C) para representar corretor e imobiliária**, com `personType` distinguindo pessoa física (corretor autônomo) de pessoa jurídica (imobiliária). Campos específicos de corretagem (CRECI, canal, vínculo com imobiliária-mãe) propostos como extensão pontual de `Supplier` (nullable, não quebra 9B/9C) **ou** uma tabela satélite `BrokerProfile` (`supplierId`, `creci?`, `parentAgencyId?` auto-referência para corretor vinculado a imobiliária, `defaultCommissionRate?`) se o time preferir não poluir `Supplier` com campos imobiliário-específicos. Recomendação: tabela satélite — mantém `Supplier` genérico para 9B/9C/9E sem acoplar semântica de corretagem a um modelo compartilhado.

---

## P. PROPOSTA

`SalesProposal`: `salesUnitId`, `customerId` (comprador principal — coautores via `SaleParty` só existem a partir da `Sale`, proposta é mais simples), `brokerId?`, `priceTableId`, `proposedPrice`, `discountAmount`, `paymentConditionSummary` (Json — esboço do plano, não parcelas reais ainda), `validUntil`, `status` (`DRAFT|SUBMITTED|UNDER_APPROVAL|APPROVED|REJECTED|EXPIRED|CONVERTED`), `approvalRequestId?` (link para `ApprovalRequest` quando o desconto exigir alçada). **Proposta não altera `SalesUnit.status` para além de `EM_PROPOSTA`, e nunca vende a unidade sozinha** — confirma o item 18 do briefing.

---

## Q. RESERVA

`SalesReservation`: `salesUnitId`, `customerId`, `startedAt`, `expiresAt`, `responsibleId`, `condition` (Json — sinal exigido, prazo), `status` (`ACTIVE|CONFIRMED|EXPIRED|CANCELLED|CONVERTED`). Expiração: **não é um cron job na 9E** — é calculada em leitura (`expiresAt < now() && status === 'ACTIVE'` ⇒ tratada como expirada, análogo a `isInstallmentOverdue` da 9B, que também é campo computado, não armazenado) mais uma rotina de liberação explícita chamada pela mesma leitura que já popula o workspace comercial (mesmo padrão do `getFinancialWorkspace` que calcula vencido em tempo de leitura). Isso evita duplicar o problema "status desatualizado" que a 9B já resolveu para parcela.

---

## R. CONCORRÊNCIA POR UNIDADE (RISCO REAL IDENTIFICADO NA BASE ATUAL)

**Achado de risco, não hipotético**: toda transição de status nesta base (9A/9B/9C) segue o padrão `findFirst` → validar → `$transaction` → `update`. Isso é **suficiente para transições de negócio comuns**, mas **não é atomicamente seguro sob concorrência real** — duas requisições simultâneas podem ambas passar pelo `findFirst` antes que a primeira `update` seja commitada. Nenhuma fase anterior precisou se preocupar com isso porque nenhuma tem um recurso escasso e contestado por múltiplos atores ao mesmo tempo (conta a pagar não é "disputada" por dois usuários). **Unidade à venda é.**

**Recomendação para a 9E (a implementar, não apenas planejar em texto solto)**: reservar/vender uma unidade deve usar `updateMany` com o status esperado **na cláusula `where`**, checando `count === 1`:

```ts
const result = await tx.salesUnit.updateMany({
  where: { id: salesUnitId, status: "DISPONIVEL" },
  data: { status: "EM_RESERVA" },
});
if (result.count === 0) throw new Error("Unidade não está mais disponível — outra operação a alterou primeiro.");
```

Isso é uma mudança de padrão pequena e local (não exige lock de banco, não exige fila) que resolve o item 20/70 do briefing de forma real. Deve ser aplicado em toda transição `SalesUnit.status`, não só na reserva.

---

## S. APROVAÇÃO COMERCIAL

Reutilizar `ApprovalPolicy`/`ApprovalRequest`/`ApprovalDecisionRecord` (Seção K) para: desconto acima de alçada, venda com condição atípica, exceção de prazo, aprovação de comissão. Novos valores de `ApprovalActType` a propor (migration futura, coordenada): `SALE`, `SALE_DISCOUNT`, `SALE_RESCISSION`, `COMMISSION`.

---

## T. VENDA

`Sale`: `projectId`, `companyId`, `salesUnitId`, `priceTableId`, `proposalId?`, `reservationId?`, `brokerId?`, `soldPrice`, `discountAmount`, `commercialConditionSnapshot` (Json — congela a condição negociada), `paymentPlanId` (Seção U), `status` (`DRAFT|UNDER_APPROVAL|APPROVED|CANCELLED`), `approvalRequestId?`, `version` (int — igual ao padrão `Budget.version`; uma renegociação relevante pode gerar nova versão da venda preservando a anterior), `createdById`, timestamps. Ao aprovar: `SaleParty` (compradores) é congelado, `SalesUnit.status → VENDIDA` (via `updateMany` condicional, Seção R), documentos vinculados via `ProcurementDocumentLink` com `entityType="Sale"`.

---

## U. CONTRATO DE VENDA

`SalesContract`: `saleId`, `projectId`, `companyId` (SPE vendedora), `number`, `title`, `buyers` (via `SaleParty`, não campo duplicado), `soldPrice`, `commercialCondition` (Json), `signatureStatus` (`PENDING|PARTIALLY_SIGNED|SIGNED` — placeholder até 9D/assinatura eletrônica existir, Seção AH), `effectiveFrom`, `status` (`DRAFT|ACTIVE|AMENDED|RESCINDED`), `version`. Estrutura de forma deliberadamente próxima a `OperationalContract` (9C) — mesmo vocabulário (`number`, `title`, `status`, `version`, valor original vs. atual) para quem já conhece o padrão de contrato da base.

---

## V. PLANO DE PAGAMENTO

`SalesPaymentPlan`: `saleId`, `version`, `status` (`DRAFT|ACTIVE|SUPERSEDED|CANCELLED`). `SalesPaymentPlanInstallment`: `planId`, `number`, `nature` (`DOWN_PAYMENT|MONTHLY|INTERMEDIATE|ANNUAL|KEYS|FINANCING|BALANCE|REINFORCEMENT|CUSTOM`), `dueDate`, `amount`, `correctionRuleId?` (aponta para `CorrectionRule` da 9B — não duplica índice), `origin`. Este plano é **comercial** — a materialização financeira real (o que a 9B efetivamente cobra) é o `ReceivableInstallment` gerado pela Seção W. O plano pode ser revisado (nova `version`) sem tocar nos recebíveis já gerados de versões anteriores; a reconciliação entre plano comercial vigente e recebíveis já emitidos é responsabilidade explícita do processo de sincronização (Seção W), não implícita.

---

## W. INTEGRAÇÃO 9E → 9B (SEÇÃO CENTRAL — PADRÃO A ESPELHAR, NÃO A INVENTAR)

### W.1 O padrão já existe e funciona (evidência de código real)

`src/application/procurement/procurement-service.ts` (linha ~300) leva uma `MeasurementCertificate` aprovada até um `PayableAccount`:

1. Calcula `sourceType`/`eventType` determinísticos.
2. `idempotencyKey = sha256(organizationId:sourceType:sourceId:sourceVersion:eventType)`.
3. `payloadChecksum = sha256(JSON dos campos financeiros relevantes)`.
4. Verifica replay: busca evento existente com o mesmo `idempotencyKey` e `status = "PROCESSED"`; se existir, retorna sem duplicar.
5. Dentro de uma `$transaction`: cria `FinancialIntegrationEvent` (`status: "PROCESSING"`), chama `createExternalPayableObligation(tx, command)` (de `external-obligation-port.ts`), que cria `FinancialObligation` + `PayableAccount` + parcela, e finalmente marca o evento `PROCESSED`.
6. `reverseExternalPayableObligation` trata o caminho inverso, bloqueando reversão se já houve pagamento efetivo.

### W.2 O que a 9E precisa (espelhar, não copiar-colar)

- Nova função `createExternalReceivableObligation(tx, command)` em `external-obligation-port.ts` (ou um arquivo irmão `external-receivable-port.ts` se o time preferir não misturar direções no mesmo arquivo) — mesma forma de `createExternalPayableObligation`, mas criando `FinancialObligation(nature: RECEIVABLE, origin: SALE)` + `ReceivableAccount` + `ReceivableInstallment`.
- `FinancialIntegrationEvent` precisa de um campo `receivableAccountId String? @unique` **novo, adicionado em migration da 9E** (não altera a migration da 9B/9C já aplicada) — hoje só tem `payableAccountId`.
- Novos valores em `FinancialIntegrationEventType`: `SALE_CONTRACT_SIGNED`, `SALE_PLAN_REVISED`, `SALE_INSTALLMENT_RENEGOTIATED`, `SALE_RESCINDED`, `COMMISSION_APPROVED` — mesma migration.
- `sourceType = "SALE_INSTALLMENT"`, `sourceId = saleId` (ou `paymentPlanId`), `sourceVersion = SalesPaymentPlan.version`.

### W.3 Caso de teste obrigatório (Cenário A do item 69)

```text
Venda com 10 parcelas → createExternalReceivableObligation chamado 10 vezes
(uma por parcela, cada uma com sourceId=saleId+numero da parcela OU
sourceId=paymentPlanId com sourceVersion fixo e eventos por parcela — decisão
de design a fechar na implementação, não neste plano) → exatamente 10 ReceivableInstallment.
Replay do mesmo comando → continua 10, nenhuma duplicada — garantido pelo mesmo
@@unique([organizationId, sourceType, sourceId, sourceVersion, eventType]) que já
protege o lado do pagável.
```

### W.4 Comissão (Seção X) usa o mesmo mecanismo, mas do lado pagável

Comissão aprovada chama `createExternalPayableObligation` (já existe, não precisa de nada novo) com `sourceType = "SALE_COMMISSION"`, `sourceId = saleId`, `supplierId = brokerId` (via `Supplier`, Seção O). **Nunca criar um `Accounts Payable` comercial paralelo** — resposta direta ao item 36.

---

## X. RECEBÍVEIS (VISÃO COMERCIAL — LEITURA, NÃO CÓPIA)

A 9E não guarda saldo, vencido, recebido — **lê** de `getFinancialWorkspace` (9B) filtrando por `ReceivableAccount.origin = SALE` e por `saleId` (via `FinancialIntegrationEvent.payload` ou uma FK direta `ReceivableAccount → Sale`, a definir na implementação — recomenda-se FK direta nullable `saleId` em `ReceivableAccount`, adicionada na mesma migration da 9E, para evitar parsing de `payload` Json em toda consulta). A "visão comercial de recebíveis" (item 42) é uma composição em cima do workspace da 9B, não um recálculo.

---

## Y. ÍNDICES

Reutilizar `FinancialIndex`/`CorrectionRule` (9B) integralmente. **Nenhuma tabela de índice na 9E.**

---

## Z. COBRANÇA

A 9E não implementa central de cobrança — consome o que a 9B já expõe (`getPayablesDue`-equivalente do lado de recebíveis: `getReceivablesDue`, régua de vencimento `buildDueHorizons`). Integração comercial adicional (comunicação, segunda via) é camada de apresentação sobre dados da 9B, não um motor de cobrança novo.

---

## AA. INADIMPLÊNCIA

Consumida, nunca recalculada: `ReceivableInstallment.status`/saldo (derivado, já existe em 9B) mais o filtro `origin = SALE`. **Nenhum campo manual "inadimplente" na 9E** — resposta direta ao item 32.

---

## AB. RENEGOCIAÇÃO

Workflow: `SalesPaymentPlan` recebe nova `version`; parcelas antigas não pagas são canceladas com motivo (`ReceivableInstallment.status = CANCELADA`, já suportado pela máquina de estados da 9B — `RENEGOCIADA` já existe como estado terminal alternativo em `ReceivableInstallmentStatus`); novas parcelas são geradas pelo mesmo caminho idempotente da Seção W, com `sourceVersion` incrementado. Parcelas já pagas **nunca são tocadas** — o histórico financeiro realizado é imutável, apenas o saldo futuro é renegociado.

---

## AC. DISTRATO

Evento comercial decidido pela 9E, efeito financeiro executado pela 9B:

1. `Sale.status → CANCELLED` (nova venda "distrato" não é criada — a mesma venda é marcada, preservando histórico, conforme item 35).
2. `SalesUnit.status: VENDIDA → DISTRATADA` (via `updateMany` condicional, Seção R).
3. Parcelas não pagas: canceladas via `transitionReceivableInstallment(..., "CANCELADA", motivo)` (já existe em `financial-service.ts`).
4. Parcelas pagas: **a 9E não decide devolução/retenção/multa** — registra o evento comercial (`SALE_RESCINDED` em `FinancialIntegrationEvent`) com o valor a devolver/reter calculado pela regra comercial (política, não hardcoded), e a 9B executa como `PayableAccount` (devolução ao cliente) ou ajuste, usando o mesmo port da Seção W.4 em direção inversa.
5. Documentação jurídica do distrato: referência opcional a entidade da 9D quando existir (Seção AP) — não bloqueia o fluxo hoje.

---

## AD. REVENDA DE UNIDADE DISTRATADA

`SalesUnit.status: DISTRATADA → DISPONIVEL` é uma transição explícita (não automática) que exige confirmação de que os efeitos financeiros do distrato anterior foram concluídos (nenhuma parcela do plano anterior em aberto). A `Sale` original permanece no histórico com seu `status = CANCELLED` — uma nova `Sale` (nova linha, não reaproveitamento) é criada para o novo comprador, com seu próprio `saleId`, mantendo os dois eventos comerciais rastreáveis e distintos para sempre.

---

## AE. COMISSÕES

`SalesCommission`: `saleId`, `brokerId` (`Supplier`), `basis` (`SOLD_PRICE|RECEIVED_AMOUNT`), `percentage`, `triggerEvent` (`SIGNATURE|DOWN_PAYMENT_PAID|RECEIPT|MILESTONE|OTHER` — Seção AF), `status` (`PENDING|APPROVED|PAYABLE_GENERATED|PAID|CANCELLED`), `approvalRequestId?`. Ao aprovar (`ApprovalPolicy actType=COMMISSION`), gera exatamente uma `PayableAccount` via `createExternalPayableObligation` (Seção W.4) — `@@unique` em `FinancialIntegrationEvent` garante que reprocessar o gatilho não duplica.

---

## AF. GATILHOS DE COMISSÃO

Configurável via política (mesmo espírito da Seção K — não hardcoded): tabela `SalesCommissionPolicy` (`organizationId`, `triggerEvent` default, `percentage` default, `basis` default) por empreendimento/canal, com `SalesCommission.triggerEvent`/`percentage` podendo sobrescrever pontualmente por venda quando negociado.

---

## AG. VGV

Visão calculada (funções puras em `sales-engine.ts`), nunca armazenada:

```text
vgvTotal = Σ listPrice de todas as SalesUnit ativas (status ≠ CANCELLED/removida)
vgvDisponivel = Σ listPrice onde status = DISPONIVEL
vgvReservado = Σ listPrice onde status ∈ {EM_RESERVA, RESERVADA}
vgvVendido = Σ soldPrice onde Sale.status = APPROVED e SalesUnit.status = VENDIDA
vgvPermutado = Σ tradeInValue das vendas com condição de permuta
vgvDistratado = Σ soldPrice das Sale com status = CANCELLED (histórico, não subtraído do vendido — mostrado separadamente)
vgvRecebido = Σ ReceivableInstallment realizado (via 9B) onde origin = SALE
vgvAReceber = vgvVendido − vgvRecebido (nunca somado ao previsto — mesma disciplina de não-dupla-contagem da 9B)
```

---

## AH. INDICADORES COMERCIAIS

VSO (Vendas Sobre Oferta), unidades/mês, VGV/mês, estoque em unidades e em VGV, meses de estoque (`estoqueDisponível / velocidadeMédia`), conversão proposta→venda (`vendas / propostas no período`) — todas funções puras sobre `SalesUnit`/`Sale`/`SalesProposal`, seguindo o mesmo padrão de `scheduleIndicators`/`capitalNeedIndicators` já usado em Operações e Financeiro.

---

## AI. DESCONTO MÉDIO / TICKET / PREÇO MÉDIO

Agregações por mês/empreendimento/tipologia/corretor/canal — mesma camada de indicadores da Seção AH, sem armazenamento próprio.

---

## AJ. ENTREGA DA UNIDADE

`SalesUnit.status: VENDIDA → ENTREGUE`, condicionado a: obra concluída (referência de leitura à 9A — `ScheduleActivity`/marco de entrega, se existir), financeiro sem pendência bloqueante (leitura à 9B — parcelas até a entrega quitadas ou política permitir chaves), documentos completos (`ProcurementDocumentLink` com checklist mínimo), vistoria aceita (Seção AK). Todas essas são **checagens de leitura entre domínios**, não uma nova máquina de estados cross-domain — a 9E decide "apta à entrega" combinando três leituras.

---

## AK. VISTORIA

`SalesUnitInspection`: `salesUnitId`, `saleId`, `scheduledAt`, `responsibleId`, `checklist` (Json — itens e status), `pendingIssues` (Json — lista, cada item com descrição e status), `attachments` (via `ProcurementDocumentLink`), `outcome` (`ACCEPTED|ACCEPTED_WITH_PENDING|REJECTED`), `nextInspectionAt?`. Múltiplas vistorias por unidade suportadas (`@@index([salesUnitId, scheduledAt])`, não `@@unique`).

---

## AL. PÓS-VENDA

Estrutura mínima: `PostSaleRequest` (`salesUnitId`, `saleId`, `customerId`, `category` (`GARANTIA|ASSISTENCIA|OCORRENCIA|OUTRO`), `description`, `responsibleId`, `slaDueAt?`, `status` (`OPEN|IN_PROGRESS|WAITING_CUSTOMER|RESOLVED|CLOSED`), timestamps) + `PostSaleUpdate` (histórico de interações, `requestId`, `authorId`, `note`, `createdAt`). **Não** implementar CRM de atendimento completo (fila, roteamento, SLA automatizado com escalonamento) — isso é explicitamente adiado pelo item 54.

---

## AM. PERSONALIZAÇÃO DE UNIDADE

**Fora do escopo da primeira sprint.** Avaliação registrada: extensão futura natural seria `SalesUnitCustomization` (`salesUnitId`, `saleId`, `item`, `cost`, `approvalRequestId`) usando o mesmo motor de alçada da Seção K — não desenhar mais agora, per item 55.

---

## AN. CENTRAL EXECUTIVA

Cards propostos (mesmo padrão visual de `operations-kpis`/`financial-view.tsx` já existente): VGV disponível, VGV vendido, unidades disponíveis, reservas ativas, vendas no mês, VSO, preço/m² médio, desconto médio, distratos no período, recebíveis (contratado/a receber/vencido — lidos da 9B), comissões pendentes, estoque crítico (unidades com >N meses paradas). Reutilizar classes CSS `operations-kpis`/`operations-panel`/`operations-table` já validadas em Operações e Financeiro — **nenhum CSS novo necessário**, mesmo padrão desta base desde a 9A.

---

## AO. O QUE INDEPENDE DA 9D (PODE COMEÇAR IMEDIATAMENTE)

- Estoque/Unidade (Seção E/F/G).
- Tabela de preços (Seção H/I/J).
- Política de desconto via `ApprovalPolicy` (Seção K).
- Cliente via `Customer` reutilizado (Seção L).
- Lead mínimo (Seção N).
- Corretor via `Supplier` (Seção O).
- Proposta, Reserva (Seção P/Q).
- Concorrência/locking de unidade (Seção R).
- Venda, Contrato de Venda (campos comerciais — sem assinatura eletrônica real), Plano de Pagamento (Seção T/U/V).
- Integração 9E→9B para recebíveis e comissões (Seção W) — **é o núcleo da fase e não toca em nada da 9D**.
- VGV, indicadores, Central Executiva, REDE IA (Seção AG–AN, AQ).
- Entrega/Vistoria/Pós-venda **sem** dependência documental jurídica formal (checklist operacional, não jurídico).

Ou seja: **toda a fase é implementável sem a 9D existir.** A 9D não é bloqueadora de nenhum item funcional — apenas de um subconjunto de campos de referência opcionais.

---

## AP. INTEGRAÇÕES FUTURAS COM A 9D (QUANDO EXISTIR)

| Componente 9E | Uso futuro da 9D |
|---|---|
| `SalesContract.signatureStatus` | Substituir/alimentar por evento real de assinatura eletrônica quando a 9D definir o provider/adapter |
| Documentos do cliente (RG, comprovante, procuração) | Se a 9D criar um modelo de "documento com validade jurídica"/procuração, `SaleParty.representativeId` pode referenciar uma entidade de procuração da 9D em vez de só texto livre |
| Distrato (Seção AC) | Julgamento jurídico de multa/retenção pode vir a ser uma decisão formal da 9D anexada ao evento comercial, hoje é regra comercial simples |
| Obrigações e licenças do empreendimento | Entrega da unidade (Seção AJ) pode futuramente checar licença de habite-se via 9D, hoje é checagem apenas de obra/financeiro/documentos operacionais |
| Contrato de venda como peça jurídica formal | Hoje `SalesContract` é um registro estrutural comercial; a 9D pode vir a ser o guardião do documento juridicamente vinculante correspondente |

Todos os pontos acima são **FKs nullable a adicionar depois**, nunca pré-requisitos.

---

## AQ. REDE IA

Ferramentas propostas (mesmo padrão `get*`/`compare*`, leitura de um `getSalesWorkspace` consolidado, evidência sempre anexada):

`getSalesInventory` ("quantas unidades ainda estão disponíveis"), `getUnitTypologyPerformance` ("qual tipologia vende mais"), `getPricePerSquareMeter` ("qual preço/m² realizado"), `getDiscountGranted` ("quanto foi concedido em desconto"), `getExpiringProposals` ("quais propostas estão vencendo"), `getDelinquentCustomers` (lê 9B, filtra por venda — "quais clientes estão inadimplentes"), `getReceivableCurve` (lê `getUpdatedCashProjection` da 9B filtrado por origem venda — "qual a curva de recebíveis"), `getRescindedUnits` ("quais unidades foram distratadas"), `getChannelPerformance` ("qual canal gera maior VGV"). IA comercial (item 59): resume histórico, compara propostas, explica indicadores, identifica anomalias, gera rascunho de comunicação — **nunca aprova desconto** (isso passa por `ApprovalRequest`, ação humana).

---

## AR. AUDITORIA

Toda entidade de ciclo de vida longo (`SalesPriceTable`, `SalesProposal`, `SalesReservation`, `Sale`, `SalesContract`, `SalesPaymentPlan`, distrato, entrega) grava em `AuditLog` (organização, projeto, ação, entidade, ator, antes/depois) — mesmo padrão de toda fase anterior, sem exceção.

---

## AS. RBAC

Mapeamento proposto sobre os 5 papéis existentes + `ApprovalPolicy` para nuance (mesma limitação/solução já documentada na 9B):

| Papel de negócio | `MembershipRole` | Alçada adicional |
|---|---|---|
| Vendedor | `ANALYST` | `ApprovalPolicy` com teto baixo de desconto |
| Gerente comercial | `ANALYST` ou `ADMIN` | Teto intermediário |
| Diretoria | `ADMIN`/`OWNER` | Sem teto |
| Financeiro | (já governado pela 9B — `ADMIN`/`OWNER` para confirmar conciliação, `ANALYST`+ para registrar) | — |
| Pós-venda | `ANALYST` | — |
| Consulta | `VIEWER`/`REVIEWER` | — |

**Mesma limitação real da 9B**: não há papel dedicado "Vendedor" distinto de "Gerente" no RBAC técnico — a distinção vem inteiramente de `ApprovalPolicy.requiredRole` + faixa de valor, não de um novo enum de papel.

---

## AT. SEGURANÇA

Tenant isolation (todo `findFirst` filtra por `organizationId`, testado), LGPD (Seção M), IDOR (mesmo padrão de teste `rejects.toThrow("não encontrado nesta organização")` usado em toda fase), locking de unidade (Seção R — risco real, mitigação concreta proposta), aprovação de desconto (Seção K/S), dados pessoais (Seção L/M), auditoria (Seção AR).

---

## AU. PERFORMANCE

Milhares de unidades e clientes, centenas de milhares de parcelas: reutilizar os mesmos índices compostos já padronizados (`(organizationId, status)`, `(projectId)`, `(dueDate, status)` do lado 9B). Paginação server-side é uma **lacuna real já documentada na 9B** (não implementada lá) — a 9E deve implementar desde o início nas listagens de unidade/cliente/parcela, não repetir a dívida técnica.

---

## AV. IMPORTAÇÃO

Planejamento conceitual apenas: importação futura de estoque/clientes/contratos/vendas via CSV, seguindo o mesmo padrão já implementado e testado em `src/domain/financial-ops/csv-import.ts` (parser puro, validação linha a linha, relatório aceito/rejeitado, idempotência por checksum) — **reaproveitar a função genérica de parsing CSV**, não recriar.

---

## AW. INTEGRAÇÕES EXTERNAS

CRMs, portais, ERPs, assinatura eletrônica, bancos, sistemas legados: **fora de escopo de implementação**. O REDE deve ser capaz de ser o *source of truth* comercial OU de consumir dados de um CRM/ERP externo já em uso — a arquitetura de `Sale`/`SalesContract` com `externalId?`/`externalSource?` (campos simples, análogos ao `externalId` já usado em `BankTransaction`/`PayablePayment` da 9B) deixa essa porta aberta sem exigir decisão agora.

---

## AX. TESTES FUTUROS (NÃO ESCRITOS NESTA FASE)

**Unidade**: disponibilidade, reserva, conflito de venda (Seção R), bloqueio, distrato, tenant isolation.
**Venda**: proposta → aprovação → venda, desconto com/sem alçada, tabela vigente no momento certo, contrato, concorrência (dois usuários, mesma unidade, apenas uma venda prevalece — teste de carga/race, não apenas unitário).
**9E → 9B** (item 69, todos obrigatórios): Caso A (10 parcelas → 10 recebíveis, replay não duplica), Caso B (recebimento na 9B não duplica receita comercial — leitura, não escrita dupla), Caso C (renegociação trata antigas por reversão/substituição, nunca apaga), Caso D (distrato preserva venda histórica, efeitos financeiros controlados), Caso E (comissão gera obrigação exatamente uma vez).
**Prova zero** (item 71): `vgvVendido = Σ vendas válidas`; `recebíveis gerados = plano comercial efetivo`; `saldo comercial = contrato − cancelamentos/ajustes`; unidade nunca simultaneamente `DISPONIVEL` e `VENDIDA` (teste de invariante de estado, não apenas de fluxo feliz).

---

## AY. MIGRATIONS FUTURAS (CONCEITUAL — NENHUMA CRIADA NESTA FASE)

Uma única migration nova da 9E (não várias, seguindo o padrão de "uma migration por fase" já usado em 9A/9B/9C) deveria conter: todas as tabelas novas da Seção D em diante, **mais** as duas extensões pontuais em tabelas existentes:
1. `FinancialIntegrationEvent.receivableAccountId String? @unique` + novos valores de `FinancialIntegrationEventType`.
2. Novos valores de `ApprovalActType` (`SALE`, `SALE_DISCOUNT`, `SALE_RESCISSION`, `COMMISSION`).

E, coordenado com quem mantém a 9B (fora da migration da 9E, ou na mesma, a decidir): `applyReceivableInstallmentCorrection` em `financial-service.ts` — função de aplicação, não schema.

---

## AZ. RISCOS

| Risco | Mitigação proposta |
|---|---|
| Unidade duplicada (cadastro manual + BIM) | `detectedUnitId` nullable + reconciliação assistida, nunca merge automático silencioso |
| Venda concorrente da mesma unidade | `updateMany` condicional por status (Seção R) — risco real e endereçado nesta análise |
| Cliente duplicado | Reuso de `Customer` + busca por `taxId` antes de criar (`@@unique` já impõe no banco) |
| Plano financeiro paralelo | Todo recebível nasce via `createExternalReceivableObligation` — nenhum `ReceivableAccount` criado fora desse caminho para vendas |
| Recebíveis duplicados | `@@unique([organizationId, sourceType, sourceId, sourceVersion, eventType])` em `FinancialIntegrationEvent`, já comprovado em produção pela 9C |
| Distrato apagando histórico | `Sale.status = CANCELLED` preserva a linha; nova venda é nova linha (Seção AD) |
| Comissão duplicada | Mesmo mecanismo de idempotência da Seção W |
| Desconto sem alçada | `ApprovalPolicy` obrigatório antes de `Sale.status = APPROVED` acima do teto configurado |
| LGPD | Seção M |
| Conflito CRM externo × REDE | `externalId`/`externalSource` deixados em aberto (Seção AW), *source of truth* a decidir por projeto, não pela plataforma |
| **Lacuna real já existente que a 9E vai expor**: ausência de `applyReceivableInstallmentCorrection` na 9B | Adicionar a função simétrica antes ou junto da 9E.4 (Seção AY) — pequena, não é redesenho |
| **Lacuna real já existente**: paginação server-side ausente na 9B | Não repetir a dívida — implementar paginação desde a 9E.1 |

---

## BA. DIVISÃO EM SPRINTS (AJUSTADA AO CÓDIGO REAL)

- **9E.1 — Estoque + Tabela de Preços**: `SalesUnit`, `SalesUnitBlock`, `SalesPriceTable`/`Line`, indicadores de preço/m². Sem dependência de cliente/venda.
- **9E.2 — Clientes + Propostas + Reservas**: extensão pontual de `Customer`, `SaleParty`, `SalesLead` mínimo, `SalesProposal`, `SalesReservation`, locking de unidade (Seção R) implementado desde já.
- **9E.3 — Vendas + Contratos + Plano de Pagamento**: `Sale`, `SalesContract`, `SalesPaymentPlan`/`Installment`, `ApprovalPolicy` novos `actType`.
- **9E.4 — Integração 9E→9B + Recebíveis + Comissões**: `createExternalReceivableObligation`, extensão de `FinancialIntegrationEvent`, `SalesCommission`/`Policy`, `applyReceivableInstallmentCorrection` na 9B (coordenado). **Sprint de maior risco técnico — é onde a idempotência é testada de verdade.**
- **9E.5 — Renegociação + Distrato + Inadimplência (visão)**: workflow de renegociação, distrato com efeitos financeiros, leitura de inadimplência da 9B.
- **9E.6 — Entrega + Vistoria + Pós-venda**: `SalesUnitInspection`, `PostSaleRequest`/`Update`, transição de entrega.
- **9E.7 — Central Executiva + REDE IA + Escala**: cards, ferramentas de IA, paginação server-side, importação CSV.

---

## RELATÓRIO FINAL

### 1. O que encontrei no código
Base 9A/9B/9C real e coerente, com um mecanismo de integração financeira idempotente já em produção (`FinancialIntegrationEvent` + `external-obligation-port.ts`, usado por `procurement-service.ts`) que é exatamente o que a 9E precisa espelhar. Nenhuma entidade de unidade comercial, cliente dedicado, venda ou contrato de venda existe hoje. `Customer` (9B) e `Supplier` (9B/9C) já existem e cobrem exatamente os papéis de comprador e corretor/imobiliária. Motor de alçada genérico (`ApprovalPolicy`/`ApprovalRequest`) já existe e cobre desconto/aprovação comercial sem precisar de nada novo. Dois padrões de documento coexistem com escopos diferentes; o genérico (`ProcurementDocumentLink`) é o certo para a 9E. Lacuna real confirmada: falta `applyReceivableInstallmentCorrection` na 9B.

### 2. Arquitetura recomendada
`SalesUnit` como estoque próprio (referenciando `ProjectOperatingUnit` e opcionalmente `DetectedUnit`, nunca duplicando), `Customer`/`Supplier` reutilizados sem alteração estrutural, `ApprovalPolicy` reutilizado para toda alçada comercial, integração 9E→9B via um novo `createExternalReceivableObligation` espelhando o port de pagáveis já existente, documentos via `ProcurementDocumentLink` generalizado.

### 3. O que entra efetivamente na 9E
Unidade/estoque, tabela de preços, cliente (reuso), lead mínimo, corretor (reuso de Supplier), proposta, reserva, aprovação comercial (reuso do motor 9C), venda, contrato de venda, plano de pagamento comercial, geração idempotente de recebíveis e comissões na 9B, renegociação, distrato, entrega, vistoria, pós-venda mínimo, indicadores comerciais, Central Executiva, REDE IA comercial.

### 4. O que fica para fases posteriores
CRM de marketing completo, assinatura eletrônica real, boleto/Pix real, personalização de unidade, integrações com CRM/ERP/portais externos, política de retenção LGPD formal, atendimento de pós-venda tipo helpdesk completo.

### 5. Como evitar duplicidade com a 9B
Nenhum `ReceivableAccount`/`PayableAccount` criado fora de `createExternalReceivableObligation`/`createExternalPayableObligation`; nenhum motor de índice/correção próprio; nenhuma central de cobrança/conciliação própria; toda leitura financeira via `getFinancialWorkspace`.

### 6. Como evitar duplicidade de cliente/unidade
Cliente: reuso de `Customer`, busca por `taxId` antes de criar, `@@unique` no banco. Unidade: `SalesUnit` referencia `DetectedUnit` por FK opcional em vez de recopiar dados geométricos; nenhuma segunda fonte de verdade para área/tipologia quando BIM existe.

### 7. Como tratar concorrência na venda
`updateMany` condicional por status esperado (não `findFirst` + `update` em dois passos) em toda transição de `SalesUnit.status` — risco real identificado nesta análise (padrão atual da base não é atomicamente seguro sob concorrência), mitigação concreta e pequena proposta.

### 8. Como tratar distrato
Evento comercial na 9E (`Sale.status = CANCELLED`, unidade liberada via transição controlada), efeito financeiro executado pela 9B via o mesmo port idempotente (em direção inversa quando há devolução), histórico da venda original nunca apagado, nova venda é nova linha.

### 9. Como tratar comissão
`SalesCommission` com gatilho configurável por política, aprovação via `ApprovalPolicy`, geração de `PayableAccount` exatamente uma vez via `createExternalPayableObligation` já existente — nenhum código novo do lado pagável, só do lado recebível.

### 10. O que depende ou não da 9D
Nada bloqueia o início da 9E. Toda a fase (Seção AO) é implementável sem a 9D. Pontos de integração futura (Seção AP) são FKs nullable a adicionar depois: assinatura eletrônica do contrato, procuração/documento jurídico do comprador, julgamento jurídico de distrato, licença de habite-se para entrega.

### 11. Divisão das sprints
9E.1 Estoque/Tabela → 9E.2 Cliente/Proposta/Reserva → 9E.3 Venda/Contrato/Plano → 9E.4 Integração 9E→9B/Comissão (maior risco técnico) → 9E.5 Renegociação/Distrato → 9E.6 Entrega/Vistoria/Pós-venda → 9E.7 Central Executiva/IA/Escala.

### 12. Principais riscos
Concorrência de venda (mitigação concreta proposta), recebível/comissão duplicados (mitigado pelo mesmo `@@unique` já provado na 9C), cliente/unidade duplicados, distrato apagando histórico, LGPD, conflito com CRM externo, e duas lacunas reais pré-existentes na 9B (correção do lado recebível, paginação server-side) que a 9E deve corrigir ou não repetir, não ignorar.

### 13. Confirmação de escopo
Apenas este documento foi criado. Nenhum arquivo de `prisma/schema.prisma`, migration, seed, serviço, API, UI ou teste foi alterado. Nenhuma alteração foi feita em arquivos das Fases 9B/9C. Nenhum commit, nenhum push.

### 14. Caminho do documento criado
`docs/PHASE_9E_SALES_CUSTOMERS_RECEIVABLES_POSTSALES_PLAN.md` (nesta branch: `planning/fase-9e-vendas-recebiveis`, worktree `C:\Users\Usuario\Documents\Codex\2026-08-17\rede-claude-9e`).
