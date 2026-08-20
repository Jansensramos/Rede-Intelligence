# Fase 9A — Base Operacional

## Objetivo

A Fase 9A transforma a viabilidade aprovada em referência operacional sem misturar estados econômicos:

```text
Viabilidade → Base Aprovada → Orçamento Oficial → Cronograma Físico-Financeiro → Fluxo Projetado
```

- **Base Aprovada:** retrato imutável do que foi aprovado.
- **Orçamento Oficial:** plano detalhado de execução, alterável apenas por revisão.
- **Projeção Atualizada:** contrato de dados preparado, ainda sem realizado, contratos ou medições.

## Arquitetura e entidades

### Estrutura operacional

- `EconomicGroup`: grupo econômico do tenant.
- `Company`: empresa, incorporadora ou SPE; possui moeda, timezone e configurações.
- `Project`: empreendimento, opcionalmente vinculado a uma empresa/SPE.
- `ProjectOperatingUnit`: hierarquia livre de fases, torres, blocos, etapas, infraestrutura e áreas comuns.
- `CostCenter`: centro de custo hierárquico, com responsável e futura conta gerencial.
- `EconomicItem`: identificador econômico canônico compartilhado pela Base, Orçamento, Cronograma e futuras compras, medições e obrigações.

Todas as consultas de aplicação partem de `organizationId`; referências de projeto, Base e Orçamento são novamente verificadas antes de mutações.

### Base Aprovada

`OperationalBaseline` referencia obrigatoriamente uma `StudyVersion` e pode referenciar o `InvestmentSnapshotBundle` existente. Seu conteúdo econômico, premissas, indicadores e origem são congelados como JSON auditável, checksum SHA-256 e linhas em `OperationalBaselineLine`.

Fluxo:

1. Preparar a Base com confirmação explícita.
2. Enviar para aprovação.
3. Aprovar com perfil `OWNER` ou `ADMIN`.
4. Para alterar a tese, criar outra versão com motivo e vínculo `previousBaselineId`.
5. Ao aprovar a nova versão, a anterior passa a `SUPERSEDED`; ela nunca é sobrescrita.

Estados exibidos: Em preparação, Em aprovação, Aprovada e Substituída.

### Orçamento Oficial e EAP

O modelo `Budget` existente foi evoluído, não recriado. Ele agora possui tipo (`PRELIMINARY`, `OFFICIAL`, `REVISED`), vínculo com Base/empresa/versão anterior, motivo da revisão e checksum. Linhas oficiais usam o mesmo `EconomicItem` da Base.

`BudgetLineItem.parentId` permite EAP de profundidade arbitrária. A prova-zero soma somente folhas, evitando dupla contagem de nós consolidados. Linhas aceitam centro de custo, unidade operacional, responsável, datas, categoria, subcategoria, origem e status. `BudgetLaborComposition` suporta função, quantidade, custo mensal, encargos, benefícios e permanência.

Um orçamento `OFFICIAL`, `APPROVED`, `SUPERSEDED`, `CLOSED` ou `ARCHIVED` é bloqueado para edição direta. Mudanças devem usar `createBudgetRevision`, preservando anterior, motivo, usuário e data.

### Ponte do Orçamento

O motor agrupa Base e Orçamento por categoria e calcula valor, diferença, percentual e materialidade. As faixas vêm de `MaterialityPolicy`, por organização. `BudgetVarianceJustification` preserva explicações de desvios relevantes.

O caso em que a Base é zero é tratado como nova verba e nunca gera divisão silenciosa por zero.

### Cronograma físico-financeiro

`OperationalSchedule` é versionado e vinculado ao Orçamento Oficial. `ScheduleActivity` pode referenciar item econômico, linha orçamentária, unidade operacional, responsável e atividade pai. `ScheduleDependency` suporta término→início, início→início e término→término e rejeita ciclos. Marcos não são hardcoded.

`ScheduleAllocation` armazena separadamente:

- percentual físico;
- percentual financeiro;
- desembolso planejado.

As distribuições linear e curva S fecham resíduos de arredondamento no último período. Na aprovação, cada atividade precisa fechar 100% físico e o valor financeiro exato. Períodos finais anteriores aos iniciais, negativos, referências inválidas e ciclos são bloqueados.

## Fluxo projetado e indicadores

O fluxo agrega as alocações por mês. A estrutura aceita curva de entradas da Base sem confundi-la com contas a receber. São calculados custo total, próximos 90 dias, pico, mês de pico, duração e concentração mensal. Não há limite de 12/24 meses; a visualização percorre o ciclo conhecido.

## Central Executiva e interface

O módulo Orçamento preserva o editor existente e acrescenta:

- cards de Base, Orçamento, diferença, prazo, próximos 90 dias e pico;
- Ponte do Orçamento com materialidade;
- curva de desembolso e tabela mensal;
- estrutura de grupo/SPE, unidades operacionais e centros de custo;
- drill-down inicial por categoria, com EAP detalhada no editor já existente.

Toda nova nomenclatura visível é prioritariamente em português e usa a identidade visual atual.

## REDE IA

Ferramentas determinísticas de leitura:

- `getOperationalBaseline`;
- `getOfficialBudget`;
- `compareBaselineToBudget`;
- `getOperationalSchedule`;
- `getProjectedDisbursement`.

O LLM recebe números calculados pelo domínio e evidências com entidade, versão e identificador; ele não recalcula valores financeiros.

## Seed demonstrativo

O seed é aditivo e idempotente. Para START BUTANTÃ ele cria estrutura demonstrativa explicitamente identificada, política de materialidade, Base Aprovada v1, Orçamento Oficial v1 de **R$ 40.761.463,51** e cronograma mensal de 36 meses. O orçamento anterior e todos os dados de Design/BIM permanecem preservados.

## Execução

```bash
pnpm db:validate
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Limitações deliberadas

Esta fase não implementa compras, contratos, medições, pagamentos, realizado, bancos, contabilidade ou RH. Importação XLSX/CSV e exportação executiva permanecem contratos futuros; a infraestrutura atual não justificou adicionar biblioteca pesada. A timeline é responsiva e sem dependência de Gantt. Para milhares de linhas, a próxima evolução de interface deve incorporar paginação/virtualização server-side, sem mudar o modelo econômico.
