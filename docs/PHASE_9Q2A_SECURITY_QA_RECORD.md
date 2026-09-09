# 9Q.2A — Segurança, auditoria e QA local

Base `52543782609db50d65313e08f74d6b9b961e88e9`; branch
`codex/fase-9q2a-release-readiness-local`. CI anterior verificado:
[34228347883](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34228347883), success.
Não houve commit, push, merge, rebase ou tag pelo agente. Auditoria adversarial
realizada pelo implementador, sem alegação de independência.

## Superfícies e revisão

| Superfície | Acesso e isolamento | Verificação / limite |
| --- | --- | --- |
| 9P.3A assinatura/Clicksign | Instalação, tenant, origem de evento e evidência correlacionados; revisão de provider fail-closed | Testes existentes de reconciliação, replay e fronteiras; nenhum smoke REAL repetido |
| 9P.3B Drive | Actions com INTEGRATIONS_READ; serviços revalidam vínculo/tenant e capacidade; escopo de instalação/projeto | Regressão de escopo, pausa, idempotência e cursor com transporte controlado |
| 9P.3C e-mail | Contrato estrito; fila cifrada; permissão persistida e revalidada pelo worker | Regressão de tenant, downgrade, retry e redaction |
| 9P.4 financeiro | Permissões do domínio, snapshot mínimo, validade e cifra | Regressão financeira/funding e evidência sem mutação oficial |
| 9P.5 ERP/CRM | Crosswalk e evidência por tenant; RBAC persistido; revisão sem sobrescrita | Regressão das dezesseis projeções e ataques às evidências |
| Manual Online | HELP_READ e sessão ativa, conteúdo filtrado pelo acesso do papel | Não contém dados de tenant ou credenciais; acessível sem projeto para onboarding |
| Painel local | OWNER/ADMIN fornecido e persistido; usuário/vínculo ativos | Tenant vem da sessão; apenas contagens, estados e códigos seguros |
| Confirmação de onboarding | Mesmo gate administrativo; input estrito; lock organizacional | Sem organizationId externo, sem texto livre, idempotência e AuditLog |
| Downloads/exports existentes | Sessão, leitura de domínio e serviço com organizationId | Recusa VIEWER em API de arquivo; conteúdo privado/no-store/sandbox; nenhum novo export |
| Health | Público mínimo; sem payloads ou segredos | Liveness não aprova dependências; readiness valida ambiente local e migrations |
| Produção | Middleware bloqueia negócio e readiness; worker recusa configuração não local | Não há flag de autoaprovação externa; somente liveness web permanece disponível |

## RBAC e IDOR

O painel não aceita IDs de organização, instalação ou projeto em query para selecionar
tenant. Leituras agregadas usam exclusivamente organizationId do contexto autenticado.
As confirmações rejeitam propriedades extras, inclusive organização fornecida pelo cliente.
Usuário inativo, vínculo ausente, tenant diferente e papel persistido rebaixado são negados.
ANALYST, REVIEWER e VIEWER não acessam o painel nem confirmam onboarding.

HELP_READ não concede aprovação de domínio. O administrador confirma um ensaio, mas
não aprova uma Base ou aplica dados externos por essa action. O aceite local revalida
os fatos mínimos existentes e depende de todas as confirmações anteriores. Qualidade
de dados, participação no rito e suporte são declarações humanas, não fatos fabricados.

## Logs, LGPD e exposição

Diagnósticos de readiness retornam códigos fixos, identidade limitada a hashes e
correlação aleatória. Métricas omitem nomes de pessoas, payloads, URLs de conexão e
credenciais. O backup passa credenciais pelo ambiente de subprocesso; erros de ferramentas
não são reproduzidos. Dumps e manifestos detalhados continuam privados e ignorados pelo Git.

A correlação recebida externamente é substituída no ingresso HTTP por UUID aleatório;
ela não identifica autorização nem serve para consultar dados. Sessões existentes usam
tokens aleatórios armazenados como hash, HttpOnly, SameSite=Lax e Secure em produção.
Proxy exige topologia conhecida e TRUSTED_PROXY_HOPS validado. CSP produtiva usa nonce,
strict-dynamic, object-src none, frame-ancestors none e connect-src self. Style inline
permanece permitido pelo contrato existente; não se declara remoção dessa exceção.

Retenção, finalidade, contatos e avaliação LGPD do cliente não são comprovados por teste
local. AuditLog do onboarding é histórico da aplicação, não um novo cofre de evidência
imutável contra administradores de banco. Não há alegação de validação jurídica externa.

## Guarda arquitetural

`PHASE_9Q2A_SURFACE_MANIFEST.json` fixa hashes canônicos LF das rotas/actions existentes
revisadas. Alteração exige nova revisão e atualização explícita do manifesto. Novas rotas
não entram automaticamente por ter um nome de função conhecido. Novas actions exigem
gate de domínio na primeira instrução de toda função exportada; comentários/imports
sem chamada e exports indiretos não bastam. Essa análise estrutural não substitui teste
negativo de comportamento nem prova segurança dos serviços chamados.

`PHASE_9Q2A_MIGRATION_MANIFEST.json` fixa o conteúdo das 34 migrations. O manifesto guarda
SHA-256 canônico LF e a variante CRLF correspondente, para reconhecer o mesmo conteúdo
aplicado em Windows ou Linux. Não ignora diferenças de SQL ou migrations adicionais.
Nenhuma migration antiga ou schema foi editado.

## Achados corrigidos antes do fechamento

- Ajuda era placeholder: substituída por manual local com contexto e papéis.
- Readiness não conferia migrations: adicionada verificação de conjunto e checksums.
- Identificador de correlação arbitrário no ingresso: substituído por UUID novo.
- Backup podia reproduzir stderr de ferramenta: diagnóstico agora é fixo e sanitizado.
- Manifesto baseado em bytes CRLF locais falharia no CI Linux: normalização LF com
  variante CRLF explicitamente derivada, sem alteração de migrations.
- Consulta inicial de estudos usava campo inexistente: corrigida para escopo via projeto,
  conforme modelo Prisma. TypeScript inicial não foi registrado como gate aprovado.

## Backup e restauração efetivamente executados

Não houve migration nova. O script de recuperação foi ensaiado mesmo assim:

- Dump privado: `outputs/backups/2026-09-08T17-05-41-959Z-test_database_url/database.dump`.
- Tamanho: 19.228.680 bytes.
- SHA-256: `24a9841531eb9b1600ed3e0e68ce89bc1f7301fa6f34e50a715dbfc4af2d3dfc`.
- Banco restaurado novo: `rede_restore_9615d11a6f3b4775884ea5b4818d21bf`.
- Validação: `2026-09-08T17:06:27.825Z`, 377 tabelas, 83.579 registros,
  origem estável e fingerprints iguais, valid=true.
- Origem: banco de QA local da porta 55434; não é evidência de backup produtivo.

Seed também executado em banco inicialmente vazio:
`rede_enterprise_9q2a_seed_bd9bdbc8b163447b84f38754a5e5e67f`, porta 55434,
aprovado em `2026-09-08T17:11:38.000Z`. Segredos efêmeros somente no processo.

## QA e evidências locais

Manifesto da primeira execução conclusiva: `work/9q2a-delivery-qa.json`; logs individuais
no mesmo diretório. Depois dos últimos ajustes, os gates afetados e a suíte oficial foram
repetidos diretamente. Resultados finais sobre o diff entregue:

| Gate | Resultado efetivo |
| --- | --- |
| Prisma validate/generate/status | Aprovado; 34 migrations, nenhuma pendente |
| Seed em banco inicialmente vazio | Aprovado |
| TypeScript | Aprovado, sem emissão |
| ESLint completo | Aprovado |
| Testes focais finais | 179/179 em 14 arquivos |
| Suíte oficial completa final | 1.130/1.130 em 127 arquivos; 409,13 s |
| Build produtivo final | Aprovado; 28 páginas; saída zero |
| Smoke HTTP exclusivamente local | 14/14 checks aprovados |
| CSP | Dev e produção verificados; produção com nonce/strict-dynamic e sem unsafe-eval |
| Predeploy local | Aprovado contra migrations reais do banco de QA |
| git diff --check | Aprovado |

Foram adicionados 32 testes à baseline de 1.098. O smoke usou somente 127.0.0.1,
usuários e sessões sintéticos e segredos efêmeros no processo; não chamou fornecedor.
Manifesto sanitizado: `work/9q2a-http-smoke.json`. O processo do launcher foi encerrado
após gravar o resultado PASSED porque o handle do servidor local permaneceu aberto no
host Windows; os checks e a limpeza de dados temporários já haviam concluído.

A primeira repetição focal pós-build encontrou `drive_qa_reject` residual de uma execução
interrompida. O teste antigo criava a função sem limpeza preventiva. O setup/finally agora
usam DROP IF EXISTS; a repetição focal passou 179/179 e a suíte oficial final 1.130/1.130.
O resultado reprovado não é apresentado como gate aprovado.

`.env` permaneceu intacto, SHA-256
`511a8f2fd77b7e3595b95de1b67adb3c91871c7ffd5d3a6661f27e53b123b72b`.
`next-env.d.ts` foi restaurado ao conteúdo do HEAD após o build. Schema e migrations
permaneceram sem diff. Não foi feita chamada de AWS ou API externa.

## Pendências e limites

9Q.2B concentra cloud/APIs reais, implantação produtiva, recuperação/RPO/RTO do alvo,
destinos reais de alertas, suporte contratado, segurança operacional e aceite humano.
O bloqueio produtivo desta fase é deliberado, inclusive com configuração declarada
completa; sua substituição exige a entrega posterior e evidência real. Não utilizar
`NODE_ENV=development` para contornar esse gate em produção.

Provisionamento administrativo permanece assistido: manual e checklist não são signup
público ou convite real por e-mail. Metas e responsáveis do piloto precisam de definição
com o cliente. Identidade de release declarada por ambiente é validada em formato, mas
não é assinatura criptográfica do artefato. O operador precisa conferir sua origem.

Worktree aberto para auditoria adversarial do usuário; nenhuma fase posterior acumulada.
