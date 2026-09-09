# 9Q.2A — Release Readiness Local

## Autoridade e base

Ordem de serviço fornecida pelo usuário em 08/09/2026. Base exclusiva:
`52543782609db50d65313e08f74d6b9b961e88e9`, publicação da 9P.5.
[CI 34228347883](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34228347883)
concluído com success, verificado pelo conector GitHub. Branch fornecida:
`codex/fase-9q2a-release-readiness-local`, inicialmente limpa.
Baseline: 1.098 testes, 34 migrations (uma aditiva da 9P.5), APIs reais adiadas.

Este contrato complementa `PHASE_9Q_RELEASE_CONTRACT.md`; sua contagem histórica
de 29 migrations não é a baseline atual. O manifesto desta entrega fixa as 34.
Não encerra a 9Q.2 integral e não inicia 9Q.2B, 9R, 9S ou Fase 10.

## Arquitetura

1. Contrato local de configuração: diagnósticos por código, sem valores, identidade
   de commit/build validada como hash e decisão sempre `productionReady=false`.
2. `predeploy:local`: valida configuração, arquivos das migrations e checksums no
   PostgreSQL local. Recusa host externo e não consulta storage, AWS ou providers.
3. Middleware: gera correlação aleatória no ingresso, define CSP e bloqueia tráfego
   de produção neste checkpoint, preservando `/api/health/live`. Não há flag de
   aprovação externa que contorne o bloqueio. Build produtivo não autoriza tráfego.
4. Liveness indica processo vivo. Readiness indica disponibilidade local e integridade
   das migrations; responde 503 em produção, configuração inválida ou banco incompatível.
5. Painel `/ajuda/prontidao`: OWNER/ADMIN persistidos, métricas agregadas exclusivamente
   da organização autenticada, estado local e pendências externas. Não retorna payloads,
   nomes de credenciais, chaves, endereços de providers ou connection strings.
6. Onboarding: confirmações humanas append-only pela aplicação em AuditLog, serializadas
   por organização e idempotentes por etapa. Não são evidências imutáveis de fornecedor.
   O aceite exige etapas anteriores e revalida existência de projeto, estudo, base e
   integração local. A confirmação não cria esses registros nem aprova seus domínios.
7. Manual Online e ajuda contextual: conteúdo versionado em português, filtrado pelo
   acesso do papel, acessível mesmo quando a organização ainda não possui projeto.
8. Guarda arquitetural: manifesto de superfícies revisadas detecta alteração de rotas
   e actions existentes; novas rotas exigem revisão explícita e novas actions exigem
   gate na primeira instrução de cada função exportada. Não é prova formal de segurança.

## Configuração por ambiente

| Ambiente | Obrigatórias | Dependências e restrições |
| --- | --- | --- |
| Desenvolvimento local | DATABASE_URL local, SESSION_SECRET e INTEGRATION_SECRET_KEY com pelo menos 32 caracteres | STORAGE_PROVIDER=local, SECRET_PROVIDER=environment, KMS_PROVIDER=local, MALWARE_SCANNER_PROVIDER=noop; somente dados sintéticos |
| Teste/CI | TEST_DATABASE_URL para rede_intelligence_test, guarda de testes, DATABASE_URL do banco efêmero; segredos efêmeros no processo | Deploy das migrations e seed; nenhuma credencial de fornecedor |
| Pré-deploy local identificado | Itens locais, REDE_RELEASE_SHA (40 hex) e REDE_BUILD_ID (64 hex) | Identidade declarada deve ser conferida contra artefato pelo operador; não é assinatura de release |
| Piloto real/produção | Inventário produtivo abaixo | Configuração e evidência operacional obrigatórias na 9Q.2B; bloqueados nesta entrega |

Inventário produtivo existente: APP_PUBLIC_URL, WEBHOOK_BASE_URL, SESSION_SECRET,
DATABASE_URL, STORAGE_PROVIDER=s3, STORAGE_BUCKET, STORAGE_REGION,
STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, MALWARE_SCANNER_PROVIDER=external,
SECRET_PROVIDER=external, KMS_PROVIDER=external, AWS_REGION, SECRETS_MANAGER_PREFIX,
SECRETS_MANAGER_PREFLIGHT_SECRET_ID e KMS_KEY_ID. INTEGRATION_SECRET_KEY protege
evidências locais das fases 9P; sua continuidade/rotação exige procedimento.
Não preencher esse inventário com valores fictícios para aprovar produção.

Opcionais controladas: SESSION_COOKIE_NAME; TRUSTED_PROXY_HOPS (0–10, conforme proxy
conhecido); STORAGE_LOCAL_ROOT, STORAGE_ENDPOINT, STORAGE_FORCE_PATH_STYLE,
STORAGE_SIGNED_URL_TTL_SECONDS; WORKER_CONCURRENCY, WORKER_POLL_MS, WORKER_LEASE_MS,
WORKER_JOB_TIMEOUT_MS. Os limites efetivos estão em runtime-config.ts. Nunca aceitar
headers de proxy como prova de origem sem configurar e validar a topologia.

## Go/no-go

| Gate | GO local | NO-GO |
| --- | --- | --- |
| Base | SHA publicado e CI da 9P.5 confirmado | SHA diferente, CI ausente/reprovado |
| Configuração | Contrato local válido e segredos só no processo | Valores ausentes, host externo ou dependência externa |
| Banco | 34 migrations com hashes iguais, seed isolado e ensaio de restauração válido | Divergência, migration pendente/falha, restore inconclusivo |
| Qualidade | Prisma, tipos, lint, focais, suíte, build e smoke local aprovados | Qualquer gate falho |
| Segurança | Testes negativos e revisão sem bloqueador alto/crítico | Tenant, IDOR, segredo ou autorização vulneráveis |
| Onboarding | Etapas ensaiadas, responsáveis e aceite humano local | Etapa não executada, evidência presumida |
| Operação | Runbooks, limiares, recuperação e responsabilidades documentados | Responsável ou procedimento ausente |
| Piloto real/produção | Nunca liberados pela 9Q.2A | Cloud, APIs, recuperação produtiva e aprovação ainda não comprovadas |

`localReady` no painel representa verificações técnicas instantâneas, não aprovação
de todos os gates humanos/QA acima. Alertas e onboarding aparecem separadamente.

## Pendências explícitas da 9Q.2B

- Cloud, DNS/TLS, rede, IAM, storage, scanner, Secrets Manager/KMS e mínimo privilégio reais.
- Provedores de piloto, consentimentos, credenciais, mapeamentos, quotas e smokes REAL.
- API Clicksign pendente e smokes de Drive, e-mail, bancos, bureau, ERP e CRM.
- Imagens publicadas, implantação e rollback reais, RPO/RTO/PITR medidos no alvo.
- Alertas enviados a destinos reais, plantão, escalonamento e simulado de incidente.
- Revisão LGPD do cliente, contratos de suporte e aceite formal de piloto real/produção.
- Substituição do bloqueio produtivo por gates comprovados em entrega própria e auditada.

Nenhuma dessas pendências é evidência produzida nesta fase. Não houve commit/push.
