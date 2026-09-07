# Fase 9P.3C — e-mail transacional local

Base: `470933d67c16a0a090c24cbeefe97c9feefb7f43`. CI da 9P.3B aprovado:
https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34062682209.

## Escopo autorizado

Camada local provider-neutral. Nenhum provedor transacional escolhido, domínio remetente
presumido, credencial solicitada ou chamada real autorizada. Não há transporte HTTP nativo.
`UNASSIGNED` identifica ausência de provedor, não uma integração operacional.

## Contratos e segurança

- Instalação inicia DISABLED/PAUSED. MOCK permite apenas simulação. REAL registra intenção,
  mas enqueue e execução recusam `REAL_NOT_CONFIGURED` antes de transporte ou credenciais.
  Campos extras como `verified`, endpoint ou segredo são rejeitados. A campanha final deve
  implementar comprovação no servidor; uma flag enviada pelo cliente nunca será suficiente.
- Transporte injetável `EmailTransport` recebe mensagem, chave estável e AbortSignal.
  Nesta fase, somente `LOCAL_SIMULATION` e recibo `SIMULATED` são aceitos. Não confirma
  aceitação, entrega, abertura, bounce nem reclamação. Injeção é restrita à composição interna.
- Templates NOTICE_V1 e APPROVAL_REQUIRED_V1, português, texto e HTML escapado. Um
  destinatário, duas variáveis limitadas, sem HTML livre, URLs, anexos, headers ou campanhas.
  Mudança semântica futura exige outra versão do template. Não há envio automático de eventos
  de negócio: o produtor deve chamar explicitamente a action autorizada.
- Configure/enqueue/retry consultam capacidade e associação ativa persistida, inclusive usuário
  ativo. Worker revalida o autor original. Consultas públicas não retornam destinatário ou corpo.
- AES-256-GCM com nonce aleatório e AAD tenant/instalação/job protege o conteúdo da fila.
  Chave derivada com separação de domínio de INTEGRATION_SECRET_KEY já existente; não há
  fallback. A chave local não é credencial de API e não é registrada. HMAC compara conteúdo
  idempotente sem expor endereço por hash simples. Rotação requer drenar ou migrar os jobs
  cifrados; não há rotação automática nesta fase. Jobs antigos sem chave ficam bloqueados.

## Fila, concorrência e recuperação

Reutiliza IntegrationJob, IntegrationDeadLetter, IntegrationRateLimitState e AuditLog;
nenhuma migration nova. ID determinístico inclui tenant, instalação e chave de idempotência.
Mesmo conteúdo retorna mesmo job; conteúdo divergente é recusado. Mutex transacional por
organização serializa enqueue, configuração e consumo local, com PK como proteção adicional.
Locks de associação/usuário protegem autorização durante a transação.

Worker usa claim/lease da fundação, transação com lock de job e fencing por leaseOwner e tentativa.
Recibo SIMULATED, estado SUCCEEDED, rate limit e auditoria são atômicos. Reexecução concluída
não simula outra vez. Em rollback só a simulação local pode repetir; nenhuma garantia de
exactly-once externo é alegada. Limite de 1–60 simulações concluídas por minuto por instalação,
padrão 10, persistido. Falhas não consomem recibos de simulação. Transporte cooperativo recebe
timeout de 10s; transação limita 15s. Transportes não cooperativos não são suportados.

Retry automático usa classificação segura e backoff exponencial com jitter, até cinco tentativas;
rate limit informa espera. Erro permanente ou esgotamento cria dead-letter e auditoria na mesma
transação. Erros e dead-letter não copiam conteúdo ou mensagens brutas do transporte.
Retry manual exige INTEGRATION_RETRY, autor original ainda autorizado e instalação MOCK ativa;
preserva ID/conteúdo e registra resolução da dead-letter. Não há retry manual de sucesso.

## Uso local

Actions em `src/app/actions/transactional-email.ts`: criar instalação, configurar MOCK,
enfileirar template com chave idempotente, consultar os últimos 100 estados e solicitar
retry manual. O worker existente consome SEND_TRANSACTIONAL_EMAIL automaticamente.
Somente IDs/estados são retornados; configurar REAL preserva a intenção, mas não habilita envio.
Os testes de banco demonstram esse fluxo completo com destinatários sintéticos `.invalid`.

## Verificação da entrega

QA: Prisma validate/generate, migrations existentes e seed em banco efêmero, TypeScript,
ESLint, testes focais, suíte completa, build produtivo e git diff --check. Auditoria local
separada do QA; não equivale a auditoria independente. Sem commit/push por orientação atual.

Pendências REAL: seleção do provedor, domínio/remetente, credenciais, prova de configuração,
transporte real, idempotência do provedor e reconciliação de resultados ambíguos, quotas por
tentativa, webhooks autenticados e evidências de entrega/bounce. Retenção e rotação de conteúdo
precisam política operacional antes de produção. O piloto transacional não está operacional.
