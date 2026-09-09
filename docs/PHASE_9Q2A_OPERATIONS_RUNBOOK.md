# 9Q.2A — Runbooks locais de operação e recuperação

## Inicialização e pré-deploy

Responsável: operador designado da REDE; substituto deve ser definido antes do piloto.
Use terminal privado e ambiente local segregado. Não altere `.env` para executar QA.
Forneça variáveis somente ao processo; não cole valores em comandos versionados ou logs.

1. Confira SHA, branch, CI de origem e worktree. Registre o estado sem fazer Git automaticamente.
2. Confira manifesto das 34 migrations; nunca edite migrations aplicadas.
3. Disponibilize banco local e segredos efêmeros para teste. Não use seed demonstrativo em produção.
4. Execute Prisma validate/generate/status, seed isolado, tipos, lint e testes.
5. Identifique REDE_RELEASE_SHA com o SHA conferido e REDE_BUILD_ID com SHA-256 do
   arquivo `.next/BUILD_ID`. Guarde o vínculo entre código, build e artefato em manifesto
   privado. Esse identificador não substitui o digest da imagem na implantação real.
6. Execute `pnpm predeploy:local`. Saída zero comprova somente os checks locais listados.
7. Execute `pnpm build`. Inicie o servidor de ensaio vinculado a 127.0.0.1.
8. Confira liveness, readiness local, CSP, autenticação, tenant e ajuda. Um servidor
   com NODE_ENV=production deve responder 503 às rotas de negócio nesta entrega.
9. Só promova o ensaio local após a matriz go/no-go. Cloud/piloto real ficam bloqueados.

## Deploy e rollback de aplicação

Não executar migration no boot. Antes de uma migration futura: backup real, restauração
isolada e validação, depois aprovação do procedimento. Aplicar uma vez pelo executor
autorizado. Nesta fase não há migration nova.

Para rollback local: pause novas entradas e integrações, drene workers, preserve jobs
e evidências, registre o artefato anterior compatível e inicie-o em ambiente segregado.
Faça o smoke antes de redirecionar tráfego. Não reverta migrations nem restaure o banco
principal automaticamente. A compatibilidade do artefato anterior com schema e guards
atuais precisa ser conferida; se não for comprovada, mantenha a pausa e corrija adiante.
Este procedimento documentado não é evidência de rollback cloud executado.

## Backup e restauração isolada

Executor local Windows: `node scripts/backup-local-database.mjs TEST_DATABASE_URL`.
O script recebe credenciais pelo ambiente, restringe host a loopback, cria dump custom,
cria banco `rede_restore_<UUID>` novo a partir de template0 e restaura somente nele.
Não há opção de destino existente, clean, drop ou restauração sobre o banco principal.
POSTGRES_BIN identifica a instalação confiável do PostgreSQL; conta administrativa
opcional é fornecida somente ao processo para criar o banco isolado.

O manifesto privado inclui tamanho, SHA-256, tabelas, contagens, fingerprints de conteúdo,
estabilidade da origem e comparação com o restore. Resultado incompleto ou diferença é
NO-GO. Escritas concorrentes podem reprovar estabilidade: pause produtores e faça novo
ensaio; não altere o manifesto para parecer válido. Dump vazio não é backup operacional.

Guarde dump e manifestos em armazenamento privado com acesso mínimo e retenção definida.
O dump contém dados e não deve ir ao Git. Compartilhe apenas resultado sanitizado e hash.
Um banco restaurado não deve ser conectado ao worker, pois contém instalações e jobs
históricos. Não fornecer credenciais de providers ao processo de inspeção do restore.

## Pausa e reativação de integrações

Use os serviços/actions já autorizados do conector e o papel exigido. Registre motivo,
tenant, instalação e jobs afetados no acompanhamento operacional. Pausar instalação
impede novas operações; drene ou cancele pelo fluxo suportado os jobs em andamento.
Não modifique diretamente payload, evidência, lease ou status por SQL.

Na reativação, confira vínculo ativo, configuração, retenção, idempotência e causa da
pausa. Reative apenas MOCK no ensaio. REAL exige a 9Q.2B. Mudança de configuração pode
invalidar jobs antigos por fingerprint; prepare novo pedido quando o contrato exigir.
Não apague evidências para permitir um reenvio.

## Filas, retries, dead-letter e quarentena

Leia métricas em `/ajuda/prontidao` (OWNER/ADMIN). Para detalhe use a área Integrações
e os serviços do conector com RBAC. Priorize itens vencidos e jobs sem progresso.
Analise motivo sanitizado, autor e configuração antes de pedir retry. Use a retentativa
manual autorizada, que revalida acesso e preserva identidade; nunca execute loops de
reenvio direto. Falhas permanentes exigem correção de origem ou vínculo.

Quarentena não é dado aplicado. Revise com permissão de auditoria, corrija vínculo
explicitamente e reprocesse pelo fluxo próprio. Evidência com versão conflitante não
pode ser sobrescrita. Expurgo respeita validade e lote de cada provider e gera auditoria.
Em 9P.5, crosswalk permanece durável e jobs com evidência ativa podem impedir limpeza genérica.

## Rotação de credenciais e chaves

1. Identifique dependências, responsável, janela e rollback; pause instalação e drene jobs.
2. Crie nova referência no cofre pelo procedimento autorizado, sem exibir valores.
3. Valide tenant, permissão, versão e expiração; faça smoke somente na campanha real autorizada.
4. Ative referência nova, revogue anterior e registre resultado sanitizado.
5. Na falha, mantenha pausado; não reintroduza segredo em logs ou configuração pública.

Chaves de cifra/HMAC não são tokens de API. INTEGRATION_SECRET_KEY protege dados antigos:
troca cega pode impedir leitura e mudar idempotência/crosswalk. Exige inventário, backup,
reencriptação/migração versionada e ensaio antes da troca. A 9Q.2A documenta o procedimento,
mas não executa rotação real. Sessões devem ser revogadas pelo fluxo de identidade em
caso de comprometimento; trocar uma variável não equivale a revogar tokens persistidos.

## Incidentes e severidade

| Severidade | Critério | Resposta e escalonamento propostos |
| --- | --- | --- |
| S1 crítica | Vazamento, tenant cruzado, perda de dados ou mutação financeira indevida | Pausa imediata; operação, segurança, patrocinador e responsável LGPD; meta de reconhecimento 15 min na cobertura contratada |
| S2 alta | Indisponibilidade total, falhas recorrentes de fila ou recuperação | Operação e responsável técnico; meta 1 h na cobertura contratada |
| S3 média | Módulo degradado com alternativa segura | Suporte e dono do módulo; triagem no mesmo dia útil |
| S4 baixa | Dúvida, documentação ou melhoria sem bloqueio | Suporte no próximo dia útil |

Essas metas são propostas, não SLA contratado. Nomes, contatos, substitutos, horários e
destino dos alertas permanecem a definir com o cliente; sua ausência bloqueia piloto real.

Fluxo: reconhecer → conter → preservar evidências → classificar → escalar → recuperar
em ambiente isolado → validar → comunicar → registrar causa e ações preventivas.
Colete horário, módulo, correlação, sintomas e decisão. Não envie payloads pessoais,
tokens ou dumps por mensagem. A avaliação e eventual comunicação de incidente LGPD
cabe ao responsável designado, segundo o procedimento jurídico aplicável ao caso.

## Observabilidade e limiares locais

| Indicador | Limiar | Ação |
| --- | --- | --- |
| Readiness | 503 em três verificações consecutivas | Impedir promoção e investigar configuração/banco |
| Fila vencida | Mais de 300 s de atraso | Conferir worker, leases e disponibilidade local |
| Dead-letter | Qualquer item não resolvido | Triar motivo e autor antes de retry |
| Quarentena | Qualquer item pendente | Revisão humana; não aprovar integração como saudável |
| Provider REAL | Sempre não verificado nesta fase | Manter gate externo pendente |

O painel é uma fotografia local, sem envio automático de alertas. Correlation IDs são
aleatórios no ingresso HTTP e não constituem autorização. Contagens não exibem conteúdo.
Capacidade, latência, destino de alertas e SLO produtivos serão medidos na 9Q.2B.
