# Fase 9Q.2B — Deploy e rollback (piloto)

Este plano formaliza, para o piloto, o processo já descrito em
`docs/PHASE_9P2_CLOUD_PRODUCTION_RUNBOOK.md` e implementado em
`.github/workflows/deploy-readiness.yml` + `src/infrastructure/release/production-preflight.ts`.
Nada aqui foi executado contra um ambiente real — não existe ambiente de piloto
provisionado nesta sessão.

## Artefato identificado por commit e build

- Imagem `web` e imagem `worker` construídas do mesmo `Dockerfile`, tagueadas pelo SHA do
  commit aprovado (`github.sha`) — já implementado em `deploy-readiness.yml`.
- `safeReleaseIdentity` (`src/domain/release/local-readiness.ts:18-22`) já sabe validar o
  formato de `REDE_RELEASE_SHA` (40 hex) e `REDE_BUILD_ID` (64 hex) sem aceitar valor
  livre — reutilizável pelo painel de prontidão cloud quando ele existir.
- Commit aprovado para esta fase: `f04eb740316f56618a6d39dab1d27eabe5d064d0` (9Q.2A,
  CI verde confirmado pelo usuário). A branch `codex/fase-9q2b-cloud-production-readiness`
  parte exatamente dele.

## Sequência de deploy (piloto)

1. **Gate documental humano** (`release-gate` em `deploy-readiness.yml`, ambiente
   `production-approval`) — aprovação manual antes de qualquer promoção.
2. **Preflight** (`pnpm run preflight:production`, `scripts/preflight-production.ts`) —
   fail-closed contra banco, storage, Secret Manager, KMS, scanner e (novo nesta fase)
   alerting. Reprovação em qualquer dependência bloqueia a promoção; a saída nunca inclui
   valor de configuração, só nome do serviço e categoria do erro
   (`productionPreflightCliResult`).
3. **Migration** — `prisma migrate deploy` executado uma única vez por um job de release
   dedicado, nunca no boot de `web`/`worker`, nunca `migrate dev`/`db push`/`reset`. Exige
   backup válido e recente comprovado antes de rodar (ver
   `docs/PHASE_9Q2B_DB_BACKUP_PITR.md`).
4. **Publicação separada** de `web` e `worker` — nenhum tráfego é liberado antes de
   `/api/health/live` e `/api/health/ready` responderem OK nas novas réplicas.
5. **Smoke tenant-safe** — requisições autenticadas contra dados sintéticos/de piloto,
   nunca dados reais de outro tenant. `scripts/smoke-authenticated.ts` já existe para o
   ambiente local; a versão cloud reaproveita o mesmo roteiro contra o domínio do piloto.
6. **Observação de erro/fila** por uma janela mínima antes de considerar o deploy estável.

## Rollback

- **Aplicação**: reimplantar a imagem anterior (mesma tag SHA já publicada). Não é
  necessário rebuild — a imagem anterior já existe no registry.
- **Migration nunca é revertida automaticamente**. Evoluções de schema devem seguir
  expand/contract (adicionar coluna nullable → popular → tornar obrigatória em release
  seguinte), exatamente como já documentado na 9P.2, para que a imagem anterior continue
  funcional mesmo com o schema novo presente.
- **Nenhum rollback destrutivo de banco**: nunca `DROP`, nunca `migrate reset`, nunca
  restaurar backup sobre o banco principal. Se uma migration se provar incompatível após
  liberar tráfego, a saída é rollback de aplicação (imagem anterior) + hotfix de migration
  compensatória em release seguinte — nunca reversão de schema in-place.
- Critério de acionamento: preflight reprovado após deploy, `/api/health/ready` falhando
  persistentemente, taxa de erro 5xx acima do SLO (ver
  `docs/PHASE_9Q2B_OBSERVABILITY_INCIDENTS.md`), ou decisão humana do responsável de
  operações.

## Manifesto sanitizado da execução

Cada execução de preflight produz um `correlationId` e a lista de serviços
verificados/reprovados (`ProductionPreflightResult`), já sem valores sensíveis — pronto
para ser anexado como evidência na matriz Go/No-Go
(`docs/PHASE_9Q2B_GO_NO_GO_MATRIX.md`). O manifesto de migrations (34 migrations,
checksums) já existe em `docs/PHASE_9Q2A_MIGRATION_MANIFEST.json` e deve ser conferido
bit a bit contra `prisma migrate status` do ambiente alvo antes de cada deploy — nenhuma
migration nova foi criada nesta fase.

## Bloqueio

Nenhum item deste plano foi executado contra um ambiente real. Falta: ambiente
provisionado, registry de imagem definido, orquestrador escolhido, e aprovação humana do
gate documental contra um alvo real — tudo isso é pré-condição, não parte do código.
