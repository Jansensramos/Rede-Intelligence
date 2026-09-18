# REDE Intelligence — Fases 10D a 10J

Data: 18/09/2026  
Branch: `codex/fase-10d-10j-cognitive-stack`

## Objetivo

Consolidar a camada cognitiva da REDE sobre as fundações já entregues em 10A (AI Gateway), 10B (Context Engine) e 10C (Tool Layer), preservando três invariantes:

1. evidência antes de conclusão;
2. decisão material permanece humana;
3. nenhuma mutação autônoma é executada sem aprovação humana explícita.

## 10D — Agent Framework

Implementado em `src/application/cognitive/agents.ts`.

Agentes registrados:

- CFO;
- Engenharia;
- Comercial;
- Jurídico;
- Mercado;
- Investidor;
- Incorporador.

Cada agente possui foco, alçada mínima e allowlist de ferramentas. O framework não concede acesso novo: utiliza exclusivamente a Tool Layer existente, que continua responsável por RBAC, escopo, evidência e auditoria.

## 10E — Red Team 2.0

Implementado em `red-team.ts`.

Questiona conclusões por:

- ausência de evidência;
- confiança baixa;
- fonte única para conclusão material;
- ação proposta sem suporte;
- contradição entre conclusões.

O Red Team não corrige nem silencia a conclusão original; ele adiciona desafios explícitos ao relatório.

## 10F — Decision Engine

Implementado em `decision-engine.ts`.

Produz uma proposta explicável com três disposições possíveis:

- prosseguir com controles;
- aguardar evidências;
- refazer análise.

Toda saída contém `requiresHumanDecision: true`.

## 10G — Investment Committee

Implementado em `investment-committee.ts`.

Orquestra os agentes, executa Red Team e entrega uma proposta única de decisão. O estado terminal da rodada é sempre `PENDING_HUMAN_DECISION`.

## 10H — REDE Operator

Implementado em `operator.ts`.

O Operator é uma camada de execução por capabilities allowlisted. Ações de mutação exigem `humanApprovalId`; sem isso, são recusadas antes do adapter.

Isto permite futura integração com APIs, browser/computer ou sistemas legados sem transformar a camada cognitiva em bypass de autorização.

## 10I — Autopilot

Implementado em `autopilot.ts`.

Modos:

- OFF;
- ADVISORY;
- ASSISTED.

O modo ASSISTED pode preparar uma `OperatorAction`, mas nunca injeta aprovação humana e nunca executa a ação por conta própria. A execução continua passando pelo Operator.

## 10J — Learning Loop

Implementado em `learning-loop.ts`.

Compara previsto x realizado por métrica e calcula:

- amostra;
- erro absoluto médio;
- viés médio.

A saída pode recomendar revisão de premissas, mas declara `policyMutationAllowed: false`. Aprendizado histórico não altera automaticamente políticas, alçadas ou modelos.

## Integração com 10C

`adapters.ts` fornece `createExistingToolLayerPort`, que conecta o Agent Framework diretamente ao `executeAiTool` existente. Não existe acesso direto a Prisma, Context Engine readers ou evidência bruta fora do choke point já auditado da 10C.

## Orquestração completa

`CognitiveStack` integra:

`Agent Framework → Red Team → Decision Engine → Investment Committee → Operator → Autopilot → Learning Loop`

A classe não mantém estado privilegiado e não cria canal alternativo de mutação.

## Critérios de aceitação

- TypeScript estrito;
- ESLint;
- testes unitários cobrindo as sete fases;
- build Next.js;
- Tool Layer permanece único choke point de evidência;
- mutação sem aprovação humana é recusada;
- Autopilot não executa ações;
- Learning Loop não altera política automaticamente.

## Próxima evolução operacional

A fundação 10D–10J fica pronta para ser conectada às superfícies executivas da REDE. A ativação de providers comerciais e automações externas continua sujeita às políticas do AI Gateway e às credenciais/autorizações do ambiente.
