# REDE Intelligence — Plano Técnico da Fase 9C

## Compras, contratos, medições e controle de compromissos

> Documento de arquitetura. Nenhuma entidade, enum ou nome proposto aqui é contrato definitivo antes do *Contract Freeze* da Fase 9B.

## Decisões fundamentais

1. `EconomicItem` continua sendo a identidade econômica canônica.
2. Orçamento, contratação, medição, obrigação, pagamento e realizado são estados diferentes; nenhum substitui o outro.
3. A Fase 9C é dona do processo de suprimentos, do compromisso contratual e da certificação da medição. A Fase 9B é dona da obrigação financeira, do pagamento, da conciliação e do realizado financeiro.
4. A integração 9C → 9B ocorre por contrato de aplicação versionado e idempotente, nunca por escrita direta da 9C em tabelas financeiras.
5. Registros aprovados não são apagados ou sobrescritos. Mudanças usam versão, aditivo, cancelamento, substituição ou reversão.
6. Totais executivos são projeções/agregações por estágio, não lançamentos duplicados.
7. Valores monetários usam `Prisma.Decimal`/`Decimal.js`; nunca `number` para persistência ou matemática de domínio.

---

## A. Estado atual

### A.1 Fonte analisada

O inventário foi realizado sobre o código efetivo da Fase 9A, commit `db52655`, incorporado ao worktree da Fase 9B pelo merge `61ddfc1`. A branch de planejamento está em `planning/fase-9c-compras-contratos`.

Foi detectada uma divergência de Git: a tag `rede-phase-9a-complete-2026-08-20` ainda aponta para `3d1095`, commit da Fase 8, embora a Fase 9A esteja no commit `db52655`. Este documento considera o código real da Fase 9A como fonte da verdade; não move tags nem branches.

### A.2 Stack real

- Next.js 15 com App Router, Server Actions e rotas API;
- TypeScript e React 19;
- PostgreSQL e Prisma 6;
- Zod 4 nas fronteiras de entrada;
- `Prisma.Decimal` e `decimal.js` nos cálculos;
- Vitest com testes de domínio e integração sequenciais contra PostgreSQL;
- autenticação própria por sessão e `OrganizationMembership`;
- papéis atuais: `OWNER`, `ADMIN`, `ANALYST`, `REVIEWER`, `VIEWER`.

### A.3 Objetos existentes relevantes

| Objeto real | Situação e uso pela 9C |
|---|---|
| `Organization` | Tenant obrigatório. Toda raiz agregada da 9C deve carregar `organizationId`. |
| `EconomicGroup` | Consolidação corporativa futura. Não é substituto de tenant. |
| `Company` | Entidade legal/SPE contratante; possui moeda e timezone. |
| `Project` | Empreendimento operacional, opcionalmente ligado à `Company`. |
| `ProjectOperatingUnit` | Hierarquia de fase, torre, bloco, infraestrutura e áreas comuns. |
| `CostCenter` | Centro de custo hierárquico e futura conta gerencial. |
| `EconomicItem` | Identidade econômica única por projeto e código. Ponto central da 9C. |
| `OperationalBaselineLine` | Referência imutável do que foi aprovado. Não deve receber contratado/medido. |
| `Budget` | Orçamento versionado; Oficial é imutável e só muda por revisão. |
| `BudgetLineItem` | EAP e valor orçado; liga `EconomicItem`, centro de custo e unidade operacional. |
| `OperationalSchedule` | Cronograma versionado vinculado ao orçamento. |
| `ScheduleActivity` | Atividade com datas, custo planejado, responsável e item econômico. |
| `ScheduleAllocation` | Distribuições física e financeira separadas por período. |
| `OperationalForecast` | Estrutura inicial em JSON; não é ainda EAC financeiro completo. |
| `AuditLog` | Auditoria genérica com tenant, usuário, entidade, before/after e metadata. |
| `ProjectDocument` | Documento versionado, hoje vinculado a `InvestmentCase`; storage/checksum são reutilizáveis, mas o vínculo é estreito para suprimentos. |
| `InvestmentReviewRound`/`CommitteeDecision` | Aprovação especializada de investimento; não deve ser usada como aprovação genérica de compra. |
| `AIPendingAction` | Precedente de confirmação e idempotência, mas especializado em ações da IA. |
| `VEOpportunity` | Oportunidade estruturada de Engenharia de Valor, com impacto e confiança. |
| `DesignAlternative`/`DesignChange` | Proveniência de mudança de projeto. |
| `BimModel`/`BimElement` | Elementos BIM persistidos; úteis como evidência quantitativa, não como cadastro de compra. |
| `DesignAuditLog`/`InvestmentAuditLog` | Auditorias especializadas existentes. |

### A.4 Lacunas atuais

Não existem hoje, no schema real:

- fornecedor/contraparte única;
- necessidade ou requisição de compra;
- especificação técnica versionada de suprimentos;
- processo de cotação, convite, proposta ou mapa comparativo;
- política genérica de alçada/aprovação;
- pedido de compra ou contrato operacional;
- aditivo/supressão;
- compromisso contratual agregado;
- boletim ou linha de medição;
- retenção ou adiantamento contratual;
- outbox/inbox transacional;
- modelos financeiros da 9B implementados.

### A.5 Restrições que influenciam o desenho

- `responsibleId` em objetos da 9A é frequentemente escalar, sem FK para `User`.
- O RBAC atual é amplo e não representa segregação de funções por projeto/empresa.
- `ProjectDocument` exige `investmentCaseId`; suprimentos precisa de anexos mesmo quando não há Investment Case.
- `CostOrigin` já contém `RECEIVED_QUOTE` e `CONTRACTED`, mas isso não autoriza alterar linha de Orçamento Oficial. São proveniências, não estágios financeiros.
- A aplicação usa serviços diretamente sobre Prisma, transações locais e Server Actions; não há barramento de eventos.

---

## B. Dependências da Fase 9A

### B.1 Objetos que serão referenciados, nunca duplicados

- `organizationId`: isolamento do tenant;
- `companyId`: empresa/SPE contratante;
- `projectId`: empreendimento;
- `operatingUnitId`: fase/torre/bloco;
- `costCenterId`: classificação gerencial;
- `economicItemId`: identidade econômica;
- `budgetLineItemId`: verba e EAP de origem;
- `scheduleActivityId`: necessidade temporal e impacto no caminho crítico;
- `OperationalBaseline`: comparação executiva com a tese aprovada.

### B.2 Regras de consumo

1. A 9C só usa como referência operacional um orçamento `OFFICIAL` e um cronograma aprovado quando disponíveis.
2. Uma compra não altera o orçamento oficial. Desvio gera explicação, alerta ou revisão formal pelo serviço da 9A.
3. Uma necessidade pode apontar para vários itens de orçamento somente por uma tabela explícita de alocação; nunca por JSON opaco.
4. Um contrato pode consumir mais de um `EconomicItem`, mas cada item contratual deve declarar sua alocação.
5. A alocação contratual deve preservar moeda, quantidade, unidade e fonte.
6. `ScheduleActivity` informa quando contratar e executar; não representa compromisso ou pagamento.

### B.3 Contrato matemático com a 9A

Para um escopo aplicável:

```text
Orçamento oficial = Contratado líquido + Saldo a contratar
```

O lado “Contratado líquido” é calculado pela 9C a partir de contratos/pedidos aprovados e aditivos vigentes. Não é escrito em `BudgetLineItem`.

---

## C. Dependências da Fase 9B

A Fase 9B ainda não tem contrato implementado. Seu plano menciona conceitos equivalentes a obrigação, conta a pagar, pagamento, banco, conciliação e projeção atualizada. A 9C não deve assumir os nomes `Obligation`, `PayableAccount`, `PayablePayment` ou `Supplier` até o freeze.

### C.1 Contratos que a 9C precisa receber da 9B

#### Porta de obrigações financeiras

Uma interface de aplicação deve aceitar um comando conceitual com:

| Campo conceitual | Obrigatório | Finalidade |
|---|---:|---|
| `organizationId` | sim | tenant |
| `companyId` | sim | devedor/SPE |
| `projectId` | sim | empreendimento |
| `counterpartyId` | sim | mesmo fornecedor da 9C |
| `economicItemId` | sim | identidade econômica |
| `costCenterId` | quando aplicável | classificação gerencial |
| `sourceType` | sim | contrato, pedido, medição, parcela ou reversão |
| `sourceId` | sim | ID persistido na 9C |
| `sourceVersion` | sim | versão aprovada da origem |
| `eventId` | sim | identidade do evento de integração |
| `idempotencyKey` | sim | prevenção de duplicidade |
| `eventType` | sim | criar, ajustar, cancelar ou reverter |
| `competenceDate` | sim | competência |
| `dueDate` | sim | vencimento |
| `grossAmount` | sim | valor bruto |
| `withholdings` | sim | retenções/impostos classificados |
| `discounts` | sim | descontos aprovados |
| `advancesApplied` | sim | compensação de adiantamentos |
| `netAmount` | sim | obrigação líquida |
| `currency` | sim | moeda |
| `documentRefs` | não | nota, boletim e evidências |
| `metadata` | não | extensão versionada, nunca fonte primária de total |

Resposta mínima: identificador financeiro criado/reutilizado, status, `idempotencyKey`, versão aceita e timestamp.

#### Porta de consulta financeira

A 9C precisa consultar, sem acessar tabelas internas:

- total pago por `sourceId`, contrato e item econômico;
- saldo aberto e obrigações canceladas/revertidas;
- status da obrigação gerada por medição/parcela;
- datas e identificadores de pagamentos confirmados;
- confirmação de conciliação;
- contribuição da origem para a Projeção Atualizada.

#### Porta de contraparte

O cadastro único de fornecedor deve ser aceito pela 9B como contraparte. A 9B deve guardar `counterpartyId` da 9C ou consumir um cadastro compartilhado; não pode criar fornecedor financeiro desconectado.

#### Porta de índices

A 9C precisa consultar índices/regras de reajuste por interface: identificador do índice, período, valor, fonte, confiança e versão. A matemática/curadoria do índice pertence à 9B.

#### Porta de aprovação compartilhada

Se a 9B criar a Central de Aprovações, a 9C deve consumir o mesmo contrato para requisição, contratação, aditivo, exceção e medição. Caso a 9B não a entregue, a 9C.1 deve criar um núcleo compartilhado antes de qualquer aprovação financeira, com aceite explícito de ambos os agentes.

---

## D. Contract Freeze mínimo da 9B

A implementação que produz obrigação financeira na 9C só pode começar quando os itens abaixo estiverem congelados em código e testes:

1. **Ownership de contraparte:** modelo/serviço definitivo e unicidade por tenant/documento fiscal.
2. **Command port:** assinatura versionada para criar obrigação a partir de origem externa.
3. **Query port:** consulta de obrigação, saldo, pago e reversões por origem.
4. **Identidade da origem:** campos definitivos equivalentes a `sourceType`, `sourceId`, `sourceVersion` e `eventId`.
5. **Idempotência:** unique constraint e comportamento de replay documentados.
6. **Cancelamento/reversão:** comando oficial que nunca apaga obrigação ou pagamento.
7. **Valores:** convenção de bruto, retenções, desconto, adiantamento, líquido e moeda.
8. **Datas:** competência, emissão, vencimento, pagamento e timezone.
9. **Status:** máquina de estados e quais estados contam como previsto, comprometido, pago e realizado.
10. **Documentos:** contrato de referência para documento fiscal/comprovante.
11. **Aprovação:** quem pode criar/aprovar obrigação e como a origem aprovada é verificada.
12. **Projeção Atualizada:** regra de substituição entre planejado genérico, compromisso, obrigação e realizado.
13. **Transação/outbox:** decisão entre chamada transacional local ou outbox; falhas e retry definidos.
14. **Testes de contrato:** criação única, replay, ajuste, cancelamento, reversão e tenant isolation verdes.

### Gate de liberação

A 9C.4 pode modelar medições antes do freeze, mas não deve aprovar uma medição com efeito financeiro em produção. A 9C.5 permanece bloqueada até todos os 14 itens estarem aceitos.

---

## E. Arquitetura de compras

### E.1 Agregados recomendados

Os nomes são provisórios:

1. **Cadastro de Contrapartes** — fornecedor e qualificação.
2. **Necessidade** — demanda econômica/técnica.
3. **Requisição** — autorização operacional para iniciar compra.
4. **Processo de Cotação** — escopo congelado, convites e propostas.
5. **Decisão de Compra** — mapa, negociação, comparabilidade e aprovação.
6. **Instrumento Contratual** — pedido ou contrato, itens e agenda.
7. **Medição** — certificação física/financeira de execução.
8. **Integração Financeira** — outbox/inbox e vínculo com objetos da 9B.

### E.2 Fronteiras

- Necessidade não é requisição.
- Requisição não é cotação.
- Cotação não é proposta.
- Proposta escolhida não é contrato até aprovação e formalização.
- Contrato aprovado é comprometido, não medido.
- Medição aprovada é direito de faturar/obrigação potencial, não pagamento.
- Pagamento e realizado pertencem à 9B.

### E.3 Estrutura de código futura

```text
src/domain/procurement/
src/domain/contracts/
src/domain/measurements/
src/application/procurement/
src/application/contracts/
src/application/measurements/
src/application/financial-integration/
src/app/actions/procurement.ts
src/app/actions/contracts.ts
src/app/actions/measurements.ts
```

Cada domínio deve possuir schemas Zod, engine puro, serviço tenant-aware e testes próprios.

---

## F. Fornecedores

### F.1 Ownership

Recomendação: cadastro de contraparte compartilhado no núcleo corporativo, com ownership funcional inicial da 9C. A 9B referencia seu ID. Não deve existir “Supplier Financeiro” separado.

### F.2 Estrutura conceitual

- organização;
- tipo pessoa física/jurídica;
- razão social/nome;
- nome fantasia;
- CNPJ/CPF normalizado;
- status operacional;
- contatos versionáveis;
- categorias e regiões;
- observações e tags;
- identificadores externos por integração;
- dados bancários somente por contrato seguro da 9B, nunca JSON aberto na 9C.

Unicidade: documento fiscal normalizado por organização. Cadastros sem documento exigem chave provisória e workflow de saneamento.

### F.3 Qualificação

Separar fornecedor de qualificação. Uma qualificação possui categoria, validade, status, evidências, revisor e data. Certidão vencida não apaga o fornecedor; altera elegibilidade para determinado ato.

### F.4 Histórico e avaliação

Indicadores devem ser derivados de fatos: prazo, qualidade registrada, aditivos, retrabalho, ocorrências e concentração. Não criar score opaco. Avaliação manual exige escala, critério, evidência e autor.

---

## G. Necessidades

### G.1 Responsabilidade

Representa “algo será necessário”, ainda sem autorização para comprar.

### G.2 Origens

- `BudgetLineItem`/`EconomicItem`;
- `ScheduleActivity`;
- solicitação manual;
- Engenharia de Valor;
- revisão de projeto/Design;
- elemento ou quantitativo BIM;
- integração externa futura.

### G.3 Campos mínimos

Tenant, SPE, projeto, unidade operacional, centro de custo, item econômico, verba, atividade, descrição, unidade, quantidade, data necessária, prioridade, solicitante, responsável técnico, origem tipada, referência de origem, confiança e status.

### G.4 Máquina de estados

```text
IDENTIFICADA → VALIDADA → CONVERTIDA_EM_REQUISICAO
      └──────→ DESCARTADA
```

Necessidade alterada após conversão gera revisão ou nova necessidade; não reescreve o escopo já cotado.

### G.5 Plano de suprimentos

Data limite recomendada:

```text
dataLimiteContratacao = dataNecessaria - leadTimeEsperado - folgaConfigurada
```

O lead time deve declarar origem: histórico, política, fornecedor, usuário ou estimativa.

---

## H. Requisições

### H.1 Responsabilidade

Agrupa uma ou mais necessidades compatíveis e solicita autorização para cotação. Linhas preservam vínculo com as necessidades; agrupamento não perde rastreabilidade.

### H.2 Máquina de estados proposta

```text
RASCUNHO
  → SOLICITADA
  → EM_APROVACAO
  → APROVADA_PARA_COTACAO
  → EM_COTACAO
  → ATENDIDA

EM_APROVACAO → DEVOLVIDA → RASCUNHO
qualquer estado não terminal → CANCELADA (com motivo)
```

“Contratada” não deve ser status da requisição antes de todas as linhas serem atendidas; usar cobertura por linha.

### H.3 Segregação

Registrar solicitante, responsável técnico, comprador e aprovador. A mesma pessoa pode acumular funções apenas quando a política permitir e a exceção for auditada.

---

## I. Cotações

### I.1 Escopo congelado

O processo referencia uma versão imutável de especificação. Mudança material de escopo cria nova versão e invalida comparações anteriores até reconfirmação.

### I.2 Entidades conceituais

- processo de cotação;
- versão da especificação;
- linha de cotação;
- convite de fornecedor;
- proposta;
- revisão da proposta;
- linha proposta;
- condição comercial;
- negociação registrada;
- documento original.

### I.3 Proposta estruturada

Persistir quantidade, unidade, preço unitário, impostos, frete, desconto, total, prazo, pagamento, validade, garantia, inclusões, exclusões e documento. O PDF é evidência; não é o único dado.

### I.4 Versionamento

Uma contraproposta cria revisão ligada à anterior. A versão usada na decisão deve permanecer imutável, com checksum do documento e dos dados estruturados.

---

## J. Mapa comparativo

### J.1 Comparabilidade

Cada linha proposta deve ser normalizada contra a linha de escopo por:

- unidade e conversão;
- quantidade;
- inclusões/exclusões;
- impostos;
- frete;
- instalação;
- prazo;
- garantia;
- pagamento;
- qualidade/especificação.

Resultado por proposta: `COMPARAVEL`, `COMPARAVEL_COM_AJUSTES` ou `NAO_COMPARAVEL`, acompanhado de motivos e ajustes explícitos.

### J.2 Regra de decisão

O mapa não seleciona automaticamente o menor preço. A decisão registra proposta escolhida, versão, justificativa, parecer técnico, exceções e aprovação.

### J.3 Visão

Colunas: referência orçamentária, referência de preço, propostas normalizadas, diferença, condição de pagamento, prazo, escopo, qualidade, risco e observações.

---

## K. Benchmark

Criar futuramente um registro de referência de preço com item/especificação, unidade, região, data-base, moeda, fonte, confiança e validade.

Fontes obrigatoriamente separadas:

- fato interno contratado;
- cotação atual;
- histórico REDE;
- referência externa;
- estimativa manual;
- estimativa assistida por IA.

Benchmark nunca é contrato e não entra em realizado.

---

## L. Saving

### L.1 Categorias

- saving negociado;
- saving técnico;
- mudança de escopo;
- transferência de custo;
- economia validada;
- diferença não classificada.

### L.2 Base de comparação

Todo saving aponta para uma referência congelada: verba orçamentária, preço de referência ou proposta inicial comparável. Fórmula nominal:

```text
saving = referência comparável - valor contratado comparável
```

### L.3 Economia validada

Requer comparabilidade de escopo, validação técnica, ausência de impacto negativo material em qualidade/segurança/prazo/desempenho, aprovador e evidências. Alteração de quantidade não vira saving automaticamente.

`ValidatedSaving` ou nome definitivo deve ser append-only após aprovação. Ele poderá alimentar bonificação futura, mas não folha/RH nesta fase.

---

## M. Aprovações

### M.1 Estado atual

Não existe motor genérico de aprovação. Comitê, aprovação de orçamento e `AIPendingAction` são especializados.

### M.2 Recomendação

Criar uma Central de Aprovações compartilhada com políticas versionadas por tenant, empresa, projeto, tipo de ato, categoria, valor e criticidade.

Conceitos mínimos:

- política e versão;
- solicitação de aprovação;
- etapas ordenadas/paralelas;
- aprovadores por usuário/papel/grupo;
- decisão, justificativa e timestamp;
- delegação e impedimento;
- exceção/override;
- snapshot do objeto aprovado.

Não ampliar `MembershipRole` para cada cargo. Papéis funcionais devem ser escopados por organização/empresa/projeto e coexistir com o papel de acesso atual.

### M.3 Atos cobertos

Requisição, contratação, aditivo, supressão, exceção, fornecedor bloqueado, medição e cancelamento. Aprovação financeira final permanece conforme contrato da 9B.

---

## N. Pedidos

Pedido de Compra atende aquisição simples, entrega definida e menor complexidade contratual. Deve possuir cabeçalho, fornecedor, itens, entrega, condições, aprovações e valor comprometido.

Pedido e contrato implementam o mesmo conceito de **instrumento comprometedor**, mas não devem ser uma tabela única com dezenas de campos nulos. Uma projeção comum fornece itens, valores, agenda e status para os agregadores.

Conversão de pedido em contrato mantém vínculo; não duplica o comprometido.

---

## O. Contratos

### O.1 Tipos

Fornecimento, empreitada, prestação de serviço, consultoria, projeto, locação, aquisição e outro configurável.

### O.2 Cabeçalho estruturado

Tenant, contratante/SPE, fornecedor, projeto, instrumento de compra, escopo, moeda, datas, vigência, responsável, modelo de faturamento, reajuste, retenção, garantia, status e documentos.

### O.3 Itens e alocação

Cada item contratual declara quantidade, unidade, preço, valor original e alocações para `EconomicItem`, `BudgetLineItem`, `CostCenter`, `ProjectOperatingUnit` e `ScheduleActivity`. Soma das alocações deve fechar 100% e valor exato.

### O.4 Máquina de estados

```text
RASCUNHO → EM_REVISAO → EM_APROVACAO → APROVADO → ATIVO
ATIVO → SUSPENSO → ATIVO
ATIVO → ENCERRADO
qualquer estado permitido → CANCELADO/RESCINDIDO com evento formal
```

Somente `APROVADO`/`ATIVO` compõe comprometido conforme data de eficácia.

### O.5 Modelos de faturamento

Medição, parcela fixa, marco, mensalidade, entrega, adiantamento e personalizado. A agenda contratual não é conta a pagar; ela melhora a previsão e pode originar eventos financeiros quando o gate definido for atingido.

---

## P. Aditivos

Aditivo é entidade própria, imutável após aprovação, com tipo, valor, quantidade, prazo, escopo, reajuste, motivo, causa do desvio, aprovadores, documentos e impacto.

Tipos mínimos: acréscimo, supressão, prazo, escopo, reajuste e outro.

```text
Valor atual = Valor original + acréscimos + reajustes - supressões
```

O histórico deve explicar cada degrau. Alterar `originalValue` é proibido. Aditivo cancelado utiliza reversão/contraditivo, não exclusão.

---

## Q. Medições

### Q.1 Agregado

Boletim de medição possui contrato, período, número, versão, responsável, linhas, bruto, retenções, descontos, adiantamentos compensados, líquido, status e aprovação.

### Q.2 Linhas

Relacionar item contratual, item econômico, verba, atividade, unidade, quantidade contratada, anterior, período, acumulada, saldo, preço unitário, valor físico e valor financeiro.

### Q.3 Estados

```text
RASCUNHO → SUBMETIDA → EM_ANALISE_TECNICA → APROVADA_TECNICAMENTE
         → EM_APROVACAO → APROVADA → ENVIADA_AO_FINANCEIRO
SUBMETIDA/ANALISE → DEVOLVIDA → nova versão
APROVADA → ANULADA apenas por reversão formal
```

### Q.4 Provas-zero

- acumulado físico não excede quantidade contratada disponível;
- medido acumulado não excede valor contratual disponível;
- soma das linhas = bruto;
- bruto - retenções - descontos - adiantamentos = líquido, respeitando impostos conforme contrato 9B;
- tolerância extraordinária exige política e aprovação;
- medição não pode referenciar item de outro contrato/tenant.

---

## R. Retenções

Retenção é registro classificado, não simples campo total. Possui tipo, regra, percentual/valor, base, data de liberação esperada, saldo e destino financeiro.

Separar:

- retenção contratual;
- caução/garantia;
- imposto retido;
- desconto operacional;
- glosa.

Retenção liberável gera evento futuro próprio para a 9B; não desaparece na medição original.

---

## S. Adiantamentos

Adiantamento possui instrumento, valor original, data, saldo e plano de amortização. Cada compensação em medição referencia o adiantamento e reduz seu saldo.

Provas-zero:

- amortizado acumulado ≤ adiantamento liberado;
- saldo = liberado - amortizações - reversões;
- adiantamento pago vem da 9B e não pode ser inferido apenas do contrato.

---

## T. Documentos fiscais

A 9C associa medição aprovada ao documento fiscal recebido, mas validação fiscal, obrigação e pagamento pertencem à 9B.

O documento deve declarar emitente/fornecedor, contratante, número/série, emissão, competência, bruto, tributos, líquido, chave e arquivo original. O vínculo medição↔documento pode ser 1:N ou N:1 conforme regras congeladas pela 9B.

`ProjectDocument` e o storage privado existente devem ser reutilizados, mas o modelo atual exige `InvestmentCase`. Antes da implementação, decidir entre:

1. tornar o documento corporativo e anexá-lo por links tipados; ou
2. criar um `DocumentLink` genérico apontando para o arquivo canônico.

Não duplicar bytes para proposta, contrato e medição.

---

## U. Integração financeira

### U.1 Padrão recomendado

Porta de aplicação + outbox transacional.

1. A aprovação na 9C persiste estado e evento na mesma transação.
2. Worker lê outbox e chama o command port da 9B.
3. A 9B mantém inbox/idempotência e devolve ID financeiro.
4. A 9C registra receipt/acknowledgement.
5. Retry usa o mesmo `eventId` e `idempotencyKey`.

Uma chamada direta síncrona é aceitável apenas se ambos os domínios compartilharem a mesma transação PostgreSQL e houver contrato explícito; ainda assim, outbox é preferível para evolução e integrações externas.

### U.2 Eventos conceituais

- compromisso contratual aprovado/ajustado/cancelado;
- medição aprovada/revertida;
- parcela contratual habilitada/cancelada;
- retenção liberada/revertida;
- adiantamento solicitado/amortizado;
- fornecedor/contraparte atualizado.

Os nomes finais dependem da 9B.

---

## V. Idempotência

Chave recomendada:

```text
organizationId + sourceType + sourceId + sourceVersion + eventType
```

Gerar hash canônico e unique constraint na inbox da 9B e outbox da 9C. O payload recebe `schemaVersion` e checksum.

Replay idêntico retorna o mesmo resultado. Replay com mesma chave e payload diferente falha como conflito. Ajuste usa novo evento/versionamento; nunca reaproveita a chave original.

---

## W. Orçamento → Contratado → Medido → Pago

### W.1 Ledger de estágios

Não criar um “saldo” mutável como fonte única. Calcular por fatos vigentes:

| Estágio | Fonte do domínio | Regra |
|---|---|---|
| Base | `OperationalBaselineLine` | imutável |
| Orçado | folhas do `BudgetLineItem` Oficial | imutável por versão |
| Contratado | itens de pedidos/contratos aprovados + aditivos - supressões | 9C |
| Medido | medições aprovadas líquidas de reversões | 9C |
| Faturado/obrigado | contrato oficial da 9B | 9B |
| Pago | pagamentos confirmados/revertidos | 9B |
| Realizado | regra financeira/conciliada da 9B | 9B |
| Projeção Atualizada | composição da 9B com dados 9A/9C | 9B |

### W.2 Evitar dupla contagem

- contrato substitui a parcela correspondente do planejado na projeção, não soma por cima dela;
- obrigação originada de medição não soma novamente o medido em visão de estágio;
- pagamento reduz obrigação aberta, mas não reduz medido;
- realizado é apresentado como estágio, não acumulado sobre pago;
- conversão pedido→contrato marca predecessor como substituído para comprometido;
- agregadores usam uma dimensão `stage`, não uma soma vertical indiscriminada.

### W.3 Indicadores

```text
saldoAContratar = orçamentoAplicável - contratadoLíquido
saldoContratual = valorContratualAtual - medidoAcumulado
aPagarDoMedido = obrigaçãoLíquidaDoMedido - pagamentosVálidos
```

Pago nunca é calculado na 9C.

---

## X. Cronograma

Necessidades e contratos ligam `ScheduleActivity`. Alertas de compra crítica comparam data necessária, lead time e data provável de contratação.

Contratos podem ter marcos próprios vinculados a atividades. Atrasos de contratação/execução produzem risco de cronograma, mas somente o engine do cronograma determina impacto/caminho crítico.

Curva de contratação futura mostra, por período: orçamento planejado, saldo a contratar, contratado, medido e pago consultado da 9B.

---

## Y. Engenharia/BIM/VE

### Y.1 Design e Engenharia de Valor

Uma `VEOpportunity` aprovada pode originar necessidade por link tipado contendo revisão, alternativa, evidência, impacto e autor. A necessidade não altera automaticamente o Design ou orçamento.

Saving técnico só é validado após confirmar especificação equivalente e impactos.

### Y.2 BIM

`BimElement`/quantitativos podem ser proveniência de quantidade. Registrar separadamente quantidade de orçamento, BIM, cotada, contratada, medida e realizada. Conversões de unidade precisam de regra e versão.

BIM não é dono do processo de compra; a 9C apenas referencia elemento/modelo/revisão.

---

## Z. Central Executiva

Visão por projeto, SPE e grupo:

- Orçamento Oficial;
- contratado;
- saldo a contratar;
- medido;
- pago vindo da 9B;
- aditivos e supressões;
- saving validado;
- processos abertos;
- compras críticas;
- contratos críticos;
- medições pendentes;
- concentração por fornecedor;
- variações com causa estruturada.

Todo card deve abrir drill-down até item econômico, EAP, instrumento, medição e evento financeiro.

---

## AA. REDE IA

Ferramentas futuras, somente leitura inicialmente:

- consultar saldo a contratar;
- listar compras críticas;
- comparar orçamento e contratado;
- listar contratos/aditivos relevantes;
- consultar medido, pago e saldo;
- consultar saving validado;
- analisar concentração de fornecedor;
- listar medições aguardando aprovação;
- explicar cadeia e causa do desvio.

A IA recebe resultados dos services determinísticos com evidências. Pode resumir propostas, cláusulas e diferenças, mas não escolher fornecedor, aprovar compra, contrato ou medição automaticamente. Mutações usam preview e confirmação explícita, seguindo o precedente `AIPendingAction`.

---

## AB. Segurança

1. Toda consulta inicia por `organizationId` e revalida empresa/projeto nas relações.
2. IDs de contraparte, orçamento, atividade e documento devem pertencer ao mesmo tenant.
3. RBAC funcional por escopo; não confiar apenas em role global.
4. Segregação entre solicitante, comprador, técnico, aprovador e financeiro.
5. Documentos privados com autorização, checksum e logs de acesso relevantes.
6. Dados bancários/tokenizados pertencem à 9B e nunca são expostos em respostas comuns.
7. Aprovados são imutáveis; cancelamento exige motivo e autoridade.
8. Imports e PDFs são entrada não confiável, sujeitos a validação.
9. APIs usam paginação, limites, validação Zod e prevenção de IDOR.
10. IA não recebe documentos além da autorização do usuário/contexto.

---

## AC. Performance

- paginação cursor-based em requisições, propostas, contratos e medições;
- filtros server-side por tenant/projeto/status/período/fornecedor;
- índices compostos iniciando por `organizationId` nas raízes;
- índices por projeto/status/data necessária, fornecedor/status e contrato/período;
- unique constraints para números/versionamento/idempotência;
- tabelas de linha carregadas sob demanda;
- agregados executivos pré-calculáveis/read models, nunca fonte transacional;
- jobs assíncronos para importação, extração de proposta e recomposição histórica;
- nenhuma renderização de milhares de linhas sem virtualização;
- evitar JSON para relações consultadas/agregadas frequentemente;
- `Decimal` no banco e agregações SQL para grandes volumes.

Particionar medições/linhas somente quando volume real justificar; desenhar chaves e datas para permitir a evolução.

---

## AD. Auditoria

Reutilizar `AuditLog` para visão transversal, adicionando auditorias especializadas apenas quando necessárias à performance/retensão.

Registrar before/after, ator, tenant, projeto, ação, entidade, motivo, origem, correlation ID e aprovação. Eventos críticos: mudança de especificação, proposta, decisão, contrato, aditivo, medição, exceção, cancelamento e integração financeira.

Não apagar proposta aprovada, contrato, aditivo ou medição. Documentos e versões ficam vinculados. Logs não substituem tabelas de negócio para reconstruir valor atual.

---

## AE. Testes

### AE.1 Domínio

- máquinas de estado e transições inválidas;
- hierarquia/alocações e prova-zero;
- comparabilidade de escopo;
- saving e classificação;
- contrato original + aditivos - supressões;
- limite físico/financeiro da medição;
- retenção e adiantamento;
- lead time e compra crítica;
- causas de desvio.

### AE.2 Integração PostgreSQL

- tenant isolation/IDOR em todas as raízes;
- RBAC e segregação;
- imutabilidade/versionamento;
- documentos e checksums;
- aprovação e auditoria;
- paginação/filtros;
- concorrência de numeração e aprovação;
- rollback transacional.

### AE.3 Contrato 9B

1. Contrato de R$ 1 milhão não vira realizado.
2. Medição de R$ 200 mil gera uma única obrigação.
3. Replay retorna a mesma obrigação.
4. Pagamento não duplica o medido.
5. Anulação gera reversão, sem delete.
6. Payload divergente com mesma chave falha.
7. Tenant A não cria/consulta obrigação do tenant B.
8. Falha temporária mantém outbox pendente e retry seguro.
9. Aditivo atualiza compromisso/projeção sem alterar orçamento histórico.
10. Pagamento parcial preserva medido e saldo financeiro correto.

---

## AF. Migrations futuras

Não criar migrations nesta preparação. Sequência conceitual:

1. **9C.1 contraparte e qualificação:** contraparte, contatos, categorias, qualificações, links de documentos, índices e unicidade fiscal.
2. **9C.1 necessidades/requisições:** necessidades, origens, revisões, requisições, linhas, alocações e workflow.
3. **Núcleo de aprovação compartilhado:** somente após alinhamento com 9B.
4. **9C.2 cotações:** especificações/versionamento, processos, convites, propostas/revisões/linhas/condições, comparabilidade e decisão.
5. **9C.2 referências/saving:** referências de preço, ajustes comparáveis e saving validado.
6. **9C.3 instrumentos:** pedidos, contratos, itens, alocações, agendas e marcos.
7. **9C.3 aditivos:** alterações contratuais e causas.
8. **9C.4 medições:** boletins, versões, linhas, retenções, adiantamentos e compensações.
9. **Integração:** outbox, receipts/inbox local, correlation/idempotency e vínculos financeiros.
10. **Read models:** agregados executivos e indicadores, se a carga justificar.

Cada migration deve ser aditiva, sem editar migrations aplicadas, sem reset e com backfill explícito quando necessário.

---

## AG. Divisão em sprints

### 9C.0 — Contract alignment

Resolver tag/base, congelar contratos da 9B, ownership de contraparte, aprovação, documentos e integração. Sem UI de produção.

### 9C.1 — Fornecedores, necessidades e requisições

Cadastro único, qualificação inicial, plano de suprimentos, especificação v1, workflow de requisição, tenant/RBAC/auditoria.

### 9C.2 — Cotações, mapa e saving

Convites, propostas versionadas, dados estruturados, comparabilidade, mapa, benchmark e economia validada.

### 9C.3 — Pedidos, contratos e aditivos

Instrumentos, itens/alocações, comprometido, agenda contratual, aditivos/supressões e ponte Orçamento × Contratado.

### 9C.4 — Medições, retenções e adiantamentos

Boletins, limites, aprovação técnica, retenções, compensações, ponte Contratado × Medido. Integração financeira desabilitada por feature flag até freeze/testes.

### 9C.5 — Integração 9C→9B, Central e IA

Outbox/inbox, obrigações/reversões, Pago consultado da 9B, Projeção Atualizada, cards executivos e ferramentas de IA somente com dados estruturados.

### 9C.6 — Escala e integrações

Importação CSV/XLSX, conectores ERP, virtualização, jobs, histórico de preços/fornecedores e read models corporativos.

---

## AH. Riscos técnicos

| Risco | Impacto | Mitigação |
|---|---|---|
| Tag 9A aponta para Fase 8 | planejar/implementar sobre base errada | corrigir governança Git após aprovação humana; usar commit real no merge |
| 9B ainda é plano, não contrato | retrabalho e acoplamento | Contract Freeze formal antes de 9C.5 |
| fornecedor duplicado entre domínios | pagamentos e histórico desconectados | ownership único de contraparte |
| escrita direta em tabelas 9B | quebra de invariantes | command/query ports + outbox |
| dupla contagem planejado/contratado/medido | KPIs/EAC incorretos | ledger de estágios e regra de substituição |
| approval sprawl | controles inconsistentes | núcleo compartilhado de aprovação |
| RBAC atual muito amplo | conflito de funções | grants funcionais escopados |
| documento preso ao Investment Case | anexos de suprimentos frágeis | documento canônico + links tipados |
| uso excessivo de JSON | consultas lentas e pouca integridade | relações/totais estruturados; JSON só extensão |
| concorrência em aprovação/numeração | duplicidade/overcommitment | transações, version check e locks adequados |
| mudanças de escopo tratadas como saving | indicadores/bonificação falsos | comparabilidade e validação técnica |
| medição excede contrato | risco financeiro | prova-zero, tolerância e exceção aprovada |
| retry duplica obrigação | conta a pagar duplicada | inbox/outbox + unique idempotency |
| pagamento inferido pela 9C | realizado falso | pago somente via query port 9B |
| agregados caros em escala | dashboard lento | índices, paginação e read models |

---

## AI. Componentes independentes da 9B

Podem começar após o alinhamento da base Git, sem aguardar o financeiro:

- cadastro único de fornecedor/contraparte, desde que ownership seja aceito;
- contatos, categorias e qualificação documental;
- necessidades e origens;
- plano de suprimentos e alerta de compra crítica;
- requisições e especificações versionadas;
- processos de cotação, convites e propostas;
- comparabilidade e mapa;
- benchmark com proveniência;
- saving/economia validada;
- pedidos/contratos como domínio operacional;
- aditivos e comprometido;
- medições e provas-zero sem geração financeira;
- integrações conceituais com Design/BIM/VE;
- auditoria e testes de tenant.

Approval compartilhado, contraparte e documento precisam de decisão coordenada mesmo quando não dependem de tabelas financeiras.

---

## AJ. Componentes bloqueados pela 9B

- criação/ajuste/cancelamento de obrigação;
- conta a pagar e seus status;
- documento fiscal como lançamento financeiro;
- pagamento, pago e saldo financeiro oficial;
- conciliação bancária;
- dados bancários de fornecedor;
- liberação financeira de retenção/adiantamento;
- índices oficiais de reajuste, se ownership for da 9B;
- Projeção Atualizada/EAC final;
- realizado;
- ponte Medido × Pago oficial;
- cards corporativos que dependem de caixa/pagamentos;
- ferramentas da IA que afirmem valores pagos/realizados.

---

## AK. Estratégia de integração final

### AK.1 Sequência

1. Corrigir/confirmar a referência Git da Fase 9A.
2. Publicar o contrato implementado da 9B em módulo compartilhado e testes de contrato.
3. Congelar contraparte, aprovação, documentos e port financeiro.
4. Implementar 9C.1–9C.4 sem escrita financeira direta.
5. Habilitar outbox 9C e inbox/command handler 9B atrás de feature flag.
6. Executar testes de replay, reversão, concorrência e tenant.
7. Comparar agregados Orçado → Contratado → Medido → Pago em dataset controlado.
8. Habilitar START BUTANTÃ, validar manualmente e só então liberar demais tenants.

### AK.2 Definition of Done da integração

- um `EconomicItem` rastreia toda a cadeia;
- nenhuma obrigação nasce duas vezes;
- cancelamento não apaga histórico;
- pago vem exclusivamente da 9B;
- totais fecham por item, contrato, projeto, SPE e tenant;
- Projeção Atualizada substitui corretamente parcelas genéricas por fatos concretos;
- documentos e aprovações são rastreáveis;
- auditoria explica quem, quando, por quê e qual impacto;
- testes de contrato e multiempresa estão verdes;
- IA apenas consulta resultados determinísticos.

---

## Mapa consolidado de entidades e ownership

| Conceito/entidade provisória | Responsabilidade | Owner | Origem principal | Relações | Consumidores |
|---|---|---|---|---|---|
| Contraparte/Fornecedor | cadastro corporativo único | Núcleo/9C | usuário/ERP | Organization | 9C, 9B, REDE Data |
| Qualificação | elegibilidade/evidências | 9C | documentos/revisor | Fornecedor | Compras/Contratos |
| Necessidade | demanda econômica/técnica | 9C | EAP, cronograma, Design/BIM/VE | EconomicItem, BudgetLineItem, ScheduleActivity | Requisição |
| Requisição | autorização para cotar | 9C | Necessidades | Approval | Cotação |
| EspecificaçãoVersionada | escopo comparável | 9C/Engenharia | técnico/documentos | Requisição | Propostas/Contrato |
| ProcessoCotação | competição e negociação | 9C | Requisição aprovada | Fornecedores/Propostas | Decisão |
| Proposta/Revisão | oferta estruturada e original | 9C | fornecedor | Cotação/Documento | Mapa/Contrato |
| MapaComparativo | comparação normalizada | 9C | propostas/referências | Decisão | Aprovação/IA |
| ReferênciaPreço | benchmark com proveniência | 9C/REDE Data | interno/externo | EconomicItem | Mapa/Saving |
| EconomiaValidada | economia auditada | 9C | decisão/contrato | VE/Approval | Central/bonificação futura |
| Pedido | compromisso simples | 9C | decisão aprovada | Itens/Fornecedor | 9B/Entrega |
| Contrato | compromisso complexo | 9C | decisão aprovada | Itens/Agenda/Documentos | Medição/9B |
| Aditivo | mudança formal | 9C | contrato/causa | Approval | Comprometido/EAC |
| Medição | certificação de execução | 9C | contrato/período | linhas/retenções | 9B/Central |
| Retenção | saldo retido classificado | 9C + efeito 9B | contrato/medição | obrigação | 9B |
| Adiantamento | valor e amortização | 9C + pagamento 9B | contrato | compensações | Medição/9B |
| Obrigação financeira | dívida operacional | 9B | evento 9C ou financeiro | contraparte/origem | AP/Tesouraria |
| Pagamento | liquidação | 9B | banco/AP | obrigação | Realizado/Central |
| Outbox/Inbox | entrega confiável | compartilhado | transação de domínio | eventId/idempotency | integração |
| Approval | decisão por alçada | compartilhado | política | qualquer ato | 9B/9C/Auditoria |
| Documento/Link | arquivo canônico e vínculos | compartilhado | upload/integração | entidades tipadas | todos os módulos |

---

## Conclusão

A Fase 9C deve adicionar fatos de suprimentos e execução sem criar um financeiro paralelo. O eixo é `EconomicItem`; a fronteira é clara: 9C controla necessidade, compra, compromisso e medição, enquanto 9B controla obrigação, pagamento, conciliação, realizado e Projeção Atualizada. O Contract Freeze mínimo e a integração por eventos idempotentes são pré-condições para transformar essa arquitetura em código sem recadastro, silos ou dupla contagem.
