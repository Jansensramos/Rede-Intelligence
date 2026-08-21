# REDE Intelligence — Fase 9C implementada

## Escopo entregue

A Fase 9C conecta Orçamento Oficial e Cronograma aos fatos de suprimentos e execução: necessidade, requisição, especificação versionada, cotação, proposta estruturada, decisão, economia validada, pedido, contrato, aditivo, medição e obrigação financeira. O `EconomicItem` e o `BudgetLineItem` continuam sendo as identidades econômicas de origem.

O cadastro `Supplier` da Fase 9B foi reutilizado como fornecedor/contraparte única. Pagamento, conciliação, realizado e Projeção Atualizada permanecem sob ownership da Fase 9B.

## Domínios e modelos

- Fornecedores: `Supplier` e `SupplierQualification`.
- Compras: `ProcurementNeed`, `PurchaseRequisition`, `PurchaseRequisitionItem`, `ProcurementSpecification`, `QuotationProcess`, `QuotationInvitation`, `SupplierProposal`, `SupplierProposalItem`, `ProposalComparisonFinding`, `ProcurementDecision` e `ValidatedSaving`.
- Aprovações: `ApprovalPolicy`, `ApprovalRequest` e `ApprovalDecisionRecord`, com alçada por ato, valor e escopo.
- Instrumentos: `PurchaseOrder`, `PurchaseOrderItem`, `OperationalContract`, `OperationalContractItem` e `ContractAmendment`.
- Execução: `MeasurementCertificate`, `MeasurementLine`, `MeasurementAdjustment`, `ContractAdvance` e `AdvanceAmortization`.
- Integração: `FinancialIntegrationEvent`, com `eventId`, chave idempotente, checksum, versão de schema, payload, tentativas e receipt financeiro.
- Documentos: `ProcurementDocumentLink`, apontando para storage canônico por checksum, sem duplicar bytes.

## Regras determinísticas

- Data-limite de contratação = data necessária − lead time − folga.
- Propostas podem ser comparáveis, comparáveis com ajustes ou não comparáveis; menor preço não seleciona vencedor automaticamente.
- Economia validada exige escopo comparável e validação técnica.
- Valor atual = original + acréscimos + reajustes − supressões aprovadas.
- Quantidade acumulada não excede a contratada.
- Medição acumulada não excede o valor contratual atual sem exceção formal.
- Líquido = bruto − retenções − descontos − adiantamentos amortizados.
- Projeção usa substituição de planejamento por compromisso e nunca soma orçamento + contrato.

## Integração 9C → 9B

`approveMeasurementAndGenerateObligation` grava aprovação e evento transacional; `createExternalPayableObligation` é a porta de aplicação versionada da 9B. A chave canônica combina organização, tipo/origem, ID, versão e evento. Replay idêntico devolve o mesmo receipt. A obrigação, Conta a Pagar e parcela são geradas uma única vez. Reversão cancela formalmente obrigação/parcela sem apagar histórico e bloqueia quando existe pagamento efetivo.

O dashboard consulta pagamentos exclusivamente nas estruturas da 9B e mantém os estágios separados: Orçamento, Contratado, Medido, Obrigado e Pago.

## Interface e REDE IA

A navegação ganhou **Suprimentos e Contratos**, em português, com Visão Geral, Necessidades, Requisições, Cotações, Fornecedores, Pedidos, Contratos/Aditivos e Medições. A Central mostra Orçamento, Contratado, Saldo a Contratar, Medido, Obrigado, Pago, aditivos, economia validada, processos abertos, compras críticas e medições pendentes.

Ferramentas de IA somente leitura consultam estágios, compras críticas, contratos/aditivos, economia validada e medições pendentes. Os resultados vêm de services determinísticos e carregam evidência; a IA não escolhe fornecedor nem aprova atos.

## Migration e seed

- Migration nova: `20260820233000_phase_9c_procurement_contracts_measurements`.
- A migration é aditiva, UTF-8 sem BOM e não altera migrations aplicadas.
- O seed preserva START BUTANTÃ e cria/atualiza de forma idempotente fornecedores qualificados, necessidade, requisição, cotação, propostas, decisão, pedido, contrato, aditivo, medição e obrigação.
- Credencial demonstrativa: `admin@rede.local` / `Rede@2026`.

## Execução

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Qualidade:

```bash
pnpm db:validate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Limites deliberados

Não foram adicionados banking real, ERP externo, estoque completo, score arbitrário de fornecedor, folha/bônus ou integrações públicas. Referências externas de preço permanecem preparadas pelo modelo de proveniência e não são inventadas. Importações em massa e virtualização avançada pertencem à evolução de escala, quando houver volume real.
