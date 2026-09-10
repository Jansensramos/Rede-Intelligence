# Fase 9Q.2B — Banco, backup, PITR, RPO e RTO

## Migrations: contagem confirmada, nenhuma nova

`ls prisma/migrations` nesta sessão retorna exatamente **34** migrations, coincidindo com
o checkpoint informado da 9Q.2A. Nenhuma migration foi criada, editada ou removida nesta
fase. `docs/PHASE_9Q2A_MIGRATION_MANIFEST.json` (checksums das 34) permanece a fonte de
verdade e deve ser reconferido contra `prisma migrate status` do ambiente alvo assim que
ele existir.

**Divergência documental encontrada e corrigida nesta fase:**
`docs/PHASE_9Q_RELEASE_CONTRACT.md` §6 citava "29 migrations esperadas" como estado atual
— desatualizado desde antes da 9Q.2A (a contagem real já era 34 nesta sessão). A linha foi
reescrita para não fixar mais um número no texto ("conferir sempre contra
`prisma/migrations`"), e `scripts/local-release-safety.test.mjs` ganhou um teste
automático (`flags a stale hardcoded migration count...`) que falha se esse documento
voltar a citar uma contagem diferente da real. Documentos históricos que citam contagens
antigas (29 a 33) como descrição correta de um checkpoint passado não foram alterados —
alterá-los reescreveria história, não corrigiria um erro.

**Estado atual confirmado nesta fase:** 34 migrations no repositório, nenhuma criada ou
alterada. **Backup pré-migration das duas migrations aplicadas ao banco `rede_intelligence`
nesta fase (`20260907123000_phase_9p4_local_financial_evidence`,
`20260908001500_phase_9p5_enterprise_evidence`) não existiu** — registrado como limitação
real, não fabricado retroativamente. Um backup foi executado **depois** da aplicação
(2026-09-09, `outputs/backups/2026-09-09T18-30-24-398Z-database_url/verification.json`,
SHA-256 conferido de forma independente) — ele comprova a capacidade de backup/restauração
isolada funcionando **hoje**, mas não substitui nem equivale a uma evidência da janela
anterior à migration, que ficou sem cobertura.

## Backup local (já implementado, já validado por teste) — modelo a replicar em cloud

`scripts/backup-local-database.mjs` já implementa exatamente o padrão exigido pelo
contrato 9Q para restauração: restrito a `127.0.0.1`/`localhost`, cria um banco de
restauração com nome aleatório (`rede_restore_<uuid>`), nunca sobrescreve o banco de
origem, verifica que o dump não está vazio, compara um manifesto de conteúdo
(checksum por tabela) entre origem-antes, origem-depois e restaurado, grava
`verification.json` com tamanho e SHA-256 do dump.

**Atualização (correção pós-reauditoria REPROVADA, mesmo dia):** o script foi alterado
uma única vez nesta fase — não no comportamento de backup/restauração acima (inalterado),
mas na checagem de banco arquivado: a verificação inline duplicada (`/archived/i`) foi
removida e substituída pela chamada à política central
(`assertNotArchivedDatabase`, em `scripts/database-url-safety.mjs`), a mesma usada agora
por `DATABASE_URL`/`TEST_DATABASE_URL` do runtime, do worker e da ferramenta de
restauração isolada (`restore-safety.ts`). Ver `docs/REDE_CAMPAIGN_CHECKPOINTS.md`,
seção "Correção pós-reauditoria REPROVADA", para o detalhe completo — a versão anterior
deste documento e do checkpoint afirmava, incorretamente, que essa cobertura já existia
para `DATABASE_URL` e para este script; não existia.

## Nova peça desta fase: guarda de isolamento reutilizável

`src/infrastructure/release/restore-safety.ts` (`assertIsolatedRestoreTarget`) extrai a
regra "nunca restaurar sobre a fonte" para uma função pura, testável sem banco real
(6 testes em `restore-safety.test.ts`), reutilizável tanto pelo script local quanto por
uma futura ferramenta de restauração cloud: rejeita quando o alvo resolve para o mesmo
host+porta+banco da fonte, e exige que o nome do banco alvo carregue um prefixo de
isolamento comprovado (`rede_restore_` por padrão, customizável). Puramente estrutural —
não faz nenhuma chamada de rede.

## Metas (herdadas da 9P.2, não redefinidas aqui)

- RPO: 15 minutos. RTO: 4 horas.
- PostgreSQL gerenciado: PITR + backup diário, retenção mínima de 35 dias.
- Storage: versionamento + lifecycle equivalente à política de retenção jurídica.
- Ensaio trimestral: restaurar em ambiente isolado, conferir amostra de objetos e hashes,
  rodar `prisma migrate status` e smoke autenticado, registrar duração/evidência.

## O que está `NÃO COMPROVADO`

- **PITR real**: nenhum PostgreSQL gerenciado existe; não há provedor para medir RPO/RTO
  reais. Meta declarada acima é alvo, não medição.
- **Backup cloud real**: não habilitado em provedor algum — "backup não passa a existir
  por efeito deste repositório" (contrato 9P.2, citado literalmente porque continua
  verdadeiro).
- **Restauração isolada em ambiente cloud**: não ensaiada — não há alvo.
- **TLS na `DATABASE_URL` de piloto/produção**: não verificável sem uma instância real.
- **Usuário de aplicação sem privilégio administrativo**: exigido pelo contrato, não
  comprovável sem uma instância real para inspecionar `pg_roles`.

## Regra que se mantém

Nenhum comando `migrate reset`, `db push` ou `DROP` foi executado nesta fase. O banco
principal não foi usado como alvo de shadow/restore em nenhum momento. Nenhuma alteração
real de schema foi proposta ou aplicada.
