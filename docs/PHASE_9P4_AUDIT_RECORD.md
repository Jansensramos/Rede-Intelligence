# 9P.4 — QA e auditoria adversarial local

## Base e rastreabilidade

Base `2dd403419b63ee95b7514802b87a58300ac504c8`, branch `codex/fase-9p4-local`.
GitHub Actions da 9P.3C confirmado com sucesso na execução
[34121184857](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34121184857).
Esse CI valida a base, não o diff da 9P.4. Sem commit/push por instrução do usuário.

Relatório Mestre fornecido pelo usuário, lido por extração e inspeção visual das páginas
15–17: `REDE_Intelligence_Relatorio_Mestre_2026_ATUALIZADO_2026-09-05.pdf`.
SHA-256 `a22956a6b72fe0d71621dc8261dec37189e8c98277a3b10dddbe25bc5214717e`.
Escopo e pendências: `PHASE_9P4_LOCAL_FINANCIAL_CONTRACT.md`.

## Backup anterior à migration

Banco de QA isolado na porta 55434. Banco histórico da porta 55432 preservado.
Backup privado: `outputs/backups/2026-09-07T12-25-44-721Z-test_database_url/database.dump`.
Tamanho: **12.715.603 bytes**.
SHA-256: `288c5cf80a67e3880d6fb6bfe098c08279ccd1fb15858a83b5e5f083fa752c47`.
Restauração: `rede_restore_6aab4e67dfe241a5af0b345a425ea8d8`.
Verificação concluída em `2026-09-07T12:26:36.774Z`: **374 tabelas, 51.201 registros**,
origem estável e conteúdo restaurado equivalente. `valid=true`; manifesto `verification.json`
na pasta do backup. O backup é de QA, não é evidência de recuperação produtiva.

## Migration e catálogo

Uma migration aditiva: `20260907123000_phase_9p4_local_financial_evidence`.
SHA-256 `cb6ca15797abc10f5a0bd6b901510f058ecf90e4ee02944d1b1d3ec42f9487c1`.
Nova tabela `financial_provider_evidence`, duas FKs RESTRICT, índice de idempotência e
três triggers ativos: validação de escopo, imutabilidade e proibição de TRUNCATE.
UPDATE é proibido; DELETE só é permitido depois de expiresAt. Payload cifrado e marcador
simulated=true obrigatório. Metadados PostgreSQL registrados em `work/9p4-catalog-audit.json`.
Os nomes de índices no Prisma refletem os nomes efetivos de 63 caracteres do PostgreSQL.
Nenhuma migration antiga foi editada.

Banco criado vazio: `rede_financial_9p4_seed_68773458f54242d0a5ce24dc7e018c18`, porta 55434.
As 33 migrations e o seed passaram em `2026-09-07T12:42:01.131Z`.
Manifesto privado: `work/9p4-empty-seed-result.json`.

## Auditoria adversarial

Revisão pelo próprio implementador, com ataques reproduzidos em testes; não é auditoria
independente. Nenhum agente externo ou fornecedor foi usado para produzir evidência.

Casos exercitados: tenant alheio com associação válida, papel falsificado, revogação persistida,
configuração REAL/desativada, input extra com PII, respostas com escopo estranho, referência
de funding divergente, replay concorrente, conflito de valores, paginação circular, falha na
segunda página, aborto cooperativo, lease antigo inclusive com mesmo dono, quota persistida,
retry/dead-letter, payload corrompido, mutação SQL de relatório, exclusão precoce e expurgo.

Correções da revisão:

- Execução antiga é cercada por leaseOwner e attemptCount; falha não usa a transição genérica.
- Resposta de funding precisa corresponder à submissão da própria instalação/objeto.
- Proposta enviada fica vinculada por hash à versão/conteúdo vistos no enqueue; mudança
  posterior exige outra solicitação. Nunca há atualização econômica silenciosa.
- Leitura de relatório requer capacidade de auditoria e de operação; VIEWER só vê estados.
- Job corrompido gera erro seguro e usa o autor da instalação como fallback de auditoria,
  sem copiar payload para dead-letter.
- Quota local é por operação concluída, para permitir paginação atômica mesmo com limite
  baixo. A quota por requisição externa pertence ao adapter REAL futuro.
- Dossiê local de funding incluído pela capacidade já existente, congelado/cifrado no enqueue.
  Retry não recalcula o dossiê. Expurgo também remove dossiês de jobs vencidos em lotes.
- Consultas de autorização selecionam só os campos necessários, sem carregar CPF/CNPJ ou
  número de conta. Digest de conteúdo usa HMAC para não permitir adivinhar scores/valores
  de baixa entropia a partir de um hash público.

Garantias de domínio: simulação bancária não cria BankTransaction oficial; bureau não
altera a decisão de crédito oficial; sinal RELEASE_REPORTED não cria obrigação, dívida ou
desembolso. O fluxo governado de conciliação/realizado existente foi preservado.

## QA conclusivo

Rodada final concluída em 07/09/2026, após as correções adversariais:

- Focais: **71/71 testes, 5/5 arquivos**, exit 0.
- Suíte completa: **1.044/1.044 testes, 121/121 arquivos**, 246,68 s, exit 0.
- TypeScript e ESLint: exit 0.
- Build: exit 0 em `2026-09-07T18:49:44.294Z`; BUILD_ID `2He8idtnv-HqBxG9G0TKs`.
- Prisma validate/generate e status aprovados; 33 migrations aplicadas. Seed em banco
  efêmero inicialmente vazio aprovado, conforme registro acima.
- `git diff --check`: aprovado. `.env`, `next-env.d.ts` e migrations anteriores preservados.

Manifesto local: `work/9p4-delivery-qa.json`; logs `work/9p4-delivery-*.log`.
Prisma: `work/9p4-final-prisma.log` e `work/9p4-final-status.log`.
Histórico: a primeira rodada focal teve 51 aprovados e uma falha no próprio teste, que
filtrava FundingDisbursement por coluna organizationId inexistente. Corrigida para o escopo
pela relação proposal; repetição 52/52. As rodadas históricas não substituem a final acima.

**Veredito: checkpoint local aprovado em QA e revisão adversarial do implementador**, com
os limites abaixo. Worktree aberto exclusivamente para a 9P.4, HEAD inalterado, sem commit
ou push. CI da 9P.4 pendente de publicação pelo usuário; não se atribui a este diff o CI da
base. A 9P.5 não foi iniciada, para preservar os checkpoints separados.

## Limites e riscos remanescentes

Somente camadas locais. Nenhum banco, agregador, bureau ou financiador escolhido/contratado,
nenhuma credencial de API externa consultada, nenhum socket de provider aberto e nenhum smoke REAL.
Não há webhook externo nem mecanismo paralelo ao Inbox existente. Não há nova tela;
actions de servidor e worker oferecem os fluxos locais e a consulta de estados/evidências.

O mock bancário padrão retorna extrato vazio. Páginas sintéticas injetadas pelos testes
comprovam processamento e deduplicação, não origem/valor real. Relatório de bureau padrão
declara dados insuficientes. Funding usa assembleFundingDossier para congelar as referências
oficiais locais no enqueue, com cifragem autenticada vinculada ao job. Nenhum documento é
enviado. Contrato de fornecedor e interpretação de payload externo ficam na campanha REAL.
Não há importação automática de evidência MOCK no ledger oficial.

Leitura vencida é bloqueada, mas a remoção física requer executar purgeFinancialEvidence
(lotes de até 100). Automatização operacional e política de retenção final ainda precisam
ser definidas. Chave de cifragem existente deve permanecer disponível enquanto houver
evidências ativas; rotação requer procedimento de migração/expurgo, sem fallback.
Administrador do banco pode remover triggers; isso não é resistência a comprometimento
administrativo. Não foi declarada conformidade jurídica ou disponibilidade produtiva.

## Correção após publicação — 07/09/2026

O usuário publicou `e0169b701b7fc0782a41499699eef3f134dd1ea7`. O GitHub Actions
[34169846543](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34169846543),
job `101887929295`, reprovou o beforeAll de
`financial-provider.database.integration.test.ts:18`: `fundingProposal.findFirstOrThrow`
não encontrou proposta. O seed não cria FundingProposal; o QA local anterior tinha dados
de outras execuções. O gate de seed vazio anterior não incluía executar essa suíte
isoladamente naquele banco. Assim, os resultados locais históricos não comprovaram sua
independência da ordem. No CI: 120/121 arquivos aprovados, 1.029 testes aprovados,
15 não executados por falha no hook; build não executado.

Correção delimitada: o próprio beforeAll cria uma FundingProposal DRAFT sintética, com
chave única e vínculo ao tenant/projeto do teste. Nenhum fornecedor real é selecionado;
nenhum teste é removido, relaxado ou marcado como skip. Serviços e seed ficam preservados.
Revisão adversarial da correção verifica independência da ordem, isolamento do vínculo,
ausência de aprovação/desembolso e preservação das asserções existentes.

QA complementar no PostgreSQL novo da porta 55435, banco inicialmente vazio
`rede_intelligence_test`, papel `rede_app`: Prisma validate/generate/status, deploy das
33 migrations e seed aprovados. A suíte financeira executou sozinha imediatamente após
deploy/seed: **15/15 testes aprovados**, antes de qualquer outra suíte. Rodada focal:
**71/71 testes em 5 arquivos**; suíte completa: **1.044/1.044 testes em 121 arquivos**,
264,96 s, sem skip, exit 0 em `2026-09-07T23:39:57.756Z`.
TypeScript e ESLint aprovados. Build aprovado, exit 0 em `2026-09-07T23:44:32.624Z`,
28 páginas, BUILD_ID `qDcQRkyITERmsDdiM3jIR`. `git diff --check` aprovado.
Manifesto privado: `work/9p4-ci-correction-qa.json`; logs `work/9p4-ci-correction-*.log`.
Migrations novas: zero. `.env`, schema, seed, migrations e `next-env.d.ts` preservados.
Os bancos das portas 55432 e 55434 não recebem migrations, seed ou testes desta correção.

Na preparação da retomada, foi realizado backup adicional de QA na porta 55434, sem alteração
posterior do schema: `outputs/backups/2026-09-07T23-27-52-980Z-test_database_url/database.dump`,
16.887.585 bytes, SHA-256 `989b5f6ea7c097c8ab189aee0d57a55f4106bfc0be2e5fd00e7f757c91eddd58`.
Restore `rede_restore_3fd4f547b0894a23adaf347b4b9294a0`, validado em
`2026-09-07T23:28:45.779Z`: 375 tabelas, 71.162 registros, origem estável e conteúdo equivalente.
Não é evidência de backup produtivo nem de implementação da 9P.5.

Git da correção: worktree aberto, sem commit/push. A implementação da 9P.5 aguarda o novo
fechamento manual e CI da 9P.4, preservando a separação de fases.

Veredito da correção: QA e revisão adversarial local pelo implementador aprovados.
O gate externo continua reprovado no SHA publicado; somente um novo CI pode substituí-lo.
