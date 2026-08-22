# REDE Intelligence — Fase 9G implementada

## Contábil, fiscal, controladoria e consolidação

Implementação aditiva sobre a base oficial `rede-phase-9f-complete-2026-08-22`. O Financeiro, Suprimentos, Jurídico, Vendas e Pessoas continuam donos dos fatos operacionais. A Fase 9G registra sua interpretação contábil, a política vigente, o lançamento e os demonstrativos derivados.

```text
Fato operacional
→ identidade econômica
→ política e mapeamento versionados
→ evento idempotente
→ lançamento equilibrado
→ razão e balancete
→ estoque, resultado, fiscal e consolidação
→ controladoria e drill-down
```

## Escopo entregue

### Plano de contas e mapeamentos

- Plano hierárquico por organização/grupo, com versões imutáveis, vigência, estado e checksum.
- Adoção do plano por empresa e particularizações armazenadas sem clonar o plano.
- Contas sintéticas e analíticas, natureza devedora/credora, categoria e agrupamento gerencial.
- Políticas contábeis versionadas por empresa/empreendimento e tipo.
- Regras de mapeamento com vigência, prioridade, especificidade, contas débito/crédito e histórico.
- Seleção determinística; empate de prioridade/especificidade bloqueia classificação.

### Evento, idempotência e identidade econômica

- `AccountingEvent` preserva organização, empresa, empreendimento, dimensões, fonte, versões, checksum, chave idempotente, competência, ocorrência, emissão, vencimento, contabilização proposta, liquidação e conciliação.
- Reenvio idêntico retorna o evento existente; payload diferente sob a mesma chave é rejeitado.
- `economicIdentityKey` associa contrato, medição, documento e pagamento ao mesmo principal econômico.
- O seed demonstra contrato de R$ 1 milhão como compromisso, medição de R$ 200 mil como competência, documento como confirmação e pagamento como caixa. O custo principal não vira R$ 600 mil.

### Partidas dobradas, razão e balancete

- Lançamentos e linhas usam `Decimal(20,2)`; nenhum `float` é usado para dinheiro.
- Postagem exige ao menos duas linhas, valores positivos e igualdade exata entre débitos e créditos.
- Lançamento material exige revisão segregada.
- Razão paginado no serviço, com conta, lançamento, evento, fonte e dimensões.
- Balancete calcula saldo anterior, débitos, créditos e saldo final segundo a natureza da conta.
- O caso de R$ 100.000,00 em débito e R$ 99.999,99 em crédito é rejeitado por teste.

### Competência, períodos, fechamento e estornos

- Períodos independentes do fechamento financeiro: aberto, em revisão, fechado, reaberto e ajuste.
- Serviço de janeiro, documento de fevereiro e pagamento de março podem coexistir sem colapsar datas.
- Período fechado bloqueia contabilização retroativa.
- Fechamento exige checklist, ausência de eventos sem classificação, ausência de divergência material e prova do balancete.
- Fechamento cria `LedgerSnapshot` com checksum; demonstrações antigas não são reescritas.
- Reabertura exige motivo e autorização segregada.
- Estorno inverte as linhas, preserva o original e cria vínculo explícito; não há exclusão de lançamento contabilizado.

### Provisões, AP, AR e medições

- Provisões registram origem, competência, método, confiança, evidência, política, estado e reversão.
- AP/AR permanecem na Fase 9B; a 9G somente recebe eventos e concilia saldos.
- Medição aprovada pode ser o gatilho configurado de custo/estoque; pagamento não é o único reconhecimento de custo.
- A conciliação demonstrativa compara AP de R$ 100 mil com razão de R$ 97 mil, registra R$ 3 mil de divergência e não cria ajuste automático.

### Estoque imobiliário, pools e apropriação

- Pools de custo por empresa, empreendimento, período, categoria e política.
- Movimentos de entrada, transferência, baixa, reversão e ajuste ligados ao evento/livro.
- Apropriação imutável por unidade com driver, população, proporção, arredondamento, residual, checksum e prova-zero.
- Drivers podem representar área, fração, tipologia, torre, bloco ou outro critério aprovado.
- Fundação para terreno em dinheiro, permuta e obrigação futura é política configurável, não regra universal.

### Receita imobiliária e demonstrações

- VGV, recebível, recebimento, receita reconhecida, custo reconhecido e margem permanecem campos distintos.
- Política de receita versionada e run por data de corte; alteração não reescreve runs anteriores.
- DRE e indicadores gerenciais derivam do razão e dos runs determinísticos.
- A visão gerencial e a contábil usam os mesmos fatos; não duplicam lançamentos.
- Balanço estrutural pode ser montado pelas categorias do plano e balancete.

### Fiscal

- Regime temporal por empresa/empreendimento: RET, Lucro Presumido, Lucro Real e outros.
- Política por tributo com vigência, jurisdição, parâmetros e fonte normativa.
- Apuração e linhas preservam base, alíquota configurada, ajustes, valor e memória.
- Ponte idempotente para obrigação financeira da Fase 9B por `TaxObligationLink`.
- Documento fiscal é apenas referenciado; não existe storage paralelo.
- O RET demonstrativo usa taxa configurada no seed e está explicitamente marcado como sujeito à validação profissional.
- Não foram implementados SPED, ECD, ECF, emissão/transmissão fiscal ou regra legal universal.

### Rateios, intercompany e consolidação

- Rateio contábil/controladoria tem driver, origem, destinos, memória, residual e prova-zero.
- R$ 100 mil rateados fecham exatamente em R$ 100 mil; centavos são tratados deterministicamente.
- Consolidação registra escopo, empresas, período, pacotes, ajustes, eliminações, aprovações e snapshot.
- Mútuo/intercompany de R$ 2 milhões mantém direito e obrigação individuais e elimina R$ 2 milhões no consolidado.
- Prova: soma individual + ajustes - eliminações = consolidado.

### Controladoria e conciliação

Ponte implementada na leitura:

```text
Base Aprovada → Orçamento → Comprometido → Medido → Contabilizado → Pago
```

Cada coluna conserva sua fonte. A 9G não grava uma segunda projeção financeira. Conciliações suportam AP, AR, bancos, medições, estoque, tributos, intercompany e razão externo por tipos configuráveis.

### RBAC, segregação, tenant e auditoria

- Capacidades separadas para leitura, classificação, criação, revisão, postagem, estorno, fechamento, reabertura, fiscal e consolidação.
- Criador não revisa o próprio lançamento material; reabertura e estorno exigem autorização segregada.
- Todos os serviços validam organização, empresa e empreendimento.
- Teste real impede leitura cruzada do START BUTANTÃ pela organização Atlas.
- Mutações de evento, postagem, estorno, fechamento e reabertura geram `AuditLog` com ator, origem e mudança.

### Central Executiva e interface

- Nova área `Contabilidade e Controladoria`, inteiramente em português, sem redesenhar a aplicação.
- Subáreas: Visão Geral, Plano de Contas, Razão, Balancete e DRE, Períodos e Fechamento, Estoque e Apropriação, Fiscal, Consolidação e Controladoria.
- Central Executiva recebeu card com receita contábil, custo, margem, estoque, tributos e divergências.
- Drill-down visual do razão preserva lançamento, conta e fonte operacional.

### REDE IA

Ferramentas somente leitura adicionadas:

- `getAccountingResult`
- `getTrialBalance`
- `getGeneralLedgerDrilldown`
- `getRealEstateInventoryPosition`
- `getUnitAccountingCost`
- `compareFinancialToAccounting`
- `getAccountingCloseStatus`
- `getUnclassifiedAccountingEvents`
- `getIntercompanyEliminations`
- `compareManagerialAndStatutoryResult`
- `getTaxesDue`
- `explainMarginBridge`

A IA recebe resultados calculados pelo motor; não calcula DRE, tributo, rateio ou consolidação por linguagem natural e não cria lançamentos.

## Banco e migration

Migration nova:

`20260822220000_phase_9g_accounting_tax_controllership`

Foram adicionados 15 enums e 34 models Prisma, com índices iniciados por organização/empresa nos caminhos críticos, chaves idempotentes, unicidades, paginação limitada nos read models e snapshots de fechamento/consolidação.

Nenhuma migration anterior foi editada e o banco não foi resetado.

## Seed START BUTANTÃ

O seed aditivo e idempotente demonstra:

- plano e contas v1;
- quatro políticas versionadas e quatro mapeamentos;
- período fechado com snapshot e período aberto;
- contrato, medição, documento e pagamento sob uma identidade econômica;
- lançamentos equilibrados;
- estoque de obra, apropriação por três unidades e prova-zero;
- VGV de R$ 83 milhões separado da venda, recebível, caixa e receita reconhecida;
- RET demonstrativo parametrizado e apuração pendente de obrigação aprovada;
- rateio administrativo;
- divergência AP × razão sem ajuste automático;
- eliminação intercompany de R$ 2 milhões e consolidado com prova-zero.

## Validação

Comandos obrigatórios:

```powershell
pnpm db:local:start
pnpm db:validate
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dev -- --port 3001
pnpm tsx scripts/smoke-authenticated.ts http://127.0.0.1:3001
```

## Limites e pendências reais

- A configuração demonstrativa fiscal e as políticas contábeis precisam ser substituídas por políticas aprovadas pelo contador responsável antes de uso produtivo.
- Materialized views, particionamento e benchmark de milhões de linhas dependem de volume real; os índices, snapshots e limites de leitura já preparam esse passo.
- Integrações reais com ERP/escritório, SEFAZ, prefeituras, NF-e e NFS-e pertencem à Fase 9H.
- SPED, ECD, ECF, transmissão fiscal, folha, eSocial, warehouse e REDE Data permanecem fora do escopo.
- A apuração fiscal demonstrativa não cria obrigação na 9B até aprovação; a ponte idempotente está modelada.

O arquivo `.env` usado localmente é ignorado pelo Git e não pertence ao freeze.
