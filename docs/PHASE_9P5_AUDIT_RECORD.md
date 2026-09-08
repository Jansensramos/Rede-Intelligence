# Fase 9P.5 — registro de QA e auditoria local

Data: 08/09/2026. Base: `c1511b71b7b1e760f95ff3447ecceb15168b020f`.
Branch fornecida pelo usuário: `codex/fase-9p5-local`.
Contrato: `PHASE_9P5_LOCAL_ENTERPRISE_CONTRACT.md`.

O usuário confirmou o CI corretivo da 9P.4 verde e autorizou a continuação.
A consulta independente ao GitHub não retornou execução para esse SHA; o link
foi solicitado para rastreabilidade. Essa confirmação é do usuário, não evidência
de CI coletada pelo agente. Não houve commit, push ou CI novo da 9P.5.

## Fontes e implementação

Leitura integral dos checkpoints, contratos anteriores e Relatório Mestre
`REDE_Intelligence_Relatorio_Mestre_2026_ATUALIZADO_2026-09-05.pdf`, 23 páginas,
SHA-256 `a22956a6b72fe0d71621dc8261dec37189e8c98277a3b10dddbe25bc5214717e`.
O Apêndice D e o plano 9H fundamentam ERP/CRM, crosswalk, comparação e revisão.

Implementados dezesseis contratos mínimos sobre entidades existentes, transporte
local injetável, instalações e configuração, vínculo manual, fila durável,
paginação, cursor cifrado, idempotência, rate limiting, retry/dead-letter,
quarentena cifrada, snapshots e decisões imutáveis, expurgo e server actions.
RBAC é revalidado no banco, inclusive pelo worker. Nenhum resultado sintético
substitui valores oficiais. REAL recusa execução antes do transporte.

## Backup anterior à migration

Backup efetivo do banco de QA, porta 55434, antes da alteração:

- Arquivo privado: `outputs/backups/2026-09-07T23-55-13-090Z-test_database_url/database.dump`.
- Tamanho: 16.887.585 bytes.
- SHA-256: `591f99d3ea6d92c450f21ccbf57df256a53f1775f3b9dbaafd318caa5a60e36a`.
- Restauração isolada: `rede_restore_775b404b82c2444eafbee31a6436fcea`.
- Validação em `2026-09-07T23:56:03.396Z`: 375 tabelas, 71.162 registros,
  origem estável, contagens e fingerprints de conteúdo iguais.
- Manifesto `verification.json` no mesmo diretório; log privado
  `work/9p5-implementation-backup.log`.

Esse backup é do ambiente de testes, não de produção. O ambiente histórico de
smoke Clicksign não recebeu esta migration.

Migration aditiva aplicada: `20260908001500_phase_9p5_enterprise_evidence`.
SHA-256: `5cb444edf1ea3ee0639621bce4a9799b6df7ae38758a5836d3d0812c84fb6b98`.
Adiciona namespace opcional de crosswalk, duas tabelas, índices, restrições e guards.
As 33 migrations anteriores permanecem intactas; total atual: 34.
Consulta ao catálogo confirmou os doze triggers `enterprise_*` habilitados.
Manifesto privado: `work/9p5-catalog-check.json`.

Deploy e seed também passaram em banco inicialmente vazio:
`rede_enterprise_9p5_seed_1619da3d203649a492170f1cb60243a0`, porta 55434,
conclusão `2026-09-08T11:52:53.666Z`. Manifesto privado:
`work/9p5-empty-seed-result.json`. Não foi flexibilizada a proteção do wrapper de testes.

## Auditoria adversarial pelo implementador

Revisão local de código, migration, caminhos genéricos de worker/conflitos e
testes negativos. Não constitui auditoria independente nem certificação externa.

| Tentativa ou propriedade | Verificação local |
| --- | --- |
| Reutilizar instalação ou evidência de outro tenant | Serviços recusam; insert SQL de evidência incompatível também é recusado |
| Forjar papel ou manter privilégio após downgrade persistido | Recusa pelo serviço e pelo processamento do job |
| Executar REAL/DISABLED por transporte injetado | Bloqueio anterior à chamada do transporte |
| Duplicar pedido concorrente ou repetir versão | Job único e evidência reutilizada somente com conteúdo igual |
| Vincular a mesma origem por outra instalação | Conflito explícito; crosswalk e namespace protegidos |
| Alterar/remover/truncar evidência ativa | Guards recusam; expurgo aceita apenas evidência expirada |
| Contornar revisão pelo serviço genérico de conflitos | Banco exige decisão específica existente |
| Aprovar revisão depois de alterar projeção local | STALE_REVIEW; nenhum dado oficial é sobrescrito |
| Reusar versão externa com conteúdo diferente | Quarentena cifrada; original preservado |
| Publicar primeira página e falhar depois | Rollback integral; cursor não avança |
| Paginação circular, cancelamento, lease ou tentativa obsoleta | Execução recusada sem publicar resultado parcial |
| Estourar rate limit e esgotar retry | Reagendamento ou dead-letter auditado e protegido contra repetição de falha |
| Expor erro arbitrário do worker ou ler sem privilégio | Erro normalizado; conteúdo exige permissão de auditoria e domínio |
| Adulterar cifra, AAD ou chave | Leitura recusada; sem fallback de chave |
| Alterar domínio oficial com projeção sintética | Dezesseis casos verificam comparação sem mutação de negócio |

A primeira execução focal terminou em 96/97: o teste novo do worker usava uma
assinatura de construtor e métodos incompatíveis com o worker existente. O teste
foi corrigido para `run/requestStop`. TypeScript também identificou metadado JSON
nullable na cópia de fixture; foi substituído por metadado sintético explícito.
Essas execuções não foram declaradas aprovadas. A repetição focal passou em 97/97.

## QA conclusivo

Manifesto privado: `work/9p5-delivery-qa.json`; logs individuais no mesmo diretório.

| Gate | Resultado |
| --- | --- |
| Prisma validate/generate | Aprovado |
| Migration status e deploy | 34 migrations, nenhuma pendente |
| Seed efêmero em banco vazio | Aprovado |
| TypeScript sem emissão | Aprovado |
| ESLint completo | Aprovado |
| Focais | 97/97, cinco arquivos, 33,19 segundos |
| Suíte completa pelo wrapper oficial | 1.098/1.098, 123 arquivos, 379,37 segundos |
| Build de produção | Aprovado, 28 páginas geradas, saída zero |
| git diff --check e whitespace dos dez arquivos novos | Aprovados |

Executor conclusivo encerrado em `2026-09-08T12:12:33.371Z`, todos os estágios
com saída zero. `.env` preservado, SHA-256
`511a8f2fd77b7e3595b95de1b67adb3c91871c7ffd5d3a6661f27e53b123b72b`.
`next-env.d.ts` restaurado byte a byte após o build. Auditoria local concluída
sem bloqueador identificado no escopo local definido; os limites abaixo permanecem.

As duas suítes novas somam 54 testes (26 de domínio e 28 de banco). Nenhum teste
anterior foi removido. O build é executado depois da suíte completa, sem concorrência.
O aviso de depreciação da configuração Prisma em package.json é preexistente;
não foi feita migração de versão de ferramenta neste checkpoint.

## Limites e pendências

Não foi escolhido provedor ERP/CRM ou transacional. Credenciais, smokes REAL,
webhooks reais, mapeamentos particulares e ajustes de API continuam pendentes da
campanha final. MOCK não demonstra interoperabilidade com sistemas reais.

Os transportes injetados são código servidor confiável e precisam cooperar com
AbortSignal; não são plugins arbitrários executados em sandbox. Rotação de chave,
agendamento de retenção e associação da origem lógica ao provedor precisam de
procedimento operacional antes de uso real. Crosswalk permanece retido para
identidade durável; jobs com evidência ativa não podem ser removidos por limpeza
genérica. Administrador de banco pode remover guards e não está no modelo de
proteção contra mutações ordinárias.

Worktree permanece aberto para auditoria adversarial do usuário e fechamento Git
manual. A fase seguinte não foi acumulada neste diff.
