# Fase 9Q.2B — IAM, KMS e storage: menor privilégio

Nenhuma política abaixo foi aplicada a uma conta AWS real — não há conta/ambiente
disponível nesta sessão. São **templates prontos para revisão humana e aplicação**,
escritos a partir do código já existente (o que cada papel efetivamente chama), não de
suposição sobre a infraestrutura final.

## Quatro identidades, nunca uma só

| Identidade | Usa | Nunca deve ter |
|---|---|---|
| `rede-app-runtime` (processo `web`) | `GetSecretValue`/`DescribeSecret` no prefixo do app, `Decrypt`/`Encrypt` na chave KMS do app, `PutObject`/`GetObject`/`HeadObject`/`DeleteObject` no bucket, `s3:GetObject` para URL assinada | `CreateSecret`, `DeleteSecret`, `iam:*`, `kms:CreateKey`, acesso a outro bucket/prefixo |
| `rede-worker-runtime` (processo `worker`) | Mesmo escopo do app-runtime (fila roda no Postgres, não em fila gerenciada própria) | Igual ao app-runtime |
| `rede-deploy-pipeline` (CI/CD, ex.: GitHub Actions via OIDC) | Push de imagem ao registry escolhido, execução do job `prisma migrate deploy` com credencial de banco de migração (não a de runtime) | Acesso de leitura a segredos de negócio, `Decrypt` do KMS de dados |
| `rede-operator-human` (rotação manual, scripts em `scripts/local/`) | `CreateSecret`/`PutSecretValue`/`DeleteSecret` no prefixo, `DescribeKey` no KMS | `Decrypt`/`Encrypt` de dados de negócio (rotação não precisa ler o valor cifrado de arquivos do storage), `s3:GetObject` de dados de tenant |

Nenhuma identidade permanente de administrador é usada por aplicação, worker ou pipeline.
Acesso administrativo humano (console) é sempre via SSO com MFA e sessão temporária —
fora do escopo deste repositório.

## Política `rede-app-runtime` (e `rede-worker-runtime`, mesmo shape)

Placeholders `${...}` devem ser substituídos pelos valores reais no momento da aplicação;
nenhum deles é inventado aqui.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SecretsReadOnly",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      "Resource": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRETS_MANAGER_PREFIX}/*"
    },
    {
      "Sid": "KmsDataKeyOnly",
      "Effect": "Allow",
      "Action": ["kms:Encrypt", "kms:Decrypt", "kms:DescribeKey"],
      "Resource": "${KMS_KEY_ARN}"
    },
    {
      "Sid": "StorageObjectScoped",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::${STORAGE_BUCKET}/*"
    },
    {
      "Sid": "StorageHealthCheck",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::${STORAGE_BUCKET}",
      "Condition": { "StringLike": { "s3:prefix": ["*/.rede-health"] } }
    }
  ]
}
```

Correspondência com o código: `secretsmanager:GetSecretValue`/`DescribeSecret` são
exatamente as chamadas de `AwsSecretsManagerAdapter.read`/`healthCheck`
(`src/infrastructure/security/aws-security-adapters.ts:29-46`); `kms:Encrypt`/`Decrypt`
correspondem a `AwsKmsAdapter.encrypt`/`decrypt`; `s3:PutObject`/`GetObject`/`DeleteObject`
correspondem a `CloudObjectStorageProvider.put`/`get`/`delete`
(`src/infrastructure/storage/storage-provider.ts:75-87`). O runtime nunca chama
`CreateSecret`/`DeleteSecret`/`CreateKey` — essas ações não aparecem em nenhum adapter de
runtime, só em `AwsSecretsManagerAdapter.create`/`revoke`, reservadas ao papel operador.

## Política `rede-operator-human` (rotação)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SecretLifecycle",
      "Effect": "Allow",
      "Action": ["secretsmanager:CreateSecret", "secretsmanager:PutSecretValue", "secretsmanager:DeleteSecret", "secretsmanager:DescribeSecret", "secretsmanager:TagResource"],
      "Resource": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRETS_MANAGER_PREFIX}/*"
    },
    {
      "Sid": "KmsDescribeOnly",
      "Effect": "Allow",
      "Action": ["kms:DescribeKey"],
      "Resource": "${KMS_KEY_ARN}"
    }
  ]
}
```

Sem `kms:Decrypt` — a rotação só grava um valor novo (`PutSecretValue`), nunca precisa ler
o antigo. Sem acesso a S3 — dados de tenant não fazem parte de rotação de credencial.

## Política `rede-deploy-pipeline`

Depende do registry/orquestrador que vier a ser escolhido (não decidido — ver
`docs/PHASE_9Q2B_CLOUD_TOPOLOGY.md`). O contrato fixo, independente do provedor, é: a
pipeline nunca recebe a credencial de runtime da aplicação (`rede-app-runtime`), e a
migration roda com uma credencial de banco separada, escopada apenas ao schema público,
sem `SUPERUSER`/`CREATEDB` — conforme já exigido em
`docs/PHASE_9P2_CLOUD_PRODUCTION_RUNBOOK.md` ("usuário sem privilégios administrativos").

## KMS: chave dedicada, nunca compartilhada com outro sistema

- Uma CMK por ambiente (piloto ≠ produção), com rotação automática anual habilitada no
  provedor (não uma responsabilidade do código deste repositório).
- Política de chave (key policy) restringe `kms:Decrypt`/`Encrypt` às duas roles de
  runtime; nenhuma outra conta/serviço tem `kms:*` sobre essa chave.
- `KMS_KEY_ID` no ambiente é o alias ou ARN da chave — nunca o material da chave em si
  (que nunca sai do KMS).

## Falhas classificadas (já implementado, não pendente)

`classifyProductionDependencyFailure` (`src/infrastructure/security/production-dependency-error.ts`)
já distingue, para qualquer chamada AWS: credencial ausente/expirada
(`MISSING_CREDENTIALS`), permissão negada (`PERMISSION_DENIED`, HTTP 403), timeout
(`TIMEOUT`), indisponibilidade de serviço (`SERVICE_UNAVAILABLE`, 5xx) e falha
inesperada (`UNEXPECTED`) — sem nunca vazar a mensagem bruta do provedor. Isso vale para
Secrets Manager, KMS e (adicionado nesta fase) o transporte de alerta. Testado em
`production-preflight.test.ts` e `alert-dispatcher.test.ts`.

## Bloqueio

Nenhuma destas políticas foi aplicada. Aplicação real, teste de `AccessDenied` proposital
(confirmar que o menor privilégio realmente bloqueia o que deveria) e revisão por um
responsável de segurança humano permanecem pendentes — bloqueador de piloto.
