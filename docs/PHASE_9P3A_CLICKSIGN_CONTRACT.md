# Fase 9P.3A — Contrato do conector Clicksign API 3.0

## Objetivo e limite

Esta fase implementa o primeiro adapter real de assinatura eletrônica do REDE Intelligence, exclusivamente sobre a API Clicksign 3.0 baseada em Envelope. O domínio continua provider-neutral e não conhece HTTP, SDK, URLs nem payloads Clicksign. Widget Embedded, Google Drive, e-mail e fases posteriores estão fora do escopo.

O smoke controlado no Sandbox comprovou autenticação, criação e encerramento de um envelope e permitiu uma sondagem estrutural somente leitura. Produção continua não comprovada e permanece fail-closed.

## Fundação já existente e reutilizada

- `SignatureProvider` é a porta de domínio; `SignatureRequest`, `SignatureParty` e `SignatureEvent` são a fonte oficial do fluxo de assinatura.
- `ConnectorDefinition`, `ConnectorInstallation` e `CredentialReference` já modelam provider, instalação por organização, configuração e referência de segredo.
- `IntegrationInboxEvent` já possui unicidade `(installationId, provider, eventId)`; `SignatureEvent.sourceInboxEventId` garante projeção de domínio única.
- `IntegrationJob`, o worker, retry/backoff/jitter, dead-letter, quarentena, rate limit e circuit breaker da fundação de integrações serão reutilizados.
- `contractFileStorage` mantém documentos fora do PostgreSQL; o banco guarda apenas referência e checksum.
- `integrationSecretVault` usa cofre local criptografado somente fora de produção e exige cofre externo em produção, sem fallback.
- RBAC reutiliza capacidades existentes. Configuração/credenciais dependem das capacidades administrativas de integrações; envio/cancelamento preserva a autorização mutável do domínio comercial. Nenhuma capability nova será criada.

## Modos e feature gate por organização

O modo efetivo é lido da `ConnectorInstallation.configuration` da própria organização:

- `DISABLED`: falha fechado; nenhuma chamada externa.
- `MOCK`: usa apenas o adapter MOCK já existente; nenhuma chamada externa.
- `REAL`: exige instalação Clicksign `ACTIVE`, direção compatível, feature gate `signatureEnvelopeEnabled: true`, configuração válida e credencial `ACTIVE` acessível pelo cofre.

Configuração mínima não secreta: `mode`, `signatureEnvelopeEnabled`, `environment` (`SANDBOX` ou `PRODUCTION`), `baseUrl`, autenticação padrão e limites. Token e segredo HMAC formam um bundle JSON guardado no cofre; o banco mantém somente o `CredentialReference.secretRef`, nunca os valores.

Hosts da API permitidos: `sandbox.clicksign.com` para Sandbox e `app.clicksign.com` para produção. Para o PDF assinado, a sondagem comprovou exclusivamente o host pré-assinado Sandbox `clicksign-sandbox-content.s3.amazonaws.com`; ele é aceito somente pelo transporte de evidência, sem `Authorization` ou headers JSON:API. Nenhum wildcard `*.amazonaws.com` é aceito. O host produtivo de conteúdo não foi comprovado e permanece bloqueado. URLs fornecidas por cliente, credenciais embutidas, portas não padrão e redirecionamentos são rejeitados.

## Operações Clicksign 3.0

O adapter usa o token puro em `Authorization`, conforme o contrato da API 3.0, além de `Accept`/`Content-Type: application/vnd.api+json`, timeout, resposta limitada e `redirect: error`.

Fluxo de envio confirmado pela documentação oficial:

1. `POST /api/v3/envelopes` cria envelope `draft`.
2. `POST /api/v3/envelopes/{envelopeId}/documents` inclui PDF por `content_base64`.
3. `POST /api/v3/envelopes/{envelopeId}/signers` inclui cada signatário.
4. `POST /api/v3/envelopes/{envelopeId}/requirements` cria requisito de qualificação (`agree`) e autenticação (`provide_evidence`).
5. `PATCH /api/v3/envelopes/{envelopeId}` define `status: running`.
6. `POST /api/v3/envelopes/{envelopeId}/notifications` dispara a notificação configurada.

Também são contratados `GET /api/v3/envelopes/{envelopeId}` para consulta e `PATCH /api/v3/envelopes/{envelopeId}` para cancelamento permitido pela API/configuração. A sondagem real comprovou a recuperação do documento por `GET /api/v3/envelopes/{envelopeId}/documents`, seguida de `GET /api/v3/envelopes/{envelopeId}/documents/{documentId}`. O PDF assinado fica em `data.links.files.signed`; `data.links.files.ziped` identifica um ZIP auxiliar, que não é baixado nem tratado como certificado nesta fase. Não existe certificado separado no contrato observado ou documentado. A URL pré-assinada vive somente em memória, passa por allowlist exata e nunca é persistida ou registrada.

### Reconciliação autenticada de assinaturas

O webhook validado por HMAC permanece o caminho primário. Quando ele não alcança o ambiente local, a porta provider-neutral pode executar uma recuperação explícita e autenticada: lista o único documento esperado, confirma seu detalhe em `closed` e consulta os eventos desse documento. Somente o evento de nome exato `sign`, cujo `attributes.data.signer.key` corresponda exatamente ao `externalPartyId` já persistido, comprova a assinatura individual. `signature_started`, `add_signer`, `document_closed`, `auto_close` e eventos desconhecidos nunca promovem uma parte.

A recuperação não fabrica webhook nem `IntegrationInboxEvent`. Uma função interna persiste atomicamente a transição `PARTY_SIGNED`, a evidência `SignatureReconciliationEvidence` e sua auditoria. A origem é `PROVIDER_RECONCILIATION`; o evento externo e o documento validado são referenciados por SHA-256 completo. IDs ausentes, repetidos, desconhecidos ou ambíguos falham fechado. Ausência temporária de `sign` permite retry limitado; estrutura incompatível e correlação divergente são permanentes.

O REDE continua sendo o estado operacional oficial. Uma assinatura existente apenas no provider não altera o domínio até que documento fechado, evento `sign`, envelope, instalação, tenant, versão, checksum e `externalPartyId` sejam cumulativamente validados. Todas as partes esperadas precisam ser reconciliadas antes de consultar o estado final, baixar o PDF e promover a solicitação a `ASSINADO`.

## Limites e privacidade

- Documento aceito: PDF (`application/pdf`) com assinatura `%PDF-`, até 10 MiB antes de Base64 (limite público atual por arquivo; o envelope suporta até 100 MB no total).
- Webhook: até 1 MiB, `application/json`, corpo bruto lido uma única vez.
- Resposta JSON da API: até 2 MiB; PDF assinado: até 25 MiB.
- Timeout padrão: 15 segundos, configurável apenas dentro de faixa segura.
- Logs e erros nunca contêm token, segredo HMAC, Authorization, cookie, query string, URL temporária, conteúdo documental, CPF, telefone ou e-mail completo.
- O REDE não envia CPF nesta fase. Nome/e-mail são enviados à Clicksign somente por necessidade do fluxo, mas não são reproduzidos em logs ou payload operacional do job.

## Webhook e tenant

Endpoint público: `/api/webhooks/clicksign/{installationId}`. O identificador é somente um localizador opaco; a organização é sempre obtida da instalação registrada no servidor. Nenhum `organizationId`/tenant do corpo, cabeçalho ou query é aceito.

Sequência obrigatória:

1. localizar instalação Clicksign ativa e obter sua referência HMAC;
2. validar `Content-Type` e tamanho;
3. calcular HMAC-SHA256 sobre os bytes crus;
4. comparar comprimentos e bytes com `timingSafeEqual`;
5. somente após sucesso interpretar JSON e validar o envelope/evento;
6. persistir uma vez no inbox;
7. enfileirar `PROCESS_SIGNATURE_WEBHOOK` e responder sem aplicar domínio;
8. worker revalida job, instalação, organização, envelope e versão antes de projetar o evento.

Assinatura inválida ou JSON malformado não cria inbox nem dado de domínio. Evento desconhecido válido vai para quarentena. Mesmo `eventId` com checksum diferente vai para quarentena como conflito; replay idêntico é no-op. A constraint existente assegura a corrida de inserts e o worker assegura efeito único por `sourceInboxEventId`.

## Mapeamento de estados

| Clicksign / evento | Estado REDE | Regra |
| --- | --- | --- |
| `draft` | `PREPARADO` | Nunca implica envio ou assinatura. |
| `running` / ativado | `AGUARDANDO_ASSINATURAS` | Exige envelope da instalação e checksum local compatível. |
| assinatura individual | parte `SIGNED` | Webhook primário ou reconciliação autenticada; ambos exigem signer externo previamente associado à parte. |
| recusa | parte `DECLINED`, solicitação `RECUSADO` | Não regride estados terminais. |
| `canceled` | `CANCELADO` | Não sobrepõe `ASSINADO`; precisa pertencer à instalação. |
| erro operacional | `ERRO` ou retry | Erro retryable permanece operacional; erro terminal seguro é auditado. |
| `closed` | `ASSINADO` | Somente com todas as partes assinadas, versão/checksum compatível, documento remoto `closed` e PDF assinado válido. |

Eventos atrasados não regressam `ASSINADO`, `RECUSADO` ou `CANCELADO`. `closed` sem todas as partes, PDF assinado válido, vínculo de instalação ou versão compatível é conflito/quarentena, nunca promoção silenciosa. Ausência temporária do link `signed` usa o retry limitado do job; formato incompatível é permanente.

## Erros e resiliência

- 401: credencial ausente/inválida, permanente até intervenção.
- 403: permissão negada, permanente.
- 404: recurso não encontrado/vínculo inválido, permanente.
- 409: conflito/idempotência, tratado por reconciliação; sem repetição cega.
- 422: configuração ou payload inválido, permanente.
- 429: rate limit, retry respeitando `Retry-After`.
- timeout/rede/5xx: retry com backoff exponencial e jitter, circuit breaker e dead-letter ao esgotar.

Mensagens ao operador são em português, sanitizadas e incluem correlation ID. O detalhe bruto do provider é classificado e não é propagado quando puder conter dados pessoais ou segredos.

## Banco e evidência

### Origem da reconciliação e ressalvas da reauditoria

`SignatureEvent.sourceInboxEventId` preserva a cardinalidade 1:1 existente, com o inbox de fechamento no evento `COMPLETED`. A migration aditiva `20260905220000_phase_9p3a_immutable_signature_evidence` acrescenta `SignatureReconciliationEvidence`: uma linha por parte, FK para a parte, solicitação, instalação, evento `PARTY_SIGNED` e inbox real (opcional, relação N:1). Portanto, duas partes reconciliadas pelo mesmo fechamento mantêm vínculo relacional antes de existir `COMPLETED`, mesmo se o PDF falhar. Execução manual deixa a FK do inbox nula. Não existe backfill a partir de JSON histórico nem inbox fabricado.

A evidência contém origem explícita, tipo `SIGN_EVENT`, provider, checksum da versão local e SHA-256 completo de evento, documento, envelope e signatário externos. Nenhum identificador externo bruto, PII, URL temporária ou payload é copiado para essa tabela. IDs locais existem somente como contexto relacional. O JSON da parte permanece uma projeção de conveniência; a evidência oficial é o registro protegido pelo PostgreSQL.

Triggers recusam UPDATE, DELETE e TRUNCATE da evidência; FKs RESTRICT impedem apagar seu contexto por cascata. Triggers adicionais protegem a parte, o evento, a identidade/checksum da solicitação e os fatos autenticados do inbox referenciado. Status, retry e erro operacional do inbox continuam mutáveis. A aplicação usa papel PostgreSQL sem privilégios administrativos; uma conta administrativa capaz de remover triggers está fora dessa garantia.

A persistência usa lock da solicitação e revalida contexto após a chamada externa. Assinaturas e evidências são gravadas na mesma transação. Replay encontra a prova existente, verifica sua correspondência e não a reescreve. O caminho público de `recordPartySigned` não recebe evidência de reconciliação. O handler de `ENVELOPE_CLOSED` permite recuperar partes `PENDING` pelo provider autenticado; cancelamento e recusa continuam bloqueados.

Antes do provider e de qualquer promoção, o inbox informado deve ser autenticado, não rejeitado/quarentenado, da mesma organização, instalação e provider Clicksign. Seu payload normalizado precisa identificar exatamente o envelope esperado e um evento `ENVELOPE_CLOSED`, com eventId coerente com o registro. Um inbox já projetado em outro contexto é incompatível. Falhas usam `SOURCE_INBOX_INVALID` permanente; replay não reescreve evidências nem duplica eventos.

O shape observado na sondagem não traz referência de documento nos eventos. O vínculo é garantido pela consulta a `/envelopes/{envelopeId}/documents/{documentId}/events`, usando o único ID obtido na lista e confirmado no detalhe `closed`. A URL final deve ser exatamente a requisitada, inclusive caminho e query. Respostas de outro documento ou endpoint são recusadas. Não se inventa campo no payload nem se reutiliza cache de eventos de outro endpoint; testes usam fixtures roteadas por URL e respostas cruzadas.

A assinatura pública de `completeRealSignatureRequest` não aceita provider injetado. A resolução é interna; testes substituem o módulo de composição com mocks isolados do Vitest. O worker mapeia exaustivamente os reason codes de `SignatureReconciliationError` e de `ClicksignProviderError`, além de suas classes de transporte. `DOCUMENT_NOT_CLOSED` e estados inelegíveis são permanentes (`BUSINESS_RULE`); estrutura e vínculo inválidos são `VALIDATION`. Evidência/link pendente e indisponibilidade transitória do transporte preservam retry limitado. Solicitação ausente ou de outro tenant tem o mesmo erro seguro com reason code e correlation ID. Logs não repetem a mensagem bruta do provider; correlações de execução são opacas, inclusive para jobs legados que continham o inbox no campo original.

O catálogo passa de 30 para 31 migrations. As 30 anteriores permanecem intactas. Backup restaurado e validado precede a aplicação da migration em cada banco com dados existentes. O registro factual da campanha informa o ambiente efetivamente alterado; QA local não comprova aplicação em produção nem smoke externo.

O REDE permanece fonte oficial do documento, versão, signatários e aprovação. Clicksign fornece execução e evidência externa. O PDF assinado é copiado para `contractFileStorage`; artefato auxiliar provider-neutral é opcional e precisa ser semanticamente identificado. O ZIP exposto pela Clicksign não é duplicado como certificado nem exigido para conclusão. URLs temporárias não são persistidas. A promoção final é transacional e condicionada às invariantes deste contrato.

## Não comprovado nesta fase

- nomes completos de todos os eventos emitidos por cada configuração de conta;
- conteúdo e utilidade do ZIP auxiliar exposto em `data.links.files.ziped`;
- host produtivo de conteúdo, SLA, cobrança e validade jurídica de uma conta específica.

Esses pontos permanecem explicitamente pendentes e o código deve falhar fechado quando dependente deles.

## Riscos residuais aceitos para reauditoria focal

1. Falha parcial do fluxo multi-etapas não executa cancelamento automático do envelope.
2. A defesa de idempotência externa permanece local enquanto não houver suporte oficial comprovado pelo provider.
3. O smoke REAL comprovou Sandbox, mas o fluxo de webhook público e a recuperação produtiva continuam pendentes.
