# Fase 9Q.2B — Rotação e revogação de segredos

## Regra geral

Nenhum segredo entra em Git, log, arquivo temporário ou resposta HTTP. `logger.ts`
(`src/infrastructure/observability/logger.ts`) já redige por padrão de nome de campo
(`password|secret|token|...`) e por padrão de valor (`Bearer ...`, `postgres://user:pass@`,
CPF/CNPJ) em qualquer log estruturado — mas a rotação em si nunca deve depender disso
como única defesa: o valor não deve ser digitado em lugar nenhum além do prompt seguro.

## Como um segredo é rotacionado (procedimento)

1. Gerar o novo valor no sistema de origem (provedor de integração, ou um valor aleatório
   para credenciais internas). Nunca reaproveitar um valor de outro ambiente.
2. Executar `scripts/local/rotate-integration-secret.ps1 -SecretId <nome> -Region <regiao>`
   (script gitignored, ver `scripts/local/README.md`) — o valor é digitado via
   `Read-Host -AsSecureString`, nunca passado como argumento.
3. O AWS Secrets Manager mantém automaticamente a versão anterior (`AWSPREVIOUS`) até a
   próxima rotação — não é preciso "guardar" o valor antigo manualmente.
4. Trocar a aplicação (via reinício controlado ou hot-reload do cofre, conforme suportado)
   para a nova versão e observar erros de autenticação por uma janela de segurança antes
   de revogar a versão anterior no fornecedor externo (quando o fornecedor externo também
   versiona credenciais, ex.: Clicksign/ERP).
5. Só então revogar a versão anterior no Secrets Manager, se necessário
   (`scripts/local/revoke-integration-secret.ps1`), respeitando janela de recuperação
   mínima de 7 dias (não é exclusão imediata).

## Quando revogar de emergência (comprometimento suspeito)

1. Revogar primeiro no **fornecedor externo** (Clicksign, banco/bureau, ERP/CRM, provedor
   de e-mail) — isso invalida o uso do valor mesmo que ele ainda exista no cofre.
2. Rotacionar no Secrets Manager imediatamente após (não esperar o ciclo normal).
3. Registrar o evento como incidente (`docs/PHASE_9Q2B_OBSERVABILITY_INCIDENTS.md`),
   preservando evidência de uso indevido se houver (AuditLog), sem incluir o valor do
   segredo na evidência.
4. Revisar `IntegrationSecretRotationLog`/equivalente de auditoria (se existir na
   modelagem de domínio) para confirmar a linha do tempo.

## O que este procedimento não cobre nesta fase

- Rotação automática agendada (ex.: Lambda de rotação nativa do Secrets Manager) — não
  configurada; hoje a rotação é sempre manual e auditável por decisão humana.
- Execução real contra uma conta AWS — nenhuma conta está disponível nesta sessão; os
  scripts estão prontos, mas **não foram executados**.

## Segredos internos (fora de integrações externas)

`SESSION_SECRET`, `INTEGRATION_SECRET_KEY` (cofre local, apenas dev/test) e credenciais de
storage seguem o mesmo padrão: nunca fixados no repositório, sempre injetados pelo runtime
da plataforma de deploy, nunca montados via `.env` na imagem (conforme
`docs/PHASE_9P2_CLOUD_PRODUCTION_RUNBOOK.md`).
