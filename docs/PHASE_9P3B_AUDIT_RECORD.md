# 9P.3B — registro de QA e auditoria local

Data: 2026-09-06. Base observada: `0efdc72`.
Executor: agente de implementação. Esta revisão local não substitui a auditoria adversarial
independente solicitada pelo usuário. Após o QA, o usuário autorizou publicar commit e CI
separados por fase; a publicação deve usar exatamente este checkpoint validado.

## Banco e backup

Banco de QA: `rede_intelligence_test`, cluster local isolado na porta 55434. O banco histórico
do Clicksign na porta 55432 não recebeu migration, seed nem testes desta fase.

Backup anterior à alteração:

- `outputs/backups/2026-09-06T16-16-44-220Z-test_database_url/database.dump` (privado).
- 4.472.153 bytes; SHA-256 `6480f1dd7bc71e42d1bf260f0b9c596fa6033a9793f2c611bf257715947cc8d4`.
- Restauração nova: `rede_restore_ddf07553c56a456ea8d86691253a1b8e`.
- Validação concluída em `2026-09-06T16:17:21.353Z`: 373 tabelas, 12.960 registros,
  contagens e fingerprints de conteúdo iguais; origem estável durante a verificação.
- Manifesto `verification.json` no mesmo diretório, com `valid=true`.

Uma migration aditiva, `20260906120000_phase_9p3b_drive_versions`, adiciona a tabela de
versões. SHA-256 `e36428716ef259e638af1ef8245738acb68a235ab653f48a4d49dbcc1eaa2c4c`.
O catálogo de QA confirmou 32 migrations, checksum igual ao arquivo, 3 triggers habilitados
e 2 FKs RESTRICT. As 31 migrations anteriores foram preservadas.

Também foi criado um banco vazio separado,
`rede_drive_9p3b_seed_6171ba507f8547d6a7f09ed0f9740356`, na porta 55434. Deploy de todas as
migrations e seed concluídos em `2026-09-06T16:37:29.253Z`. A suíte utiliza o banco com o nome
exato aceito pelo guard original; nenhuma proteção de teste foi alterada.

## Revisão técnica

| Área | Evidência local |
| --- | --- |
| Tenant e RBAC | Serviço/action resolvem contexto; teste recusa tenant alheio, VIEWER, instalação pausada e credencial ausente antes de I/O |
| Credencial e escopo | Cofre real de QA com token sintético; provider resolvido é recusado após pausa/expiração; cursor vincula organização, instalação, configuração e credencial |
| Paginação | Token inicial antes da listagem; páginas de arquivos e mudanças separadas; alteração durante a varredura reconciliada |
| Atomicidade | Trigger de falha exclusivo de QA rejeita o segundo item; primeira referência/versão e cursor são revertidos na mesma página |
| Retomada | Falha na segunda página preserva a primeira; consulta seguinte usa exatamente o cursor persistido |
| Concorrência | Lease + lock; duas execuções não duplicam versões nem retrocedem cursor |
| História | UPDATE/DELETE/TRUNCATE rejeitados; perda de acesso retira link e preserva versões |
| FULL/REPLAY | Varredura completa retira ausentes após conclusão; replay não altera história ou cursor oficial |
| Cancelamento | Abort durante resposta impede confirmar a página |
| Erros | 401/403/429/5xx, resposta inválida, redirecionamento e limite de corpo cobertos; worker preserva classe, correlação e retry limitado |
| Modos | MOCK sem rede e sem evidência fictícia; DISABLED bloqueia; REAL usa composição interna com transporte controlado nos testes |

A revisão detectou e corrigiu a perda da marca de FULL entre tentativas e a reutilização
possível do cursor após troca de credencial. Nenhuma evidência REAL foi inferida dos testes.

## Execuções

- Prisma validate/generate: aprovados.
- Deploy/seed em banco existente de QA após backup: aprovados.
- Deploy/seed em banco criado vazio: aprovados.
- Primeiro focal: 69 testes; ampliação: 74; focal com worker e Meu Drive: 81.
- Primeira suíte completa: 990/990 testes em 117 arquivos, 307,09 segundos, saída zero.
- Validação conclusiva: **992/992 testes em 117/117 arquivos**, sem skips, 255,73 segundos,
  saída zero; inclui a retomada de FULL interrompido e Meu Drive.
- Focal final: **82/82 testes em 7/7 arquivos**, saída zero, 22,02 segundos.
- TypeScript e ESLint finais: aprovados, sem avisos.
- Build produtivo: concluído, 28 páginas; artefato `BUILD_ID=S926S34suMh34SUejhPEz`.
- `git diff --check`: aprovado. `.env` e migrations anteriores intactos.

Veredito: **APROVADO NA AUDITORIA LOCAL DO EXECUTOR**, no escopo implementado e testado.
A aprovação adversarial independente e a operação REAL permanecem não comprovadas.

Logs privados em `work/9p3b-*`: backup, migration/seed, seed vazio, tipos, lint, focais,
suíte completa e catálogo. Resultados intermediários são preservados e não substituem o QA final.

## Limites de validação

Nenhuma chamada REAL ao Google ou Clicksign; nenhuma credencial real solicitada ou usada.
OAuth/consentimento e renovação em uma conta externa não foram exercitados. Token expirado
é recusado; renovação deve atualizar o cofre pelo fluxo de credenciais existente.
Arquivos são referências de metadados: não há cópia, download, exportação, recursão de pastas
ou webhook nesta entrega. Nenhuma custódia de conteúdo é declarada.

Administrador do banco capaz de remover triggers permanece fora da garantia de imutabilidade.
QA local não comprova operação Google nem disponibilidade cloud. O resultado do CI deve ser
confirmado no SHA publicado; testes locais não substituem essa evidência.
A fase 9P.3C não foi iniciada neste checkpoint. Na retomada da campanha, o usuário autorizou
deixar APIs externas para o fim e continuar as camadas independentes até a Fase 10.
