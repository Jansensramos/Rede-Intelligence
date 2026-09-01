# Fase 9F — Pessoas, Administração, Eficiência e Causa-raiz

## Situação

Implementação concluída sobre a base oficial `rede-phase-9e-complete-2026-08-22`, sem criar módulos paralelos de orçamento, cronograma, medição, contas a pagar/receber ou economia validada.

## Limites preservados

- `User` continua representando autenticação e autorização; `PersonProfile` representa o perfil profissional e pode, opcionalmente, referenciar um usuário por `userId`.
- orçamento e cronograma oficiais continuam pertencendo à Fase 9A;
- realizado financeiro continua pertencendo à Fase 9B;
- medições, contratos e `ValidatedSaving` continuam pertencendo à Fase 9C;
- a Fase 9F não implementa folha, eSocial, ponto, recrutamento, benefícios completos, pagamento de bônus ou ranking de pessoas;
- incentivo é apenas simulação e nunca gera conta a pagar, lançamento financeiro ou folha.

## Modelo persistente

### Estrutura e capacidade

- `Department`, com hierarquia e bloqueio de ciclos;
- `Position`;
- `PersonProfile`;
- `EmploymentRelationship`, com empresa, cargo, departamento, gestor e vigência histórica;
- `Team` e `TeamMembership`;
- `WorkAllocation`, ligado a empreendimento, centro de custo, item econômico e atividade do cronograma;
- `RelationshipCostSnapshot`, de acesso restrito.

### Custos administrativos

- `AdministrativeCostPlan` e `AdministrativeCostPlanLine`;
- `AdministrativeCostAllocationRule`;
- `AdministrativeCostAllocationSnapshot` e `AdministrativeCostAllocationLine`.

O rateio é determinístico em centavos, conserva o valor de origem e registra `residualAmount`, `proofZero` e checksum.

### Eficiência e causa-raiz

- `EfficiencyAnalysisRun` e `EfficiencyMetricResult`;
- `PerformanceVarianceCase`;
- `RootCauseInvestigation`;
- `CausalHypothesis` e `CausalEvidence`;
- `RootCauseAllocation`, para causas parciais cuja soma não pode superar 100% e deve chegar exatamente a 100% no fechamento;
- `ExternalDependency`;
- `CorrectiveAction` e `CorrectiveActionEvidence`.

Cada análise preserva o snapshot de entrada e a versão da metodologia. A cadeia usa explicitamente Planejado, Comprometido, Medido, Realizado e Projeção.

## Regra econômica crítica

Um desembolso menor não é economia por si só. O cenário demonstrativo usa:

- planejado: R$ 350.000;
- realizado: R$ 200.000;
- avanço planejado: 100%;
- avanço real: 50%;
- desvio de caixa: R$ 150.000;
- economia elegível: **não**.

Somente um registro comparável e efetivamente validado em `ValidatedSaving` pode alimentar uma simulação de incentivo.

## Capacidades e privacidade

As capacidades da 9F são adaptadas ao `MembershipRole` existente:

- `VIEWER`: leitura operacional, sem remuneração;
- `REVIEWER`: leitura e verificação segregada de ação;
- `ANALYST`: gestão operacional, alocação, análise, causa-raiz e simulação;
- `ADMIN` e `OWNER`: capacidades anteriores mais remuneração, aprovação de ação e aprovação de simulação de referência.

Custos individuais são omitidos do workspace quando o papel não possui `COMPENSATION_READ`. A REDE AI sempre consulta a visão equivalente a `VIEWER`, mesmo quando o usuário conectado possui papel superior. Auditorias de custo não duplicam o valor sensível no JSON da trilha.

## Interface e Central Executiva

A navegação inclui **Pessoas e Eficiência**, com as áreas Visão Geral, Pessoas e Estrutura, Equipes e Capacidade, Custos Administrativos, Eficiência, Causa-raiz, Ações e Incentivos.

A Visão Executiva recebeu o resumo de pessoas, equipes, alocações, desvios, ações e custo mensal conforme permissão. O padrão visual existente foi preservado.

## REDE AI

Foram adicionadas somente ferramentas de leitura:

- `getOrganizationalStructure`;
- `getTeamCapacity`;
- `getEfficiencyVariances`;
- `getRootCauseInvestigations`;
- `getCorrectiveActions`.

Nenhuma ferramenta de IA altera vínculos, remuneração, ações ou incentivos.

## Seed demonstrativo

O seed idempotente do START BUTANTÃ inclui 2 departamentos, 3 cargos, 3 perfis e vínculos, 1 equipe, alocações, custos restritos, plano administrativo com prova de zero, análise do cenário crítico, 3 hipóteses com causas somando 100%, dependência externa, ação corretiva ativa e simulação vinculada a `ValidatedSaving` sem pagamento.

## Execução local

```powershell
pnpm db:local:setup
pnpm db:migrate
pnpm db:seed
pnpm dev -- --port 3001
```

Acesso demonstrativo: configurado exclusivamente no ambiente local, sem valores versionados.

## Validação exigida

```powershell
pnpm db:validate
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

O smoke autenticado deve validar a Visão Executiva, Pessoas e Eficiência, os módulos anteriores e ausência de `Runtime TypeError` no console.
