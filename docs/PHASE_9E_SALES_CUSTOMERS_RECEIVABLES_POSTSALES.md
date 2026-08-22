# Fase 9E — Vendas, clientes, unidades, contratos de venda, recebíveis e pós-venda

## Objetivo

A Fase 9E conecta o produto imobiliário (unidade) ao cliente, à venda, ao contrato e ao plano de pagamento, e entrega os recebíveis à Fase 9B pelo mesmo mecanismo idempotente que a Fase 9C já usa e comprovou em produção para gerar contas a pagar a partir de medições. Não há financeiro paralelo: a 9E decide o evento comercial, a 9B executa o efeito financeiro. O planejamento arquitetural completo está preservado em `docs/PHASE_9E_SALES_CUSTOMERS_RECEIVABLES_POSTSALES_PLAN.md`.

## Arquitetura

- `Customer` e `Supplier` (9B) são reutilizados sem alteração estrutural — nenhum `SalesCustomer` foi criado. Corretor/imobiliária usa `Supplier` + a tabela satélite `BrokerProfile` (CRECI, imobiliária-mãe, comissão padrão).
- `ApprovalPolicy`/`ApprovalRequest`/`ApprovalDecisionRecord` (9C) são reutilizados integralmente para alçada de venda, desconto, distrato e comissão — quatro novos valores de `ApprovalActType` (`SALE`, `SALE_DISCOUNT`, `SALE_RESCISSION`, `COMMISSION`), nenhuma tabela de alçada nova.
- `ProcurementDocumentLink` (9C) é o padrão de documento a reutilizar quando a interface de upload for ligada; nenhum storage paralelo foi criado nesta fase.
- `SalesUnit` é o estoque comercial próprio, referenciando `ProjectOperatingUnit` (torre/bloco) e opcionalmente `DetectedUnit` (BIM/Design) por FK/id solto — nunca copia área ou tipologia da leitura geométrica.
- Todo agregado de primeiro nível carrega `organizationId`; todo `findFirst` de serviço filtra por organização (testado).

## Modelo persistido

| Grupo | Models principais |
|---|---|
| Estoque e preço | `SalesUnit`, `SalesUnitBlock`, `SalesPriceTable`, `SalesPriceTableLine` |
| CRM mínimo e corretagem | `SalesLead`, `BrokerProfile` |
| Negociação | `SalesProposal`, `SalesReservation` |
| Venda | `Sale`, `SaleParty`, `SalesContract`, `SalesPaymentPlan`, `SalesPaymentPlanInstallment` |
| Comissão | `SalesCommissionPolicy`, `SalesCommission` |
| Entrega e pós-venda | `SalesUnitInspection`, `PostSaleRequest`, `PostSaleUpdate` |

Extensões pontuais e aditivas em modelos existentes: `ReceivableAccount.saleId` (FK direta, evita parsing de payload em toda consulta), `ReceivableInstallment` ganhou a relação inversa `salesInstallment`, `FinancialIntegrationEvent.receivableAccountId` (espelha `payableAccountId`) e quatro novos valores de `FinancialIntegrationEventType` (`SALE_CONTRACT_SIGNED`, `SALE_PLAN_REVISED`, `SALE_RESCINDED`, `COMMISSION_APPROVED`). Nenhuma migration anterior foi alterada — tudo em `prisma/migrations/20260822120000_phase_9e_sales_customers_receivables_postsales/`.

## Máquina de estados e concorrência

`SalesUnit.status` segue `DISPONIVEL → EM_RESERVA/EM_PROPOSTA → RESERVADA → VENDIDA → DISTRATADA/ENTREGUE`, com `BLOQUEADA`/`PERMUTA` acessíveis a partir dos estados intermediários e `DISTRATADA → DISPONIVEL` como reversão explícita. Toda transição crítica (reserva, venda, bloqueio, entrega, reativação) usa `updateMany` com o status esperado na cláusula `where`, checando `count === 1` — o mesmo padrão de risco identificado no plano arquitetural, agora implementado, não apenas descrito. O teste de concorrência (`database.integration.test.ts`) dispara duas aprovações de venda simultâneas sobre a mesma unidade contra PostgreSQL real e confirma que exatamente uma prevalece.

## Integração 9E → 9B

`createExternalReceivableObligation`/`reverseExternalReceivableObligation` (`src/application/financial-ops/external-obligation-port.ts`) espelham `createExternalPayableObligation` linha a linha: mesma chave `sha256(organizationId:sourceType:sourceId:sourceVersion:eventType)`, mesmo checksum de payload, mesmo `@@unique` de banco. Cada parcela comercial (`SalesPaymentPlanInstallment`) gera exatamente um `ReceivableAccount`/`ReceivableInstallment` — uma venda com 10 parcelas gera 10 recebíveis, e o ponto de entrada `generateSaleReceivables` pode ser chamado repetidamente sem duplicar (Cenário A). Comissão aprovada usa o port pagável já existente (`sourceType="SALE_COMMISSION"`) sem nenhuma tabela de conta a pagar comercial paralela. Distrato com parcela paga usa o mesmo port pagável para a devolução calculada (`calculateRescissionRefund`), com `supplierId` nulo e descrição identificando o comprador — parcelas não pagas são canceladas via `transitionReceivableInstallment` já existente na 9B, nunca apagadas. A lacuna real identificada no plano (`applyReceivableInstallmentCorrection` ausente na 9B) foi fechada de forma aditiva em `financial-service.ts`, espelhando `applyPayableInstallmentCorrection`.

## Renegociação

Gera nova versão do `SalesPaymentPlan` (`previousPlanId`), cancela via `transitionReceivableInstallment` apenas as parcelas antigas não pagas, preserva as pagas intocadas, e gera os novos recebíveis pelo mesmo caminho idempotente com `eventType=SALE_PLAN_REVISED`. O plano anterior nunca é apagado, apenas marcado `SUPERSEDED`.

## VGV e indicadores

Funções puras em `src/domain/sales/engine.ts` (`vgvBreakdown`, `vgvToReceive`, `vso`, `monthsOfStock`, `pricePerM2`, `computeDiscount`) calculam VGV total/disponível/reservado/vendido/permutado/distratado, VGV a receber (vendido − recebido, nunca somado ao previsto), VSO e preço/m² — nenhum valor agregado é armazenado, mesma disciplina de "sempre calculado" já usada em Financeiro e Suprimentos. Recebido/inadimplência são lidos diretamente de `ReceivableAccount`/`ReceivableInstallment` via `saleId`, nunca recalculados.

## Interface e REDE AI

A navegação ganhou **Vendas e Recebíveis**, com Visão Geral, Estoque e Preços, Propostas, Reservas, Vendas e Contratos, Comissões e Entrega/Pós-venda. A REDE AI ganhou onze ferramentas de leitura (`getSalesInventory`, `getUnitTypologyPerformance`, `getPricePerSquareMeter`, `getDiscountGranted`, `getExpiringProposals`, `getDelinquentCustomers`, `getReceivableCurve`, `getRescindedUnits`, `getPendingCommissions`, `getUnitsAwaitingDelivery`), todas limitadas ao contexto autenticado e sem nenhuma ferramenta de mutação — desconto e aprovação continuam exigindo ação humana via `ApprovalRequest`.

## Dados demonstrativos

O seed do START BUTANTÃ cria, de modo aditivo e idempotente, três unidades (vendida e entregue, bloqueada, disponível), uma tabela de preços ativa, um corretor com perfil CRECI, um lead convertido em cliente, uma proposta, uma reserva confirmada, uma venda aprovada com contrato e plano de três parcelas, um recebimento de entrada conciliado, uma política e uma comissão aprovada (gerando obrigação a pagar exatamente uma vez), uma vistoria aceita, a entrega da unidade e uma solicitação de pós-venda com atualização. Executar o seed duas vezes não duplica nenhum registro.

## Execução

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev -- --port 3001
```

Credencial demonstrativa: `admin@rede.local` / `Rede@2026`.

## Limites conscientes

- assinatura eletrônica real do contrato de venda não faz parte desta fase — `SalesContract.signatureStatus` é um placeholder estrutural para integração futura;
- boleto/Pix real de cobrança não são emitidos; a 9E consome integralmente a régua de vencimento e a conciliação já existentes na 9B;
- personalização de unidade, CRM de marketing completo e atendimento de pós-venda tipo helpdesk (fila, SLA automatizado, escalonamento) foram deliberadamente adiados, conforme o plano;
- paginação server-side não foi implementada nas listagens desta fase — adequado ao volume demonstrativo do START BUTANTÃ, mesma dívida técnica já registrada na 9B, a evoluir antes de milhares de unidades;
- a integração com a 9D é por FK nullable (documento genérico via `ProcurementDocumentLink` quando ligado à UI) — distrato, julgamento jurídico de multa/retenção e licença de habite-se para entrega continuam sendo checagens comerciais simples, não decisões jurídicas formais;
- validação contra PostgreSQL real (migração aplicada, seed executado duas vezes, suíte de integração, smoke test autenticado) não foi possível neste ambiente de execução — o binário do PostgreSQL local recusa iniciar sob a conta de Administrador do Windows deste ambiente (mesma restrição de segurança do próprio PostgreSQL já documentada na Fase 9B, não contornável sem criar um usuário restrito). Todos os testes de integração seguem o padrão `describe.skipIf(!process.env.DATABASE_URL)`; a migração foi gerada por `prisma migrate diff` (schema→schema, sem necessidade de conexão) e deve ser validada com `pnpm db:migrate && pnpm db:seed && pnpm db:seed && pnpm test` contra um Postgres real antes do merge.
