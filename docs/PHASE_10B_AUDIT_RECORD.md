# Fase 10B — Context Engine — correção focal pós-auditoria

**Data:** 15/09/2026  
**Branch:** `codex/fase-10b-context-engine`  
**HEAD-base:** `54c9c905e08d505d1d994c929bee03c76d674018`  
**Estado:** aberto, sem staging, commit ou push; aceite depende de nova auditoria independente.

## Resultado dos achados originais

| Achado reproduzido | Causa | Correção e prova |
| --- | --- | --- |
| Bundle aceito após membership inativa | preparo e consumo eram transações separadas; `assertBundleScope` era apenas local | consumo no commit `QUEUED → RUNNING`, com releitura no PostgreSQL; teste crítico confirma adapter 0, reserva `FAILED` com custo 0 e nenhum `CONTEXT_CONSUMED` |
| Autorização process-local | `WeakSet` exigia a mesma identidade de objeto JS | removido como autoridade; bundle reidratado é validado, vinculado ao ledger e reconstruído no banco; duas instâncias geram uma tentativa, um consumo e um adapter call |
| Bundle já nascia vencido | `ASSUMPTION_SNAPSHOT` não tinha TTL no reader, enquanto o builder aplicava fallback de um dia | toda fonte permitida exige TTL explícito; não existe fallback; `validUntil` precisa ser posterior a `preparedAt`; fonte futura e bundle vencido são recusados |
| Conjunto jurídico parcial | orçamento selecionava item por item e só conferia presença do tipo | `selectionGroup` e `groupRequirement`; grupos obrigatórios entram completos ou causam `CONTEXT_BUDGET_EXCEEDED`; 41 documentos não viram READY parcial |
| Ordem física em itens técnicos | nested relation de `EngineeringTechnicalOpinion.items` não tinha `orderBy` e itemKey usava índice | `orderBy: sequence asc, id asc`; itemKey deriva do ID opaco; todos os outros `findMany`/listas possuem desempate total |
| Contratos permissivos | números sem limite, duplicatas, correlationId cru e Zod podia acionar getters | guarda recursiva de plain data antes de Zod rejeita prototype não padrão, accessors, Proxy, ciclos e estruturas excessivas; limites fechados, unicidade e versões canônicas; correlationId é validado |
| Escape de envelope | XML interpolava strings e aceitava fechamento de tag em version | projeção JSON canônica allowlisted; instruções continuam no campo de sistema; versões rejeitam delimitadores e controles |
| Gate incompleto | scanner do Context Engine ignorava `.cjs` | extensão incluída e fixtures cobrem alias, namespace, import dinâmico, fetch indireto, pais ausentes e cleanup em `finally` |
| PostgreSQL estreito | havia quatro testes e somente fonte de engenharia; “concorrência” compartilhava um `TransactionClient` | teste real cobre as seis fontes; Gateway cobre revogação, supersession, nova versão, capability, conversa, projeto, replay e reidratação; corrida usa outro `PrismaClient` |

## Preparação, consumo e transporte

O preparo usa uma transação `Serializable`, finalidade escolhida pelo planner do servidor e correlationId gerado no servidor. Ele checa membership/papel, AI_READ, AI_USE, capability da finalidade, autoria/tenant/projeto da conversa e lê apenas campos allowlisted. O bundle contém referências opacas, ator/conversa, finalidade/política, fontes, grupos, medições, fingerprint e validade curta.

A reserva do Gateway persiste em `AIPendingAction.arguments` um binding strict com `policyVersion`, finalidade, `preparedAt`, `validUntil`, fingerprint, IDs reais de ator, conversa, organização e projeto, idempotencyKey, correlationId, executionLogId e pendingActionId. A alegação anterior de binding restrito a campos opacos foi superada. Nenhum payload de evidência é persistido.

O ponto sem retorno é o commit `TRANSPORT_AUTHORIZED/RUNNING`. Nessa transação `Serializable`, o ledger:

1. adquire uma barreira `SHARE` nas tabelas de identidade, escopo e fontes;
2. valida a tentativa `QUEUED`, pending action `EXECUTING`, vínculo e idempotencyKey;
3. relê membership/papel/capabilities, conversa, organização/projeto e política;
4. relê as fontes, incluindo versões, revogação, supersession, freshness e conflitos, e reconstrói o fingerprint;
5. grava `CONTEXT_CONSUMED` e faz o CAS `QUEUED → RUNNING` na mesma transação.

O adapter só é chamado após esse commit. Uma mutação que começou antes impede o lock até confirmar e será relida; uma mutação que perde a corrida só confirma depois do ponto sem retorno. Falha anterior ao transporte libera somente `QUEUED`; estados terminais e `RUNNING` não são ressuscitados. Apenas `P2034` é repetido, no máximo três vezes e ainda antes do adapter. O adapter nunca é repetido.

## Autorrevisão adversarial

- Membership inativa, VIEWER, parecer superseded, nova versão, conversa com outro autor e projeto trocado após o preparo foram recusados com zero adapter call.
- Revogação jurídica `VERIFIED → REVOKED` foi recusada no consumo.
- Uma revogação aberta em outro `PrismaClient` antes da autorização confirmou primeiro; o consumo aguardou, releu e recusou.
- Em cada disputa com 2, 5 e 10 instâncias lógicas consumindo cópias serializadas do mesmo bundle houve um sucesso, uma linha de execução contabilizada, um `CONTEXT_CONSUMED` e uma chamada total ao adapter.
- Em cada disputa com 2, 5 e 10 subprocessos Node e `PrismaClient`s independentes, exatamente um processo promoveu a reserva e gravou o consumo; os demais observaram o CAS perdido. Esse teste prova a camada durável, enquanto a chamada única ao adapter é provada na camada completa do Gateway porque o adapter injetado não é compartilhado entre processos.
- Mesmo fingerprint com outro ator, correlationId divergente, conversa divergente ou outra idempotencyKey falha antes da reserva.
- Bundle vencido falha antes da reserva; timestamp futuro nunca produz READY. Alterações isoladas ou conjuntas de `preparedAt`/`validUntil`, prazo menor/maior, igualdade com `now`, offsets equivalentes e precisão temporal não canônica são recusadas. O vencimento durante espera por lock também termina com adapter 0 e nenhum `CONTEXT_CONSUMED`.
- Getters não foram executados; setters, accessors, propriedade própria não enumerável, Symbol, Proxy, prototype nulo, array com propriedade oculta, estruturas excessivas, duplicatas, números negativos/não finitos/acima do limite, Unicode oculto e controles foram recusados. Objetos e arrays legítimos congelados/selados permanecem aceitos.
- Payload com `</context_evidence>`, CDATA e sintaxe JSON/Markdown permaneceu string em JSON válido, sem fechar estrutura.
- O teste das seis fontes revelou um bug adicional: códigos reais de `RiskFinding` em minúsculas eram excluídos pela regex. A allowlist foi corrigida para o mesmo alfabeto canônico seguro usado nos refs, sem admitir controles ou delimitadores.
- Falhas de contexto anteriores ao adapter não contam como falha do circuit breaker. Falhas posteriores continuam `RUNNING`, sem liberação ou segundo transporte, preservando a política da 10A.

## Correção focal final — quatro achados

| Achado | Correção estrutural | Evidência observável |
| --- | --- | --- |
| Tempo fora do fingerprint/binding | fingerprint inclui `preparedAt`, `validUntil` e restrições da política; binding persiste os dois tempos e todas as identidades da tentativa; consumo reconstrói o prazo e confere `now < validUntil` imediatamente antes de audit/CAS | adulteração para 2027, redução, alteração conjunta, formato equivalente e expiração aguardando lock falham sem adapter/audit |
| Ciclo do projeto não revalidado | um helper server-side é usado no preparo e no consumo, com a mesma falha segura | estados suspensos/terminais recusados; mudança confirmada antes da autorização vence a corrida; mudança posterior ao commit não recolhe o transporte |
| Propriedade não enumerável escapava | inspeção recursiva de descriptors recusa dados ocultos e accessors sem os executar | getter-canário permanece zero; setter, Symbol, array adulterado e traps de Proxy falham controladamente |
| Prova apenas process-local | disputas 2/5/10 na camada completa e em subprocessos Node com clientes independentes | unicidade de adapter/cobrança na camada completa; unicidade de consumo/CAS na camada multiprocesso |

O prazo permitido é `min(preparedAt + 60_000 ms, source.recordedAt + TTL explícito da política para cada fonte)`. `preparedAt` e `validUntil` aceitam somente `YYYY-MM-DDTHH:mm:ss.sssZ`. O valor recebido precisa coincidir exatamente com o binding e com a reconstrução a partir da política/fontes atuais.

O enum `ProjectStatus` atual não contém `ACTIVE`, e schema/migration eram proibidos nesta rodada. O helper considera `DRAFT`, `UNDER_REVIEW` e `APPROVED` os estados ativos equivalentes já representáveis, e bloqueia `PAUSED`, `ARCHIVED`, `CLOSED` e desconhecidos. Um literal único `ACTIVE` dependeria de migration futura explicitamente autorizada. Análise histórica de `CLOSED` permanece fora do escopo.

## QA observado

- Foco final (contratos, arquitetura, PostgreSQL e Gateway): **4 arquivos e 122 testes aprovados**, zero falhas.
- Subárvore completa Context Engine + AI Gateway: **24 arquivos e 381 testes aprovados**, zero falhas.
- TypeScript (`tsc --noEmit`) e ESLint completo: aprovados, zero erros e zero avisos.
- Prisma: schema válido, client gerado, **39 migrations** encontradas e banco atualizado, sem migration criada ou aplicada.
- Suíte oficial, primeira passagem do código final no banco existente: **162 arquivos aprovados, 1 arquivo oficialmente ignorado; 1.996 testes aprovados e 4 skips oficiais**, zero falhas, **407,54 s**.
- Suíte oficial, segunda passagem do código final no mesmo banco e sem recriação manual: **162 arquivos aprovados, 1 arquivo oficialmente ignorado; 1.996 testes aprovados e 4 skips oficiais**, zero falhas, **501,35 s**.
- Build produtivo: aprovado, **28/28 páginas estáticas** geradas; `next-env.d.ts` restaurado ao conteúdo do HEAD após a alteração automática do Next.js.
- Preflight produtivo inválido: recusado antes de qualquer dependência externa, exit code **2**, status `CONFIGURACAO_INVALIDA`, sem exibir valores.
- Manifesto de superfícies 9Q.2A: **35/35 hashes** canônicos conferem, zero divergências; manifesto não alterado.
- `git diff --check`: aprovado; apenas avisos informativos de conversão LF/CRLF do Git no Windows.
- Busca final de segredos: zero segredo real encontrado; os valores hostis presentes são canários deliberados de testes adversariais.

## Migration e riscos residuais

Nenhuma migration foi necessária ou criada. `AIExecutionLog` e `AIPendingAction` já sustentam tentativa, CAS, idempotência e vínculo auditável. O conteúdo da resposta não é persistido, portanto replay concluído suprime novo transporte sem reexpor a resposta antiga.

A barreira usa locks de tabela para também ordenar inserções de novas fontes. Isso reduz concorrência de escrita durante a transação curta de autorização; é o risco operacional residual concreto. Uma solução mais granular exigiria um protocolo/registro compartilhado por todos os produtores e pode demandar migration, que permanece proibida sem autorização específica. Não há recolhimento retroativo depois de `TRANSPORT_AUTHORIZED`. Providers comerciais, API/DNS externa e credenciais reais continuam bloqueados. Nenhuma parte das fases 10C–10I foi iniciada.
