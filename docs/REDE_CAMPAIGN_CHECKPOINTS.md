# Campanha REDE Intelligence — 9P.3A a 10I

Início: 2026-09-05. Base: `523ed64f0a96f65ed37ef7fe4e250886f5060b5f`.
Branch inicial: `feature/fase-9p3a-clicksign`.

## Regra de avanço

Cada fase mantém implementação, QA, auditoria, migrations, backup, commit e CI identificáveis.
O checkpoint registra resultado técnico, testes efetivamente executados, Git e riscos antes do próximo.
Código validado localmente não significa integração operacional ou disponibilidade cloud.
Bloqueio externo é comunicado e impede declarar o gate correspondente concluído.

## Sequência solicitada

| Checkpoint | Escopo | Estado |
| --- | --- | --- |
| 9P.3A — correção bloqueadora | Evidência imutável, recuperação pelo handler, classificação do adapter e logs | QA e auditoria locais aprovados; CI pendente |
| 9P.3A — smoke final | Envelope Sandbox existente, correlação e PDF final | Alvo localizado no banco de testes; token ausente |
| 9P.3B–9P.5 | Demais integrações, conforme contratos de fase | Aguardam gate anterior e recuperação dos contratos detalhados |
| 9Q — restante | Gates de release e operação | Aguardando |
| 9R, 9S | Próximas fases do roadmap aprovado | Aguardam contratos detalhados |
| 10A | AI Gateway | Aguardando |
| 10B | Context Engine | Aguardando |
| 10C | Tool Layer | Aguardando |
| 10D | Agent Framework | Aguardando |
| 10E | Red Team 2.0 | Aguardando |
| 10F | Decision Engine | Aguardando |
| 10G | Investment Committee | Aguardando |
| 10H | REDE Operator | Aguardando |
| 10I | Autopilot | Aguardando |

## 9P.3A — registro de backup e migration

`DATABASE_URL` nesta pasta aponta para `rede_intelligence` em `127.0.0.1:55432`.
Na verificação inicial, esse banco tinha zero tabelas públicas. O arquivo de 866 bytes gerado
nessa primeira tentativa foi recusado como evidência de backup operacional. Nenhuma migration
foi aplicada nesse banco vazio.

Backup válido do banco `rede_intelligence_test`, anterior à migration:

- Arquivo local privado: `outputs/backups/2026-09-05T21-06-46-503Z-test_database_url/database.dump`.
- Manifesto: `verification.json` na mesma pasta.
- Tamanho: 38.381.856 bytes.
- SHA-256: `2f2beef1d8ef133715276bd2a99e9ac8a4467b7b177fcddea4794b134afa646e`.
- Restauração isolada: `rede_restore_51e06145fc2448adbf0deef558f454ca`.
- Verificação concluída em `2026-09-05T21:07:46.108Z`: 372 tabelas, 156.649 registros,
  contagens e fingerprints de conteúdo iguais; origem estável entre as leituras.
- As tentativas anteriores que falharam não são usadas como gate. Uma comparação inicial
  sem ordenação do resultado SQL foi corrigida antes da validação conclusiva.

A migration aditiva `20260905220000_phase_9p3a_immutable_signature_evidence` foi aplicada
ao banco de testes da porta 55432 após esse gate. Um segundo cluster de QA, na porta 55433,
recebeu a restauração do mesmo backup, com usuário `rede_app` sem privilégios administrativos.
Esse cluster mantém o nome de banco permitido pelo wrapper oficial, sem flexibilizar a proteção.

## Limites atuais

O backup é de testes; não é backup de produção nem substitui a localização do banco operacional.
Na busca posterior, o executor histórico revelou que o smoke usa deliberadamente
`TEST_DATABASE_URL` da porta 55432. A leitura de `2026-09-05T21:39:24.009Z` confirmou o envelope
esperado pelo hash já registrado, solicitação `AGUARDANDO_ASSINATURAS`, uma parte `PENDING`,
ID externo presente e checksum coerente. A instalação permanece `PAUSED` e a credencial está
ausente. O bloqueio de localização foi resolvido; o token de Sandbox precisa ser fornecido
pelo prompt seguro local para o smoke real.
As credenciais e os dumps permanecem em pastas ignoradas pelo Git. Nenhuma chamada externa
de assinatura foi executada nesta correção. Os smokes descritos no contrato são históricos,
não foram repetidos nem promovidos a evidência deste checkpoint.

O executor antigo `final-stage.ts` criava um inbox sintético e foi considerado incompatível
com este checkpoint. A variante local `immutable-final-stage.ts`, com launcher
`run-immutable-final-stage.ps1`, usa reconciliação manual com origem nula, exige 31 migrations
e verifica a evidência imutável após a conclusão. Os arquivos e relatórios históricos foram
preservados. Preparar o executor não equivale a executar o smoke.

## QA local executado

- Prisma validate e generate: aprovados.
- Migration deploy e seed no ambiente isolado: aprovados.
- TypeScript e ESLint: aprovados.
- Focais: 140/140 testes em 6/6 arquivos, porta 55433, saída zero.
- Wrapper oficial `pnpm test`: 954/954 testes em 114/114 arquivos, saída zero, 196,78 segundos.
- Nenhum teste removido e nenhum timeout flexibilizado. A suíte foi executada sem build concorrente.
- O primeiro build compilou, mas falhou no prerender por `NODE_ENV` não produtivo herdado
  do ambiente. A repetição usa `NODE_ENV=production` explicitamente, sem alterar `.env`.

- Build produtivo final: aprovado, 28 páginas.
- Preflight somente leitura do novo smoke manual: aprovado, sem token solicitado.
- Auditoria local: `PHASE_9P3A_REAUDIT_RECORD.md`; M1 encerrada no escopo técnico testado.
- Publicação Git e CI: pendentes de execução deste checkpoint.
