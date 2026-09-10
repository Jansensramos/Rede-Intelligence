# Fase 9R — Contrato (Repasse, Chaves e Assistência Técnica)

**Status: APROVADO com decisões definitivas — implementação concluída nesta sessão.**
Ver `docs/PHASE_9R_AUDIT_RECORD.md` para o registro de auditoria, QA e riscos residuais.

Branch: `codex/fase-9r`. HEAD-base: `69d00f0e1207d0e3b2cab4118695d977bd50f29c`.
CI verde neste commit. Deployments Vercel falhos/pendentes — não autoriza declarar cloud
ou produção prontas; este contrato não depende de infraestrutura cloud para ser aprovado.

## Decisões definitivas do aprovador (substituem as seções correspondentes abaixo)

1. O domínio de repasse bancário usa o nome **`BankFinancingDisbursement`** (não
   `BankFinancingRelease`, nome provisório da proposta original).
2. `CondominiumSetup` mantido como proposto.
3. O gate jurídico consome `LegalLicense` (9D) como fonte oficial — implementado em
   `src/application/handover/delivery-gate-service.ts`.
4. A 9R armazena somente referência (`blockingLicenseIds`), resultado agregado
   (`APTO`/`PENDENTE`/`SEM_EVIDENCIA`) e snapshot auditável (gravado no `AuditLog` da
   transição `SALES_UNIT_DELIVERED` — o "termo de entrega") — nunca duplica checklist
   ou regra jurídica da 9D.
5. Portal do cliente final permanece fora do escopo; toda superfície entregue é
   autenticada e interna (`/comercial`, Server Actions com RBAC no servidor).

## Fontes usadas para recuperar o escopo (nenhum significado foi inventado)

- `work/master-report.txt` — Relatório Mestre 2026, seções 15, 27, 28, 45, 46, Apêndices
  A-D — única fonte que define o conteúdo funcional da 9R com detalhe (o repositório de
  código, por si só, só registra "9R aguarda contrato detalhado").
- `docs/REDE_CAMPAIGN_CHECKPOINTS.md` — tabela de sequência (linha 29: "9R, 9S — Próximas
  fases do roadmap aprovado — Aguardam contratos detalhados") e regras de avanço (QA,
  auditoria, migrations, backup, commit e CI por fase).
- `docs/PHASE_9Q_RELEASE_CONTRACT.md` — gates de release/piloto/produção transversais,
  que continuam se aplicando a qualquer código novo desta fase.
- `docs/ROADMAP.md` e `docs/PRD.md` — versão histórica/fundacional do produto (Fase 0-1);
  confirmam que "acompanhamento previsto × realizado" era explicitamente fora do escopo
  do MVP original e só amadurece nas fases 9-series.
- `README.md` — inventário do que já está implementado (para não duplicar).
- `prisma/schema.prisma` — modelos reais já existentes (`SalesUnitInspection`,
  `PostSaleRequest`/`PostSaleUpdate`, `ReceivableAccount`/`Installment`/`Payment`,
  `FinancialInstitution`, `Supplier`, `SignatureRequest`) usados para separar "o que a
  9R estende" de "o que a 9R cria".

## 1. Definição executiva da 9R

A 9R é a fase que fecha o ciclo **pós-contrato e pós-obra do lado do cliente**: o
dinheiro do financiamento do comprador é liberado pelo banco e conciliado
("Repasse"), a unidade é vistoriada e entregue com as pendências técnicas/jurídicas/
financeiras resolvidas e o condomínio implantado ("Chaves"), e os chamados de garantia
e assistência técnica pós-entrega são geridos até resolução ("Assistência"). É a ponte
entre "venda contratada" (9E/9K.4B) e "empreendimento encerrado" (9S).

Citação-fonte (`work/master-report.txt`, linha 627): *"A 9R fecha repasse bancário,
conciliação por cliente/unidade/contrato, entrega de chaves, implantação do condomínio e
assistência técnica."*

## 2. Problema de negócio resolvido

Hoje (9E/9K.4B), o REDE sabe que uma unidade foi vendida, tem contrato assinado e sabe
quais parcelas/recebíveis estão previstos — mas não sabe, de forma auditável e
determinística:

- se o financiamento do cliente (banco, FGTS, subsídio) já foi liberado e se o valor
  liberado bate com o valor esperado do contrato/recebível;
- se a unidade está apta para entrega (pendências técnicas de obra, documentação
  jurídica, quitação financeira) antes de qualquer vistoria ser aceita;
- o que acontece depois que as chaves são entregues — quem responde por um chamado de
  garantia, com que prazo (SLA), com que fornecedor, com que evidência e com que custo.

Sem isso, o "resultado realizado" que alimenta a 9S e o REDE Data fica incompleto: a
receita registrada permanece "recebível esperado", nunca vira "repasse bancário
conciliado e confirmado", e não existe histórico de pós-entrega para aprendizado do
próximo empreendimento.

## 3. Usuários e departamentos envolvidos

| Perfil | Uso principal |
|---|---|
| Financeiro/Tesouraria (9B) | Concilia o repasse bancário com a conta a receber e a transação bancária real |
| Comercial/Pós-venda (9E/9K.4B) | Acompanha a jornada até a entrega e trata chamados |
| Engenharia/Obra (9C/9M) | Fornece o gate técnico de pendências antes da vistoria |
| Jurídico (9D) | Fornece o gate jurídico (registro, documentação, condições precedentes) |
| Administração de condomínio (novo) | Implantação do condomínio e transferência de responsabilidades |
| Suporte/Assistência técnica | Trata chamados, aciona fornecedor responsável, mede SLA e reincidência |
| Gestão Executiva (9K.2) | Enxerga exceções de repasse atrasado, entrega pendente ou SLA de assistência estourado |
| Cliente final | Não acessa o sistema diretamente nesta fase (sem portal do cliente no escopo) |

## 4. Escopo funcional

### 4.1 Repasse

- Registrar o financiamento/recursos do cliente (banco financiador, valor de
  financiamento, FGTS/subsídio quando aplicável) vinculado a `Sale`/`SalesContract`.
- Registrar assinatura/registro da operação de crédito do comprador (marco, não o
  conteúdo do contrato bancário).
- Registrar a liberação do crédito pelo banco (data, valor, referência bancária).
- Conciliar o valor liberado com a unidade, o contrato e o(s)
  `ReceivableInstallment`(s) esperado(s) — divergência de valor gera exceção, nunca
  ajuste silencioso.
- Ao conciliar, gerar o `ReceivablePayment` oficial que quita o recebível — reaproveita
  o motor de recebíveis da 9E/9B, não cria uma segunda contabilidade de caixa.

### 4.2 Chaves

- Consolidar o gate de entrega: pendência técnica (obra/engenharia), pendência jurídica
  (documentação/registro) e pendência financeira (repasse conciliado e/ou saldo
  quitado) — todos os três precisam estar "sem pendência bloqueante" antes de uma
  vistoria poder ser aceita como apta à entrega.
- Estender a vistoria já existente (`SalesUnitInspection`) com o vínculo aos três
  gates acima; **não recriar** checklist/outcome, que já existem.
- Gerar o termo de entrega (documento formal, reaproveitando o armazenamento de
  documentos já usado por `ContractDocument`) quando o outcome da vistoria for
  `ACCEPTED` ou `ACCEPTED_WITH_PENDING` com plano de resolução.
- Implantar o condomínio: entidade nova para registrar constituição, síndico/
  administradora responsável e data de transferência de responsabilidade da
  incorporadora para o condomínio — fora do que qualquer modelo atual cobre.

### 4.3 Assistência técnica

- Estender `PostSaleRequest`/`PostSaleUpdate` (já existentes, categorias
  `GARANTIA`/`ASSISTENCIA`/`OCORRENCIA`/`OUTRO`) com: fornecedor responsável
  (reaproveita `Supplier`, já usado pela 9C), SLA explícito com vencimento e
  violação, reincidência (vínculo a chamado anterior da mesma unidade/causa), custo
  do reparo e evidência antes/depois (reaproveita o `StorageProvider` genérico, como a
  9K.4B já fez para documentos de contrato).
- Painel de reincidência e SLA para Gestão Executiva (9K.2), sem criar uma segunda
  fonte de verdade — deriva de `PostSaleRequest` como a Central de Ações (9K.3) já
  deriva de fatos operacionais.

## 5. Escopo técnico

- Novo bounded context `src/domain/handover/` (regras puras: elegibilidade de gate,
  conciliação de repasse, cálculo de SLA/reincidência) e `src/application/handover/`
  (casos de uso, tenancy, transações), seguindo exatamente o padrão já usado por
  `src/domain/sales/` + `src/application/sales/`.
- Extensões (não recriação) de `SalesUnitInspection` e `PostSaleRequest`/
  `PostSaleUpdate` via novos campos/relacionamentos opcionais — sem quebrar os call
  sites existentes de 9E/9K.4B.
- Reaproveitamento explícito: `Supplier` (9C), `FinancialInstitution`/`BankAccount`
  (9B), `ReceivableAccount`/`Installment`/`Payment` (9B/9E), `StorageProvider`
  genérico (9K.4B/Design), `ContractDocument`-style de armazenamento para o termo de
  entrega.
- Nenhum adaptador de banco real, gateway de pagamento real ou administradora de
  condomínio real nesta fase — mesma abstração "provider simulado primeiro, real
  quando contratado" já usada por assinatura digital e bureau de crédito (9H/9P.3).
- Alertas operacionais (`operational-alerts.ts`, 9Q.2B) ganham categorias novas
  (`REPASSE_DIVERGENTE`, `SLA_ASSISTENCIA_VENCIDO`) reaproveitando o mesmo payload
  allowlisted, dedup e circuit breaker — não um sistema de alerta paralelo.

## 6. Entidades, serviços e interfaces afetados

| Tipo | Item | Ação |
|---|---|---|
| Entidade nova | `BankFinancingRelease` (nome provisório) | repasse bancário: banco, valor, FGTS/subsídio, data de liberação, status de conciliação |
| Entidade nova | `CondominiumSetup` (nome provisório) | implantação do condomínio, responsável, data de transferência |
| Extensão | `SalesUnitInspection` | vínculo aos 3 gates (técnico/jurídico/financeiro) e ao termo de entrega |
| Extensão | `PostSaleRequest` | `supplierId`, `slaDueAt` (já existe — reforçar semântica de violação), `recurrenceOfRequestId`, `estimatedCost`/`actualCost`, evidências |
| Reaproveitado, sem alteração de schema | `ReceivableAccount`, `ReceivableInstallment`, `ReceivablePayment`, `Supplier`, `FinancialInstitution`, `SignatureRequest`, `ContractDocument` | consumidos, nunca duplicados |
| Serviço novo | `src/application/handover/repasse-service.ts` | registro e conciliação de repasse |
| Serviço novo | `src/application/handover/delivery-service.ts` | gates, vistoria estendida, termo de entrega, condomínio |
| Serviço estendido | `src/application/sales/*` (post-sale) | SLA/reincidência/fornecedor/evidência |
| Interface (UI) nova | Painel de Repasse, Painel de Entrega/Chaves, Painel de Assistência (dentro do contexto Comercial já existente em `/comercial`) | segue o padrão de grandes áreas da 9K |
| Ação executiva | Exceções de repasse divergente/SLA vencido na Central de Ações (9K.3) | reaproveita `ExecutiveException`, não cria segunda tabela |

## 7. Dependências das fases anteriores

- **9E** (obrigatória): `Sale`, `SaleParty`, `SalesContract`, `SalesPaymentPlan*`,
  `SalesUnitInspection`, `PostSaleRequest/Update` — 9R não existe sem essa base.
- **9B** (obrigatória): `ReceivableAccount/Installment/Payment`, `FinancialInstitution`,
  `BankAccount` — a conciliação do repasse é, na essência, uma baixa de recebível.
- **9C** (obrigatória): `Supplier` — fornecedor responsável pela assistência técnica.
- **9D** (obrigatória para o gate jurídico): condições precedentes, registro,
  documentação de entrega.
- **9K.3/9K.2** (obrigatória para exceções): `ExecutiveException`, Central de Ações.
- **9Q.2B** (obrigatória para observabilidade): `operational-alerts.ts`, logger,
  RBAC/tenant já endurecidos — 9R reaproveita, não reabre esse trabalho.
- **9H** (referência de padrão, não bloqueio): abstração "provider simulado → real"
  para qualquer futura integração bancária real de repasse.

## 8. Limites entre 9R, 9S e Fase 10

- **9R termina** quando o repasse está conciliado, a unidade entregue (termo de
  entrega emitido) e o condomínio implantado, e quando a assistência técnica tem
  SLA/reincidência/fornecedor rastreados — **não** inclui o fechamento contábil,
  societário ou o resultado final do empreendimento.
- **9S começa** no encerramento: medições finais, retenções, garantias contratuais
  remanescentes em nível de obra/contrato (não de unidade individual), governança de
  sócios/investidores, distribuição, resultado previsto × realizado e arquivo
  permanente. 9S **consome** o histórico de assistência técnica da 9R (chamados
  fechados, custo real) como insumo do resultado realizado, mas não reabre o modelo
  de dados da 9R.
- **Fase 10** (AI Gateway, Context Engine, Tool Layer, Agent Framework, Red Team 2.0,
  Decision Engine, Investment Committee 2.0, REDE Operator, Autopilot) é
  exclusivamente sobre a camada de IA/agentes sobre o REDE já existente — 9R não cria
  nem depende de nenhuma capacidade de Fase 10; um agente de Fase 10 poderá, no
  futuro, *ler* fatos de 9R (repasse atrasado, chamado reincidente) como qualquer
  outro domínio, sem acoplamento nesta fase.

## 9. Itens explicitamente fora do escopo desta fase

- Qualquer integração bancária real (Open Finance, API de banco, FGTS real) —
  permanece simulada/mock até contrato de piloto exigir o contrário, por decisão
  humana.
- Qualquer administradora de condomínio real integrada.
- Portal do cliente final (o comprador não acessa o sistema nesta fase).
- App móvel para fornecedor/técnico de assistência em campo.
- Cloud real, deploy, rollback, PITR, alertas reais, scanner de produção,
  integrações externas, piloto e produção — nada disso é tocado ou declarado pronto
  por esta fase (permanece a mesma barreira já em vigor desde 9Q.2B).
- 9S e Fase 10 — não iniciadas.
- Qualquer alteração em migrations existentes ou no banco arquivado.

## 10. Critérios objetivos de aceite (propostos)

- Repasse: valor liberado divergente do esperado nunca gera baixa automática —
  sempre produz exceção revisável por humano; teste de integração comprova o
  bloqueio.
- Chaves: uma vistoria não pode ser registrada como apta a gerar termo de entrega
  enquanto qualquer um dos 3 gates (técnico/jurídico/financeiro) estiver pendente —
  testado com os 3 casos isolados e o caso combinado.
- Assistência: SLA vencido produz exceção executiva (9K.3) determinística, sem LLM
  na regra; reincidência é detectada por vínculo explícito, nunca por heurística de
  texto livre.
- RBAC: todo novo caso de uso revalida organização/projeto no servidor antes de
  qualquer leitura/escrita; teste negativo com VIEWER/perfil sem capacidade
  correspondente.
- QA: TypeScript, ESLint, suíte de testes (unitária + integração contra Postgres
  real) e build aprovados; nenhuma migration nova sem justificativa e backup
  registrado (ver item 12).
- Documentação: `docs/PHASE_9R_CONTRACT.md` (este documento, após aprovado e
  eventualmente ajustado) passa a ser a fonte de verdade da fase, com um registro de
  fechamento no padrão de `PHASE_9P3A_REAUDIT_RECORD.md`/`PHASE_9P5_AUDIT_RECORD.md`.

## 11. Matriz de RBAC e isolamento por organização (proposta)

Segue o padrão de papéis já existente (`OWNER`, `ADMIN`, `ANALYST`, `REVIEWER`,
`VIEWER`) e o princípio já vigente no repositório: nenhuma capacidade nova é
concedida implicitamente por papel elevado sem checagem explícita no servidor;
toda query é filtrada por `organizationId` do contexto autenticado.

| Ação | OWNER/ADMIN | ANALYST (Financeiro/Comercial) | REVIEWER | VIEWER |
|---|---|---|---|---|
| Registrar financiamento/repasse | ✅ | ✅ (Financeiro) | ❌ | ❌ |
| Conciliar repasse com recebível | ✅ | ✅ (Financeiro) | ❌ | ❌ |
| Aprovar divergência de repasse | ✅ | ❌ (só revisa) | ✅ (aprova) | ❌ |
| Registrar vistoria/gate | ✅ | ✅ (Engenharia/Comercial conforme gate) | ❌ | ❌ |
| Emitir termo de entrega | ✅ | ✅ (Comercial) | ❌ | ❌ |
| Implantar condomínio | ✅ | ✅ (Comercial/Administrativo) | ❌ | ❌ |
| Abrir/atualizar chamado de assistência | ✅ | ✅ (Suporte/Comercial) | ❌ | leitura própria/organização, sem escrita |
| Fechar chamado / atribuir fornecedor | ✅ | ✅ (Suporte) | ❌ | ❌ |
| Ver painel de SLA/reincidência (Gestão Executiva) | ✅ | ✅ | ✅ | ✅ leitura, conforme escopo de portfólio já existente na 9K.2 |

Isolamento: todo modelo novo carrega `organizationId` (e `projectId` quando aplicável)
obrigatórios, com os mesmos testes negativos cross-tenant já usados em 9E/9K
(`database.integration.test.ts` com uma segunda organização).

## 12. Necessidade ou não de migration

**Sim, uma migration será necessária quando a implementação começar** — as duas
entidades novas (`BankFinancingRelease`, `CondominiumSetup`) e os campos de extensão
em `PostSaleRequest`/`SalesUnitInspection` não existem hoje no schema. **Nenhuma
migration é criada nesta etapa** (só contrato/planejamento), conforme instruído.

Quando a implementação for aprovada, antes de criar a migration:

1. Registrar backup local (mesmo padrão de `scripts/backup-local-database.mjs`,
   já validado e com a guarda de banco arquivado corrigida na reauditoria 9Q.2B).
2. Justificar cada tabela/coluna nova neste documento (ou num adendo), amarrada a um
   critério de aceite da seção 10.
3. Seguir a regra permanente já registrada no relatório mestre: proibido
   `migrate reset`, `DROP`, banco principal como shadow, ou edição de migration
   antiga sem autorização explícita.

## 13. Estratégia de testes e auditoria

- Unitário: regras puras de `src/domain/handover/` (elegibilidade de gate, cálculo
  de SLA/reincidência, conciliação de valores) — sem banco, sem rede, 100%
  determinístico.
- Integração: `*.database.integration.test.ts` contra PostgreSQL real (mesmo padrão
  de `contract-closing.database.integration.test.ts`), cobrindo RBAC negativo,
  isolamento cross-tenant e os 3 gates de entrega.
- Adversarial: reauditoria dedicada ao final da fase, no mesmo formato usado em
  9P.3A-9P.5 e 9Q.2B (`PHASE_9R_AUDIT_RECORD.md` ou equivalente) — acessos indevidos
  entre organizações, bypass de gate, divergência de repasse não tratada, SLA
  calculado incorretamente.
- QA de fechamento: `prisma validate/generate/status`, TypeScript, ESLint, suíte
  completa (unitária + integração), build, sem números fabricados — mesmo padrão
  desta e das últimas correções (números reais reportados, nunca aproximados).

## 14. Riscos e decisões humanas pendentes

- **Decisão de nomenclatura**: `BankFinancingRelease`/`CondominiumSetup` são nomes
  provisórios — preciso de confirmação/ajuste antes de qualquer migration.
- **Decisão de escopo do "gate jurídico"**: a 9D já modela condições precedentes e
  documentação, mas não está claro se 9R deve ler diretamente desses modelos ou se
  precisa de um checklist próprio de entrega — decisão de negócio pendente.
- **Decisão sobre app/portal externo**: se algum piloto exigir que o cliente final
  acompanhe repasse/assistência diretamente, isso expande o escopo (autenticação
  externa, portal) — explicitamente fora desta proposta até decisão humana.
- **Risco de acoplamento com 9P.3-9P.5**: se um piloto real precisar de integração
  bancária real de repasse antes da 9R começar a implementação, a ordem de execução
  pode mudar — decisão de priorização de negócio, não técnica.
- **Risco de escopo "condomínio"**: pode crescer para um módulo maior (gestão
  contínua de condomínio) se um piloto pedir — esta proposta limita a 9R a
  "implantação" (evento único de transferência), não gestão contínua.

## 15. Encerramento desta etapa

Este documento é uma **proposta**. Nenhuma implementação, migration, integração real,
commit, push ou início de 9S/Fase 10 ocorre até aprovação humana explícita deste
contrato (ou de uma versão revisada dele).

---

**Status (2026-09-10)**: aprovado pelo usuário com as 5 decisões registradas em
`docs/PHASE_9R_AUDIT_RECORD.md` (nomenclatura `BankFinancingDisbursement`,
`CondominiumSetup` mantido, gate jurídico via `LegalLicense`/9D só por referência,
portal do cliente fora do escopo) e implementado integralmente sem alterar o escopo
aqui descrito. Uma reauditoria adversarial posterior encontrou e corrigiu 5 achados
(1 Alto, 4 Médio) de implementação — nenhum exigiu mudança de escopo deste contrato;
detalhe completo em `docs/PHASE_9R_AUDIT_RECORD.md` §8.
