# REDE Intelligence — Plano técnico da Fase 9G

## Contábil, fiscal, controladoria e consolidação

> Documento de planejamento. Nenhum código, schema Prisma, migration, seed, serviço, componente, API ou teste foi alterado nesta preparação.

## 1. Objetivo

A Fase 9G deve transformar fatos operacionais já controlados pelo REDE Intelligence em visão econômico-contábil rastreável, sem criar uma segunda verdade financeira e sem tentar substituir um ERP contábil ou fiscal completo.

```text
Evento operacional
→ classificação e política vigentes
→ evento contábil idempotente
→ lançamento equilibrado
→ razão e balancete
→ DRE e balanço
→ consolidação e controladoria
```

O módulo deverá responder, por período e data de corte, qual é o resultado de cada empreendimento, SPE, empresa e grupo; quanto foi reconhecido como receita e custo; qual é o estoque imobiliário; como caixa e competência se reconciliam; quais tributos e provisões estão registrados; e quais divergências impedem o fechamento.

## 2. Base analisada e estado atual

Análise realizada na branch `planning/fase-9g-contabil-fiscal-controladoria`, baseada no tag `rede-phase-9d-complete-2026-08-21`, commit `93a3cfaf0ca86760e2261193aa1cbaf909ad9ff4`.

### 2.1 Capacidades existentes reutilizáveis

| Contexto | Objetos e serviços existentes | Reuso na 9G |
|---|---|---|
| Estrutura empresarial | `Organization`, `EconomicGroup`, `Company`, `Project`, `ProjectOperatingUnit` | Tenant, grupo, entidade legal, SPE, empreendimento e estrutura física |
| Estrutura gerencial | `CostCenter`, `EconomicItem` | Dimensões canônicas de classificação e drill-down |
| Planejamento | `OperationalBaseline`, `Budget`, `BudgetLineItem`, `BudgetLaborComposition`, `OperationalSchedule`, `OperationalForecast` | Base Aprovada, orçamento, EAP, cronograma e projeção operacional |
| Financeiro | `FinancialObligation`, AP, AR, parcelas, pagamentos, recebimentos, bancos e conciliação | Obrigações, liquidação, caixa e reconciliação auxiliar |
| Correção e índices | `FinancialIndex`, `CorrectionRule`, `InstallmentAdjustment` | Valores corrigidos com versão e memória, sem motor paralelo |
| Intercompany | `IntercompanyTransaction` e pernas AP/AR | Origem dos saldos recíprocos e eliminações consolidadas |
| Fechamento financeiro | `FinancialPeriodClosure` e serviços de fechar/reabrir | Gate financeiro do fechamento contábil; não será convertido em período contábil |
| Compras | necessidades, requisições, cotações, `PurchaseOrder`, contratos e aditivos | Compromisso e origem documental, não custo reconhecido por si só |
| Execução | `MeasurementCertificate`, linhas, retenções, ajustes e adiantamentos | Evidência de serviço/obra executada e potencial competência |
| Integração idempotente | `FinancialIntegrationEvent`, `LegalFinancialEvent`, `external-obligation-port.ts` | Padrão comprovado de source/version/checksum/idempotency |
| Jurídico | obrigações, contratos, garantias, prazos e eventos financeiros | Fonte de contingências, multas, garantias e provisões |
| Aprovações | `ApprovalPolicy`, `ApprovalRequest`, `ApprovalDecisionRecord` | Alçadas e segregação para lançamentos, fechamento, estorno e consolidação |
| Materialidade | `MaterialityPolicy` | Checklist, divergências, rateios e controladoria |
| Auditoria | `AuditLog` | Ator, entidade, antes/depois, data e metadados |
| Documentos | `ProcurementDocumentLink` e Sala de Documentos | Referências documentais; nenhuma sala fiscal paralela |
| REDE IA | registro de ferramentas com modo, papel e evidência | Consultas somente leitura sobre resultados determinísticos |

### 2.2 Comportamentos confirmados no código

- Os serviços validam `organizationId` e referências de projeto antes de mutações.
- O Financeiro calcula saldo de parcela a partir dos pagamentos e não o mantém como verdade desconectada.
- A projeção atualizada separa realizado, compromisso concreto e previsão residual.
- A conciliação bancária gera sugestões determinísticas e exige confirmação.
- O intercompany gera pernas AP/AR ligadas ao mesmo evento.
- O fechamento financeiro atual verifica transações sem conciliação e parcelas aguardando aprovação, permitindo fechar com pendências registradas.
- Medição aprovada pode gerar obrigação e conta a pagar pela porta externa, com validação de bruto, retenções, descontos, adiantamentos e líquido.
- Eventos financeiros de Compras e Jurídico possuem chaves idempotentes e checksum.

### 2.3 Lacunas atuais

Não existem plano de contas, política contábil, mapeamento operacional-contábil, evento contábil genérico, partidas dobradas, razão, balancete, DRE, balanço, período contábil, provisão contábil, rateio contábil, estoque imobiliário contábil, apropriação por unidade, política de receita, regime fiscal, apuração tributária, conciliação contábil ou consolidação com eliminações.

O `FinancialPeriodClosure` é fechamento operacional-financeiro, não fechamento contábil. O `FinancialIntegrationEvent` atual é específico da integração 9C→9B e não deve ser renomeado ou sobrecarregado como razão contábil.

### 2.4 Planos futuros consultados

- O plano 9E propõe `SalesUnit`, venda, contrato comercial, plano de pagamento, distrato e integração idempotente com AR. Na referência disponível, isso ainda não está implementado.
- O plano 9F propõe pessoa/vínculo/custos e um `AccountingActualPort`; também determina que custos operacionais permaneçam nas fontes e sejam consumidos pela Contabilidade.

A 9G deve integrar 9E e 9F somente após merge, revisão e congelamento dos respectivos contratos.

## 3. Princípios arquiteturais

1. O módulo operacional é dono do fato; a 9G é dona da classificação e representação contábil.
2. Um fato econômico é reconhecido uma única vez, mesmo que atravesse contrato, medição, nota, obrigação e pagamento.
3. Compromisso não é competência; competência não é vencimento; vencimento não é caixa.
4. Todo lançamento contabilizado fecha débito igual a crédito.
5. Lançamento contabilizado não é editado nem apagado: estorno e novo lançamento preservam história.
6. Política, mapeamento, rateio, fechamento e consolidação são versionados e auditáveis.
7. Relatórios derivam do razão; controladoria combina razão com fontes operacionais sem alterar nenhum deles.
8. Regras fiscais e de reconhecimento são configuráveis e exigem validação técnica; percentuais legais não são hardcoded.
9. Toda consulta e mutação é isolada por organização e entidade legal.
10. O REDE será camada de inteligência, integração e controle, não emissor fiscal ou substituto universal do sistema contábil oficial.

## 4. Arquitetura de módulos e portas

### 4.1 Contextos propostos

```text
accounting-master-data
  ├─ plano de contas, políticas, mapeamentos e dimensões
accounting-events
  ├─ ingestão idempotente e classificação
general-ledger
  ├─ lançamentos, linhas, estornos, razão e balancete
accounting-close
  ├─ períodos, checklist, ajustes e reconciliações
real-estate-accounting
  ├─ estoque, custo por unidade e reconhecimento de receita
tax-control
  ├─ regimes, documentos, apurações e obrigações fiscais
consolidation
  ├─ pacotes, saldos, eliminações e consolidado
controllership
  └─ pontes operacionais, indicadores, alertas e drill-down
```

### 4.2 Portas de entrada

Cada porta retorna um envelope versionado contendo `organizationId`, empresa, projeto opcional, `sourceType`, `sourceId`, `sourceVersion`, evento, datas, valores, moeda, dimensões, checksum e evidência:

- `OperationsAccountingSource`: Base, orçamento, EAP, cronograma e itens econômicos da 9A.
- `FinancialAccountingSource`: obrigações, AP/AR, ajustes, liquidações, bancos e fechamento da 9B.
- `ProcurementAccountingSource`: pedidos, contratos, aditivos, medições, retenções e adiantamentos da 9C.
- `LegalAccountingSource`: obrigações, multas, contingências e garantias da 9D.
- `SalesAccountingSource`: unidades, vendas, distratos, recebíveis e entrega após congelamento da 9E.
- `PeopleCostAccountingSource`: custos por competência e alocação após congelamento da 9F.
- `ExternalAccountingImportPort`: balancetes/lançamentos do escritório ou ERP externo.

### 4.3 Portas de saída

- `AccountingExportPort`: eventos, lançamentos, plano, centros, documentos e saldos.
- `TaxDocumentProvider`: prefeituras, SEFAZ e provedores, inicialmente sem implementação real.
- `ExternalLedgerComparisonPort`: comparação com razão/balancete externo.

Os adaptadores devem possuir versão de contrato e testes de contrato. Falha de ingestão permanece reprocessável; não pode gerar lançamento parcial.

## 5. Plano de contas

### 5.1 Estrutura conceitual

| Entidade proposta | Responsabilidade |
|---|---|
| `ChartOfAccounts` | Plano reutilizável no grupo, com nome, finalidade e moeda funcional padrão |
| `ChartOfAccountsVersion` | Versão imutável, vigência, status e política de transição |
| `LedgerAccount` | Conta hierárquica da versão, código, natureza, saldo normal e permissões de lançamento |
| `CompanyChartAssignment` | Adoção de uma versão por empresa e período |
| `CompanyAccountOverride` | Particularização controlada de nome, integração ou bloqueio sem clonar o plano |
| `ReportingLineMapping` | Mapeamento versionado de contas para DRE, balanço, fluxo e visão gerencial |

O plano suporta ativo, passivo, patrimônio líquido, receita, custo, despesa e contas de compensação quando a política permitir. Não haverá plano universal hardcoded.

Regras:

- árvore sem ciclos, código único por versão e profundidade livre;
- somente contas analíticas aceitam lançamento;
- natureza e saldo normal não mudam em versão já utilizada;
- nova vigência cria nova versão e um mapa de transição entre contas;
- empresas podem particularizar apenas dentro dos limites do plano do grupo;
- contas bloqueadas permanecem consultáveis no histórico.

## 6. Políticas e mapeamento operacional-contábil

### 6.1 `AccountingPolicy`

Política versionada por organização, grupo ou empresa, com vigência e aprovação. Controla, por referências configuráveis:

- reconhecimento de receita e custo;
- apropriação ao estoque e baixa;
- provisões e reversões;
- materialidade e tolerância;
- rateios;
- fechamento e período de ajuste;
- moeda funcional e arredondamento;
- critérios para terreno, permuta e custos apropriáveis.

Uma entrada deve registrar o identificador e a versão exata da política aplicada.

### 6.2 `AccountingMappingRule`

Mapeia combinações de dimensões para contas débito/crédito e código de histórico:

- empresa e projeto;
- `EconomicItem` e categoria;
- `CostCenter`;
- natureza/origem da obrigação;
- tipo de compra, contrato, medição ou ajuste;
- origem de venda/receita;
- origem jurídica ou administrativa;
- regime/política vigente.

Precedência recomendada: regra específica de empresa/projeto/item antes da regra corporativa genérica. Cada regra possui prioridade, vigência, versão, critérios estruturados e conta de destino. Empate ambíguo bloqueia contabilização e cria pendência; nenhum `if/else` disperso deve decidir contas.

Antes de ativar uma versão, um simulador deve executar fatos históricos de amostra e apresentar alterações de classificação.

## 7. Evento contábil e identidade econômica

### 7.1 `AccountingEvent`

Campos conceituais mínimos:

- tenant, empresa, projeto, centro de custo, item econômico e unidade operacional;
- `sourceModule`, `sourceType`, `sourceId`, `sourceVersion`;
- `economicIdentityKey`: identifica o mesmo fato através dos seus estágios;
- `eventType`, `eventVersion`, `schemaVersion`;
- `idempotencyKey` e `payloadChecksum`;
- ocorrência, competência e data contábil proposta;
- valores bruto, retenções, descontos, líquido e moeda;
- status, política/mapeamento aplicados e erro de classificação;
- payload normalizado e ponte para documentos.

Restrição de unicidade: organização + fonte + ID + versão + tipo de evento. Reenvio idêntico retorna o resultado existente; checksum diferente para a mesma identidade exige nova versão ou evento de correção, nunca sobrescrita.

Estados propostos:

```text
RECEBIDO → VALIDADO → CLASSIFICADO → CONTABILIZADO
             ↘ REJEITADO      ↘ PENDENTE_DE_MAPEAMENTO
CONTABILIZADO → REVERTIDO (por evento compensatório)
```

### 7.2 Identidade econômica contra dupla contagem

`economicIdentityKey` agrupa contrato, medição, documento fiscal, obrigação e pagamento do mesmo custo. O tipo do evento define o efeito:

- pedido/contrato: compromisso, normalmente sem entrada no razão patrimonial;
- medição/execução: candidato a reconhecimento de custo/estoque;
- documento fiscal: suporte fiscal e obrigação, podendo complementar ou confirmar o fato;
- pagamento: liquidação da obrigação e movimento de caixa;
- estorno/correção: evento novo referindo o anterior.

Políticas decidem o gatilho de reconhecimento, mas nunca permitem reconhecer o mesmo principal novamente em cada estágio.

## 8. Partidas dobradas e razão

### 8.1 Entidades conceituais

| Entidade proposta | Responsabilidade |
|---|---|
| `AccountingEntry` | Cabeçalho do lançamento, empresa, período, política, evento, histórico e status |
| `AccountingEntryLine` | Conta, débito/crédito, valor, moeda e dimensões analíticas |
| `AccountingReversalLink` | Relação explícita entre original, estorno e substituto |
| `LedgerSnapshot` | Saldos imutáveis de período fechado para leitura e recuperação |

Cada linha pode referenciar projeto, centro de custo, `EconomicItem`, unidade operacional, unidade comercial futura, contrato, documento e contraparte, sem duplicar esses cadastros.

### 8.2 Invariantes

```text
Σ débitos na moeda funcional = Σ créditos na moeda funcional
saldo_final = saldo_inicial + movimentos_do_período
```

- valor positivo e exatamente um lado por linha;
- pelo menos duas linhas;
- todas as contas pertencem à versão adotada pela empresa;
- período aberto e data dentro do período;
- dimensões e política pertencem ao mesmo tenant;
- lançamento só muda para `POSTED` dentro da transação que executa prova-zero;
- lançamento `POSTED` é imutável.

A validação deve existir no motor de domínio e no fluxo transacional. Uma constraint/trigger PostgreSQL pode ser usada como defesa adicional após prova técnica, pois a soma entre linhas não é uma simples constraint de coluna no Prisma.

### 8.3 Estorno

```text
lançamento original POSTED
→ lançamento de estorno com débitos/créditos invertidos
→ novo lançamento corrigido, se aplicável
```

Estorno exige motivo, aprovador conforme materialidade, referência ao original e período permitido. Nunca há `DELETE` de lançamento contabilizado.

## 9. Datas e competência versus caixa

Datas independentes:

- `occurredAt`: ocorrência operacional;
- `competenceDate`: período econômico;
- `documentIssuedAt`: emissão fiscal/contratual;
- `dueAt`: vencimento financeiro/fiscal;
- `accountingDate`: data efetiva no razão;
- `settledAt`: liquidação financeira;
- `reconciledAt`: conciliação bancária/contábil.

Exemplo obrigatório:

```text
serviço executado em janeiro → competência janeiro
NF emitida em fevereiro      → documento/obrigação fevereiro
pagamento em março           → caixa março
```

O razão explica o custo e a obrigação na competência definida pela política; a liquidação posterior baixa o passivo contra caixa. Relatórios devem alternar entre competência e caixa, identificando a base usada.

## 10. Período e fechamento contábil

### 10.1 `AccountingPeriod`

Período por empresa e mês, independente de `FinancialPeriodClosure`, com estados:

```text
ABERTO → EM_REVISÃO → FECHADO
  ↑                       ↓
PERÍODO_DE_AJUSTE ← REABERTO sob autorização
```

Campos: organização, empresa, mês, política/planos vigentes, status, responsáveis, datas, versão, snapshot e motivo de reabertura.

O fechamento financeiro é pré-requisito verificável, não substituto. O contábil pode bloquear por pendências acima da materialidade mesmo que o Financeiro tenha registrado seu fechamento.

### 10.2 Checklist de fechamento

- Financeiro e bancos conciliados;
- AP/AR revisados e conciliados ao razão;
- medições e serviços executados revisados;
- provisões registradas/revertidas;
- documentos e impostos revisados;
- intercompany recíproco;
- estoque e custo por unidade processados;
- receita e custo reconhecidos pela política vigente;
- lançamentos sem mapeamento resolvidos;
- prova-zero de razão, balancete e relatórios;
- aprovação e snapshot de fechamento concluídos.

Cada item possui origem determinística, status, materialidade, responsável, evidência e dispensa aprovada. Fechamento gera snapshot imutável e checksum.

### 10.3 Mês fechado

Fato de competência fechada não pode criar/editar lançamento retroativo. Alternativas controladas:

- lançar ajuste no primeiro período aberto, referindo a competência original;
- abrir período específico de ajuste;
- reabrir com `ApprovalPolicy`, justificativa e trilha completa.

## 11. Provisões

`AccountingProvision` registra fato conhecido ainda não liquidado: serviço executado sem nota/medição final, imposto, contingência, despesa administrativa ou custo de obra.

Campos: fonte/evidência, empresa, projeto/dimensões, competência, estimativa, método, confiança, política, revisão prevista e conta de reversão.

Regras:

- provisão não cria AP automaticamente;
- documento ou obrigação posterior consome/reverte a provisão pela mesma identidade econômica;
- estimativa revisada gera evento de complemento/reversão;
- provisão recorrente exige vigência e reavaliação;
- contingência jurídica consome a classificação da 9D, sem o Jurídico lançar no razão diretamente.

## 12. AP, AR e liquidações

### 12.1 Contas a pagar

A 9B permanece dona de obrigação, parcela, vencimento, pagamento e saldo. Eventos possíveis na 9G:

- reconhecimento/provisão: débito em custo, despesa, estoque ou adiantamento; crédito em obrigação;
- pagamento: débito na obrigação; crédito em banco;
- juros/multa: despesa financeira contra obrigação/caixa;
- desconto: redução conforme política, preservando memória;
- retenção: obrigação fiscal/terceiro separada do líquido ao fornecedor;
- baixa/cancelamento: estorno ou ajuste, nunca remoção do AP.

### 12.2 Contas a receber

A 9B/9E permanecem donas de venda, plano financeiro, parcela, correção, recebimento, inadimplência, renegociação e distrato. A 9G recebe eventos distintos para:

- contrato/VGV comercial;
- reconhecimento de receita conforme política;
- constituição/ajuste do recebível;
- correção e juros;
- recebimento e baixa;
- perda/provisão de crédito;
- renegociação e distrato com reversões referenciadas.

VGV, recebível, recebimento e receita contábil nunca são sinônimos.

## 13. Compras, contratos e medições

```text
Pedido/contrato → compromisso
Medição aprovada → execução e possível competência
Documento fiscal → evidência fiscal/obrigação
Pagamento → caixa
```

Caso crítico:

| Estágio | Valor | Tratamento |
|---|---:|---|
| Contrato | R$ 1.000.000 | Compromisso; não reconhece todo o custo automaticamente |
| Medição | R$ 200.000 | Evento candidato ao custo/estoque da competência |
| NF | R$ 200.000 | Confirma/complementa obrigação fiscal; mesma identidade econômica |
| Pagamento | R$ 200.000 | Liquida passivo contra caixa |

O custo principal reconhecido é R$ 200 mil, não R$ 600 mil. A chave econômica, o ledger de estágios da 9C e a política de reconhecimento impedem duplicação.

Retenção vira obrigação separada quando aplicável. Adiantamento é ativo até amortização pela medição. Aditivo altera compromisso/projeção; só afeta competência quando houver fato reconhecível.

## 14. Custo da obra e controladoria operacional

Visão única por empreendimento, centro, `EconomicItem`, EAP, contrato, fornecedor e período:

```text
Base Aprovada
→ Orçamento
→ Comprometido
→ Medido
→ Contabilizado
→ Pago
→ Projeção Atualizada da 9B
```

Cada coluna mantém sua fonte. A controladoria calcula pontes e divergências, mas não grava um novo valor operacional. O contabilizado deriva do razão e o pago deriva do Financeiro.

## 15. Estoque imobiliário e terreno

### 15.1 Estrutura conceitual

| Entidade proposta | Responsabilidade |
|---|---|
| `RealEstateInventoryPolicy` | Política versionada de elegibilidade, apropriação e baixa |
| `InventoryCostPool` | Pool por empreendimento/período/categoria: terreno, incorporação, obra etc. |
| `InventoryCostMovement` | Entrada, transferência, baixa, reversão ou ajuste com lançamento de origem |
| `UnitCostAllocationRun` | Execução imutável da apropriação, política, critérios e prova-zero |
| `UnitCostAllocationLine` | Custo atribuído à unidade/tipologia/torre/bloco e memória |
| `InventoryBalanceSnapshot` | Quantidade e valor no fechamento por estágio |

Estados analíticos: terreno, desenvolvimento/incorporação, construção em andamento, unidade concluída em estoque, unidade vendida ainda não baixada conforme política e unidade entregue/baixada.

Custos apropriáveis e não apropriáveis são definidos pela política versionada e por validação contábil/fiscal, não por enum legal eterno.

### 15.2 Custo por unidade

Critérios configuráveis:

- custo direto identificado;
- área privativa/total;
- fração ideal;
- tipologia;
- torre, bloco ou etapa;
- quantidade equivalente;
- critério técnico aprovado;
- combinação ponderada.

```text
Σ custo alocado às unidades + residual justificado = custo do pool
```

O run armazena população de unidades, pesos, arredondamento, residual, versão da política e fontes. Alteração gera novo run; não sobrescreve o anterior.

### 15.3 Terreno e permuta

A arquitetura suporta aquisição em dinheiro, permuta física, permuta financeira, obrigação futura e incorporação ao estoque. O evento registra contraprestação, obrigação, unidades/percentual envolvidos e política aplicada. Reconhecimento, mensuração e tributação exigem regra configurada e validação profissional; nenhuma regra fiscal fixa será codificada como universal.

## 16. Reconhecimento de receita e margem

### 16.1 Políticas configuráveis

`RevenueRecognitionPolicy` é versão especializada ou seção da `AccountingPolicy`, com vigência por empresa/projeto/regime. Pode considerar contrato, entrega, evolução, recebimento e norma aplicável, sem declarar um único método como verdade.

Entidades conceituais:

- `RevenueRecognitionRun`: data de corte, política, vendas/unidades e fontes;
- `RevenueRecognitionLine`: receita reconhecida, anteriormente reconhecida, ajuste, custo baixado e margem;
- `RevenueRecognitionSchedule`: memória futura, nunca uma substituta dos recebíveis.

Separações obrigatórias:

```text
VGV comercial ≠ recebível ≠ recebimento ≠ receita contábil
custo orçado ≠ custo incorrido ≠ custo apropriado ≠ custo baixado
```

Venda, renegociação, distrato e entrega geram novos eventos. O histórico do contrato e dos reconhecimentos anteriores permanece íntegro.

## 17. Fiscal e regimes tributários

### 17.1 Escopo da camada fiscal

A 9G controla configuração, evidências, bases, apurações propostas, obrigações, vencimentos e conciliação. Não transmite declarações nem substitui motor tributário homologado.

Entidades conceituais:

| Entidade proposta | Responsabilidade |
|---|---|
| `TaxRegimeAssignment` | Regime por empresa/SPE e vigência |
| `TaxPolicy` | Tributo, incidência, parâmetros, vigência, jurisdição e fonte normativa |
| `FiscalDocumentReference` | Metadados e vínculo ao documento já armazenado |
| `TaxAssessment` | Apuração versionada por empresa/período/tributo |
| `TaxAssessmentLine` | Base, ajustes, alíquota parametrizada, valor e origem |
| `TaxObligationLink` | Ponte da apuração aprovada para obrigação da 9B |
| `TaxWithholding` | Retenção, beneficiário, recolhimento e compensação |

Datas de competência, documento, vencimento, pagamento e conciliação permanecem distintas.

### 17.2 Regimes e RET

O regime é atribuído por empresa e período. A arquitetura comporta RET, lucro presumido, lucro real e outros, sem assumir exclusividade.

RET deve ter configuração específica, versionada, vigente e auditável por patrimônio de afetação/empreendimento quando aplicável. Base, percentual, composição e exceções vêm da política validada. Nenhuma alíquota será hardcoded como regra permanente.

O modelo deve suportar IRPJ, CSLL, PIS, COFINS, ISS, INSS, retenções e tributos específicos quando aplicáveis, mas cálculos legais definitivos permanecem fora da primeira implementação.

### 17.3 Documentos e adaptadores

NF-e, NFS-e, recibos e notas de débito/crédito serão referenciados pela infraestrutura documental existente, com chave, emissor, tomador, datas, valor, checksum e versão. Não haverá uma Sala de Documentos duplicada.

Interfaces futuras: SEFAZ, prefeituras, provedores NFS-e e escritório contábil. A primeira geração usa importação/exportação controlada e rotulada, sem conexão real.

## 18. Rateios

| Entidade proposta | Responsabilidade |
|---|---|
| `AllocationPolicy` | Critério, vigência, dimensões, limites e aprovadores |
| `AllocationRun` | Execução imutável por período e conjunto de custos |
| `AllocationLine` | Origem, destino, driver, peso, valor e arredondamento |

Drivers possíveis: VGV, receita, headcount da 9F, área, custo, capacidade ou percentual manual aprovado.

Caso crítico:

```text
despesa corporativa = R$ 100.000
Σ rateios para as quatro SPEs = R$ 100.000
```

Resíduo de centavos é fechado deterministicamente na última linha elegível ou conforme política explícita. O run registra fonte do driver, data de corte, memória e aprovação. Rateio intercompany pode gerar contas recíprocas e precisa ser eliminado na consolidação quando cabível.

## 19. Intercompany e consolidação

### 19.1 Intercompany

A 9G reutiliza `IntercompanyTransaction` e seus pares AP/AR. Cada lado recebe sua classificação contábil individual e referência ao mesmo par econômico.

Caso crítico:

```text
Empresa A empresta R$ 2 milhões à SPE B
A: direito a receber
B: obrigação a pagar
Grupo: direito e obrigação eliminados
```

Transferência interna não produz receita, despesa, lucro ou patrimônio artificial.

### 19.2 Consolidação

Entidades conceituais:

- `ConsolidationScope`: grupo, empresas, participação, método e vigência;
- `ConsolidationRun`: período, versões dos fechamentos, moeda e status;
- `ConsolidationPackage`: balancete fechado de cada empresa e checksum;
- `ConsolidationElimination`: par, contas, valores, origem, justificativa e aprovação;
- `ConsolidatedBalanceSnapshot`: resultado imutável do run.

```text
consolidado = soma dos pacotes individuais
            + ajustes de consolidação aprovados
            - eliminações aprovadas
```

Eliminações cobrem mútuos, transferências, receitas/despesas internas e saldos recíprocos. Diferença entre pernas bloqueia ou cria pendência material; não é eliminada silenciosamente.

Caso crítico: soma individual `X`, eliminações `Y`, consolidado `X - Y`, com cada linha de `Y` rastreável ao par intercompany e aos lançamentos de origem.

## 20. Relatórios contábeis e gerenciais

### 20.1 Razão

```text
Conta → linha do lançamento → evento contábil → documento
→ medição/venda/obrigação/pessoa → contrato → contraparte
```

Filtros: empresa, projeto, conta, período, centro de custo, item econômico, unidade e origem. Paginação por cursor é obrigatória.

### 20.2 Balancete

Por conta, empresa e período:

- saldo anterior;
- débitos;
- créditos;
- saldo final;
- prova de formação do saldo.

### 20.3 DRE

Linhas configuradas por `ReportingLineMapping`:

- receita;
- impostos/deduções;
- custo;
- margem bruta;
- despesas;
- resultado operacional;
- resultado financeiro;
- resultado final.

Dimensões: empreendimento, SPE, empresa e grupo. EBITDA ou outro subtotal só aparece quando definido pela estrutura de relatório/política; não é inferido livremente.

### 20.4 Balanço

Suporte progressivo a caixa/bancos, recebíveis, estoques, adiantamentos e ativos; fornecedores, obrigações, tributos, empréstimos e provisões; patrimônio líquido. Toda linha deriva do balancete e do mapeamento vigente.

### 20.5 Gerencial versus societário

As visões coexistem por mapeamentos e dimensões diferentes sobre os mesmos fatos/lançamentos. Ajustes exclusivamente gerenciais são identificados em livro/camada própria e nunca contaminam o societário sem aprovação contábil.

## 21. Conciliação contábil e provas-zero

`AccountingReconciliation` e seus itens comparam subledgers e razão:

- AP da 9B versus fornecedores no razão;
- AR da 9B versus clientes no razão;
- bancos conciliados versus caixa/bancos;
- medições reconhecidas versus custo/estoque;
- estoque analítico versus conta sintética;
- tributos apurados versus obrigações;
- intercompany entre pares;
- REDE versus balancete externo.

Exemplo: AP liquidado em R$ 100 mil e razão em R$ 97 mil gera divergência de R$ 3 mil, com itens, competência, materialidade e ação — nunca ajuste automático sem aprovação.

Invariantes:

```text
débitos = créditos
saldo inicial + débitos - créditos = saldo final, conforme natureza
subledger reconciliado = conta de controle, dentro da tolerância
soma das subsidiárias + ajustes - eliminações = consolidado
Σ rateios + residual justificado = origem
Σ custo unitário + residual = pool de estoque
```

## 22. Controladoria

A camada de controladoria constrói pontes sem duplicar fontes:

| Estágio | Fonte |
|---|---|
| Base Aprovada | 9A |
| Orçamento/EAP/Cronograma | 9A |
| Comprometido | 9C e obrigações 9B |
| Medido | 9C |
| Contabilizado | razão 9G |
| Pago/recebido | 9B |
| Projeção Atualizada | 9B |
| Vendas/VGV | 9E após congelamento |
| Pessoas/administração | 9F após congelamento |

Não será criado `AccountingForecast` na primeira geração. A projeção financeira permanece na 9B; a 9G oferece leitura contábil, pontes, variações e efeitos no resultado.

Alertas determinísticos:

- custo contabilizado acima do orçamento;
- receita reconhecida abaixo do esperado pela política;
- margem deteriorada;
- despesa administrativa acima de política;
- conta de controle não conciliada;
- fechamento atrasado;
- evento sem mapeamento ou lançamento sem origem;
- intercompany divergente/não eliminado;
- tributo próximo ao vencimento;
- estoque analítico divergente do razão.

## 23. Central Executiva

Indicadores com empresa, projeto, período, base e data de corte:

- receita contábil e gerencial;
- custo incorrido, contabilizado e pago;
- margem bruta e resultado operacional;
- resultado por empreendimento/SPE e consolidado;
- estoque imobiliário e custo médio/por unidade;
- AP, AR e caixa reconciliados;
- tributos e provisões;
- intercompany a conciliar/eliminar;
- estágio e qualidade do fechamento mensal;
- divergências acima da materialidade;
- ponte Base → Orçamento → Compromisso → Medição → Razão → Caixa → Projeção.

Todo card abre drill-down até o fato operacional. A identidade visual e a nomenclatura prioritariamente em português devem ser preservadas.

## 24. REDE IA

Ferramentas futuras somente leitura:

- `getAccountingResult`;
- `getTrialBalance`;
- `getGeneralLedgerDrilldown`;
- `getRealEstateInventoryPosition`;
- `getUnitAccountingCost`;
- `compareFinancialToAccounting`;
- `getAccountingCloseStatus`;
- `getUnclassifiedAccountingEvents`;
- `getIntercompanyEliminations`;
- `compareManagerialAndStatutoryResult`;
- `getTaxesDue`;
- `explainMarginBridge`.

O LLM não calcula DRE, balanço, tributo, rateio ou consolidação. Recebe resultados do motor com política, versão, período, confiança e evidências. Não publica saldos de outra organização, não cria lançamentos e não fecha/reabre períodos.

## 25. Segurança, RBAC e segregação

Reutilizar `MembershipRole` e acrescentar capabilities, não outro sistema:

- `ACCOUNTING_EVENT_READ`, `ACCOUNTING_CLASSIFY`;
- `ACCOUNTING_ENTRY_CREATE`, `ACCOUNTING_ENTRY_REVIEW`, `ACCOUNTING_ENTRY_POST`;
- `ACCOUNTING_REVERSE`;
- `ACCOUNTING_CLOSE`, `ACCOUNTING_REOPEN`;
- `TAX_READ`, `TAX_ASSESS`, `TAX_APPROVE`;
- `CONSOLIDATION_RUN`, `CONSOLIDATION_APPROVE`;
- `ACCOUNTING_EXPORT`, `ACCOUNTING_IMPORT`.

Escopos: organização, grupo, empresa, projeto e livro. Segregações mínimas:

- criador não contabiliza/aprova o próprio lançamento material;
- quem fecha não reabre sozinho;
- quem prepara eliminação não aprova o consolidado;
- importação externa exige revisão antes de afetar o razão;
- acessos a fiscal, folha futura e exportações são independentes.

`ApprovalPolicy` deve receber novos `ApprovalActType` em migration futura, após definir a matriz. Serviços validam tenant e entidade legal em toda referência. RLS pode ser defesa em profundidade, nunca substituto das validações de aplicação.

## 26. Auditoria e histórico

Cada lançamento responde:

- quem e qual módulo originaram o fato;
- registro e versão da origem;
- evento/checksum/idempotency key;
- política e mapeamento aplicados;
- documento e dimensões;
- quem preparou, revisou, aprovou e contabilizou;
- quando ocorreu, competiu, contabilizou, liquidou e conciliou;
- se houve estorno, reabertura, ajuste ou eliminação.

Políticas, plano, mapeamentos, lançamentos, rateios, períodos, snapshots e consolidações não são sobrescritos silenciosamente. Leitura/exportação sensível também deve ser auditada.

## 27. Performance e escala

Projetar para múltiplos grupos, centenas de SPEs, milhões de linhas e vários anos:

- `organizationId` e `companyId` no início dos índices críticos;
- índices por período/status, conta/data, fonte/idempotência e dimensões;
- paginação por cursor no razão e nos eventos;
- contabilização em lotes pequenos, transacionais e idempotentes;
- filas/outbox com retry, dead-letter e observabilidade para adaptadores;
- snapshots de fechamento por empresa/período;
- read models/materialized views para balancete, DRE, balanço e Central;
- refresh versionado após fechamento, sem consulta OLTP massiva;
- particionamento temporal somente após benchmark;
- cache com tenant, empresa, período, versão e data de corte;
- exportações assíncronas e reproduzíveis;
- métricas de atraso, falha, pendência, divergência e tempo de fechamento.

## 28. Integrações 9A–9F

### 9A

Base, orçamento, EAP, cronograma, `EconomicItem` e centros são dimensões/fontes de comparação; a 9G não modifica versões aprovadas.

### 9B

AP/AR, pagamento, recebimento, bancos, conciliação, intercompany e projeção permanecem fontes. `FinancialPeriodClosure` é gate, não período contábil. Caixa e competência continuam separados.

### 9C

Pedido/contrato é compromisso; medição é evidência de execução; retenção e adiantamento têm tratamentos próprios. A identidade econômica evita reconhecer contrato, medição, NF e pagamento como quatro custos.

### 9D

Contingências, obrigações, multas e garantias alimentam eventos/provisões segundo política. O Jurídico classifica risco e evidência; a Contabilidade decide reconhecimento.

### 9E

Após freeze: `SalesUnit`, venda, contrato, plano, distrato, entrega e eventos de recebível alimentam estoque, reconhecimento de receita, custo baixado e margem. A 9G não duplica unidade comercial nem AR.

### 9F

Após freeze: pessoa → vínculo → custo por competência → empresa/centro/projeto → evento contábil. A 9G consome custo agregado autorizado; não implementa folha nem expõe remuneração individual na Central/IA.

## 29. Importação, exportação e sistemas externos

### 29.1 Exportação

Pacotes versionados para escritório/ERP: plano, contas, centros, eventos, lançamentos, documentos, saldos e checksums. Cada lote registra formato, versão, corte, filtros, autor, destinatário e status.

### 29.2 Importação

Contabilidade externa → REDE para validar balancete/razão, não para sobrescrever automaticamente o razão interno. Fluxo: upload → validação estrutural → staging → matching → divergências → aprovação → efeito permitido.

### 29.3 Conectores futuros

Contratos de adaptador preparam Sienge, Mega, SAP, TOTVS, Domínio Sistemas, outros ERPs, bancos, SEFAZ e prefeituras. Nenhum conector real pertence à implementação inicial.

## 30. Migrations e rollout futuros

Nenhuma migration é criada neste planejamento. Estratégia futura:

1. migrations aditivas por sprint, sem editar migrations aplicadas;
2. tabelas opcionais e índices antes de ativar ingestão;
3. backfill/import em staging com reconciliação, nunca reset de banco;
4. feature flags por organização/empresa;
5. shadow posting para comparar lançamentos sem torná-los oficiais;
6. validação com contador/controladoria e PostgreSQL real;
7. ativação por empresa e período;
8. seed demonstrativo aditivo/idempotente somente após política aprovada;
9. rollback por desativação e estorno, não exclusão.

## 31. Testes futuros

### 31.1 Domínio

- árvore e versões do plano;
- precedência, ambiguidade e vigência dos mapeamentos;
- idempotência e checksum;
- partida dobrada e arredondamento;
- datas de competência, contábil e caixa;
- estorno e substituição;
- provisão, complemento e reversão;
- rateio com prova-zero;
- custo apropriável, pools e custo por unidade;
- reconhecimento/reversão de receita e margem;
- regimes, bases e políticas fiscais configuradas;
- intercompany e eliminações;
- consolidação e saldos.

### 31.2 Casos críticos obrigatórios

1. Contrato R$ 1 milhão + medição/NF/pagamento de R$ 200 mil reconhece somente R$ 200 mil de principal.
2. Serviço em janeiro, NF em fevereiro e pagamento em março preserva três datas/efeitos.
3. Mútuo de R$ 2 milhões cria direito/obrigação individuais e elimina no grupo.
4. Venda preserva VGV, AR, caixa, receita, custo e margem separados.
5. Unidade não vendida permanece no estoque conforme política e baixa somente no evento aplicável.
6. Período fechado bloqueia retroação e permite somente ajuste/reabertura autorizada.
7. Rateio de R$ 100 mil fecha exatamente em R$ 100 mil.
8. Consolidado fecha em `X + ajustes - Y`, com eliminações rastreáveis.

### 31.3 Integração e segurança

- contratos 9A–9F e ERP externo;
- isolamento de tenant/empresa em leitura, escrita, IA e exportação;
- capabilities, escopos e segregação;
- concorrência de contabilização/fechamento;
- recuperação de lote e retry sem duplicidade;
- auditoria completa;
- conciliação de AP/AR/bancos/estoque/tributos/intercompany;
- regressão do START BUTANTÃ e módulos existentes.

### 31.4 Performance

- milhões de linhas no razão com paginação;
- fechamento de dezenas/centenas de SPEs;
- geração concorrente de balancete/DRE;
- consolidação incremental;
- exportação grande e refresh de read models;
- metas de latência definidas antes da implementação.

## 32. Sprints recomendadas

### 9G.0 — Contrato contábil e inventário

- congelar dicionário de eventos/datas/dimensões das 9A–9D;
- revisar contratos finais 9E/9F quando disponíveis;
- definir ownership, políticas iniciais e matriz RBAC;
- validar desenho com Contabilidade, Fiscal, Controladoria e Jurídico.

**Saída:** catálogo de eventos, datas e responsáveis; nenhum fato sem owner.

### 9G.1 — Plano de contas, políticas e motor de eventos

- plano hierárquico/versionado, adoção e particularização;
- políticas e mapeamentos com simulação;
- `AccountingEvent`, idempotência, classificação e pendências;
- adaptadores iniciais de 9A–9D em shadow mode.

**Saída:** fatos classificados reproduzivelmente, ainda sem razão oficial.

### 9G.2 — Livro razão e partidas dobradas

- entries/lines, prova-zero, postagem, estorno e drill-down;
- razão, balancete inicial e snapshots;
- aprovações e auditoria.

**Saída:** razão equilibrado e rastreável em PostgreSQL real.

### 9G.3 — Fechamento e conciliação

- período contábil, checklist, ajustes e reabertura;
- reconciliações AP/AR/bancos/medições;
- importação de balancete externo em staging.

**Saída:** primeiro mês fechado com todas as provas-zero.

### 9G.4 — Estoque imobiliário e apropriação

- pools, movimentos e políticas de estoque;
- terreno/permuta configuráveis;
- custo por unidade e provas de rateio;
- integração da unidade comercial após freeze da 9E.

**Saída:** estoque analítico conciliado ao razão e memória por unidade.

### 9G.5 — Receita, fiscal e regimes

- política/runs de reconhecimento de receita;
- regimes por vigência, RET parametrizado e apurações controladas;
- referências fiscais, retenções e obrigação na 9B;
- adaptadores externos apenas como contratos/importação.

**Saída:** receita/custo/margem e apuração demonstrativa aprovadas por especialista.

### 9G.6 — Consolidação e intercompany

- escopo, pacotes, moeda/método quando aplicável;
- matching recíproco, eliminações e ajustes;
- snapshots e relatórios consolidados.

**Saída:** caso de mútuo e consolidado `X - Y` fechando com rastreabilidade.

### 9G.7 — Controladoria, Central Executiva e REDE IA

- ponte completa dos estágios operacionais;
- DRE/balanço gerencial e societário;
- indicadores, alertas, drill-down e ferramentas de leitura;
- read models, carga, segurança e rollout.

**Saída:** resultado por projeto/SPE/grupo conciliado, explicável e performático.

## 33. Riscos e mitigação

| Risco | Consequência | Mitigação |
|---|---|---|
| Segunda verdade financeira | Saldos incompatíveis | ownership por módulo, portas e reconciliação |
| Contrato/medição/NF/pagamento quadruplicados | Custo artificial | identidade econômica e política de gatilho |
| Data única | competência e caixa incorretos | datas independentes e testes do caso janeiro–março |
| Plano hardcoded | inadequação entre empresas | plano e particularizações versionados |
| Regra fiscal fixa | risco legal | políticas vigentes, fonte normativa e aprovação especializada |
| Lançamento desequilibrado | razão inválido | prova-zero transacional e defesa no banco |
| Alteração retroativa | quebra de auditoria | período, estorno, ajuste e reabertura autorizada |
| Intercompany por soma simples | resultado falso | pares, reciprocidade e eliminações auditáveis |
| Rateio opaco | margem distorcida | driver, versão, memória e prova-zero |
| Estoque sem reconciliação | custo/margem errados | pool, movimentos, unidade e conta de controle |
| Dependência de 9E/9F instáveis | retrabalho | portas e gates após freeze |
| Escopo de ERP gigante | atraso e complexidade | foco em inteligência, integração e controle |
| Volume do razão | relatórios lentos | snapshots, read models, paginação e lotes |
| Acesso cruzado | vazamento sensível | tenant/empresa, capabilities, auditoria e testes |

## 34. Itens deliberadamente posteriores

- SPED completo, ECD e ECF;
- eSocial e folha;
- emissão fiscal oficial;
- integração real NF-e/NFS-e;
- cálculo tributário definitivo de produção;
- transmissão a órgãos públicos;
- conectores reais Sienge, Mega, SAP, TOTVS, Domínio e outros;
- contabilidade societária automática sem validação profissional;
- auditoria independente;
- consolidação internacional/IFRS e conversão cambial avançada, salvo decisão futura;
- ativo imobilizado e funding contábil completos, além do mínimo exigido pelos relatórios;
- substituição do escritório contábil ou ERP oficial.

## 35. Decisões pendentes antes da implementação

- sistema oficial do razão: REDE, ERP externo ou operação híbrida;
- plano e relatórios iniciais aprovados pelo responsável contábil;
- políticas de custo apropriável, estoque, terreno/permuta e receita;
- fonte e granularidade das unidades após a 9E;
- fonte de custos de pessoas após a 9F;
- tratamento da competência de medição versus documento por classe de evento;
- tolerâncias/materialidade de fechamento e conciliação;
- escopo societário e participação para consolidação;
- regimes vigentes por empresa e patrimônio de afetação;
- livro gerencial separado e regras de ajustes;
- moeda funcional e necessidade real de multimoeda;
- volumes e SLAs para decidir particionamento/materialized views.

## 36. Critério final de conclusão

A Fase 9G estará concluída quando a seguinte cadeia for demonstrável, reconciliada e auditável:

```text
o que planejamos
→ o que contratamos
→ o que executamos
→ o que devemos
→ o que pagamos
→ o que vendemos
→ o que recebemos
→ o que contabilizamos
→ o que tributamos
→ resultado real por empreendimento/SPE
→ resultado consolidado do grupo
```

Todo número deve chegar ao lançamento e do lançamento ao evento, documento e fato operacional original. A primeira implementação recomendada é a Sprint 9G.0; ela começa pela validação profissional e congelamento dos contratos, não pela criação prematura de tabelas.
