# Fase 9Q — Contrato técnico de lançamento

## 1. Finalidade e autoridade

Este documento é o contrato objetivo para promover o REDE Intelligence entre ambientes. Ele não substitui evidência executada: configuração declarada, workflow existente ou texto de runbook não comprovam disponibilidade cloud, backup, restauração, segurança ou desempenho.

O REDE permanece a fonte única de verdade. Engines determinísticas calculam, a IA explica e prepara, e uma pessoa autorizada decide. Nenhum status crítico pode ser inferido ou fabricado para aprovar um gate.

## 2. Estados de prontidão

| Estado | Significado | O que não significa |
|---|---|---|
| Código pronto | QA local e CI aprovados; artefatos reproduzíveis; nenhuma pendência de código conhecida no escopo | Cloud configurada, backup restaurável ou operação autorizada |
| Piloto controlado | Código pronto, ambiente segregado, usuários assistidos, dados autorizados, suporte e rollback de aplicação testados | Produção aberta, escala comprovada ou recuperação produtiva comprovada |
| Produção liberada | Todos os gates deste contrato possuem evidência datada, responsável e aprovação humana | Autorização permanente; cada release precisa de nova evidência |

## 3. Ambientes

| Ambiente | Dados e acesso | Configuração obrigatória | Condição de promoção |
|---|---|---|---|
| Desenvolvimento | Dados sintéticos; acesso local | Banco local, cofre local com chave fornecida fora do Git; storage local; scanner noop identificado | Testes unitários e integração relevante verdes |
| Teste | Exclusivamente `rede_intelligence_test`; dados sintéticos | `TEST_DATABASE_URL`, guarda de teste, chave efêmera/determinística de CI, storage local | Banco principal recusado pelo guard; execução repetível |
| CI | PostgreSQL efêmero do job; nenhuma credencial real | Variáveis CI-only, migrations via deploy, seed de demonstração, build | Todo o pipeline verde; valores CI jamais reutilizados fora do job |
| Piloto | Dados autorizados e organização segregada | Configuração produtiva, Secrets Manager/KMS externos, storage privado, scanner externo, logs/alertas, backup e suporte | Preflight aprovado e checklist de piloto assinado |
| Produção | Dados reais sob controles LGPD | Todos os itens do piloto, redundância e recuperação comprovadas, política de retenção, observabilidade e plantão | Gate final aprovado por todos os responsáveis |

Variáveis obrigatórias de produção são validadas por nome: `DATABASE_URL`, `APP_PUBLIC_URL`, `WEBHOOK_BASE_URL`, `SESSION_SECRET`, configuração S3, `MALWARE_SCANNER_PROVIDER`, `SECRET_PROVIDER`, `KMS_PROVIDER`, `AWS_REGION`, `SECRETS_MANAGER_PREFIX`, `SECRETS_MANAGER_PREFLIGHT_SECRET_ID` e `KMS_KEY_ID`. Valores nunca integram logs, relatórios ou evidências versionadas.

## 4. Condições fail-closed

- Produção recusa storage local, scanner noop, provider de ambiente e KMS local.
- Ausência ou invalidade de configuração impede o processo de ser considerado pronto.
- Indisponibilidade de banco, storage, Secret Manager, KMS ou scanner reprova o preflight.
- Seed demonstrativo é proibido quando `NODE_ENV=production`.
- Login demonstrativo exige habilitação explícita e nunca é renderizado em produção.
- Falha de scanner bloqueia upload; não há desvio para disco ou banco.
- Falha de cofre bloqueia leitura/escrita de credencial; não há fallback hardcoded.
- Migration não é executada no boot das réplicas e nunca é revertida automaticamente.

## 5. Bloqueadores

### Piloto

- preflight produtivo reprovado;
- credencial demonstrativa visível ou seed demonstrativo possível;
- teste negativo de isolamento organizacional/RBAC reprovado;
- ausência de responsável de operação e suporte;
- backup não habilitado ou restauração isolada não ensaiada;
- scanner, Secret Manager, KMS, storage ou banco sem conectividade comprovada;
- logs sem redaction ou sem correlação;
- onboarding assistido não ensaiado com uma segunda organização.

### Produção

Todos os bloqueadores de piloto, mais: RPO/RTO sem medição, rollback não ensaiado, alertas sem destino/responsável, incident response não exercitado, pendência crítica/alta aceita sem aprovação formal, ou ausência de validação LGPD.

## 6. Responsáveis e evidências

| Perspectiva | Responsável pela aprovação | Evidência mínima |
|---|---|---|
| Segurança | Responsável de Segurança | preflight, matriz RBAC/tenant, scan de dependências/imagens, redaction e revisão de segredos |
| SRE/Cloud | Responsável de Operações | manifesto por SHA, health/readiness, alertas, capacidade, smoke, rollback |
| Banco de Dados | Responsável pelo PostgreSQL | 29 migrations esperadas, status, PITR, backup e restauração isolada |
| QA | Responsável de Qualidade | CI, totais de testes, testes negativos, build e smoke autenticado |
| Produto/Onboarding | Responsável do piloto | organização/empresa/projeto/usuários provisionados e checklist assistido |
| Suporte | Responsável de atendimento | contatos, severidades, escalonamento e diagnóstico sanitizado |
| LGPD | Encarregado ou responsável designado | finalidade, base legal, retenção, acesso, incidente e atendimento ao titular |
| Release | Aprovador humano autorizado | consolidação das evidências anteriores e decisão datada |

Toda evidência informa ambiente, data, commit/imagem, executor, resultado e localização imutável. Evidência ausente equivale a gate reprovado.

## 7. Checklist de lançamento

### Segurança

- [ ] Segredos externos, KMS e scanner validados sem exibir valores.
- [ ] Credenciais demonstrativas ausentes e seed produtivo recusado.
- [ ] RBAC e isolamento multiempresa comprovados no servidor.
- [ ] Logs e respostas não contêm segredo, token, CPF, CNPJ ou credencial.

### Banco

- [ ] `prisma validate`, `generate` e `migrate status` aprovados.
- [ ] Conjunto esperado de migrations conferido; nenhuma migration inesperada.
- [ ] Conexão TLS, mínimo privilégio, PITR e retenção confirmados.

### Deploy

- [ ] Imagens web/worker reproduzíveis e identificadas por SHA.
- [ ] Preflight aprovado antes da liberação de tráfego.
- [ ] Liveness, readiness e smoke autenticado aprovados.
- [ ] Migration executada uma única vez por job autorizado.

### Recuperação

- [ ] Backup persistente validado.
- [ ] Restauração executada somente em ambiente isolado.
- [ ] Integridade banco/storage e hashes verificados.
- [ ] RPO/RTO medidos e rollback por imagem anterior ensaiado.

### Suporte

- [ ] Canal, horário, severidades e escalonamento publicados.
- [ ] Responsáveis e substitutos definidos.
- [ ] Pacote de diagnóstico sanitizado testado.
- [ ] Procedimento de incidente e comunicação LGPD exercitado.

## 8. Regra de evidência cloud

É proibido declarar como executado qualquer backup, restauração, deploy, rollback, alerta, scan, teste de carga ou validação de serviço cloud que não tenha sido realmente executado no ambiente identificado. Código, mocks e testes locais comprovam contrato técnico; não comprovam a operação do fornecedor. Uma dependência externa não testada permanece explicitamente `NÃO COMPROVADA` e bloqueia a promoção correspondente.
