# Fase 9Q.2B — Matriz Go/No-Go do piloto

Commit-base desta matriz: `f04eb740316f56618a6d39dab1d27eabe5d064d0` (9Q.2A, CI verde).
Branch: `codex/fase-9q2b-cloud-production-readiness`. Data: 2026-09-09.

Regra de leitura: **GO** só é uma decisão humana. Este documento nunca marca uma linha
como GO por si mesmo — ele registra evidência, e a coluna Decisão fica em aberto até um
responsável humano assiná-la, conforme `docs/PHASE_9Q_RELEASE_CONTRACT.md` §8 ("é
proibido declarar como executado qualquer... validação de serviço cloud que não tenha
sido realmente executado").

## Segurança

| Requisito | Evidência | Responsável | Status | Bloqueio | Validade da evidência | Decisão |
|---|---|---|---|---|---|---|
| Segredos/KMS validados sem exibir valor | `production-preflight.test.ts`, `aws-security-adapters.ts` (código testado, sem alvo real) | Segurança | PARCIAL | Sem conta AWS real para rodar o preflight de verdade | Testes unitários válidos enquanto o código não mudar; não substituem execução real | Pendente |
| Scanner antimalware externo | `upload-policy.ts` (`UnavailableProductionScanner`) | Segurança | BLOQUEADO | Nenhum adapter real de scanner existe no código | N/A | Pendente |
| Credencial demonstrativa ausente em produção | `runtime-config.ts` (produção recusa `SECRET_PROVIDER=environment`) | Segurança | COMPROVADO (nível de código) | — | Válido enquanto o schema não mudar; teste automatizado (`runtime-config.test.ts`) | Pendente (falta ambiente real para confirmar em runtime) |
| RBAC/isolamento multiempresa | `assertStorageAuthorization` testado; RBAC de 9Q.1B; login real via navegador (Chrome, `admin@rede.local`) confirmado até `/executivo` e painel `/ajuda/prontidao` (OWNER/ADMIN) renderizado com dados reais; ANALYST/REVIEWER/VIEWER negados por teste de integração contra Postgres real | QA/Segurança | COMPROVADO (código + navegador real para OWNER) | Falta teste ponta-a-ponta contra infraestrutura real (bucket/IAM); negação de VIEWER não repetida numa segunda sessão de navegador (coberta por teste de integração real, não navegador) | Válido enquanto o código não mudar | Pendente |
| Logs sem segredo/PII | `logger.ts` (redaction por campo e por valor, testado; nesta rodada ganhou telefone BR, JWT nu e IDs operacionais em texto livre — achado da reauditoria REPROVADA) | Segurança | COMPROVADO (nível de código; redaction por regex tem limite inerente — não cobre todo padrão possível) | — | Válido enquanto o padrão de redaction não mudar | Pendente |
| Upload malicioso bloqueado | `upload-validation.ts` (22 testes: executável disfarçado, MIME incompatível, assinatura divergente, override bidirecional, caractere de controle/NUL, path traversal, nome vazio/excessivo) | Segurança | COMPROVADO (nível de código) | Scanner de produção ainda bloqueado (ver acima) — validação de assinatura não substitui scanner | Válido enquanto o código não mudar | Pendente |
| IAM de menor privilégio | Templates em `docs/PHASE_9Q2B_IAM_KMS_POLICY.md` | Segurança | NÃO COMPROVADO | Nenhuma política aplicada a conta real; teste de `AccessDenied` não executado | N/A | Pendente |
| SSRF do transporte de alerta (literal + IPv4 embutido em IPv6) | `alert-dispatcher.ts` (`assertSafeAlertEndpoint`, 43 testes: https/userinfo/porta/loopback/link-local/privado/multicast/reservado/CGNAT/metadados de nuvem, e as 4 formas de IPv4 embutido em IPv6 — mapeado, IPv4-translated, NAT64, 6to4) | Segurança | COMPROVADO (nível de código; bypass real encontrado por auditoria adversarial e corrigido em duas rodadas — mapeado/NAT64/6to4 na primeira, IPv4-translated na reauditoria seguinte) | Sem destino real para confirmar em runtime | Válido enquanto o código não mudar | Pendente |
| Proteção contra DNS rebinding/TOCTOU | `alert-dispatcher.ts` — resolve+valida todos os A/AAAA, conecta pinado no endereço validado, SNI/Host preservam o hostname original, sem nova dependência (`node:dns`+`node:https`); resposta family=4 malformada agora fail-closed (`parseCanonicalIPv4`, achado da reauditoria REPROVADA); 27 testes de rebinding/malformação | Segurança | COMPROVADO (nível de código) | Sem destino real para confirmar em runtime; tamanho de cabeçalho de resposta não limitado por esta camada | Válido enquanto o código não mudar | Pendente |
| Circuit breaker do transporte de alerta | `alert-dispatcher.ts` — máquina de 3 estados (CLOSED/OPEN/HALF_OPEN) com exclusão real de sonda concorrente sob `Promise.all`, 4 testes (achado Médio da reauditoria REPROVADA: a versão anterior permitia tempestade de probes no half-open) | Segurança/SRE | COMPROVADO (nível de código) | Sem destino real para observar em runtime | Válido enquanto o código não mudar | Pendente |
| Call sites produtivos do alerting (dead-letter/quarentena/worker fatal) | `job-runner.ts`, `clicksign-service.ts`, `import-service.ts`, `scripts/worker.ts` via `operational-alerts.ts` (dedup — testado oficialmente para a janela de 5 min nesta rodada —, rate limit, payload mínimo); testes diretos em `job-runner.database.integration.test.ts` (7) e `clicksign.database.integration.test.ts`; idempotência de redelivery da quarentena Clicksign testada em `contract-closing.database.integration.test.ts` | Segurança/SRE | COMPROVADO (nível de código; gap real de "nenhum call site" encontrado por auditoria e corrigido) | Sem destino real para observar um alerta chegando de fato | Válido enquanto o código não mudar | Pendente |

## Banco

| Requisito | Evidência | Responsável | Status | Bloqueio | Validade | Decisão |
|---|---|---|---|---|---|---|
| 34 migrations, nenhuma inesperada | `ls prisma/migrations` = 34, checksums batem via `local-release-safety.test.mjs` | Banco de Dados | COMPROVADO | — | Válido para este commit exato | Pendente |
| `prisma validate`/`generate`/`migrate status` | Executados: `validate` aprovado; `migrate status` local aplicado via `migrate deploy` real (ver auditoria de migrations abaixo) | Banco de Dados | COMPROVADO (local, dev) | Não substitui execução contra instância cloud gerenciada | Válido para este commit exato | Pendente |
| Suíte de teste em banco isolado, criado do zero | `rede_intelligence_test` recriado (antigo renomeado para `..._archived_20260904`, evidência preservada); 34 migrations + seed + 1.206/1.206 testes, repetido 3x sem recriar o banco | Banco de Dados/QA | COMPROVADO (local) | Não é o banco de piloto/produção | Válido para este banco local nesta data | Pendente |
| Conexão TLS, menor privilégio | — | Banco de Dados | NÃO COMPROVADO | Nenhuma instância gerenciada real | N/A | Pendente |
| PITR, retenção 35 dias | `docs/PHASE_9Q2B_DB_BACKUP_PITR.md` | Banco de Dados | NÃO COMPROVADO | Nenhum provedor de PostgreSQL gerenciado contratado | N/A | Pendente |
| Guarda de restauração isolada (nunca sobre a fonte) | `restore-safety.ts`, 9 testes (inclui origem/destino arquivados, achado da reauditoria REPROVADA) | Banco de Dados | COMPROVADO (nível de código) | Falta ensaio real contra instância cloud | Válido enquanto o código não mudar | Pendente |
| Restauração local validada (referência de padrão) | `backup-local-database.mjs`; comportamento de backup/restauração inalterado, mas a checagem de banco arquivado foi centralizada nesta correção (ver linha "banco arquivado" abaixo); executado de fato contra `rede_intelligence` em 2026-09-09 (`valid:true`, SHA-256 registrado, antes da centralização) | Banco de Dados | COMPROVADO (local) | Não é evidência de cloud; backup **não existia** antes das 2 migrations aplicadas nesta fase (registrado, não fabricado) | Execução datada 2026-09-09; não contínua | Pendente |
| Banco arquivado bloqueado (DATABASE_URL, TEST_DATABASE_URL, worker, Prisma, backup/restauração) | `scripts/database-url-safety.mjs::assertNotArchivedDatabase` (radical `archiv`, fail-closed em URL inválida), conectada em `runtime-config.ts`, `prisma.ts`, `restore-safety.ts` e `backup-local-database.mjs` — sem cópia duplicada; 23 testes unitários + subprocessos reais (`worker.ts`, `backup-local-database.mjs`) em `local-release-safety.test.mjs` | Banco de Dados/Segurança | COMPROVADO (nível de código; achado Bloqueador da reauditoria anterior — `DATABASE_URL` não tinha proteção alguma — corrigido nesta rodada) | Nenhuma instância gerenciada real para confirmar em runtime cloud | Válido enquanto o código não mudar | Pendente |

## Deploy

| Requisito | Evidência | Responsável | Status | Bloqueio | Validade | Decisão |
|---|---|---|---|---|---|---|
| Imagem identificada por SHA | `deploy-readiness.yml` (`container-audit`) | SRE/Cloud | COMPROVADO (workflow existente) | Nunca executado contra registry real de piloto | Válido enquanto o workflow não mudar | Pendente |
| Preflight antes do tráfego | `production-preflight.ts` + CLI, 6 dependências (banco, storage, segredo, KMS, scanner, alerting); **executado de fato**: caminho inválido (localReady:false/exit 1) e caminho válido com config efêmera (localReady:true/exit 0, 9/9 checks) via `predeploy:local` | SRE/Cloud | COMPROVADO (local, ambos os caminhos executados) | Nunca executado contra ambiente cloud real | Válido enquanto o código não mudar | Pendente |
| Liveness/readiness separados | `/api/health/live`, `/api/health/ready` (9Q.2A); **executado**: liveness 200, readiness bloqueada 503 (causa real: `INTEGRATION_SECRET_KEY` ausente do `.env` local) e readiness válida 200 (chave efêmera) | SRE/Cloud | COMPROVADO (local, executado ao vivo) | Falta comprovação contra ambiente cloud | Válido localmente nesta data | Pendente |
| Migration executada uma única vez | Plano documentado em `docs/PHASE_9Q2B_DEPLOY_ROLLBACK_PLAN.md` | SRE/Cloud/Banco | NÃO COMPROVADO | Nenhum deploy real ocorreu | N/A | Pendente |
| Rollback de aplicação ensaiado | Plano documentado | SRE/Cloud | NÃO COMPROVADO | Nenhum ambiente para ensaiar | N/A | Pendente |
| `TRUSTED_PROXY_HOPS` correto para a topologia real | `docs/PHASE_9Q2B_CLOUD_TOPOLOGY.md` (regra de contagem, não valor) | SRE/Cloud | NÃO COMPROVADO | Topologia (LB/CDN) não contratada | N/A | Pendente |

## Recuperação

| Requisito | Evidência | Responsável | Status | Bloqueio | Validade | Decisão |
|---|---|---|---|---|---|---|
| Backup persistente validado (cloud) | — | Banco de Dados | NÃO COMPROVADO | Sem provedor | N/A | Pendente |
| Restauração isolada (cloud) | — | Banco de Dados | NÃO COMPROVADO | Sem provedor | N/A | Pendente |
| RPO/RTO medidos | Meta declarada (15min/4h), não medida | Banco de Dados | NÃO COMPROVADO | Sem provedor | N/A | Pendente |

## Suporte e observabilidade

| Requisito | Evidência | Responsável | Status | Bloqueio | Validade | Decisão |
|---|---|---|---|---|---|---|
| Alertas com destino real | `alert-dispatcher.ts` (gate fail-closed + transporte webhook genérico, testado); nenhum destino contratado | SRE/Cloud | PARCIAL (gate pronto, destino ausente) | Nenhum fornecedor de alerta escolhido | Gate válido enquanto o código não mudar | Pendente |
| Métricas de SLO (5xx, p95, heartbeat) | Nenhuma instrumentação agregada existe | SRE/Cloud | NÃO COMPROVADO | Não implementado | N/A | Pendente |
| Responsável/plantão/escalonamento | — | Suporte | NÃO COMPROVADO | Decisão organizacional pendente | N/A | Pendente |
| Runbooks de incidente | Esqueleto em `docs/PHASE_9Q2B_OBSERVABILITY_INCIDENTS.md` | Suporte/Segurança | PARCIAL | Precisa validação e expansão por operação real | N/A | Pendente |

## LGPD

| Requisito | Evidência | Responsável | Status | Bloqueio | Validade | Decisão |
|---|---|---|---|---|---|---|
| Revisão LGPD completa | `docs/PHASE_9Q2B_LGPD_CHECKLIST.md` (inventário técnico, sem aprovação) | LGPD/Jurídico | BLOQUEADO — pendente de responsável humano | Nenhuma pessoa com essa responsabilidade revisou nesta sessão | N/A | Pendente |

## Integrações

| Requisito | Evidência | Responsável | Status | Bloqueio | Validade | Decisão |
|---|---|---|---|---|---|---|
| Clicksign sandbox testado | `docs/PHASE_9Q2B_INTEGRATIONS_SANDBOX_STATUS.md` | Produto/Onboarding | NÃO COMPROVADO | Sem credencial de sandbox | N/A | Pendente |
| Google Drive testado | idem | Produto/Onboarding | NÃO COMPROVADO | Sem credencial | N/A | Pendente |
| E-mail transacional | idem | Produto/Onboarding | BLOQUEADO por design | `provider: UNASSIGNED`, instalação sempre `PAUSED` | N/A | Pendente |
| Bureau/crédito | idem | Produto/Onboarding | BLOQUEADO por design | Mock explícito, sem cliente real | N/A | Pendente |
| ERP/CRM | idem | Produto/Onboarding | NÃO COMPROVADO | Sem credencial de sandbox | N/A | Pendente |

## Divergência documental registrada

`docs/PHASE_9Q_RELEASE_CONTRACT.md` §6 cita "29 migrations esperadas" — desatualizado
(real: 34, confirmado nesta sessão e na 9Q.2A). Não corrigido sem autorização de quem
mantém o contrato mestre.

## Veredito

**NENHUMA linha desta matriz recebe GO nesta sessão.** Produção permanece bloqueada por
`productionTrafficBlocked` (`src/domain/release/local-readiness.ts:27`, inalterado nesta
fase — `env.NODE_ENV === "production"` sempre bloqueia, incondicionalmente). O piloto só
pode avançar quando: (1) um ambiente cloud real existir, (2) cada linha `NÃO COMPROVADO`
tiver evidência real datada, e (3) um responsável humano por perspectiva assinar a coluna
Decisão — nenhum agente de engenharia pode preencher essa coluna.
