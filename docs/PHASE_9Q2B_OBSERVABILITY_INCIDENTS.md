# Fase 9Q.2B — Observabilidade, alertas e incidentes

## Redaction de logs — já implementado, não refeito

`src/infrastructure/observability/logger.ts` já redige por nome de campo
(`password|senha|secret|token|authorization|cookie|cpf|cnpj|...tax.*id|document|credential|api[-_]?key|email|phone|signed.*url|temporary.*url`)
e por padrão de valor (Bearer token, cookie de sessão, `postgres://user:pass@`, CPF/CNPJ
formatados ou em dígitos, e-mail, query string de URL — incluindo URL assinada/temporária)
em qualquer chamada de `logger.*`. Isso já cobre o requisito "IDs internos, PII, CPF,
CNPJ, tokens, URLs assinadas e dados financeiros não podem aparecer em logs públicos" no
nível do transporte de log.

## Gap encontrado e fechado nesta fase: alertas sem destino real

Antes desta fase, `ErrorReporterProvider`/`MetricsProvider`
(`src/infrastructure/observability/providers.ts`) só tinham implementação **local**
(escreve em `console.*` via `logger`) — sem nenhum guard impedindo esse comportamento em
produção, ao contrário de storage/secret/KMS/scanner, que já falhavam fechado. Isso é
exatamente o bloqueador "alertas sem destino/responsável" citado em
`docs/PHASE_9Q_RELEASE_CONTRACT.md` §5.

Correção: `runtime-config.ts` ganhou `ALERTING_PROVIDER` (`local`/`external`, default
`local`) e `ALERTING_EXTERNAL_ENDPOINT` (URL opcional) — produção agora exige
`ALERTING_PROVIDER=external` + endpoint configurado, mesmo padrão fail-closed de
`SECRET_PROVIDER`/`KMS_PROVIDER`. `src/infrastructure/observability/alert-dispatcher.ts`
(novo) adiciona `WebhookAlertTransport` — transporte HTTP genérico, deliberadamente
agnóstico de fornecedor (aceita qualquer backend com webhook JSON: Slack/Teams incoming
webhook, PagerDuty Events API, OpsGenie, Datadog, relay para Sentry, endpoint interno),
consistente com a decisão de design já registrada na 9P.2 ("`ErrorReporterProvider` e
`MetricsProvider` mantêm o domínio agnóstico a Sentry, Datadog ou OpenTelemetry"). Payload
sempre passa por `sanitizeLogValue` antes de sair — mesma redaction do logger. Falhas de
entrega são classificadas por `wrapProductionDependencyFailure` (timeout, indisponibilidade,
etc.), e o preflight de produção ganhou um sexto serviço verificado: `ALERTING_PROVIDER`
(`src/infrastructure/release/production-preflight.ts`). 6 testes novos
(`alert-dispatcher.test.ts`), todos verdes.

**O que isso NÃO faz**: não escolhe um fornecedor de alerta real, não configura uma conta
Slack/PagerDuty/Datadog, não envia um alerta real. Constrói o gate e o transporte
genérico; a escolha de fornecedor e a URL real do webhook são decisão humana pendente.

## Métricas mínimas exigidas (herdadas da 9P.2) — status

| Métrica | Onde já existe | Alerta configurado? |
|---|---|---|
| 5xx > 2%/5min | Nenhuma métrica de taxa de erro HTTP agregada existe no código hoje | Não |
| p95 acima do SLO | Nenhuma instrumentação de latência agregada existe | Não |
| readiness falhando | `/api/health/ready` existe e é testado; falta ligar a um alerta externo real | Não |
| worker sem heartbeat | Não instrumentado nesta fase | Não |
| fila/idade crescendo, dead-letter nova | Métricas de fila/dead-letter/quarentena por tenant já existem (9Q.2A, painel `/ajuda/prontidao`) — falta ligar a alerta externo | Não |
| DB/storage indisponível | Coberto pelo preflight (bloqueia deploy), não é alerta contínuo em produção rodando | Não |
| integração com erro/retry persistente | Modelo de instalação (`classifyInstallationState`) já sinaliza `CRITICAL`/`ATTENTION` na UI — falta alerta externo | Não |
| aumento anormal de login/rate limit | Não instrumentado nesta fase | Não |

O gate de configuração (`ALERTING_PROVIDER=external`) agora bloqueia produção sem
destino — mas **nenhuma dessas métricas está de fato conectada a esse destino ainda**.
Isso é trabalho de instrumentação futura, fora do escopo fechável sem escolher o
fornecedor primeiro.

## Runbooks (esqueleto, a expandir com o responsável de operações real)

- **Indisponibilidade de banco/storage/KMS/Secret Manager**: preflight já bloqueia deploy
  novo; para indisponibilidade em produção já rodando, isolar o componente, não tentar
  fallback silencioso (nenhum existe por design), acionar o responsável de operações.
- **Vazamento suspeito**: revogar credencial no fornecedor primeiro (ver
  `docs/PHASE_9Q2B_SECRETS_ROTATION_PROCEDURE.md`), depois rotacionar no cofre, preservar
  AuditLog, identificar tenants/objetos atingidos, seguir plano jurídico de comunicação
  (LGPD).
- **Corrupção de dados**: nunca restaurar sobre produção; restaurar em ambiente isolado
  (`assertIsolatedRestoreTarget`), comparar hashes, decidir com o responsável de banco.
- **Fila acumulada/dead-letter**: painel de prontidão (9Q.2A) já expõe as métricas por
  tenant; ação depende de causa raiz (integração externa fora do ar, job com erro
  recorrente) — sem automação de auto-retry agressivo que possa mascarar o problema.
- **Integração externa fora do ar**: instalação muda para `CRITICAL`/`ATTENTION`
  automaticamente (`classifyInstallationState`); não há fallback para dado não confiável.

## Responsável, plantão, escalonamento

Não definidos nesta fase — são decisões organizacionais, não algo que o código determina.
Bloqueador explícito de piloto (contrato 9Q §5: "ausência de responsável de operação e
suporte").

## Bloqueio

Nenhum alerta real foi enviado a um destino real nesta fase — não há destino configurado.
Instrumentação de métricas de SLO (5xx, p95, heartbeat de worker, rate limit de login)
permanece pendente. Responsável e plantão não definidos.
