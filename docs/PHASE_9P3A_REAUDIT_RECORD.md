# 9P.3A — reauditoria da correção bloqueadora

Data: 2026-09-05. Base: `523ed64f0a96f65ed37ef7fe4e250886f5060b5f`.
Escopo: última reprovação de M1, handler de fechamento, composição de erros do adapter/worker e correlação nos logs.
Método: revisão local do código, consulta somente leitura do catálogo PostgreSQL e testes adversariais executados.
Esta é uma auditoria local do agente executor; não é um parecer independente de terceiro.

## Veredito técnico

**Gate da fase reaberto após o smoke e o CI do commit `793b92c`.**
O QA abaixo registra a execução anterior, cujo alcance foi insuficiente: o teste do handler
substituía o resolvedor, e o seed foi validado sobre backup já populado. A tentativa REAL
subsequente encontrou uma falha de composição e o CI encontrou uma reserva demonstrativa
vencida. As correções e a nova validação constam no registro complementar ao fim deste documento.

| Achado | Evidência da correção | Resultado |
| --- | --- | --- |
| M1 — origem mutável, ausente quando PDF falha | `SignatureReconciliationEvidence` contém FK para parte, solicitação, evento `PARTY_SIGNED`, instalação e inbox real N:1. A criação é atômica com a assinatura, antes do download. | Encerrado localmente |
| M1 — proteção no PostgreSQL | Catálogo confirmou 7 triggers habilitados e 5 FKs RESTRICT. Testes recusaram UPDATE, DELETE, TRUNCATE, alteração de JSON/evento/inbox/checksum e exclusão por cascata. | Encerrado localmente |
| M1 — origem manual | FK do inbox nula e prova explícita persistida. Nenhum backfill de JSON histórico; nenhum inbox criado pela reconciliação. | Encerrado localmente |
| Handler não alcançava reconciliação | Teste chama `processClicksignWebhookJob` com duas partes PENDING; falha do PDF deixa duas provas, zero conclusão e zero quarentena; retry conclui uma vez. | Encerrado localmente |
| B1 — adapter entregava CONFLICT → RETRY | Tabelas exaustivas cobrem ambos os tipos de erro e classes de transporte. Teste usa adapter real com transporte controlado e prova `DOCUMENT_NOT_CLOSED` → BUSINESS_RULE → DEAD_LETTER. | Encerrado localmente |
| B1 — tenant sem erro seguro | Consulta ausente/alheia na reconciliação lança `SignatureReconciliationError`, com reason code e UUID de correlação, sem identificar o alvo. | Encerrado localmente |
| Log expunha inbox em correlationId | Novos jobs recebem UUID; worker não imprime a correlação legada. Teste captura início e falha de job contendo `clicksign:private-inbox-id`. | Encerrado localmente |
| B2 — injeção de provider | Assinatura exportada mantém quatro argumentos; resolução interna; nenhum setter ou provider controlado por action/API. Evidência removida do input público de `recordPartySigned`. | Preservado |
| B3 — documento cruzado | Consulta de eventos mantém endpoint do documento validado e URL final exata; testes de resposta cruzada continuam aprovados. Hash completo do documento fica na prova. | Preservado |

## QA comprovado

- Prisma validate/generate/deploy e seed: aprovados.
- TypeScript e ESLint: aprovados.
- Focais: **140/140 testes, 6/6 arquivos**, sem skip, saída zero.
- Wrapper oficial: **954/954 testes, 114/114 arquivos**, sem skip, saída zero.
- Build com `NODE_ENV=production`: aprovado, 28 páginas geradas.
- `git diff --check`: aprovado.
- As 30 migrations anteriores e `.env` não foram alterados. Nova migration aditiva: uma.
- Nenhuma chamada externa de assinatura durante o QA. Transportes e credenciais dos testes são controlados.

Os primeiros testes focais detectaram falta de chave efêmera no ambiente e interferência de
fixture de instalação que precisava permanecer retida por causa das FKs imutáveis. A fixture
agora é pausada ao fim do teste. A execução conclusiva usou cluster isolado na porta 55433,
com o guard original de banco preservado. Nenhum teste ou timeout foi flexibilizado.
O primeiro build falhou com `NODE_ENV` inadequado; a execução produtiva explícita passou.

Logs privados de execução: `work/9p3a-focal-isolated.log`, `work/9p3a-full.log`,
`work/9p3a-build.log`, `work/9p3a-lint.log` e `work/9p3a-readonly-audit.json`.

## Banco, evidência histórica e riscos

O backup e sua restauração constam em `REDE_CAMPAIGN_CHECKPOINTS.md`. A migration foi aplicada
após validação real do backup. Seu SHA-256 é
`476cc1db5eb51ecd7b8a70475e069de3e7e4a080b5f3666c443e962a297fb834`.

O envelope histórico foi localizado no banco de testes da porta 55432. A solicitação continua
`AGUARDANDO_ASSINATURAS`, com parte PENDING e checksum correto. Instalação PAUSED, credencial
ABSENT. O novo executor manual passou no preflight; não fabricou inbox nem repetiu o smoke.

Permanecem não comprovados: conclusão REAL com o token atual, webhook público, host produtivo
de conteúdo e operação cloud. Os demais riscos residuais do contrato Clicksign permanecem
explicitamente registrados. Triggers não protegem contra um administrador que os remova.
O código está apto à validação de CI; esse resultado não declara produção operacional.

## Reabertura — smoke e CI de `793b92c`

- CI [33994120122](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/33994120122):
  falhou no seed em banco vazio. A reserva tinha expiração fixa em `2026-09-05T00:00:00Z`.
  Install, Prisma validate/generate e as 31 migrations passaram antes da falha.
- Smoke manual, execução única: `PROVIDER_RECONCILIATION_UNAVAILABLE`, correlação
  `e5e715de-a03a-4c1f-89c7-7946fe56b9ea`. O wrapper de `clicksignProviderForOrganization`
  omitia `reconcileSignatures`, embora o adaptador o implementasse. A falha ocorreu antes
  da consulta externa de reconciliação. Não é evidência de token inválido.
- Limpeza confirmada: credencial removida, instalação PAUSED, solicitação
  AGUARDANDO_ASSINATURAS e parte PENDING. O relatório original foi preservado em arquivo
  privado identificado pela correlação. Nenhum retry REAL foi executado pelo agente.
- Correção: encaminhamento de `reconcileSignatures` pelo mesmo guard das demais operações;
  `Required<SignatureProvider>` exige a superfície completa na composição Clicksign.
  O teste de integração resolve a instalação e o cofre reais, usa apenas transporte
  controlado e verifica os três endpoints, credencial, hashes e erro DOCUMENT_NOT_CLOSED.
- Seed: prazos relativos para novas propostas/reservas; reserva vencida de execução
  interrompida é liberada pelo serviço existente, preservando o histórico; reserva CONVERTED
  é reutilizada. A primeira repetição do QA encontrou a omissão desse último estado,
  corrigida antes do novo commit. Nenhuma regra de expiração do domínio foi alterada.
- Migration adicional desta correção: nenhuma. QA em cluster novo, porta 55434, banco
  inicialmente vazio e usuário sem privilégios administrativos. O banco do smoke foi preservado.
- Resultado da nova validação e Git/CI: acompanhar `REDE_CAMPAIGN_CHECKPOINTS.md`.
