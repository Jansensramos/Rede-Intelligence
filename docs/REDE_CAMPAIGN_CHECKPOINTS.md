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
| 9P.3B | Google Drive | Contrato preparado; implementação e gates pendentes |
| 9P.3 — e-mail | E-mail transacional | Provedor do piloto pendente |
| 9P.4 | Bancos, conciliação, funding e bureau de crédito | Sistemas concretos dependem dos pilotos |
| 9P.5 | Sienge e CRM utilizado pelo cliente | Sistemas concretos dependem dos pilotos |
| 9Q — restante | Gates de release e operação | Aguardando |
| 9R, 9S | Próximas fases do roadmap aprovado | Aguardam contratos detalhados |
| 10A | AI Gateway | Aguardando |
| 10B | Context Engine | Aguardando |
| 10C | Tool Layer | Aguardando |
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
