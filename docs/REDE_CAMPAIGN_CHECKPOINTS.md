# Campanha REDE Intelligence — 9P.3A a 10I

Início: 2026-09-05. Base: `523ed64f0a96f65ed37ef7fe4e250886f5060b5f`.
Branch inicial: `feature/fase-9p3a-clicksign`.

## Regra de avanço

Cada fase mantém implementação, QA, auditoria, migrations, backup, commit e CI identificáveis.
O checkpoint registra resultado técnico, testes efetivamente executados, Git e riscos antes do próximo.
Código validado localmente não significa integração operacional ou disponibilidade cloud.
Bloqueio externo é comunicado e impede declarar o gate correspondente concluído.

Atualização autorizada pelo usuário em 2026-09-06: adiar os ajustes/validação da API Clicksign
para o fim da campanha e prosseguir com as demais fases. A pendência REAL da 9P.3A deixa de
bloquear o desenvolvimento subsequente, mas continua impedindo declarar Clicksign operacional.
QA, auditoria, commit e CI continuam separados por fase; nenhuma evidência externa é presumida.

## Sequência solicitada

| Checkpoint | Escopo | Estado |
| --- | --- | --- |
| 9P.3A — correção bloqueadora | Evidência imutável, recuperação pelo handler, classificação do adapter e logs | Correção com QA local aprovado; publicação Git bloqueada por permissão |
| 9P.3A — smoke final | Envelope Sandbox existente, correlação e PDF final | Adiado pelo usuário para o fim; não concluído |
| 9P.3B | Google Drive | Implementado; QA e auditoria local aprovados; API real adiada; publicação por fase autorizada |
| 9P.3 — e-mail | E-mail transacional | Provedor do piloto pendente |
| 9P.4 | Bancos, conciliação, funding e bureau de crédito | Sistemas concretos dependem dos pilotos |
| 9P.5 | Sienge e CRM utilizado pelo cliente | Sistemas concretos dependem dos pilotos |
| 9Q — restante | Gates de release e operação | Aguardando |
| 9R | Repasse bancário, chaves (gates de entrega + condomínio) e assistência técnica | Contrato aprovado e implementado nesta sessão — ver seção dedicada ao final deste documento |
| 9S | Encerramento do empreendimento/SPE, governança, resultado realizado | Contrato aprovado e implementado nesta sessão — ver seção dedicada ao final deste documento |
| 10A | AI Gateway | Contrato aprovado e implementado nesta sessão (local, provider-neutral, provider disabled ativo) — ver seção dedicada ao final deste documento |
| 10B | Context Engine | Aguardando |
| 10C | Tool Layer | Diagnóstico e implementação local concluídos (branch `codex/fase-10c-tool-layer`); correção focal pós-auditoria (16/09/2026) e correção BLOQUEADORA final pós-reauditoria (ALTO-2, 16/09/2026) aplicadas — ver seção dedicada ao final deste documento; aguardando uma última reauditoria focal antes de commit/push |
| 10D | Agent Framework | Aguardando |
| 10E | Red Team 2.0 | Aguardando |
| 10F | Decision Engine | Aguardando |
| 10G | Investment Committee | Aguardando |
| 10H | REDE Operator | Aguardando |
| 10I | Autopilot | Aguardando |

A sequência 9P foi recuperada da tarefa “2 Desenvolvimento REDE Intelligence”, mensagens
`56c65957-4456-4b12-8306-0794c534c80c` e `3d9b299e-0c03-412e-af99-93f59e0d6a5b`.
A aprovação histórica define a ordem dos conectores; não define bancos, CRM ou credenciais
dos pilotos. Esses detalhes não serão inferidos como evidência de integração concluída.

## 9P.3A — registro de backup e migration

`DATABASE_URL` nesta pasta aponta para `rede_intelligence` em `127.0.0.1:55432`.
Na verificação inicial, esse banco tinha zero tabelas públicas. O arquivo de 866 bytes gerado
nessa primeira tentativa foi recusado como evidência de backup operacional. Nenhuma migration
foi aplicada nesse banco vazio.

Backup válido do banco `rede_intelligence_test`, anterior à migration:

- Arquivo local privado: `outputs/backups/2026-09-05T21-06-46-503Z-test_database_url/database.dump`.
- Manifesto: `verification.json` na mesma pasta.
- Tamanho: 38.381.856 bytes.
- SHA-256: `2f2beef1d8ef133715276bd2a99e9ac8a4467b7b177fcddea4794b134afa646e`.
- Restauração isolada: `rede_restore_51e06145fc2448adbf0deef558f454ca`.
- Verificação concluída em `2026-09-05T21:07:46.108Z`: 372 tabelas, 156.649 registros,
  contagens e fingerprints de conteúdo iguais; origem estável entre as leituras.
- As tentativas anteriores que falharam não são usadas como gate. Uma comparação inicial
  sem ordenação do resultado SQL foi corrigida antes da validação conclusiva.

A migration aditiva `20260905220000_phase_9p3a_immutable_signature_evidence` foi aplicada
ao banco de testes da porta 55432 após esse gate. Um segundo cluster de QA, na porta 55433,
recebeu a restauração do mesmo backup, com usuário `rede_app` sem privilégios administrativos.
Esse cluster mantém o nome de banco permitido pelo wrapper oficial, sem flexibilizar a proteção.

## Estado anterior à tentativa REAL de `793b92c`

O backup é de testes; não é backup de produção nem substitui a localização do banco operacional.
Na busca posterior, o executor histórico revelou que o smoke usa deliberadamente
`TEST_DATABASE_URL` da porta 55432. A leitura de `2026-09-05T21:39:24.009Z` confirmou o envelope
esperado pelo hash já registrado, solicitação `AGUARDANDO_ASSINATURAS`, uma parte `PENDING`,
ID externo presente e checksum coerente. A instalação permanece `PAUSED` e a credencial está
ausente. O bloqueio de localização foi resolvido; o token de Sandbox precisa ser fornecido
pelo prompt seguro local para o smoke real.
As credenciais e os dumps permanecem em pastas ignoradas pelo Git. Nenhuma chamada externa
de assinatura foi executada nesta correção. Os smokes descritos no contrato são históricos,
não foram repetidos nem promovidos a evidência deste checkpoint.

O executor antigo `final-stage.ts` criava um inbox sintético e foi considerado incompatível
com este checkpoint. A variante local `immutable-final-stage.ts`, com launcher
`run-immutable-final-stage.ps1`, usa reconciliação manual com origem nula, exige 31 migrations
e verifica a evidência imutável após a conclusão. Os arquivos e relatórios históricos foram
preservados. Preparar o executor não equivale a executar o smoke.

## QA local de `793b92c` — registro histórico

- Prisma validate e generate: aprovados.
- Migration deploy e seed no ambiente isolado: aprovados.
- TypeScript e ESLint: aprovados.
- Focais: 140/140 testes em 6/6 arquivos, porta 55433, saída zero.
- Wrapper oficial `pnpm test`: 954/954 testes em 114/114 arquivos, saída zero, 196,78 segundos.
- Nenhum teste removido e nenhum timeout flexibilizado. A suíte foi executada sem build concorrente.
- O primeiro build compilou, mas falhou no prerender por `NODE_ENV` não produtivo herdado
  do ambiente. A repetição usa `NODE_ENV=production` explicitamente, sem alterar `.env`.

- Build produtivo final: aprovado, 28 páginas.
- Preflight somente leitura do novo smoke manual: aprovado, sem token solicitado.
- Auditoria local: `PHASE_9P3A_REAUDIT_RECORD.md`; M1 encerrada no escopo técnico testado.
- Publicação Git: `793b92c1f576f66b0b0fe65c618d82c0e9eed1c7`, enviado para
  `origin/feature/fase-9p3a-clicksign`. CI subsequente reprovado conforme registro abaixo.

## 9P.3A — correção após gates reais

O CI [33994120122](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/33994120122)
falhou no seed: expiração fixa da reserva demonstrativa. O smoke falhou com
`PROVIDER_RECONCILIATION_UNAVAILABLE`: método omitido na composição do serviço.
Diagnóstico e limites da auditoria anterior estão em `PHASE_9P3A_REAUDIT_RECORD.md`.

Ambos foram corrigidos no mesmo checkpoint 9P.3A. Nenhuma nova migration é necessária.
O QA complementar usa banco criado vazio na porta 55434; o banco histórico da porta 55432
não recebeu seed nem testes. A tentativa REAL não foi repetida, e a ausência de credencial
permanece um bloqueio externo para a conclusão operacional.

QA complementar executado em 2026-09-05:

- Focal: **141/141 testes, 6/6 arquivos**, porta 55433, saída zero.
- Banco vazio na porta 55434: as 31 migrations aplicadas e seed concluído. Repetição do
  seed também concluída; o wrapper oficial executou novamente deploy/seed antes dos testes.
- Wrapper oficial: **955/955 testes, 114/114 arquivos**, sem skip, saída zero, 297,48 segundos.
- TypeScript: aprovado. ESLint final: aprovado, sem avisos.
- Preflight somente leitura: aprovado, sem solicitar token.
- `.env` e todas as migrations preservados. Sem migration adicional neste commit de correção.
- Build produtivo: aprovado, saída zero, 28 páginas. Git/CI da correção: pendentes.
- Gate REAL: adiado para o fim da campanha por autorização de 2026-09-06.

Logs privados: `work/9p3a-correction-focal.log`, `work/9p3a-correction-fresh-setup.log`,
`work/9p3a-correction-seed-repeat-final.log`, `work/9p3a-correction-full.log`,
`work/9p3a-correction-types.log`, `work/9p3a-correction-lint-final.log` e
`work/9p3a-correction-build.log`. A tentativa de repetição que detectou a reserva CONVERTED
foi preservada separadamente em `work/9p3a-correction-seed-repeat.log`.

## Retomada de 2026-09-06 — bloqueio de publicação

O usuário retirou o Clicksign REAL do caminho crítico de desenvolvimento e o reservou para
o fim da campanha. O build da correção terminou com saída zero; a auditoria local e o QA
ficam registrados acima. A 9P.3B tem contrato preparado em `PHASE_9P3B_GOOGLE_DRIVE_CONTRACT.md`.

O comando de preparação do commit foi recusado por falta de permissão para criar `index.lock`
nos metadados do worktree, localizados em outro diretório do repositório principal.
A política atual permite leitura do Git e não permite solicitar ampliação pelo sandbox.
Não foi criado commit da correção nem disparado novo CI. HEAD permanece `793b92c`.
O CI reprovado desse HEAD não foi substituído por uma aprovação local.

Patch revisável separado da correção: `work/9p3a-correction-reviewed.patch` (privado).
Não houve reset, mudança de worktree ou recriação de repositório para contornar a restrição.
É necessário restabelecer escrita nos metadados Git para publicar checkpoints por fase.
Preparação técnica da próxima fase não equivale a fase implementada ou aprovada.

## 9P.3B — checkpoint local validado

Base desta entrega: `0efdc72ed57be33978a2d3a06b60905424313c0c`, observada no checkout.
Implementação: transporte Drive de leitura, Meu Drive/pasta e Drive compartilhado, modos
DISABLED/MOCK/REAL, cofre, tenant/RBAC, cursor vinculado ao escopo/credencial, paginação
transacional, retomada, lease, versões preservadas, worker e interface de configuração.

- QA: 82/82 focais; 992/992 totais em 117 arquivos; tipos, lint e build aprovados.
- Banco: uma migration aditiva; 32 migrations em QA. Backup restaurado e comparado antes
  da alteração; seed também validado em banco criado vazio. Banco histórico do Clicksign intacto.
- Auditoria local e hashes: `PHASE_9P3B_AUDIT_RECORD.md`.
- Git: sem commit/push nesta entrega, conforme instrução explícita. Worktree aberto.
- Riscos: OAuth e API Google reais não exercitados; auditoria adversarial independente pendente.

Nova orientação de retomada: adiar APIs externas até o fim da Fase 10 e continuar camadas
independentes. Isso não transforma integrações pendentes em operacionais. QA e auditoria
locais continuam separados por fase; a orientação de não fazer commit/push permanece.

## Autorização atual da campanha

O usuário autorizou subsequentemente commit e CI separados por fase, sem acumular várias
fases no mesmo diff. Essa orientação substitui a retenção sem commit acima. Publicar e
verificar o SHA da 9P.3B antes de implementar a etapa seguinte.

Todas as validações reais de APIs externas ficam para o fim; contratos, interfaces
provider-neutral, DISABLED/MOCK/REAL e testes com transporte controlado entram agora.
Git/CI são os canais de publicação e verificação autorizados, não smokes dos provedores.
Na Fase 10, AI Gateway inicia em DISABLED/MOCK, Operator não executa sistemas externos reais
e Autopilot é recomendatório, exigindo aprovação humana antes de qualquer mutação.

### Bloqueio efetivo de publicação após a autorização

A permissão de escrita no Git comum e nos subdiretórios exatos do worktree foi concedida
pelo mecanismo de permissões, mas `git add` continuou recusado ao criar `index.lock`.
A tentativa de execução fora do sandbox foi rejeitada automaticamente porque a política
do ambiente desabilita `sandbox_approval`. Nenhum commit ou push da 9P.3B ocorreu;
nenhum CI novo foi disparado. Branch observada: `feature/fase-9p3b-google-drive`,
HEAD `0efdc72ed57be33978a2d3a06b60905424313c0c`.

O diff permanece exclusivamente da 9P.3B e seu checkpoint documental. Em cumprimento à
regra de não acumular fases, a próxima implementação aguarda escrita Git efetiva e CI
do checkpoint atual. Os resultados locais não são usados como substitutos do CI.

## Publicação da 9P.3B e abertura da 9P.3C

O usuário publicou `470933d67c16a0a090c24cbeefe97c9feefb7f43`. O GitHub Actions
[34062682209](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34062682209)
terminou com `success`, verificado nesta retomada. Isso supera o bloqueio histórico de
publicação da 9P.3B acima, sem transformar seu smoke REAL em aprovado.

A branch `codex/fase-9p3c-email-local` foi criada manualmente pelo usuário nessa base.
Orientação atual: implementar e auditar somente a 9P.3C, sem commit/push pelo agente.
O usuário realizará Git pelo PowerShell. Não avançar ou acumular a 9P.4 neste diff.

Contrato local: `PHASE_9P3C_TRANSACTIONAL_EMAIL_CONTRACT.md`.
QA e auditoria: `PHASE_9P3C_AUDIT_RECORD.md`.
Provedor transacional permanece não escolhido. REAL fail-closed, credenciais e todos os
smokes externos reservados à campanha final. Nenhuma evidência externa da 9P.3C produzida.

### 9P.3C — fechamento local

Implementados contratos provider-neutral, templates versionados, fila cifrada, idempotência
por tenant/instalação, RBAC persistido, rate limit de simulação, retry/dead-letter auditados,
fencing de lease/tentativa, actions e despacho pelo worker. REAL permanece fail-closed.

QA conclusivo: 51/51 focais, 1.016/1.016 totais em 119 arquivos, Prisma, seed em banco vazio,
TypeScript, ESLint, build e diff check aprovados. Nenhuma migration nova. Auditoria local
aprovada, com achados e limites registrados em `PHASE_9P3C_AUDIT_RECORD.md`.

Git: HEAD continua `470933d`, diff somente da 9P.3C, sem commit/push pelo agente.
CI da 9P.3C aguarda publicação pelo usuário. Próxima fase na sequência: 9P.4, camadas locais
de bancos/conciliação/funding/bureau, sem escolher sistemas de piloto ou executar APIs reais.
Não iniciada neste diff; avanço após publicação e verificação do checkpoint atual.

## 9P.4 — financeiro e crédito local

Base publicada pelo usuário: `2dd403419b63ee95b7514802b87a58300ac504c8`, 9P.3C.
GitHub Actions [34121184857](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34121184857)
confirmado com sucesso. Branch de trabalho fornecida: `codex/fase-9p4-local`.
O usuário mantém commit e push sob sua execução pelo PowerShell.

Escopo lido no Relatório Mestre atualizado em 05/09/2026, Apêndice D, páginas 15–17:
bancos/conciliação, bureau e FundingProvider. Contrato detalhado:
`PHASE_9P4_LOCAL_FINANCIAL_CONTRACT.md`. Auditoria e QA: `PHASE_9P4_AUDIT_RECORD.md`.

Camadas locais implementadas: contratos e transporte injetável MOCK, instalação por tenant,
RBAC persistido, fila, paginação/cursores, idempotência, rate limit, retry/dead-letter, dossiê
de funding congelado/cifrado, relatórios mínimos imutáveis e expurgo auditado. Uma migration
aditiva após backup restaurado e validado. Não alteram saldo, conciliação, crédito ou
desembolso oficiais com resultados sintéticos. REAL permanece fail-closed.

QA conclusivo aprovado: 71/71 focais, 1.044/1.044 totais em 121 arquivos, Prisma,
seed efêmero em banco vazio, TypeScript, ESLint, build e `git diff --check`.
Revisão adversarial local pelo implementador concluída, com correções e limites registrados
no relatório de auditoria; não representa auditoria independente nem validação REAL.
HEAD permanece `2dd4034`, sem commit/push. CI da 9P.4 aguarda publicação pelo usuário.
Próximo checkpoint: 9P.5, após as operações Git do usuário e confirmação do CI da 9P.4;
não iniciado neste diff, para não acumular fases.
Provedores, credenciais, chamadas, smokes e ajustes específicos de APIs externas permanecem
reservados à campanha final, após as camadas locais do programa, conforme orientação atual.

## Retomada para 9P.5 — correção do gate anterior

HEAD publicado: `e0169b701b7fc0782a41499699eef3f134dd1ea7`; branch fornecida pelo usuário:
`codex/fase-9p5-local`, inicialmente limpa. A execução
[34169846543](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34169846543)
da 9P.4 terminou reprovada: 120 arquivos passaram, mas o beforeAll da suíte financeira
procurava uma FundingProposal ausente no seed. Seus 15 testes não chegaram a executar;
1.029 testes passaram e o build foi pulado pelo CI.

A correção cria uma proposta sintética própria no preparo da suíte, sem alterar serviços,
seed ou migrations. QA em cluster novo aprovado: 15/15 testes financeiros isolados antes
de outras suítes, 71/71 focais, 1.044/1.044 totais em 121 arquivos; Prisma, deploy/seed,
TypeScript, ESLint, build e diff check aprovados. Revisão adversarial local concluída.
Detalhes e limites em `PHASE_9P4_AUDIT_RECORD.md`.
Não iniciar implementação da 9P.5 neste diff: o gate da 9P.4 precisa ser publicado pelo
usuário e aprovado no CI. Nenhum commit/push pelo agente e nenhuma API real executada.

## 9P.5 — ERP e CRM locais

Retomada autorizada pelo usuário, que informou o CI corretivo da 9P.4 verde.
Base atual: `c1511b71b7b1e760f95ff3447ecceb15168b020f`; branch fornecida:
`codex/fase-9p5-local`. O conector GitHub não retornou execução para esse SHA;
a confirmação do usuário é registrada como tal, com link independente pendente.
Essa autorização supera a pausa histórica acima para a implementação local.

Escopo: Relatório Mestre de 05/09/2026, Apêndice D, e contratos anteriores.
Contrato: `PHASE_9P5_LOCAL_ENTERPRISE_CONTRACT.md`.
QA, backup e auditoria: `PHASE_9P5_AUDIT_RECORD.md`.

Camadas implementadas: dezesseis projeções sobre entidades existentes, ERP/CRM
provider-neutral, instalação por tenant, RBAC persistido, crosswalk manual,
fila com idempotência, cursor e quarentena cifrados, rate limit, retry/dead-letter,
evidências e revisões imutáveis e expurgo auditado. Divergências não sobrescrevem
dados oficiais. REAL permanece fail-closed; nenhum fornecedor foi selecionado.

Uma migration aditiva após backup real restaurado e validado; migrations anteriores
preservadas. Credenciais, chamadas, smokes e ajustes específicos de APIs externas
permanecem para a campanha final. Não há evidência REAL nova neste checkpoint.

QA local conclusivo aprovado: 97/97 focais, 1.098/1.098 totais em 123 arquivos,
Prisma, deploy/seed efêmero, TypeScript, ESLint, build e `git diff --check`.
Auditoria adversarial local pelo implementador concluída, com limites e histórico
de correções registrados no relatório; não equivale a auditoria independente.

Fechamento Git manual pelo usuário: nenhum commit ou push pelo agente. CI da 9P.5
aguarda publicação. Próximo checkpoint na sequência: 9Q restante, sujeito ao seu
contrato e aos gates do checkpoint atual; não iniciado nem acumulado neste diff.

## 9Q.2A — Release Readiness Local

Base publicada da 9P.5: `52543782609db50d65313e08f74d6b9b961e88e9`.
GitHub Actions [34228347883](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34228347883)
confirmado com success. Branch fornecida: `codex/fase-9q2a-release-readiness-local`.
A ordem de serviço do usuário define esta divisão formal: 9Q.2A local agora;
9Q.2B para cloud e APIs reais ao final. Não se declara a 9Q.2 integral concluída.

Contrato e arquitetura: `PHASE_9Q2A_LOCAL_RELEASE_CONTRACT.md`.
Runbooks: `PHASE_9Q2A_OPERATIONS_RUNBOOK.md`.
Implantação e onboarding: `PHASE_9Q2A_PILOT_ONBOARDING_PLAN.md`.
Segurança, QA e evidências: `PHASE_9Q2A_SECURITY_QA_RECORD.md`.

Camadas locais: predeploy automatizado, manifesto de migrations e superfícies,
identidade segura, health/readiness, bloqueio produtivo, métricas por tenant,
Manual Online, ajuda contextual e confirmações auditadas de onboarding.
Nenhuma migration nova; schema e migrations anteriores preservados. Backup de QA
restaurado em banco isolado e seed em outro banco vazio efetivamente executados.

QA final: 179/179 focais em 14 arquivos; 1.130/1.130 na suíte oficial em 127
arquivos; Prisma, migration status, seed efêmero, TypeScript, ESLint, build de
28 páginas, predeploy, 14 checks HTTP locais, CSP e `git diff --check` aprovados.
Um resíduo de função temporária de teste do Drive foi encontrado em rodada intermediária;
o setup tornou-se idempotente e todas as repetições finais passaram. Auditoria local
concluída sem bloqueador no escopo 9Q.2A; não equivale a validação independente ou REAL.

Commit e push permanecem exclusivamente manuais pelo usuário. Nenhuma fase posterior
foi iniciada. Cloud, credenciais, smokes e integrações reais seguem pendentes da 9Q.2B.

## 9Q.2B — Cloud Production Readiness (preparação, sem ambiente real)

Base publicada da 9Q.2A: `f04eb740316f56618a6d39dab1d27eabe5d064d0`, CI verde
confirmado pelo usuário. Branch: `codex/fase-9q2b-cloud-production-readiness`, criada
exatamente a partir desse commit. Nenhum commit ou push foi feito pelo agente nesta fase.

Nenhum provedor cloud, região, conta, banco gerenciado, bucket ou credencial real
existiu nesta sessão. O trabalho desta fase é código e documentação preparatórios,
testáveis sem acesso externo — não execução real contra cloud.

Documentos novos: `PHASE_9Q2B_CLOUD_TOPOLOGY.md`, `PHASE_9Q2B_IAM_KMS_POLICY.md`,
`PHASE_9Q2B_SECRETS_ROTATION_PROCEDURE.md`, `PHASE_9Q2B_DEPLOY_ROLLBACK_PLAN.md`,
`PHASE_9Q2B_DB_BACKUP_PITR.md`, `PHASE_9Q2B_STORAGE_SECURITY.md`,
`PHASE_9Q2B_OBSERVABILITY_INCIDENTS.md`, `PHASE_9Q2B_INTEGRATIONS_SANDBOX_STATUS.md`,
`PHASE_9Q2B_LGPD_CHECKLIST.md`, `PHASE_9Q2B_GO_NO_GO_MATRIX.md`.

Código novo/alterado: validação de MIME/extensão/assinatura binária para a sala de
documentos (gap real encontrado — data room não tinha essa checagem, só design/BIM
tinha); gate fail-closed de alerting em produção (`ALERTING_PROVIDER`/
`ALERTING_EXTERNAL_ENDPOINT`) com transporte webhook genérico, ligado como sexto
serviço do preflight de produção; guarda pura de restauração isolada
(`assertIsolatedRestoreTarget`), reaproveitável por uma futura ferramenta de restore
cloud; três scripts PowerShell interativos gitignorados (`scripts/local/`) para
criar/rotacionar/revogar segredo no AWS Secrets Manager via `Read-Host -AsSecureString`,
sem tocar disco/argv/stdout. Nenhuma migration nova; 34 preservadas.

### Correção focal (mesmo dia): isolamento de teste, migrations locais e endurecimento

A primeira rodada desta fase terminou com 1.152/1.155 testes, 3 falhas atribuídas a
resíduo órfão no Postgres local de teste (instalações Clicksign de 2026-09-04/05 e um
`IntegrationSyncRun` do Drive obsoleto). O usuário pediu correção do isolamento sem
apagar evidência imutável, migrations locais auditadas, e endurecimento adversarial de
`alert-dispatcher.ts`/`upload-validation.ts`.

**Isolamento sem apagar evidência**: o banco `rede_intelligence_test` poluído foi
**renomeado** (não `DROP`) para `rede_intelligence_test_archived_20260904` — todo o
conteúdo, incluindo `SignatureReconciliationEvidence`, permanece intacto e acessível sob
esse nome — e um `rede_intelligence_test` novo e vazio foi criado (via role `postgres`
local, já que `rede_app` não tem `CREATEDB`). 34 migrations aplicadas do zero + seed
efêmero + suíte completa: **1.155/1.155 em 130 arquivos**, repetido em três rodadas
consecutivas sobre o mesmo banco (sem recriá-lo) para provar determinismo real, não um
acaso de banco limpo. Correções de causa raiz, não só o banco novo:
`clicksign.database.integration.test.ts` não tenta mais `DELETE` da instalação no
`afterAll` (isso já falhava por `onDelete: Restrict` de `SignatureReconciliationEvidence`
sempre que um teste anterior reconciliava uma assinatura, deixando a instalação órfã em
estado `ACTIVE`) — agora ela é sempre pausada primeiro, de forma incondicional, e a
limpeza dos filhos sem proteção de evidência é best-effort; um `try/finally` novo garante
o reset de status mesmo se a asserção do meio falhar. `prisma/seed-integrations.ts`
atualiza `lastSyncAt` da instalação Drive quando um sync anterior já existe, em vez de
deixá-lo envelhecer além da janela de 24h de freshness em bancos não recriados.
`scripts/local-release-safety.test.mjs` ganhou verificação automática de que o
manifesto de migrations bate em tamanho com o real, um caso explícito de "migration
ausente", e um teste `spawnSync` provando que `scripts/worker.ts` recusa iniciar
(exit≠0, sem tocar o banco) com configuração local inconsistente.

**Migrations no banco de desenvolvimento** (`rede_intelligence`, local): as duas
migrations pendentes da 9Q.2A (`20260907123000_phase_9p4_local_financial_evidence`,
`20260908001500_phase_9p5_enterprise_evidence`) foram aplicadas via `prisma migrate
deploy` em 2026-09-09T17:58:22-23Z, confirmado por `_prisma_migrations.finished_at`.
**Nenhum backup existia antes dessa aplicação** — registrado honestamente, não
fabricado. Um backup+restauração isolada foi executado depois (evidência do estado
atual, não da janela anterior à migration): `valid: true`, SHA-256 registrado, restaurado
em `rede_restore_57b13946...`, nunca sobre o banco de origem. 34 migrations confirmadas
no repositório; nenhuma antiga alterada.

**Documentação**: `docs/PHASE_9Q_RELEASE_CONTRACT.md` §6 citava "29 migrations
esperadas" como estado atual (divergente); corrigido para uma frase autocorretiva
("conferir sempre contra `prisma/migrations`") em vez de fixar um número que volta a
ficar desatualizado. Checkpoints históricos que citam contagens antigas (30, 31, 32, 33)
como descrição de uma fase passada não foram alterados — são registro correto do que
era verdade naquele momento.

**Preflight**: caminho inválido (`SESSION_SECRET`/`INTEGRATION_SECRET_KEY` ausentes)
reprova com `localReady:false`/exit 1, real, executado. Caminho válido com
`INTEGRATION_SECRET_KEY`/`REDE_RELEASE_SHA`/`REDE_BUILD_ID` efêmeros (não persistidos em
`.env`) aprova com `localReady:true`/exit 0, todos os 9 checks `ok`, real, executado.

**Smoke HTTP local**: servidor local real iniciado; liveness 200, readiness bloqueada
(503, causa real: `INTEGRATION_SECRET_KEY` ausente do `.env` local) e readiness válida
(200, com a chave efêmera), correlation ID aleatório e comprovadamente não controlável
pelo cliente, CSP presente. Login real via Chrome (`admin@rede.local`, acesso
demonstrativo) redirecionou para `/executivo` com dados reais; painel RBAC
`/ajuda/prontidao` renderizou para OWNER com "Migrations: 34" real; RBAC de
ANALYST/REVIEWER/VIEWER coberto por teste de integração já existente contra Postgres
real (não refeito via segunda sessão de navegador). Upload (legítimo/MIME
incompatível/executável disfarçado/magic bytes inválidos/scanner indisponível) validado
por teste real de bytes, não por clique de navegador — distinção mantida explicitamente.

**Endurecimento adversarial**: `alert-dispatcher.ts` ganhou `assertSafeAlertEndpoint` —
recusa http, userinfo na URL, porta não-443, localhost, loopback (v4/v6), link-local
(incl. metadados de nuvem 169.254.169.254), redes privadas (10/8, 172.16/12, 192.168/16)
e unique-local IPv6 — mais rejeição de redirecionamento (`redirect:"manual"`, 3xx nunca é
sucesso), `fetch` injetável, timeout já existente confirmado por teste. Achado real:
401/408/429 não eram classificados por código HTTP em `production-dependency-error.ts`
(caíam em `UNEXPECTED`) — corrigido para `MISSING_CREDENTIALS`/`TIMEOUT`/
`SERVICE_UNAVAILABLE`, beneficia todos os adapters (AWS incluído), não só alerting.
`upload-validation.ts` ganhou `assertSafeFileName`: rejeita override bidirecional
(U+202A/C/D/E, U+2066/9 — disfarce visual de extensão), caractere de controle (incl.
NUL), formato de path traversal/separador de caminho, nome vazio/>255 caracteres;
acentuação/Unicode legítimo continua aceito. 51 testes novos no total desta correção
(31 em `alert-dispatcher.test.ts`, 22 em `upload-validation.test.ts`, 19 em
`production-dependency-error.test.ts`, 7 em `local-release-safety.test.mjs`, 17 em
`production-preflight.test.ts`, todos verdes). Circuit breaker e resolução de DNS
pinada contra rebinding **não foram implementados** — riscos residuais documentados,
não uma lacuna escondida.

Nenhuma chamada real foi feita a Clicksign, Google Drive, e-mail, bureau ou ERP/CRM —
sem credencial disponível. Scanner antimalware de produção confirmado sem adapter real
(bloqueador pré-existente, não fabricado nesta fase). Produção permanece bloqueada por
`productionTrafficBlocked`, inalterado. Revisão LGPD preparada, não aprovada — sem
responsável humano nesta sessão. Matriz Go/No-Go: nenhuma linha recebeu GO.

**Classificação final desta fase: preparação local para Cloud Production Readiness.**
Cloud real, deploy real, rollback real, PITR real, alertas com destino real e smokes
contra integrações externas reais permanecem integralmente pendentes — não declarados,
não fabricados. Suíte final desta correção: 1.206/1.206 em 130 arquivos.

Commit e push permanecem exclusivamente manuais pelo usuário. Nenhuma fase posterior
(9R, 9S, Fase 10) foi iniciada. Zero staged; worktree aberto para reauditoria.

### Correção focal final (mesmo dia): SSRF, DNS rebinding, call sites produtivos

A reauditoria adversarial anterior encontrou um bypass real de SSRF (IPv4 embutido em
IPv6 em `assertSafeAlertEndpoint`) e a ausência de qualquer call site produtivo do
alerting. Esta rodada corrige exatamente os seis achados dessa auditoria, sem tocar
migrations, `.env`, banco arquivado ou schema.

**B1 — IPv4 embutido em IPv6**: `alert-dispatcher.ts` ganhou expansão numérica completa
do endereço IPv6 canônico (8 grupos de 16 bits) e reconhece as três formas de embutir um
IPv4 (mapeado `::ffff:0:0/96`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`), extraindo e
revalidando o IPv4 interno com a mesma política do IPv4 direto — além de multicast,
reservado (`240.0.0.0/4`) e CGNAT (`100.64.0.0/10`), que também faltavam. Um bug de
offset (`::ffff:0:0/96` checado no grupo errado) foi encontrado pela própria bateria de
testes nova, corrigido, e reconfirmado.

**B2 — DNS rebinding/TOCTOU**: sem dependência nova. `alert-dispatcher.ts` trocou `fetch`
por `node:https` + `node:dns/promises`: resolve todos os registros A/AAAA, valida **cada
um** com a mesma política, recusa se qualquer endereço resolvido for proibido (mistura
público+privado incluída), e conecta pinado no endereço já validado — nunca resolve de
novo entre validar e conectar. O hostname original é preservado como `Host` e como SNI
(`servername`), então a verificação de certificado TLS continua contra o hostname real,
nunca contra o IP; `rejectUnauthorized` nunca é tocado. Resolver e executor HTTP são
injetáveis — nenhum teste faz DNS ou rede real.

**Circuit breaker mínimo**: em memória, por instância de transporte — abre após N falhas
consecutivas, suprime tentativas durante o cooldown, fecha sozinho se a tentativa após o
cooldown tiver sucesso. Relógio injetável; testado sem espera real.

**A1 — call sites produtivos**: antes desta correção, nada no código de aplicação chamava
o alerting. Agora: `job-runner.ts::failJob` emite um alerta `DEAD_LETTER` depois do commit
da transação (ponto único, cobre todos os tipos de job); `clicksign-service.ts` (2 pontos)
e `import-service.ts` (1 por importação, não 1 por linha rejeitada — evita tempestade)
emitem `QUARANTINE`; `scripts/worker.ts` emite `WORKER_FATAL` no `catch` fatal do
processo. Todos via `src/application/observability/operational-alerts.ts` (novo):
dedup de 5 min por categoria+código+tenant (tenant sempre como hash SHA-256, nunca o ID
bruto), rate limit de 10/min por categoria+tenant, nunca lança (falha de transporte é
logada sanitizada e contabilizada, nunca desfaz a transação de origem), payload restrito
a categoria/severidade/timestamp/correlationId/tenantRef/código/ambiente/releaseId — sem
PII, payload de integração ou conteúdo de documento.

**M1**: `PHASE_9Q2B_DB_BACKUP_PITR.md` reescrito — não diz mais que a divergência do
contrato mestre está pendente (já foi corrigida); registra estado atual (34) e a ausência
real do backup pré-migration sem reescrever isso como resolvido.

**M2 (texto original desta correção — corrigido abaixo em "Correção pós-reauditoria
REPROVADA": a afirmação de que `DATABASE_URL` e `backup-local-database.mjs` já estavam
cobertos era falsa; ver adiante)**: banco arquivado documentado sem ambiguidade — nome
atual `rede_intelligence_test_archived_20260904`, arquivamento real em 2026-09-09 (não
2026-09-04; o sufixo é a data do resíduo mais antigo, não da ação de arquivar).

**B3**: `assertSafeFileName` agora rejeita nomes reservados do Windows
(CON/PRN/AUX/NUL/COM1-9/LPT1-9, com ou sem extensão) e nome terminado em ponto ou espaço.

**Regressão HTTP**: os 13 arquivos de teste de todos os adapters citados (Clicksign,
Google Drive, e-mail, financial providers, enterprise/ERP-CRM, worker) — 253/253 testes —
reconfirmados verdes sem nenhuma mudança de comportamento além da nova classificação de
401/408/429 em `production-dependency-error.ts` (também usada por AWS Secrets
Manager/KMS). Confirmado por leitura de código: nada no repositório usa essa
classificação para decidir retry automaticamente hoje — é só informativa para o operador
— então a mudança não pode reabrir retry infinito nem duplicar efeito colateral.

**QA final desta correção**: `prisma validate`/`generate`/`migrate status` (banco de
teste oficial) aprovados; TypeScript e ESLint limpos (zero erro, zero warning); preflight
inválido (exit 1) e válido com config efêmera (exit 0, 9/9) reexecutados; build produtivo
aprovado; suíte completa **1.263/1.263 em 130 arquivos, repetida duas vezes consecutivas
sobre o mesmo banco de teste sem recriá-lo**; `git diff --check` aprovado.

**Riscos residuais explicitamente não resolvidos**: proteção de tamanho de cabeçalho HTTP
de resposta (camada abaixo do meu código); nenhum destino de alerta real foi contratado
(o gate e os call sites existem, mas `ALERTING_PROVIDER` nunca é `external` nesta sessão);
scanner antimalware de produção sem adapter real; nenhuma integração externa testada.

Commit e push permanecem exclusivamente manuais pelo usuário. Nenhuma fase posterior
foi iniciada. Zero staged; worktree aberto para nova reauditoria.

### Correção pós-reauditoria REPROVADA (mesmo dia): DATABASE_URL sem proteção, achados residuais de B1/B2/A2, logger, quarentena

A reauditoria adversarial seguinte à correção acima **reprovou** a preparação local,
com 1 achado Bloqueador e 3 Altos. Este bloco documenta a correção desses achados — a
seção "M2" acima, escrita na rodada anterior, estava **errada**: afirmava que
`DATABASE_URL` e `backup-local-database.mjs` já usavam a guarda contra banco arquivado;
na prática, `assertNotArchivedDatabase` só era alcançável por `assertTestDatabaseUrl`
(exclusivo de `TEST_DATABASE_URL`), e `backup-local-database.mjs` tinha uma checagem
`/archived/i` duplicada e independente. Essa divergência entre documentação e código é
o próprio achado M1 desta rodada.

**Bloqueador corrigido — `DATABASE_URL` sem proteção nenhuma**: `scripts/database-url-safety.mjs`
passa a ser a única fonte da checagem (`assertNotArchivedDatabase`), com dois reforços:
(1) o radical `/archiv/i` — cobre `archived`/`archive`/`archival` e qualquer
prefixo/sufixo/separador, em vez de só a palavra exata `archived`; (2) fail-closed real —
URL inválida, percent-encoding malformado ou entrada não textual agora **bloqueiam**
(antes, uma URL inválida passava sem checar). A guarda está conectada em todos os pontos
exigidos, sem cópia duplicada:
- `src/infrastructure/config/runtime-config.ts::parseRuntimeConfig` — valida `DATABASE_URL`
  logo após o schema zod, antes de qualquer outra etapa de boot (web, worker, preflight).
- `src/infrastructure/database/prisma.ts` — valida `process.env.DATABASE_URL` no escopo do
  módulo, antes de `new PrismaClient(...)` — é o choke point real: qualquer código que
  precise do banco importa este módulo, cobrindo web e worker mesmo que algum chamador não
  passe por `parseRuntimeConfig` primeiro.
- `src/infrastructure/release/restore-safety.ts::assertIsolatedRestoreTarget` — valida
  origem e destino de qualquer ferramenta de restauração (local hoje, cloud quando existir
  um alvo gerenciado real).
- `scripts/backup-local-database.mjs` — a checagem inline duplicada foi removida; agora
  importa e chama `assertNotArchivedDatabase` diretamente, antes de `mkdirSync`/`pg_dump`/
  `createdb`/`pg_restore`.
- `assertTestDatabaseUrl` (`TEST_DATABASE_URL`, `run-tests.mjs`/`vitest.config.ts`)
  continua protegida, sem alteração de comportamento externo.

Verificado por subprocesso real (não só a função isolada):
`scripts/local-release-safety.test.mjs` agora spawna `backup-local-database.mjs` e
`worker.ts` de verdade com `DATABASE_URL` arquivada e confirma exit≠0, mensagem "arquivado"
e nenhum vazamento de credencial em stdout/stderr.

**B1 residual corrigido — IPv4-translated**: `isUnsafeIPv6` não cobria
`::ffff:0:a.b.c.d` (RFC 2765/SIIT — distinto do IPv4-mapped porque `0xffff` está no
grupo 4, não no grupo 5). `[::ffff:0:127.0.0.1]` e `[::ffff:0:169.254.169.254]` agora são
recusados na Camada 1 (literal) e na Camada 2 (resolvido via DNS). Nota de exploração
real: diferente do IPv4-mapped padrão, esta forma não tem tradução automática pelo
socket do SO em stacks modernos — o fechamento é por completude da política declarada
("todas as formas conhecidas"), não porque havia uma rota de exploração viva confirmada.

**B2 residual corrigido — resposta DNS family=4 malformada fail-open**: `resolveSafeAddress`
chamava `isUnsafeIPv4Parts` direto sobre `record.address.split(".").map(Number)` — um
endereço não numérico produzia `NaN`, e toda comparação de faixa com `NaN` é `false`,
então a resposta malformada era tratada como seguro. Novo `parseCanonicalIPv4` exige
exatamente 4 grupos decimais 0-255, sem zero à esquerda, sinal, espaço, hexadecimal,
forma decimal inteira ou dígito Unicode fora de ASCII — qualquer coisa fora desse
formato (incluindo `family` diferente de 4 ou 6, ou um registro incompleto/hostil) é
recusada antes de chegar à política de rede. Não explorável pelo resolver real de
produção (`dns.lookup` sempre devolve `family=4` bem formado), mas fecha o contrato
"fail-closed" para qualquer `DnsResolver` injetado — a interface é declaradamente
plugável.

**A2 corrigido — circuit breaker sem exclusão de probe no half-open**: o breaker anterior
computava "aberto?" como função pura do tempo decorrido — qualquer número de chamadas
concorrentes no instante em que o cooldown expirava passava junto. Reescrito como máquina
de 3 estados (`CLOSED`/`OPEN`/`HALF_OPEN`): a primeira chamada síncrona depois do cooldown
reivindica `HALF_OPEN` e é a única sonda; qualquer outra chamada da mesma leva —
inclusive sob `Promise.all` real — encontra o estado já reivindicado e é suprimida, nunca
uma segunda sonda. Sucesso único fecha; falha única (da sonda) reabre com cooldown fresco.
Durante a implementação, o próprio teste de concorrência (`Promise.all`) expôs um bug
real: `beforeAttempt()` estava dentro do mesmo `try/catch` que chama `onFailure()`, então
uma tentativa *suprimida* (que nunca toca a rede) também contava como uma nova falha e
derrubava o half-open prematuramente — corrigido movendo `beforeAttempt()` para fora do
try/catch. O estado persiste no reporter cacheado em `operational-alerts.ts`
(`cachedReporter`, inalterado nesta rodada) — sem essa persistência entre chamadas, o
breaker nunca abriria de verdade.

**Logger endurecido**: `sanitizeString` ganhou padrão de telefone BR (formatado e não
formatado, sem apagar números pequenos legítimos — CEP, valores monetários, contadores),
padrão de JWT "nu" (heurístico `eyJ...` sem exigir prefixo `bearer`/`token:`), e passou a
redigir `organizationId`/`installationId`/`inboxId`/`userId` quando aparecem como
`chave=valor`/`chave: valor` em **texto livre** (antes só chaves de objeto estruturado
eram cobertas). `sanitizeLogValue` de `Error` agora inclui e sanitiza `.cause`
recursivamente. Decisão preservada de propósito: como CHAVE de objeto estruturado em log
interno, esses IDs continuam visíveis (depuração operacional) — só o payload externo de
alerta usa `tenantRef` hasheado; o logger geral não substitui essa allowlist.

**Idempotência da quarentena Clicksign (item 9)**: `claimNextJob` reivindica de novo
qualquer `IntegrationJob` `RUNNING` cuja lease expirou ("recuperação de worker morto" —
cenário real e deliberado do desenho de fila, não hipotético). Se um worker cair depois
de `quarantineAndMark` marcar o inbox como `QUARANTINED` mas antes de `completeJob`, o
mesmo job é reexecutado; sem guard, a segunda execução duplicaria o
`IntegrationQuarantineItem`. `processClicksignWebhookJob` agora trata `QUARANTINED` como
status terminal (ao lado do `PROCESSED` já existente) — sem nova migration, sem
find-before-create sujeito a corrida: só usa a identidade já persistida
(`inbox.status`). Teste de integração novo em
`contract-closing.database.integration.test.ts` reprocessa o mesmo job 3x sobre um evento
sem `ExternalEntityReference` correspondente e confirma exatamente 1 item de quarentena.

**Dedup de importação (item 10) — decisão explícita, não mais implícita**: a chave de
dedup permanece tenant+categoria+`code` (não inclui execução/`correlationId`) —
documentado agora diretamente em `operational-alerts.ts` e testado em
`operational-alerts.test.ts` ("dedup por tenant+categoria+code, não por execução"): duas
importações distintas do mesmo `capability` para o mesmo tenant dentro da janela de 5 min
geram só 1 alerta, de propósito (é a proteção anti-tempestade herdada da 9Q.2A —
`import-service.ts` já limita a 1 alerta por importação, não por linha).

**Teste oficial de dedup de 5 min (item 8)**: adicionado a `operational-alerts.test.ts`
(antes só verificado por sonda manual fora da suíte) — primeira emissão ocorre, repetição
dentro da janela é suprimida, emissão após expiração volta a ocorrer, categorias/tenants
diferentes não colidem, relógio sempre injetado (sem espera real).

**QA desta rodada**: `prisma validate` aprovado; `tsc --noEmit` limpo; `eslint .` limpo;
34 migrations confirmadas, nenhuma alterada. Suíte oficial completa (`pnpm test`,
`prisma migrate deploy`/`db seed`/`vitest run` contra o PostgreSQL local de teste) **não
executada nesta sessão até o Postgres local ser iniciado explicitamente pelo operador**
— ver o registro de QA desta correção para os números reais capturados antes e depois de
subir o cluster local, incluindo os arquivos de teste que dependem de banco (ex.: o teste
de idempotência da quarentena Clicksign acima, que não pôde ser executado nesta sessão e
está marcado como tal). Nenhum teste pulado foi tratado como aprovado.

**Riscos residuais explicitamente não resolvidos**: os mesmos da rodada anterior (sem
destino de alerta real contratado, scanner antimalware de produção sem adapter real,
nenhuma integração externa testada), mais: proteção de homóglifo Unicode multi-idioma
para o radical "archiv" não implementada (fora de escopo — nenhum nome de banco legítimo
usa outro alfabeto); `quarantineDuplicateConflict` (Clicksign, conflito de payload) mantém
um TOCTOU estreito de find-before-create sob redelivery externa quase simultânea do
provider — não corrigido nesta rodada por não ter sido demonstrado como estruturalmente
alcançável, ao contrário do caminho de `quarantineUnknown` corrigido acima.

**A 9Q.2B integral, o piloto e a produção continuam pendentes.** Esta correção fecha os
achados da reauditoria REPROVADA sobre a preparação LOCAL — nada aqui declara cloud,
PITR, alertas reais, scanner de produção, integrações externas ou Go/No-Go como
comprovados.

Commit e push permanecem exclusivamente manuais pelo usuário. Nenhuma fase posterior foi
iniciada. Zero staged; worktree aberto para nova reauditoria adversarial.

## Fase 9R — Repasse, Chaves e Assistência Técnica (branch `codex/fase-9r`, HEAD-base `69d00f0e1207d0e3b2cab4118695d977bd50f29c`)

Escopo recuperado do Relatório Mestre (`work/master-report.txt`, não inventado — o
repositório só registrava "9R aguarda contrato detalhado") e formalizado em
`docs/PHASE_9R_CONTRACT.md`, aprovado com 5 decisões definitivas do usuário
(nomenclatura `BankFinancingDisbursement`, `CondominiumSetup` mantido, gate jurídico
consumindo `LegalLicense`/9D só por referência e snapshot agregado, portal do cliente
fora do escopo). Implementação completa nesta sessão — detalhe técnico, achados da
revisão adversarial própria e QA completo em `docs/PHASE_9R_AUDIT_RECORD.md`.

Resumo: repasse bancário (criação → solicitação → liberação → conciliação, gerando o
`ReceivablePayment` oficial via 9B/9E, nunca uma segunda contabilidade), gate de
entrega técnico+jurídico+financeiro combinado (`markUnitDelivered` estendida, 9E),
implantação de condomínio (evento único, estados terminais protegidos), assistência
técnica estendida (fornecedor, custo, reincidência, evidência com checksum, SLA
sempre derivado). Duas entidades novas apenas (`BankFinancingDisbursement`,
`CondominiumSetup`); todo o resto reaproveitado de 9B/9C/9E, confirmado por teste
arquitetural. Uma migration aditiva única, aplicada só após backup real verificado
(dev e teste, ambos restaurados em banco isolado e validados antes da migration).

QA: 134 arquivos, 1374 testes, 0 falhas (suíte oficial, repetida sem recriar o banco);
TypeScript/ESLint limpos; build aprovado (40 rotas, nenhuma nova); preflight inválido
recusado; `git diff --check` aprovado. 50 testes novos da 9R (unitários puros +
integração PostgreSQL real, incluindo RBAC/IDOR, concorrência/idempotência real do
repasse, e o teste arquitetural de ausência de domínio paralelo).

**9S (encerramento, governança, resultado realizado) e Fase 10 (IA/agentes) não foram
iniciadas.** Nenhuma API externa, cloud real ou credencial real foi usada nesta fase.
Commit e push permanecem exclusivamente manuais pelo usuário. Zero staged; worktree
aberto para auditoria independente.

### Correção focal pós-reauditoria da 9R (2026-09-10)

Uma reauditoria adversarial independente (só leitura) sobre a implementação acima
devolveu **REPROVADO**: 1 achado Alto (gate técnico de entrega reaproveitava uma
vistoria antiga aprovada em vez da mais recente) e 4 achados Médio (TOCTOU entre a
leitura dos gates de entrega e o commit; trilha de auditoria sem `correlationId`/
estado anterior; imutabilidade de `RECONCILED`/`IMPLEMENTED`/`CANCELLED` só na
aplicação, sem espelho no banco; `P2002` tratado genericamente na conciliação
concorrente). Todos os cinco foram corrigidos com mudança de código real e teste real
contra PostgreSQL nesta sessão — detalhe completo, honesto e por achado em
`docs/PHASE_9R_AUDIT_RECORD.md` §8.

A migration original da 9R (`20260910131423_phase_9r_repasse_chaves_assistencia`) não
foi editada. A proteção estrutural entrou por uma segunda migration aditiva
(`20260910151500_phase_9r_structural_immutability`, triggers condicionais de
imutabilidade + `TRUNCATE` bloqueado, mesmo padrão de
`20260905220000_phase_9p3a_immutable_signature_evidence`), aplicada só após backup
real de dev e teste com SHA-256/horário registrados e restauração validada em banco
isolado — ver tabela em `docs/PHASE_9R_AUDIT_RECORD.md` §8.4.

QA desta correção: 134 arquivos, **1402 testes**, 0 falhas (suíte oficial, repetida
sem recriar o banco); TypeScript/ESLint limpos; build aprovado (39 rotas, nenhuma
nova); preflight inválido recusado; `git diff --check` aprovado. 23 testes novos desta
correção (9 gate técnico + 6 TOCTOU/concorrência real + 3 P2002 + 5 imutabilidade
estrutural, incluindo SQL bruto e `TRUNCATE`); total da 9R passou de 50 para **78
testes**.

Branch `codex/fase-9r` e HEAD-base `69d00f0e1207d0e3b2cab4118695d977bd50f29c`
preservados. **9S e Fase 10 continuam não iniciadas.** Nenhuma API externa, cloud real
ou credencial real foi usada. Nenhum commit, push, merge, rebase ou tag foi executado
nesta correção. Zero staged; worktree aberto para reauditoria focal independente.

### Correção focal de CI da 9R (2026-09-10) — `prisma db seed` falhava no GitHub Actions

Após a reauditoria focal acima, o trabalho da 9R foi commitado
(`d829725 feat: add phase 9R handover and post-sale operations`) e o primeiro run do
CI (`.github/workflows/ci.yml`, contra um Postgres genuinamente vazio) falhou em
`prisma db seed`: `Entrega bloqueada — técnico: SEM_EVIDENCIA (Nenhuma vistoria
registrada para esta venda.)`. Causa real: `prisma/seed.ts` marcava a unidade
demonstrativa `TOR-A-1301` como entregue usando uma `SalesUnitInspection` com
`scheduledAt` fixo no calendário (`"2026-09-20"`) — o gate técnico corrigido na
reauditoria acima corretamente ignora vistoria futura, e localmente o problema nunca
apareceu porque os bancos dev/teste já tinham a unidade `ENTREGUE` de uma execução
anterior (guard idempotente do seed nunca reexecutava o gate de verdade). Detalhe
completo, honesto, em `docs/PHASE_9R_AUDIT_RECORD.md` §9.

Correção exclusiva em `prisma/seed.ts` — `scheduledAt` passou a ser calculado
relativo ao instante real de execução do seed (sempre "ontem", nunca fixo/obsoleto),
a vistoria ganhou um marcador explícito (`_seedFixture`) e a busca idempotente passou
a filtrar por `organizationId` explicitamente. **Nenhuma linha de
`markUnitDelivered`, do gate técnico, schema ou migration foi tocada** — o gate
permanece exatamente como a reauditoria o corrigiu, sem bypass, fallback ou aprovação
automática. Teste novo (`prisma/seed.database.integration.test.ts`, 4 testes) roda o
seed real contra um banco Postgres físico isolado e descartável, 36 migrations
aplicadas do zero — reproduzindo o cenário exato do CI — e confirma idempotência,
snapshot com os três gates `APTO`, recusa em produção e isolamento de tenant.

QA: 135 arquivos, **1406 testes**, 0 falhas (suíte oficial, repetida sem recriar o
banco); TypeScript/ESLint limpos; build aprovado (39 rotas); `git diff --check`
aprovado; **36 migrations inalteradas**. Branch `codex/fase-9r`, HEAD
`d829725396542b90e96cddb4b2b195606395df40` preservados. Nenhuma API externa, cloud
real ou credencial real foi usada. Nenhum commit, push, merge, rebase ou tag foi
executado. Zero staged; worktree aberto para a correção ser revisada.

## Fase 9S — Encerramento do Empreendimento, Governança e Resultado Realizado (branch `codex/fase-9s`, HEAD-base `f339ad0f2a9f11322a906d09f40f85e8a2db5725`)

Escopo recuperado do Relatório Mestre (seções 27, 28, 45, 46, 53) e do próprio
contrato da 9R (`docs/PHASE_9R_CONTRACT.md` §8, que já definia a fronteira entre as
duas fases), formalizado em `docs/PHASE_9S_CONTRACT.md`, aprovado com 8 decisões
definitivas do usuário (sem `DISSOLVED` em `CompanyStatus` — decisão societária só
via `LegalDecision`, nunca baixa real; `VIEWER` sem `CLOSURE_READ`; reabertura só
`OWNER`; regras exatas de assistência impeditiva; `SEM_EVIDENCIA` bloqueando campos
centrais; aportes/devoluções só via `ProjectClosureDistribution`; nomes definitivos
`ProjectClosureResult`/`ProjectClosureDistribution`; distribuição simples sem
waterfall). Implementação completa nesta sessão — detalhe técnico, achados da
revisão adversarial própria e QA completo em `docs/PHASE_9S_AUDIT_RECORD.md`.

Resumo: gate de encerramento com 5 subgates puros (operacional/9R, contratual/9C,
jurídico/9D, financeiro/9B, contábil/9G, mesmo formato `APTO/PENDENTE/SEM_EVIDENCIA`
já validado pela 9R); resultado realizado final reaproveitando `RevenueRecognitionRun`,
`TaxAssessment`, `AccountingProvision`, `FundingDisbursement` e a convenção
`documentRef` de `external-obligation-port.ts` — nenhum valor fabricado, ausência
real de fonte fica `SEM_EVIDENCIA` explícito; encerramento contábil reaproveitando
`AccountingPeriod`/`FinancialPeriodClosure` sem reabrir esse mecanismo; checklist de
encerramento societário reaproveitando `LegalDueDiligenceCase`/`LegalDecision` (9D);
distribuição final simples sem movimentação bancária real; reabertura só `OWNER`,
com nova versão vinculada (`supersedesId`) que nunca sobrescreve o snapshot `FINAL`
anterior (protegido por trigger de imutabilidade desde a migration original, sem
precisar de uma correção posterior como na 9R). Duas entidades novas apenas
(`ProjectClosureResult`, `ProjectClosureDistribution`); todo o resto reaproveitado,
confirmado por teste arquitetural. Uma migration aditiva única (já incluindo os
triggers de imutabilidade), aplicada só após backup real verificado (dev e teste,
ambos restaurados em banco isolado e validados antes da migration).

QA: 138 arquivos, **1487 testes**, 0 falhas (suíte oficial, repetida sem recriar o
banco); TypeScript/ESLint limpos (0 avisos); build aprovado (39 rotas, nenhuma nova —
sem UI nesta fase); preflight inválido recusado; `git diff --check` aprovado. 81
testes novos da 9S (49 unitários puros + 32 de integração PostgreSQL real, incluindo
RBAC/IDOR, concorrência real na aprovação, imutabilidade via SQL bruto, e o teste
arquitetural de ausência de domínio paralelo). Revisão adversarial própria encontrou
e corrigiu 5 achados durante a implementação (destaque: consulta de tributos
acumulava valores de outros projetos da mesma empresa por falta de filtro por
`projectId` — corrigida antes deste registro).

**Fase 10 (IA/agentes) não foi iniciada.** Nenhuma API externa, cloud real ou
credencial real foi usada nesta fase. Nenhum commit, push, merge, rebase ou tag foi
executado. Branch `codex/fase-9s` e HEAD-base
`f339ad0f2a9f11322a906d09f40f85e8a2db5725` preservados. Zero staged; worktree aberto
para auditoria independente.

### Correção pós-reauditoria REPROVADA da 9S

Uma auditoria adversarial independente reprovou a entrega acima: 1 Bloqueador (gate
jurídico liberava com qualquer `LegalDecision`, inclusive `DO_NOT_PROCEED`, por
checar só a existência da decisão, nunca seu valor), 2 Altos (previsto×realizado
nunca implementado apesar de descrito acima — `financialResultId`/
`forecastEvaluationIds` sempre `null`; distribuição `APPROVED` sobrevivia a um
recálculo do `ProjectClosureResult` `DRAFT` que a originou) e 2 Médios
(`LegalChecklistItem`/`LegalDocumentRequest` nunca lidos pelo gate;
`AccountingPeriod` `CLOSED` aceito sem o `LedgerSnapshot` que o sustenta). Todos os
seis corrigidos nesta sessão — causa, correção, testes e QA completos em
`docs/PHASE_9S_AUDIT_RECORD.md` §8 e `docs/PHASE_9S_CONTRACT.md` §18. Nenhuma
migration nova (os dois campos do achado de previsto×realizado já existiam no
schema); suíte oficial após a correção: 137 arquivos, **1536 testes**, 4 skipped,
0 falhas. Fase 10 continua não iniciada; nenhum commit/push executado.

### Correção focal final após segunda reauditoria REPROVADA da 9S

Uma segunda auditoria adversarial reprovou a correção acima por dois motivos: o
guard contra recalcular um `DRAFT` com distribuição já `APPROVED` era um
check-then-act sem transação (contagem e escrita em chamadas separadas —
TOCTOU real, reproduzido pela auditoria); e `LegalChecklistItem`/
`LegalDocumentRequest` `CANCELLED` continuavam liberando o gate jurídico sem
revisor nem justificativa. Ambos corrigidos nesta sessão: o guard agora roda
dentro de uma única transação `Serializable` (releitura + CAS +
`ForecastEvaluation`/`AuditLog` atômicos), com retry limitado exclusivamente a
`P2034` e erro classificado (`reasonCode` + `correlationId`) em qualquer outra
recusa; checklist e documentos passam a ser avaliados por regras próprias de
cada modelo, e `CANCELLED` nunca é evidência positiva para nenhum dos dois,
com ou sem revisor. Nenhuma migration nova. A autorrevisão adversarial (corrida
real repetida contra PostgreSQL, sem mocks) encontrou e corrigiu um bug real:
no esgotamento do retry, um `P2034` bruto do Prisma escapava sem classificação
— corrigido nos dois serviços envolvidos. Suíte oficial após a correção: 137
arquivos, 1 skipped (pré-existente da 9R, sem relação com a 9S), **1556
testes**, 4 skipped, 0 falhas. Detalhe completo em
`docs/PHASE_9S_AUDIT_RECORD.md` §9 e `docs/PHASE_9S_CONTRACT.md` §19. Três
organizações sintéticas (`reaudit-race-*`), resíduo da auditoria anterior,
seguem preservadas no banco compartilhado (protegidas por trigger de
imutabilidade genuíno) — confirmadas por leitura, não apagadas. Fase 10
continua não iniciada; nenhum commit/push executado.

### Última correção focal da 9S — determinismo do teste e validade da evidência jurídica

Uma reauditoria seguinte encontrou dois pontos residuais na correção acima: um
teste de concorrência intermitente (regex case-sensitive contra uma mensagem
"Não..." — bug do teste, não da implementação) e a classificação do achado
CANCELLED como "informativo" quando, na prática, `documentLinkId`/
`evidenceDocumentIds` nunca poderiam ser tratados como evidência real, pois
**nenhuma entidade canônica de documento existe em todo o schema** para
`LegalDueDiligenceCase`/`LegalDocumentRequest` (o mesmo campo livre sem FK se
repete, sem uso, em quatro modelos da 9D). Corrigido nesta sessão: o teste
agora valida classe do erro/`reasonCode`/`correlationId` (10/10 execuções
individuais + 5/5 da suíte focal sem intermitência); o gate jurídico passou a
tratar `LegalDocumentRequest.RECEIVED` e `LegalChecklistItem.evidenceDocumentIds`
como estruturalmente inverificáveis (nunca produzem `APTO`) — **sem nenhuma
migration nova**; a lacuna estrutural para uma prova real de evidência
documental está registrada e aguarda autorização explícita. Suíte focal:
158 testes, verde de forma estável. Detalhe completo em
`docs/PHASE_9S_AUDIT_RECORD.md` §10 e `docs/PHASE_9S_CONTRACT.md` §20. Fase 10
continua não iniciada; nenhum commit/push executado; organizações sintéticas
residuais preservadas.

### Correção estrutural final — evidência jurídica canônica

A lacuna estrutural registrada na correção anterior (nenhuma entidade canônica
de documento existia para provar `LegalDocumentRequest`/`LegalChecklistItem`)
recebeu autorização explícita para **uma única migration aditiva**. Criada
`LegalEvidenceDocument` (design em `docs/PHASE_9S_CONTRACT.md` §21, escrito
antes da migration): FKs `RESTRICT` para organização/projeto/caso, vínculo
exatamente único (solicitação documental XOR item de checklist, por `CHECK`),
trigger de validação cruzada de tenant/caso, e imutabilidade condicional
(`PENDING_REVIEW` mutável; `VERIFIED` só permite a transição para `REVOKED`,
preservando o snapshot original via protected-column-diff; `REJECTED`/
`REVOKED` totalmente imutáveis; `TRUNCATE` sempre bloqueado) — mesmos padrões
já aprovados em 9P.3A/9R. Novo serviço dedicado
(`legal-evidence-service.ts`: registrar, verificar, recusar, revogar,
consultar — RBAC, segregação uploader≠revisor, CAS `Serializable`,
idempotência, `AuditLog` atômico) e o gate 9S (`gates.ts`/
`closure-gate-service.ts`) passou a consultar evidência `VERIFIED` real em vez
de confiar em `documentLinkId`/`evidenceDocumentIds` — `RECEIVED` com evidência
canônica agora pode genuinamente satisfazer o gate, e itens de checklist
`HIGH`/`CRITICAL` passam a exigir a mesma prova. Nenhum dado legado foi
migrado automaticamente; registros existentes seguem `SEM_EVIDENCIA` até
receberem evidência real. Dois backups reais (dev + teste) verificados antes
da migration (`sha256` e `restoredContentMatches: true` registrados em
`docs/PHASE_9S_AUDIT_RECORD.md` §11.4); as 37 migrations anteriores seguem
byte-idênticas; esta é a 38ª. A autorrevisão adversarial encontrou e corrigiu
um bug real de código: `rejectLegalEvidenceDocument` lançava sua validação de
motivo vazio de forma síncrona antes de delegar à função `async`, escapando
como exceção em vez de Promise rejeitada. Detalhe completo em
`docs/PHASE_9S_AUDIT_RECORD.md` §11 e `docs/PHASE_9S_CONTRACT.md` §21. Suíte
oficial completa após a correção: 138 arquivos (1 pulado, pré-existente e sem
relação), **1.595 testes**, 4 skipped, 0 falhas. Fase 10 continua não
iniciada; nenhum commit/push executado; organizações sintéticas residuais
preservadas.

### Correção final pós-auditoria da 9S — redação e idempotência estrutural

Duas auditorias adversariais independentes sobre a correção acima reprovaram
por dois achados Altos — nenhum bypass de tenant/RBAC/IDOR encontrado, a
superfície estrutural (migration/triggers/constraints) se manteve sólida: (1)
o `AuditLog` de evidência jurídica expunha `checksum` e `storageKey`
completos (e, num levantamento mais fino, também o motivo de recusa/
revogação em texto livre); (2) `registerLegalEvidenceDocument` não tinha
garantia estrutural de idempotência — só um `findFirst` antes do `create`,
sem constraint — e 5 chamadas concorrentes idênticas reproduzidamente
criavam 5 linhas distintas. Ambos corrigidos nesta sessão. Redação: helper
central único produz `evidenceRef` (SHA-256 truncado a 16 hex, determinístico
e não reversível porque o checksum tem alta entropia) em vez do valor bruto,
reaproveitado por register/verify/reject/revoke — nenhuma redação divergente
entre os quatro caminhos; `storageKey` nunca mais entra no `AuditLog` em
nenhuma forma. **Correção posterior necessária (ver "Correção crítica final"
abaixo): esta versão também aplicou a mesma técnica de hash ao motivo livre**
(`reasonRef`), premissa que se provou falsa por não considerar a diferença de
entropia entre um checksum e um texto livre curto.
Idempotência: identidade extraída do próprio contrato (organização+projeto+
caso+vínculo jurídico+checksum, restrita a linhas `PENDING_REVIEW`/
`VERIFIED` — `REJECTED`/`REVOKED` ficam de fora, pois reenviar após uma
decisão terminal é uma nova operação lógica), garantida por dois índices
únicos parciais reais (nunca um índice composto único sobre as duas colunas
de vínculo, que deixaria escapar duplicatas via `NULL <> NULL`) — 39ª
migration, aditiva, aplicada após dois backups reais verificados (`sha256`
em `docs/PHASE_9S_AUDIT_RECORD.md` §12.4). O serviço trata o conflito de
unicidade só pela constraint EXATA esperada (`error.meta.target`, nunca
"qualquer P2002"), relendo e devolvendo o registro vencedor. Detalhe completo
em `docs/PHASE_9S_AUDIT_RECORD.md` §12 e `docs/PHASE_9S_CONTRACT.md` §22.
Suíte oficial completa após a correção: 138 arquivos (1 pulado, pré-existente
e sem relação), **1.612 testes**, 4 skipped, 0 falhas, confirmado em 2
execuções idênticas sem recriar o banco. Fase 10 continua não iniciada;
nenhum commit/push executado; nenhum `AuditLog` histórico apagado ou
reescrito.

### Correção crítica final — remoção de fingerprint de motivo livre

Uma verificação focal independente sobre a correção acima reprovou por um
achado Crítico, confirmado por ataque de dicionário real: `reasonRef` — hash
SHA-256 determinístico e sem chave, aplicado ao motivo livre de recusa/
revogação sob a premissa de que teria a mesma garantia de não-reversibilidade
do `evidenceRef` — na prática recuperava o motivo original. `evidenceRef` é
seguro porque sua entrada (checksum, 256 bits de entropia) é inviável de
adivinhar; `reasonRef` aplicava a mesma técnica a texto livre curto e
previsível ("Documento ilegível.", etc.), com o algoritmo público (no próprio
código-fonte) — um dicionário local de 15 frases recuperou, byte a byte, os
dois motivos reais de um teste real contra PostgreSQL. Corrigido nesta
sessão: `reasonRef` foi removido de `legal-evidence-service.ts` — nenhuma
derivação hash/HMAC de texto livre permanece; `reject`/`revoke` gravam só um
`reasonCode` estático e allowlisted (`LEGAL_EVIDENCE_REJECTION_REASON_PROVIDED`/
`LEGAL_EVIDENCE_REVOCATION_REASON_PROVIDED`, tipado como união literal),
nunca derivado do conteúdo — duas razões diferentes na mesma operação sempre
produzem o mesmo código. `evidenceRef` não foi alterado; nenhuma regra de
idempotência, gate, RBAC, storage ou imutabilidade foi tocada; **nenhuma
migration nova** (39, inalteradas). Detalhe completo em
`docs/PHASE_9S_AUDIT_RECORD.md` §13 e `docs/PHASE_9S_CONTRACT.md` §23. Suíte
oficial completa após a correção: 138 arquivos (1 pulado, pré-existente e sem
relação), **1.614 testes**, 4 skipped, 0 falhas, confirmado em 2 execuções
idênticas sem recriar o banco. `AuditLog`s gravados durante a janela da
correção anterior podem conter `reasonRef` — histórico imutável, não
reescrito; documentado como risco residual. Fase 10 continua não iniciada;
nenhum commit/push executado.

## 10A — AI Gateway (implementação local provider-neutral)

Contrato aprovado em `docs/PHASE_10A_AI_GATEWAY_CONTRACT.md` (15 decisões definitivas
do aprovador) e implementado nesta sessão, na mesma branch `codex/fase-10a-ai-gateway`
(HEAD-base `457aa75c874a673d51e0f72e4bbfc31417e8fb79`, 9S aprovada). Registro completo
em `docs/PHASE_10A_AUDIT_RECORD.md`. Resumo: contratos provider-neutral
(`AiGateway`/`AiRequest`/`AiResponse`/`AiGatewayError`) tornam-se o único caminho
autorizado para executar uma chamada de IA; o único provider realmente ativo em
qualquer ambiente é `disabled` (nenhum comercial autorizado nesta rodada); um segundo
adapter (`compatible_http`) existe só para prova de conceito/teste com transporte
injetado, atrás de allowlist exata de host + resolução DNS validada + conexão fixada
(reaproveitando as validações já auditadas de `alert-dispatcher.ts`, 9Q.2B); produção
recusa incondicionalmente qualquer modo diferente de `disabled`. Orçamento,
idempotência e auditoria reaproveitam somente `AIUsageBudget`/`AIExecutionLog`/
`AIPendingAction` já existentes — **nenhuma migration foi criada**: a ceremônia de
backup+restauração isolada exigida antes de qualquer migration precisa de um
privilégio de banco (`CREATEDB`) indisponível para o usuário `rede_app` neste
ambiente, e solicitar essa credencial é proibido pela autorização desta rodada;
verificado diretamente (`rolcreatedb=false`) antes de desistir da migration, não
presumido. Consequência documentada: o ledger persistido do Gateway só funciona para
chamadores associados a uma `AIConversation` (hoje: `askRedeAI`); o Red Team
(`LLMProvider`) permanece exatamente como estava, não conectado ao Gateway nesta
rodada. Dois bugs reais foram encontrados e corrigidos na autorrevisão adversarial:
uma regressão em `parseRuntimeConfig` que derrubava qualquer chamador (não só IA)
quando as chaves `AI_*` estão presentes-porém-vazias no `.env`; e um vazamento das
linhas internas do ledger do Gateway na lista de "ações pendentes" exibida ao usuário.
Ambos corrigidos e cobertos por teste. RBAC de IA
(`AI_USE`/`AI_ADMIN`/`AI_BUDGET_READ`/`AI_BUDGET_MANAGE`/`AI_AUDIT_READ`) implementado
exatamente como a decisão 11; `AI_USE` sempre acumula a capacidade de leitura do
domínio de origem. Suíte oficial completa: 151 arquivos (1 pulado, pré-existente e sem
relação), **1.759 testes passando + 4 skipped = 1.763**, 0 falhas — 13 arquivos novos
desta fase somando 145 testes (contados um a um), incluindo corrida real de orçamento com
`Promise.all` contra PostgreSQL. Fases 10B–10I continuam não iniciadas; nenhum commit/push
executado;
nenhuma credencial solicitada; nenhum dado real ou chamada externa em qualquer teste.

**Correção registrada abaixo (10A — correção focal pós-auditoria):** a alegação de RBAC
acima ("implementado exatamente como a decisão 11") foi confirmada, por auditoria
independente, como **descrevendo uma função pura testada isoladamente, nunca chamada por
nenhum call site de produção** — `askRedeAI` continuava protegido só pelo `AI_READ`
pré-existente. Corrigido; ver seção dedicada abaixo.

## 10A — correção focal pós-auditoria com ressalvas

Uma auditoria adversarial independente sobre a implementação da 10A (registrada acima)
reprovou com ressalvas (`APROVADO COM RESSALVAS`), confirmando por reprodução real três
achados Altos e quatro Médios; nenhum era explorável hoje (provider sempre `disabled`),
mas todos eram bugs/lacunas reais. Corrigidos nesta sessão, mesma branch, sem migration,
sem commit/push, sem provider comercial habilitado. Registro completo em
`docs/PHASE_10A_AUDIT_RECORD.md` §9.

Resumo dos sete achados e correções: (1) **gate arquitetural bypassável** — um arquivo
novo com `fetch()` direto para um provedor de IA real, sem mencionar as palavras-chave
que o filtro antigo exigia, passava sem ser analisado; reescrito para analisar a AST real
(TypeScript compiler API) de todo arquivo produtivo, sem nenhuma pré-filtragem — bypass
original reproduzido e confirmado corrigido. (2) **RBAC da 10A morto** — `AI_USE` agora é
exigido como a primeira linha de `askRedeAI`, antes de orçamento/ledger/Gateway, e nas
duas entradas (Server Action e rota `/api/ai/chat`) de forma idêntica; `AI_ADMIN`/
`AI_BUDGET_READ`/`AI_BUDGET_MANAGE`/`AI_AUDIT_READ` continuam sem nenhuma superfície ativa
— documentado honestamente como "definidas para uso futuro", não como "em uso". (3)
**provider/model não confiáveis no ledger** — a identidade agora vem exclusivamente do
roteamento do servidor (`AiModelProfile.modelRef`, novo campo), fixada antes de chamar o
adapter; a resposta do adapter só é comparada para detectar divergência
(`PROVIDER_IDENTITY_MISMATCH`, novo código permanente), nunca persistida diretamente. (4)
**idempotencyKey hostil** — validada por um charset fechado antes de qualquer acesso ao
Prisma; os dois bugs reais confirmados pela auditoria (chave vazia colidindo com erro
bruto de constraint; byte NUL crashando com erro bruto de encoding) não reproduzem mais.
(5) **custo negativo/não finito** — validado (inteiro, finito, não-negativo, com teto)
antes de qualquer persistência; nunca pode gerar crédito. (6) **reserva órfã `RUNNING`**
— mapeamento confirmou que o schema já tinha os valores de enum necessários (`QUEUED`,
`RUNNING`, `EXPIRED`) só nunca usados com esse propósito; reservas `QUEUED` vencidas
(transporte comprovadamente nunca iniciado) agora expiram com segurança via um reaper com
CAS transacional real (testado com dois reapers concorrentes na mesma linha); reservas
`RUNNING` vencidas (ambíguas) nunca são liberadas automaticamente — **nenhuma migration
foi necessária**. (7) **header validation implícita** — a chave/token agora é validada
explicitamente antes do DNS/transporte, não depende mais só do `https.request` nativo do
Node para rejeitar CR/LF/NUL.

QA da correção: TypeScript e ESLint limpos (0 erros, 1 warning pré-existente aceito);
`prisma validate`/`migrate status` sem alteração de schema (39 migrations, inalteradas);
suíte oficial completa executada duas vezes após a correção (repetição sem recriar o
banco, para confirmar determinismo) — **155 arquivos de teste passaram | 1 ignorado (156)**
e **1843 testes passaram | 4 ignorados (1847)** nas duas execuções, 0 falhas; build de
produção (`next build`) com sucesso; `git diff --check` e varredura de padrões de segredo
sem ocorrências. Uma falha real de processo apareceu na primeira tentativa da suíte — não
nos 7 itens em si, mas no gate de superfície revisada da Fase 9Q.2A, cujo hash baseline
para `src/app/api/ai/chat/route.ts` e `src/app/actions/ai.ts` ficou desatualizado porque o
Item 2 (RBAC) alterou esses dois arquivos intencionalmente; corrigido recalculando e
gravando os dois hashes revisados em `docs/PHASE_9Q2A_SURFACE_MANIFEST.json` (comportamento
esperado do gate, não uma falha de segurança). Fases 10B–10I continuam não iniciadas;
nenhum commit/push executado; nenhuma credencial solicitada; nenhuma API/DNS externa em
qualquer teste (adapters hostis usam só resolver/requester injetados).

## 10A — correção crítica pós-reauditoria final (máquina de estados, custo, gate AST)

Uma reauditoria focal final ("REAUDITORIA FOCAL FINAL — FASE 10A — PÓS-CORREÇÃO INTEGRAL"),
independente e read-only, avaliou a correção acima e **reprovou** — encontrando, com testes
reais contra PostgreSQL (nunca mocks), bugs concretos que a declaração final da correção
anterior ("nenhum bug adicional foi encontrado") afirmava incorretamente não existir. Ver
`docs/PHASE_10A_AUDIT_RECORD.md` §11 para o detalhamento completo. Resumo dos achados e das
correções, sem apagar o histórico anterior:

1. **CRÍTICO — reserva expirada ressuscitava**: `markGatewayExecutionTransportStarted`
   ignorava se a promoção QUEUED→RUNNING realmente aconteceu, e `gateway.ts` chamava o
   adapter mesmo assim; `confirmGatewayExecution`/`releaseGatewayExecution` faziam
   `update` incondicional, então um `confirm` tardio conseguia ressuscitar uma reserva já
   `FAILED` (liberada pelo reaper) de volta para `COMPLETED`, recobrando custo já
   liberado. Corrigido com CAS transacional verificado em todas as transições
   (`markGatewayExecutionTransportStarted` agora devolve `{transitioned: boolean}` e
   `gateway.ts` só chama o adapter se `transitioned === true`); estado terminal nunca mais
   é sobrescrito. 18 testes novos com concorrência real (`Promise.all`).
2. **ALTO — custo observado hostil na confirmação**: o custo/unidades reportados pelo
   adapter na confirmação (diferente do custo *estimado* na reserva, que já era validado)
   não passavam por nenhuma validação — um adapter hostil conseguia gravar custo negativo
   (reduzindo o gasto agregado) ou `NaN` (erro bruto do Prisma). Corrigido: mesma
   validação fechada do custo estimado, mais revalidação atômica de orçamento quando o
   custo observado excede a reserva (fail-closed, nunca trunca, nunca gera crédito).
3. **ALTO — gate AST ainda bypassável**: três bypasses triviais comprovados (não
   metaprogramação exótica) — acesso computado/colchete a `globalThis["fetch"]`/
   `Reflect.get(globalThis,"fetch")`; extensões `.js`/`.mjs`/`.cjs` nunca escaneadas;
   `scripts/` (incluindo `scripts/worker.ts`, entrypoint real) fora do escopo. Todos
   fechados.
4. **MÉDIO — reaper sem call site produtivo**: a função existia e era bem testada
   isoladamente, mas nada a chamava em produção. Corrigido com a estratégia mínima
   exigida: recuperação oportunística tenant-scoped antes de cada nova reserva. Nenhum
   job periódico foi adicionado — avaliado e registrado como não viável sem inventar um
   mecanismo de agendamento novo, fora do escopo desta correção.
5. **MÉDIO — choke point de RBAC**: `assertAiUse` (o único ponto de composição
   AI_READ+AI_USE+domínio) nunca era chamado pelas 4 superfícies reais, que duplicavam a
   combinação manualmente. Corrigido: as 4 superfícies usam exclusivamente `assertAiUse`;
   teste arquitetural novo detecta qualquer superfície futura que importe o Gateway/
   ferramentas de IA sem passar por ele.
6. **BAIXO — header Unicode**: `isSafeHeaderValue` não fechava o charset (Unicode
   bidi/zero-width passavam). Corrigido para ASCII imprimível fechado.
7. **Manifesto tocado mecanicamente pelo auditor**: registrado com transparência; os
   hashes de `src/app/actions/ai.ts`/`src/app/api/ai/chat/route.ts` foram recalculados
   pelo implementador, pelo algoritmo canônico, depois de todas as correções acima
   estarem finalizadas (ambos os arquivos foram alterados de novo nesta rodada, pelo
   item 5).

QA da correção crítica: TypeScript e ESLint limpos (0 erros, 1 warning pré-existente
aceito); `prisma validate`/`migrate status` sem alteração de schema (39 migrations,
inalteradas); suíte oficial completa executada duas vezes (repetição sem recriar o banco)
— **158 arquivos de teste passaram | 1 ignorado (159)** e **1893 testes passaram | 4
ignorados (1897)** nas duas execuções, 0 falhas, números idênticos (determinismo
confirmado); build de produção com sucesso; `git diff --check` e varredura de padrões de
segredo sem ocorrências. 57 testes novos somados aos 238 já existentes na subárvore
`ai-gateway`. Fases 10B–10I continuam não iniciadas; nenhum commit/push executado; nenhuma
credencial solicitada; nenhuma API/DNS externa em qualquer teste.

## 10A — correção crítica DEFINITIVA pós-reauditoria (falha pós-transporte)

A "REAUDITORIA FINAL DE ENCERRAMENTO — FASE 10A", independente e read-only, avaliou a
correção acima e **reprovou** — encontrando ao vivo, com Postgres real e um adapter
injetado (nunca mocks), que `gateway.ts` retentava `adapter.execute()` automaticamente
(1 tentativa inicial + até 3 retries) e liberava a reserva (custo zerado) para qualquer
falha pós-transporte que não fosse `RECONCILIATION_REQUIRED` — incluindo
`TIMEOUT`/`PROVIDER_UNAVAILABLE`/`UNEXPECTED`, sem nenhuma garantia de não-cobrança do
provedor. A declaração "nenhum bug adicional" da correção anterior estava, de novo,
incorreta. Ver `docs/PHASE_10A_AUDIT_RECORD.md` §13 para o detalhamento completo, e a
correção em-linha da declaração original em §9.8 (marcada "CORRIGIDO/RETIFICADO").

**Regra adotada, sem exceção por classe de erro**: antes de `adapter.execute` ser
invocado, uma falha é pré-transporte e pode liberar a reserva. Depois de invocado, a
execução é potencialmente cobrável — nenhum erro libera automaticamente ou gera uma
segunda chamada ao adapter; a reserva permanece `RUNNING`/`RECONCILIATION_REQUIRED` até
reconciliação manual.

**Alterações**: `gateway.ts` perdeu o laço de retry em torno de `adapter.execute`
(exatamente uma invocação por execução lógica agora) e passou a rastrear um marcador
interno `adapterInvoked` que decide, sozinho, se uma falha pode liberar a reserva.
`releaseGatewayExecution` agora só aceita `QUEUED` como origem (nunca mais `RUNNING`) — uma
tentativa de liberar `RUNNING` é sempre um no-op seguro. Identidade/uso hostil detectados
depois da resposta do adapter também passaram a deixar a execução `RUNNING` em vez de
liberada (mudança deliberada: o adapter respondeu, logo é potencialmente cobrável mesmo
com uma resposta hostil).

**37 testes novos** provando, com PostgreSQL real e `adapter.execute` espionado: cada uma
das principais classes de erro pós-invocação (AUTHENTICATION, AUTHORIZATION, RATE_LIMIT,
TIMEOUT, PROVIDER_UNAVAILABLE, conexão encerrada, resposta truncada, INVALID_RESPONSE,
PROVIDER_USAGE_INVALID, UNEXPECTED, aborto, erro síncrono/assíncrono) resulta em exatamente
1 chamada ao adapter, zero liberação, `RUNNING` preservado; falha de confirmação (via spy)
após resposta válida não rechama o adapter; duas execuções reais concorrentes com a mesma
`idempotencyKey` nunca chamam o adapter duas vezes; replay do cliente após falha de
confirmação é rejeitado sem rechamar o adapter; o reaper nunca toca uma execução com
transporte genuinamente em voo.

**Ajustes baixos**: warning do ESLint (`_signal` não usado) eliminado sem desativar
nenhuma regra global — `npx eslint src` agora relata **0 erros, 0 warnings**; `eval`/`new
Function` bloqueados diretamente no scanner AST (não mais só um teste de regressão
textual), com fixtures provando a detecção; manifesto 9Q.2A confirmado coerente (nenhum
arquivo do seu escopo foi tocado por esta correção, 35/35 hashes batem).

QA final: TypeScript e ESLint limpos (**0 erros, 0 warnings** — warning eliminado, não
apenas aceito); `prisma validate`/`migrate status` sem alteração de schema (39 migrations,
inalteradas); suíte oficial completa executada duas vezes (repetição sem recriar o banco)
— **159 arquivos de teste passaram | 1 ignorado (160)** e **1909 testes passaram | 4
ignorados (1913)** nas duas execuções, 0 falhas, números idênticos (determinismo
confirmado); build de produção com sucesso; `git diff --check` e varredura de padrões de
segredo sem ocorrências; manifesto 9Q.2A confirmado coerente (35/35 hashes batem, nenhum
arquivo do seu escopo tocado). 37 testes novos desta correção, subárvore `ai-gateway` agora
com 24 arquivos e 309 testes. Fases 10B–10I continuam não iniciadas; nenhum commit/push
executado; nenhuma credencial solicitada; nenhuma API/DNS externa em qualquer teste;
provider comercial continua bloqueado (`disabled` obrigatório).

## 10B — Context Engine (implementação integral local)

Implementação iniciada sobre `codex/fase-10b-context-engine`, HEAD-base
`54c9c905e08d505d1d994c929bee03c76d674018`, após a correção focal da 10A. Foram criados
os sete contratos strict do Context Engine, cinco finalidades server-side, políticas
versionadas, readers específicos e escopados, proveniência opaca, freshness, conflitos,
minimização, orçamento determinístico e envelope de evidência
`DATA_NOT_INSTRUCTION`.

O coordenador revalida membership ativa, papel, conversa, organização e projeto antes
das fontes e lê sob uma única transação `RepeatableRead`. A primeira allowlist reutiliza
`StudyVersion`/`AssumptionSnapshot`, `FinancialResult`, `RiskFinding`,
`LegalEvidenceDocument` e `EngineeringTechnicalOpinion`, sem getters com escrita, texto
livre, PII, storageKey, payload ou checksum integral. O Gateway produtivo exige e valida
o bundle, cria a projeção para o provider e remove o objeto interno antes do adapter.
O fingerprint de idempotência da 10A inclui o fingerprint de contexto. O log externo de
orquestração mantém custo/tokens zero, deixando a contabilização exclusivamente no
ledger do Gateway.

Nenhuma migration ou alteração de schema foi necessária. Providers comerciais, rede
externa e credenciais reais continuam bloqueados. A implementação não produz conclusão,
recomendação, ferramenta, decisão ou ação e não iniciou 10C–10I. O registro completo,
incluindo autorrevisão e QA observado, está em `docs/PHASE_10B_AUDIT_RECORD.md`.

### Correção focal pós-auditoria da 10B

A auditoria adversarial reprovou a primeira implementação por TOCTOU: o bundle emitido
em memória permanecia aceito por até 60 segundos, mesmo após membership ou fonte ser
revogada. Essa alegação anterior foi superada. O ponto sem retorno agora é o commit
`TRANSPORT_AUTHORIZED/RUNNING`: sob `Serializable` e uma barreira relacional, a mesma
transação relê membership/papel/capabilities, conversa, organização/projeto, política e
as seis fontes, reconstrói o fingerprint, grava `CONTEXT_CONSUMED` e faz o CAS
`QUEUED → RUNNING`. O adapter só é chamado depois desse commit.

O `WeakSet` process-local foi removido como autoridade. O binding strict fica no ledger
existente e liga ator, conversa, tenant, projeto, finalidade, política, fingerprint,
request/idempotencyKey e tentativa. Bundle reidratado funciona entre instâncias, mas só
após consumo no PostgreSQL; o mesmo requestRef não obtém segundo transporte nem nova
contabilização. TTL é explícito para toda fonte, timestamp futuro falha fechado e grupos
obrigatórios são indivisíveis. A projeção para transporte passou a JSON canônico, e o gate
do Context Engine inclui `.cjs`. Nenhuma migration foi necessária ou criada; 10C–10I
continuam não iniciadas.

### Correção focal final da 10B — binding temporal e ciclo do projeto

A alegação anterior de que o fingerprint completo e o binding já impediam qualquer
adulteração temporal foi superada. `preparedAt` e `validUntil` agora pertencem ao núcleo
canônico do fingerprint e ao binding persistido, junto com as identidades reais da
tentativa. O consumo reconstrói política e fontes sob a barreira e exige exatamente
`validUntil = min(preparedAt + 60_000 ms, recordedAt + TTL explícito de cada fonte)`;
ambos os timestamps usam apenas UTC ISO 8601 com milissegundos. A verificação final
`now < validUntil` ocorre imediatamente antes de `CONTEXT_CONSUMED` e do CAS.

O projeto passou a ser revalidado pelo mesmo helper no preparo e no consumo. Como o enum
`ProjectStatus` vigente não possui `ACTIVE` e schema/migration estavam proibidos, os
estados representáveis `DRAFT`, `UNDER_REVIEW` e `APPROVED` formam a equivalência ativa
desta versão; `PAUSED`, `ARCHIVED`, `CLOSED` e valores desconhecidos falham fechados. A
introdução de um literal único `ACTIVE` requer migration futura autorizada. Uso histórico
de `CLOSED` ficou fora do escopo.

A guarda de plain data agora rejeita propriedades próprias não enumeráveis, Symbols,
accessors e Proxies hostis sem executar getter/setter, preservando arrays comuns e dados
legítimos congelados/selados. A concorrência foi ampliada para 2, 5 e 10 instâncias: a
camada completa prova uma chamada ao adapter, uma contabilização e um consumo; subprocessos
Node com `PrismaClient`s independentes provam exatamente um consumo/CAS durável. O teste
multiprocesso não afirma compartilhar adapter entre processos. Os locks `SHARE` globais
permanecem como risco residual de throughput. Nenhuma migration foi criada e nenhuma
parte das fases 10C–10I foi iniciada.

QA observado nesta correção final: foco com 4 arquivos/122 testes; subárvores completas
com 24 arquivos/381 testes; TypeScript e ESLint completos sem erros ou avisos; Prisma
válido, client gerado, 39 migrations e banco atualizado; suíte oficial duas vezes no
mesmo banco, com números idênticos de 162 arquivos aprovados + 1 ignorado e 1.996 testes
aprovados + 4 skips (407,54 s e 501,35 s); build produtivo com 28/28 páginas, com
`next-env.d.ts` restaurado; preflight inválido recusado com exit code 2 antes de qualquer
dependência externa.

## 10C — Tool Layer (diagnóstico, implementação local e correção focal pós-auditoria)

Diagnóstico e contrato aprovados sobre `codex/fase-10c-tool-layer`, base
`f4586dcf2c005f32d02d47a202ed17d13502f0db` (fase 10B). O piloto expõe exatamente 4
ferramentas `READ_ONLY` (`getApprovedViabilitySummary`, `getActiveRisks`,
`getEngineeringProgress`, `getVerifiedLegalEvidence`), cada uma mapeada 1:1 a um
`ContextPurpose` já auditado pela 10B, sob o protocolo transacional completo de preparo e
consumo (barreira `SHARE`, CAS, `consumeContextBundleInTransaction`), RBAC cumulativo
(`AI_READ`+`AI_USE`+capability de domínio+`minimumRole=REVIEWER`) e rate limit dedicado.
Nenhuma migration, nenhuma ferramenta de escrita, nenhuma rota nova, nenhuma integração
com o fluxo legado (`planAIIntent`) e nenhuma parte das fases 10D–10I.

Uma auditoria adversarial independente encontrou 6 achados reais (nenhum critério de
reprovação automática atingido): estado terminal do ledger de auditoria podia ser
sobrescrito por um perdedor tardio de uma corrida de replay (ALTO-1); as duas fases
internas de execução eram publicamente reexportáveis, permitindo obter evidência sem
passar pelo protocolo completo de consumo (ALTO-2); 13 ferramentas legadas `READ_ONLY`
(fora do piloto) gravam via getters de workspace impuros já documentados pela 10B, sem
cobertura da regressão original (ALTO-3); rate limit sem isolamento por ator (MÉDIO-4);
nome de ferramenta inválido persistido bruto em auditoria (MÉDIO-5); cobertura de teste
insuficiente para o estado final do ledger sob replay (MÉDIO-6).

Uma correção focal (16/09/2026) resolveu os 6 achados sem ampliar o escopo da 10C, sem
migration e sem alterar o comportamento funcional das quatro ferramentas aprovadas:
transições do ledger passaram a ser CAS monotônico atômico com a auditoria; o barril
público (`index.ts`) passou a exportar nomeadamente só `executeAiTool`, com gate
arquitetural e prova em runtime de que as fases internas nunca são alcançáveis de fora do
pacote; rate limit passou a incluir uma referência segura do ator na chave; nomes de
ferramenta inválidos passaram a gravar só um sentinel estático; o catálogo legado ganhou
um manifesto fixo e nomeado das 13 exceções conhecidas, com gate preventivo contra novas
exceções silenciosas, sem reclassificar nenhuma delas. Suíte oficial completa (duas
passagens, mesmo banco): 166 arquivos aprovados + 1 ignorado (167), 2.049 testes aprovados
+ 4 skips oficiais (2.053), zero falhas, 527,97 s — 53 testes novos/incrementais desde a
linha de base pré-10C. TypeScript, ESLint, Prisma (validate/generate/status nos dois
bancos), build produtivo (28/28 páginas) e preflight inválido (exit 2) aprovados. Registro
completo em `docs/PHASE_10C_TOOL_LAYER_CONTRACT.md` e `docs/PHASE_10C_AUDIT_RECORD.md`.
Nenhum commit, push, merge, rebase ou tag foi executado; aguardando reauditoria focal
independente.

Uma reauditoria focal independente reproduziu um bypass FUNCIONAL do achado ALTO-2: as duas
fases internas continuavam `export`adas de `service.ts` (só não reexportadas por `index.ts`),
e o gate arquitetural dependia de varredura textual do identificador literal — um arquivo
fora do pacote montou o nome em runtime (`["prepare","Ai","Tool","Invocation"].join("")`),
fez `import()` dinâmico e acessou a função por colchete, sem nunca escrever o identificador
literalmente; o gate não detectou e a função interna foi de fato invocada de fora do pacote.
Classificado ALTO/BLOQUEADOR, impedindo o veredito de aceite pleno.

Uma correção BLOQUEADORA final (16/09/2026), escopo estritamente limitado a este achado,
fechou-o estruturalmente: `prepareAiToolInvocation`/`consumeAiToolInvocation` deixaram de ter
`export` em `service.ts` (funções privadas de escopo de módulo — nenhuma técnica de import,
estática ou dinâmica, com ou sem ofuscação, alcança um binding não exportado). O gate
arquitetural foi reescrito de substring para AST real (TypeScript Compiler API, mesmo padrão
da 10A), como defesa em profundidade. Os testes de corrida do pacote passaram a usar um
harness dedicado que nunca devolve o `ContextBundle`/evidência, preservando a mesma cobertura
de corrida (inclusive entre processos Node/PrismaClient independentes) de antes. ALTO-1, o
reaper, o manifesto das 13 exceções legadas, o rate limit por ator e a sanitização de
`toolName` não foram tocados. Testes focais do Tool Layer: 63 (era 57) — 29 integração + 13
arquitetura + 9 regressão/manifesto legado + 7 domínio + 5 choke point, zero falhas.
TypeScript, ESLint, Prisma (validate/status nos dois bancos), suíte oficial completa (duas
passagens, mesmo banco, sem recriação) e build produtivo aprovados. Registro completo em
`docs/PHASE_10C_TOOL_LAYER_CONTRACT.md` (seção 26) e `docs/PHASE_10C_AUDIT_RECORD.md` (seção
"Correção BLOQUEADORA final pós-reauditoria"). Nenhum commit, push, merge, rebase ou tag foi
executado; HEAD permanece `f4586dcf2c005f32d02d47a202ed17d13502f0db`; parando para uma última
reauditoria independente, conforme solicitado.
