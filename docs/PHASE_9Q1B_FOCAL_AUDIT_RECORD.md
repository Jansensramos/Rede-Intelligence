# Registro factual da correção focal 9Q.1B

Data da verificação: 2026-09-02 (America/Sao_Paulo).

O backup pré-migração anteriormente informado como
`C:\Users\Usuario\Documents\Codex\BACKUPS_REDE\rede-pre-9q1b-20260901.dump` não foi produzido e não existe.
A migration `20260901120000_phase_9q1b_session_tenant_rbac` já havia sido aplicada quando esta limitação foi
confirmada. A migration é aditiva: acrescenta `organization_memberships.is_active` com valor padrão `true`,
sem remoção de tabelas ou colunas; os dados históricos foram preservados. A ausência do backup pré-migração
não pode ser apagada nem corrigida retroativamente, e nenhum arquivo com aparência de evidência prévia foi criado.

Antes das correções focais foi criado um backup real do estado então atual:

- Caminho: `C:\Users\Usuario\Documents\Codex\BACKUPS_REDE\rede-post-9q1b-before-focal-fixes-20260902-085432.dump`
- Banco e horário do servidor: `rede_intelligence`, 2026-09-02 08:55:31.533538 -03:00
- Criação local do arquivo: 2026-09-02 08:54:33 -03:00
- Tamanho: 32.028.484 bytes
- Catálogo validado com `pg_restore -l`: 3.012 entradas
- SHA-256: `40FF7AFD4A63A5506D8BF957B9D0E1BD829095095FE742042BB5B7E99E76AFAD`

Não houve restauração sobre o banco principal.
