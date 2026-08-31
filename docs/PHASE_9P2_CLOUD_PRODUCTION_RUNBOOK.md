# Fase 9P.2 — Runbook de produção cloud

## Topologia e release

Publicar a imagem em dois processos independentes: `web` atende HTTP e `worker` consome a fila PostgreSQL. O job de release executa `pnpm exec prisma migrate deploy` uma única vez, antes de liberar tráfego. Réplicas web e worker nunca executam migration no boot.

1. CI verde e imagem identificada por SHA imutável.
2. Confirmar PITR/backup e revisar migrations.
3. Executar `prisma migrate deploy` uma vez.
4. Publicar web e worker separadamente; validar `/live` e `/ready`.
5. Fazer smoke tenant-safe e acompanhar erros/fila.
6. Rollback usa a imagem anterior. Migration não é revertida automaticamente; evoluções futuras devem usar expand/contract.

## Ambientes, segredos e KMS

- `development` e `test`: storage local privado, scanner noop explicitamente identificado, segredos por ambiente e cofre local com `INTEGRATION_SECRET_KEY` obrigatória.
- `production`: storage `s3`, scanner externo, Secret Manager e KMS externos. A validação de boot falha sem banco, URLs, sessão, storage, scanner, segredos ou KMS.
- Injetar segredos pelo runtime da plataforma. Não montar `.env` na imagem e não imprimir valores em logs, health ou mensagens de validação.
- Rotacionar credenciais de storage, sessão, webhook e integrações no fornecedor. Manter duas versões durante a janela quando suportado.

## Storage privado

O bucket bloqueia acesso público. A fonte de verdade é `bucket + storageKey + hash + MIME + tamanho`, nunca uma URL. Downloads sensíveis exigem autenticação, tenant, projeto e capability antes de URL assinada curta (padrão 300 s). Ativar versionamento, criptografia gerenciada e lifecycle conforme retenção jurídica.

S3-compatible suporta AWS S3, R2 ou MinIO via `STORAGE_ENDPOINT` e `STORAGE_FORCE_PATH_STYLE`. CORS lista somente `APP_PUBLIC_URL` e métodos necessários. Scanner indisponível bloqueia novos uploads; não há fallback silencioso a disco ou banco em produção.

## PostgreSQL gerenciado

Exigir TLS/SSL pela `DATABASE_URL`, rede privada/allowlist e usuário sem privilégios administrativos. Cada réplica multiplica conexões; ajustar limites no provedor. Pooler só após teste com Prisma. Migration usa conexão direta e nunca `migrate dev`, `db push` ou `reset`.

## Backup e restauração

Backup não passa a existir por efeito deste repositório: precisa ser habilitado no provedor antes do go-live.

- Meta inicial: RPO 15 minutos; RTO 4 horas.
- PostgreSQL: PITR + backup diário, retenção mínima 35 dias.
- Storage: versionamento + retenção/lifecycle equivalente.
- Teste trimestral: restaurar em ambiente isolado, conferir amostra de objetos e hashes, rodar `prisma migrate status` e smoke autenticado, e registrar duração/evidência.
- Nunca restaurar sobre produção. Validar consistência banco/objetos e revogar URLs/tokens expostos.

## Observabilidade e alertas

Encaminhar logs JSON ao backend escolhido. `ErrorReporterProvider` e `MetricsProvider` mantêm o domínio agnóstico a Sentry, Datadog ou OpenTelemetry. Não enviar PII nem segredos.

Alertas mínimos: 5xx > 2%/5 min; p95 acima do SLO; readiness falhando; worker sem heartbeat; fila/idade crescendo; dead-letter nova; DB/storage indisponível; integração com erros/retries persistentes; aumento anormal de login/rate limit. Definir responsável, canal e escalonamento antes do go-live.

## Incidente

Isolar o componente, preservar AuditLog/evidências, rotacionar credenciais, invalidar sessões quando aplicável e identificar tenants/objetos atingidos. Storage indisponível deixa upload/download indisponíveis; não desvia dados a armazenamento inseguro. Cumprir o plano jurídico de comunicação.
