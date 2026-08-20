# Fase 9B — Financeiro, Tesouraria, Contas a Pagar/Receber e Fluxo Operacional

## Objetivo

A Fase 9B transforma a Base Operacional da Fase 9A em operação financeira real, preservando a cadeia:

```text
Base Aprovada → Orçamento Oficial → Cronograma Físico-Financeiro → Obrigação Financeira
  → Conta a Pagar / Conta a Receber → Programação → Pagamento / Recebimento
  → Transação Bancária → Conciliação → Realizado → Projeção Atualizada → Central Executiva
```

Princípio central: **um evento nasce uma única vez**. Uma conta a pagar sempre se origina de orçamento, cronograma, contrato ou lançamento manual explícito — nunca de um pagamento que já aconteceu sem rastro anterior. Um pagamento sempre reduz o saldo de uma parcela existente, nunca cria um registro econômico paralelo.

## Arquitetura e entidades

### Cadastros de suporte

- `FinancialInstitution`, `Supplier`, `Customer`, `BankAccount` — fundação para contas a pagar/receber e tesouraria.

### Contas estruturadas

- `FinancialObligation` — rastreabilidade opcional de origem (orçamento, contrato, medição, compra, venda, tributo, funding, jurídico, intercompany, integração, manual) antes de a conta nascer.
- `PayableAccount` / `PayableInstallment` — cada parcela é uma entidade própria, com saldo **derivado** (nunca armazenado desconectado): `saldo = valorAtual − pagamentos válidos`.
- `ReceivableAccount` / `ReceivableInstallment` — mesma lógica, do lado do direito de recebimento.
- `PayablePayment` / `ReceivablePayment` — evento de pagamento/recebimento, com `idempotencyKey` único (hash de parcela + data + valor + conta bancária) para impedir duplicidade.

Todas as contas suportam, quando aplicável: empresa/SPE (`companyId`), empreendimento (`projectId`), centro de custo, item econômico, item orçamentário e atividade do cronograma — cada um como relação real no banco (não apenas texto livre), o que permite o drill-down completo (empresa → projeto → centro de custo → conta → parcela → documento → origem) sem depender de convenções implícitas.

### Tesouraria e bancos

- `BankAccount.restriction` (`FREE`/`RESTRICTED`) separa caixa livre de caixa vinculado — nunca tratado como fungível.
- Saldo de conta bancária é **calculado**, não armazenado: `saldoInicial + créditos − débitos` das `BankTransaction` da conta.
- `BankTransaction.checksum` (único por conta) garante que importar o mesmo arquivo duas vezes não duplica movimentos.

### Conciliação

Motor determinístico em `src/domain/financial-ops/engine.ts` (`scoreReconciliationCandidate`, `rankReconciliationCandidates`):

| Critério | Peso |
|---|---|
| Valor exato (±R$0,01) | 50 |
| Valor próximo (±2%) | 30 |
| Data exata | 25 |
| Data próxima (±3 dias) | 12 |
| Documento/NF na descrição | 25 |
| Contraparte na descrição | 15 |

Confiança: `≥75` ALTA, `≥45` MÉDIA, `>0` BAIXA. Sugestões ficam em `ReconciliationMatch` com `status = SUGGESTED`; confirmar uma sugestão **cria o pagamento/recebimento naquele momento** (não antes) e marca a transação como `RECONCILED`, eliminando as demais sugestões concorrentes daquela transação. Nenhuma decisão de conciliação é tomada por LLM — apenas o motor determinístico.

### Transferências entre contas

`FinancialTransfer` registra as duas pernas vinculadas (`fromTransactionId`/`toTransactionId`, ambas `BankTransaction` já `RECONCILED` no momento da criação, pois a origem é interna e conhecida) — nunca como despesa + receita separadas.

### Intercompany

`IntercompanyTransaction` é o evento único. Ao ser criada, gera (quando os projetos são informados) uma `PayableAccount` na empresa de origem e uma `ReceivableAccount` na empresa de destino, ambas vinculadas por `intercompanyTransactionId`. A eliminação na consolidação usa `summarizeConsolidationElimination` para não inflar artificialmente receita/despesa econômica do grupo.

### Fluxo projetado, realizado e projeção atualizada

Hierarquia aplicada em `buildUpdatedProjection` (motor puro, testado):

```text
Total do período = Realizado + Compromisso concreto pendente + Previsão residual
Previsão residual = max(0, Previsão do cronograma − Total comprometido no período)
```

Isso implementa literalmente o caso do plano arquitetural: cronograma prevê R$100.000, conta concreta vinculada de R$97.500 → total apresentado R$100.000 (nunca R$197.500). A previsão vem das alocações do `OperationalSchedule` aprovado (Fase 9A); o compromisso vem das `PayableInstallment` vinculadas a `scheduleActivityId`; o realizado vem dos pagamentos já registrados contra essas parcelas.

### Régua de vencimentos e necessidade de capital

`buildDueHorizons` consolida valores vencidos e horizontes cumulativos (D+3, D+7, D+14, D+21 para a régua; D+7/D+30/D+90 para indicadores executivos). `projectCashBalances` + `capitalNeedIndicators` projetam o saldo de caixa livre período a período e apontam o menor saldo e a necessidade de capital, se houver.

### Correção contratual

`applyInstallmentCorrection` aplica índice, juros e multa sobre o valor corrigido anterior, com desconto, e nunca produz resultado negativo. Cada aplicação cria um `InstallmentAdjustment` imutável (memória de cálculo: valor anterior, índice, período, juros, multa, desconto, resultado, quem aplicou, quando) — o valor da parcela nunca é sobrescrito sem histórico.

### BankingAdapter (contrato futuro)

`src/domain/financial-ops/banking-adapter.ts` define a interface `BankingAdapter` (consultar saldo, sincronizar transações, identificar conta pelo ID do provedor, tratar webhook) que qualquer integração bancária real (Open Finance, API do banco, CNAB) implementará no futuro, sem exigir redesenho de `PayableAccount`/`ReceivableAccount`/`BankTransaction`. `ManualBankingAdapter` (`src/application/financial-ops/manual-banking-adapter.ts`) é a única implementação desta fase: calcula saldo a partir das transações já importadas e não sincroniza automaticamente (não há provedor conectado) — prova que o contrato é utilizável hoje.

### Importação de extrato CSV

`parseBankStatementCsv` (`src/domain/financial-ops/csv-import.ts`) é um parser puro e testado: valida cada linha independentemente (data, valor, tipo, descrição), aceita separador `,` ou `;` e formato de valor brasileiro (`1.234,56`) ou internacional, e retorna um relatório de linhas aceitas/rejeitadas (com motivo) sem interromper o arquivo inteiro por uma linha ruim. `importBankStatementCsv` (serviço) reaproveita o mesmo caminho idempotente de `importBankTransactions` — checksum por conta bancária garante que reimportar o mesmo arquivo não duplica.

### Fechamento mensal

`FinancialPeriodClosure` é por `companyId` + mês. Fechar registra pendências reais (transações não conciliadas, parcelas aguardando aprovação) sem bloquear o fechamento por elas — apenas as preserva em `pendingIssues` para auditoria. Reabertura exige usuário, motivo e timestamp, e nunca apaga o fechamento anterior.

## Máquina de estados

Implementada em `src/domain/financial-ops/engine.ts` (`assertPayableTransition`, `assertReceivableTransition`) e aplicada em toda mutação de status no serviço — transições fora da tabela lançam erro explícito em português.

- **Conta a Pagar:** `PREVISTA → PROGRAMADA → AGUARDANDO_APROVACAO → APROVADA → PARCIALMENTE_PAGA → PAGA`, com `CANCELADA` disponível a qualquer momento não terminal (exige motivo).
- **Conta a Receber:** `PREVISTA → EMITIDA → PARCIALMENTE_RECEBIDA → RECEBIDA`, com `RENEGOCIADA` e `CANCELADA` como estados terminais alternativos.
- O próximo status após um pagamento/recebimento é **derivado do saldo remanescente** (`nextPayableStatusAfterPayment`/`nextReceivableStatusAfterPayment`), nunca definido manualmente pelo chamador.
- "Vencida" não é um status armazenado: é calculado (`isInstallmentOverdue`) a partir de saldo > 0, vencimento passado e status não terminal — evita um campo desatualizado.

## Auditoria e segurança

- Toda mutação financeira grava `AuditLog` (ação, entidade, usuário, organização, antes/depois quando aplicável).
- Nenhum `DELETE` em entidade financeira consolidada — apenas cancelamento controlado (com motivo) ou reabertura de período auditada.
- Nenhuma credencial bancária é armazenada; `BankAccount` guarda apenas dados operacionais (agência, conta, titular, saldo de abertura).
- Isolamento multi-tenant: toda leitura/escrita filtra por `organizationId`; leitura cross-organização é testada explicitamente (ver Testes).

### Papéis e permissões

Reutiliza o RBAC existente (`OWNER`, `ADMIN`, `ANALYST`, `REVIEWER`, `VIEWER`) sem criar sistema paralelo:

- Criar/editar contas, registrar pagamento/recebimento, importar extrato/CSV, criar transferência/intercompany: `OWNER`, `ADMIN`, `ANALYST`.
- Aprovar parcela (`APROVADA`), aprovar intercompany, **confirmar/rejeitar conciliação**, fechar/reabrir período: `OWNER`, `ADMIN` apenas.
- `REVIEWER`/`VIEWER` não conseguem executar nenhuma mutação financeira (só leitura via REDE IA/dashboard).

Quem cadastra (`ANALYST`) não ganha automaticamente poder de aprovar, confirmar conciliação ou fechar período — essas quatro ações exigem `ADMIN`/`OWNER`. Isolamento multi-tenant é obrigatório em toda função (testado).

**Limitação real:** o plano arquitetural original descreve papéis dedicados (Tesouraria, Contas a Pagar, Contas a Receber, Controladoria). O RBAC atual do REDE tem apenas 5 papéis, sem esse recorte funcional — a segregação por *função de negócio* (cadastro vs. tesouraria vs. controladoria como pessoas fisicamente distintas) não é imposta pelo sistema, mas a segregação por *nível de risco* (operação comum vs. operação sensível) é, com as quatro ações acima isoladas em `ADMIN`/`OWNER`.

## REDE IA

Novas ferramentas de leitura estruturada (nunca recalculam matemática financeira no LLM):

- `getCashPosition` — caixa total, livre, restrito, por conta.
- `getPayablesDue` / `getReceivablesDue` — em aberto, vencidas, por horizonte.
- `getUpdatedCashProjection` — realizado × compromisso × previsão residual.
- `getReconciliationStatus` — pendências de conciliação e intercompany.

## Interface (aba Financeiro)

`src/components/financial-view.tsx`, com operação real sobre os server actions/serviço — não é somente leitura:

- **Tesouraria & Bancos:** lista contas com saldo calculado; formulário para cadastrar conta bancária.
- **Contas a Pagar:** formulário de criação (fornecedor opcional, competência, valor total dividido em N parcelas mensais iguais); ações por parcela conforme o status (`Programar` → `Aprovar` → `Pagar`, com conta bancária e data).
- **Contas a Receber:** mesmo padrão (`Emitir` → `Registrar recebimento`).
- **Conciliação:** importação de extrato CSV colado diretamente na tela; lista de transações sem conciliação; `Sugerir candidatos` gera as sugestões do motor; `Confirmar`/`Rejeitar` por sugestão (exige `ADMIN`/`OWNER`).
- **Intercompany:** formulário de registro (empresa origem/destino, natureza, valor, data) e `Aprovar` nas pendentes.
- **Projeção Atualizada:** gráfico e tabela realizado/compromisso/residual, inalterado desde o primeiro relatório.

## Banco de dados

Migration nova: `prisma/migrations/20260820180000_phase_9b_financial_foundation/`. Não altera a migration da Fase 9A. Adiciona 24 enums e 19 modelos: `FinancialInstitution`, `Supplier`, `Customer`, `BankAccount`, `FinancialObligation`, `PayableAccount`, `PayableInstallment`, `PayablePayment`, `ReceivableAccount`, `ReceivableInstallment`, `ReceivablePayment`, `BankTransaction`, `ReconciliationMatch`, `FinancialTransfer`, `IntercompanyTransaction`, `FinancialIndex`, `CorrectionRule`, `InstallmentAdjustment`, `FinancialPeriodClosure`.

**Nota sobre geração da migration:** o ambiente de execução não permitiu subir um PostgreSQL local (o binário do Postgres recusa rodar como usuário Administrador do Windows, restrição de segurança do próprio Postgres, não contornável sem criar um usuário restrito). A migration foi gerada via `prisma migrate diff --from-schema-datamodel --to-schema-datamodel --script` (diff puro entre os dois estados do `schema.prisma`, sem necessidade de conexão com banco) — o mesmo mecanismo interno que `prisma migrate dev` usa para calcular o SQL, mas sem a etapa de aplicar contra um shadow database para validação ao vivo. `prisma validate`, `prisma generate` e todos os testes que não dependem de banco passaram. **A migration deve ser validada com `pnpm db:migrate` contra um Postgres real antes do merge**, como primeira ação da próxima sessão de trabalho.

## Seed (START BUTANTÃ)

Aditivo e idempotente, sem resetar banco. Adiciona: uma empresa Holding (para demonstrar intercompany), duas contas bancárias da SPE (operacional livre e funding restrita), um fornecedor e um cliente, uma conta a pagar com duas parcelas (uma aprovada e paga via conciliação bancária simulada, outra programada), uma conta a receber com duas parcelas (uma recebida, outra emitida), uma transferência entre contas e um aporte intercompany aprovado da Holding para a SPE.

## Testes

- **Unitários (motor puro, `src/domain/financial-ops/engine.test.ts`):** 16 testes cobrindo saldo de parcela, vencimento, transições de estado, correção contratual, régua de vencimentos, scoring de conciliação, não duplicidade previsão×compromisso, hierarquia realizado>compromisso>residual, posição de caixa, necessidade de capital, reciprocidade intercompany e prova-zero — incluindo um bloco dedicado replicando literalmente os três cenários críticos de validação final (A: R$100.000 previsto × R$97.500 comprometido → R$100.000, nunca R$197.500; B: conta e pagamento de R$100.000 → realizado R$100.000, nunca R$200.000; C: aporte intercompany de R$2.000.000 → eliminação de consolidação de R$2.000.000, nunca R$4.000.000).
- **Unitários (importação CSV, `src/domain/financial-ops/csv-import.test.ts`):** 4 testes cobrindo linhas válidas, rejeição linha a linha sem interromper o arquivo, colunas obrigatórias ausentes e formato de valor brasileiro.
- **Integração (`src/application/financial-ops/database.integration.test.ts`, 8 testes):** projeção sem dupla contagem, bloqueio de transição arbitrária, idempotência de pagamento, idempotência de importação bancária + conciliação end-to-end, isolamento multi-organização, e os Cenários B e C de validação final executados contra o pipeline real (conta paga + transação + conciliação → realizado exato; intercompany aprovado → obrigação/direito com o mesmo valor nas duas empresas). Segue o padrão `describe.skipIf(!process.env.DATABASE_URL)` já usado nas fases anteriores — **não executados neste ambiente** pela limitação de credenciais descrita em "Validação pendente contra Postgres real"; devem rodar contra um banco real antes do merge.

## Qualidade (executado neste ambiente)

| Verificação | Resultado |
|---|---|
| `prisma validate` | ✅ verde |
| `prisma generate` | ✅ verde |
| `prisma migrate diff` (schema→schema) | ✅ gerado sem erros |
| `pnpm db:migrate` contra Postgres real | ⚠️ não executável neste ambiente — ver "Validação pendente contra Postgres real" |
| TypeScript (`tsc --noEmit`) | ✅ 0 erros |
| ESLint | ✅ 0 erros, 0 warnings |
| Testes unitários | ✅ 93 passando (20 no domínio financeiro: 16 motor + 4 CSV), 46 skip (por design) |
| Testes de integração (Fase 9B e anteriores) | ⚠️ não executáveis neste ambiente (sem Postgres real acessível) |
| `pnpm build` | ✅ verde, 0 erros de runtime na compilação |
| Smoke test HTTP/navegador autenticado | ⚠️ não executável — depende de banco real para login/seed |

## Performance

Índices adicionados seguem o padrão da Fase 9A: `(organizationId, status)`, `(projectId)`, `(dueDate, status)` nas parcelas, `(bankAccountId, occurredAt)` nas transações. Saldos (de conta bancária e de parcela) são sempre calculados via agregação, nunca lidos de um campo desatualizado — trade-off aceito nesta fase: sem `FinancialSnapshotMonthly`/paginação server-side, adequado ao volume demonstrativo do START BUTANTÃ, mas a evoluir antes de milhares de transações por mês.

## Validação pendente contra Postgres real

O ambiente de execução do Claude tem PostgreSQL 17 e 18 **instalados e rodando como serviços do Windows** (não é ausência de Postgres), mas ambos exigem senha (`scram-sha-256`) que o Claude não possui e não deve tentar descobrir ou redefinir — são instâncias do sistema, não algo criado para esta tarefa. Comandos exatos para validação humana, a partir de `C:\Users\Usuario\Documents\Codex\2026-08-17\rede-claude-9b`:

```powershell
# 1) Criar um banco dedicado no PostgreSQL 17 já em execução (ajuste a senha real do usuário postgres)
$env:PGPASSWORD = "SUA_SENHA_POSTGRES"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -p 5432 -c "CREATE DATABASE rede_fase9b;"

# 2) Apontar o projeto para esse banco
$env:DATABASE_URL = "postgresql://postgres:SUA_SENHA_POSTGRES@localhost:5432/rede_fase9b?schema=public"

# 3) Aplicar a migration nova desta fase (não altera nenhuma migration existente)
pnpm db:migrate

# 4) Popular o banco — seed aditivo e idempotente; rodar duas vezes deve ser seguro
pnpm db:seed
pnpm db:seed

# 5) Rodar toda a suíte, incluindo os testes de integração desta fase e das anteriores
pnpm test

# 6) Smoke test manual: subir a aplicação e validar autenticado
pnpm dev
# abrir http://localhost:3000, logar com admin@rede.local / Rede@2026
# navegar: Financeiro > Tesouraria & Bancos, Contas a Pagar, Contas a Receber, Conciliação, Intercompany, Projeção Atualizada
```

Somente após esse passo a migration e os testes de integração podem ser considerados efetivamente validados.

## Pendências reais

1. **Migration não aplicada/validada contra Postgres real** neste ambiente — ver seção acima; deve ser a primeira ação antes de qualquer merge.
2. **Testes de integração não executados** pelo mesmo motivo.
3. **Smoke test de UI/HTTP autenticado não realizado** — mesma causa raiz.
4. **Sem parser real de OFX** — CSV estruturado está implementado e testado (`csv-import.ts`); OFX (formato binário/SGML mais complexo) permanece contrato futuro, como o plano previu para integrações bancárias reais.
5. **Sem emissão real de boleto/Pix** — fora de escopo desta fase, por definição do plano.
6. **Segregação de funções por papel de negócio (não por risco) permanece parcial** — ver "Papéis e permissões"; o RBAC de 5 papéis não distingue Tesouraria de Contas a Pagar de Controladoria como pessoas fisicamente diferentes, mas isola por nível de risco (aprovação/conciliação/fechamento exigem `ADMIN`/`OWNER`).
7. **UI sem paginação server-side** — adequada ao volume demonstrativo; listas (transações, parcelas) carregam até 50 itens por consulta nesta fase.
8. **Formulários de conta a pagar/receber criam parcelas apenas em valores iguais** (N parcelas de valor total/N) — parcelas com valores desiguais continuam suportadas pela camada de serviço (`createPayableAccount`/`createReceivableAccount` aceitam qualquer lista de `{dueDate, amount}`), só não têm campo dedicado na interface para essa variação.

## Próxima sprint recomendada (não implementada)

Sprint 9B.2 sugerida: paginação server-side nas tabelas de transações/parcelas, edição de parcelas com valores desiguais na UI, e então avançar para importação real de OFX e um segundo `BankingAdapter` (Open Finance) implementando o contrato já definido.
