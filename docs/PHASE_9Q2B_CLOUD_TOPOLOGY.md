# Fase 9Q.2B — Topologia do ambiente cloud (piloto)

## Estado desta seção

Nenhum provedor cloud, região, VPC, load balancer ou DNS foi contratado ou informado até
o momento em que este documento foi escrito (2026-09-09). Por regra explícita da 9Q.2B
("TRUSTED_PROXY_HOPS deve corresponder à topologia real comprovada. Não adivinhar."),
nenhum valor de topologia abaixo é inventado — cada linha está marcada como
`COMPROVADO`, `HERDADO DO CÓDIGO` (decisão já embutida no código de fases anteriores,
verificável, mas ainda não implantada) ou `NÃO COMPROVADO — pendente de contratação`.

## O que já está decidido no código (9P.2 / 9Q), verificável e não fabricado aqui

| Camada | Decisão herdada | Evidência no repositório |
|---|---|---|
| Segredos | AWS Secrets Manager via SDK oficial (`SECRET_PROVIDER=external`) | `src/infrastructure/security/aws-security-adapters.ts`, `src/infrastructure/security/secret-provider.ts` |
| Cifragem | AWS KMS via SDK oficial (`KMS_PROVIDER=external`) | `src/infrastructure/security/aws-security-adapters.ts` |
| Storage de objetos | S3-compatible (aceita AWS S3, Cloudflare R2 ou MinIO por `STORAGE_ENDPOINT`/`STORAGE_FORCE_PATH_STYLE`) | `src/infrastructure/storage/storage-provider.ts` (`CloudObjectStorageProvider`) |
| Deploy | Dois processos de container (`web`, `worker`) a partir do mesmo `Dockerfile`, imagem identificada por SHA | `Dockerfile`, `.github/workflows/deploy-readiness.yml` |
| Migração | `prisma migrate deploy` executado uma única vez, fora do boot das réplicas | `docs/PHASE_9P2_CLOUD_PRODUCTION_RUNBOOK.md`, `src/infrastructure/release/production-preflight.ts` |
| Preflight | Fail-closed: banco, storage, Secret Manager, KMS, scanner e (adicionado nesta fase) alerting bloqueiam o preflight se indisponíveis ou mal configurados | `src/infrastructure/release/production-preflight.ts` |

Isso comprova a **forma** do deploy (dois processos, imagem imutável, migration única),
não a **topologia física** (região, rede, número de saltos de proxy). As duas coisas são
independentes e não devem ser confundidas em uma evidência de prontidão.

## O que permanece `NÃO COMPROVADO` — pendente de decisão/contratação humana

| Item | Por que não pode ser inferido |
|---|---|
| Provedor cloud e região específicos (AWS, e qual região) | `AWS_REGION`, `STORAGE_REGION` são variáveis de ambiente sem valor fixado no código; nenhuma conta/projeto foi identificado nesta sessão |
| Ambientes segregados piloto vs. produção (contas separadas? mesma conta com prefixo?) | Não há Terraform/CloudFormation/Pulumi no repositório definindo isso |
| Rede: VPC, sub-redes públicas/privadas, security groups, NAT | Nenhum IaC presente |
| Balanceador de carga e **quantidade exata de proxies entre o cliente e o processo Next.js** | Depende do provedor de LB/CDN escolhido (ALB direto, CloudFront+ALB, Cloudflare+ALB, etc.) — cada topologia produz uma contagem diferente de saltos `X-Forwarded-For` |
| DNS e TLS (registrador, certificado, renovação) | Não contratado |
| Dimensionamento de `web`/`worker` (réplicas, CPU/RAM) | Depende do orquestrador escolhido (ECS, EKS, Fly, outro) — não decidido |
| PostgreSQL gerenciado real (RDS? Aurora? outro?) | Nenhuma instância provisionada; `DATABASE_URL` de piloto/produção não existe |
| Scanner antimalware externo real | `MALWARE_SCANNER_PROVIDER=external` no schema de config, mas **nenhum adapter concreto existe no código** — `createMalwareScanner` sempre retorna `UnavailableProductionScanner` (falha fechado) até um fornecedor real ser integrado. Ver `src/infrastructure/storage/upload-policy.ts:13-24`. |
| Backup gerenciado, PITR, retenção | Depende do provedor de banco escolhido; nada habilitado |
| Destino real de alerta (Slack/PagerDuty/Datadog/etc.) | `ALERTING_PROVIDER`/`ALERTING_EXTERNAL_ENDPOINT` adicionados nesta fase como gate fail-closed, mas nenhum destino foi contratado |

## `TRUSTED_PROXY_HOPS` — regra de preenchimento (não um valor)

O código (`src/infrastructure/http/trusted-proxy.ts`) já implementa o parsing seguro e o
fallback fail-closed (produção recusa tráfego com config inválida; middleware volta a 0
saltos fora de produção). O que falta **não é código**: é o número real de proxies que a
topologia contratada insere entre o cliente e o processo Next.js. Regra de contagem a
aplicar quando a topologia existir:

1. Contar cada hop que **o time controla e confia** (LB gerenciado, CDN gerenciado) — nunca
   um hop cuja cabeça de `X-Forwarded-For` o cliente possa forjar.
2. Um ALB da AWS na frente do container = 1 hop. Um CDN inserindo outro cabeçalho antes do
   ALB pode ser 2 hops — depende de o CDN escrever/preservar `X-Forwarded-For` corretamente.
3. Validar com um request real: comparar o IP de origem observado no LB/CDN com o que
   `resolveTrustedClientAddress` calcula para o valor de `TRUSTED_PROXY_HOPS` proposto,
   antes de aceitar o valor como evidência.
4. Documentar o resultado deste teste como evidência (linha `TRUSTED_PROXY_HOPS` na matriz
   Go/No-Go), não como suposição.

## Bloqueio explícito

Nenhum destes itens é declarado como decidido, testado ou aprovado por este documento.
Todos permanecem bloqueadores de piloto conforme `docs/PHASE_9Q_RELEASE_CONTRACT.md` §5,
até que exista topologia real contratada e evidência de teste contra ela.
