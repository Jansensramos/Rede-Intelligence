# 9P.3A — reauditoria da correção bloqueadora

Data: 2026-09-05. Base: `523ed64f0a96f65ed37ef7fe4e250886f5060b5f`.
Escopo: última reprovação de M1, handler de fechamento, composição de erros do adapter/worker e correlação nos logs.
Método: revisão local do código, consulta somente leitura do catálogo PostgreSQL e testes adversariais executados.
Esta é uma auditoria local do agente executor; não é um parecer independente de terceiro.

## Veredito técnico

**APROVADO LOCAL para as correções bloqueadoras. M1 encerrada no escopo da reconciliação implementada.**
O smoke REAL final não foi executado neste checkpoint e permanece um gate externo separado.

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
