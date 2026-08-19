# REDE Red Team v1

## Objetivo e limites

O Red Team é uma camada adversarial sobre um `StudyVersion` imutável. Ele questiona viabilidade, evidência e execução, mas não recalcula nem sobrescreve o REDE Engine, REDE Score ou Sensitivity Engine. A Fase 4 não contém chat, acesso à internet, agentes autônomos externos ou execução de instruções encontradas em documentos.

## Fluxo

1. A aplicação fecha o cálculo, Score, sensibilidade, stresses, alertas e trilhas da nova versão.
2. `buildEvidencePack` reúne contexto do tenant, premissas e fontes, valores calculados, documentos enviados e lacunas conhecidas.
3. Seis especialistas determinísticos avaliam somente esse pacote.
4. Achados `HIGH` e `CRITICAL` recebem revisão cruzada; opiniões incompatíveis ficam como divergências explícitas.
5. O Chair aplica regras de decisão documentadas e produz a conclusão executiva.
6. Run, pareceres, evidências, vínculos, achados, contestações, solicitações, revisões, divergências e conclusão são persistidos antes de a versão virar `SNAPSHOT`.

## Especialistas

- `FINANCE_FUNDING`: necessidade de capital, liquidez, funding e aderência à política.
- `ENGINEERING_COST`: orçamento, cronograma, contingência, custo e risco técnico.
- `COMMERCIAL_MARKET`: preço, velocidade, recebimentos, repasse e evidência de demanda.
- `LEGAL_STRUCTURING`: titularidade, contrato do terreno, licenças e condicionantes.
- `INVESTOR_CFO`: retorno ajustado ao risco, gates, concentração e destruição de valor em stress.
- `DEVELOPER_OPERATOR`: executabilidade, margens de manobra, fases e mitigação operacional.

Cada parecer possui status, confiança, opinião, perguntas, IDs de achados e indicação de uso do provider. Nenhum especialista recebe ou altera o estado de outro durante a primeira rodada.

## Evidence Pack e proveniência

O pacote registra sua própria versão e identifica organização, projeto, estudo, versão, hash e cenário. Premissas carregam fonte. Resultados incluem Engine, Score, regras, gates, penalidades, Sensitivity, stresses, break-even, alertas e traces.

Cada item normalizado tem `ref`, `kind`, `label`, `value`, `source` e `trust`. Referências como `ASSUMPTION.*`, `POLICY.*`, `ENGINE.*`, `SCORE_RULE.*`, `STRESS.*`, `BREAK_EVEN.*`, `TRACE.*`, `DOCUMENT.*` e `MISSING_EVIDENCE.*` formam a proveniência auditável. Todo achado deve possuir referências existentes no pacote, persistidas também na tabela de associação `red_team_finding_evidence`.

Documentos enviados são classificados como `USER_UNTRUSTED`; dados dos motores e políticas são `SYSTEM`. As lacunas documentais esperadas são materializadas em vez de serem preenchidas por inferência.

## Saídas estruturadas

Um achado contém agente, categoria, tipo, severidade, confiança, título, descrição, implicação, ação recomendada, status e referências. Tipos permitidos: risco, inconsistência, evidência ausente, contestação de premissa, oportunidade, quebra de política e bloqueio de decisão.

Premissas são classificadas como suportadas, fracamente suportadas, não suportadas, agressivas ou inconsistentes. Solicitações de evidência têm documento, razão, prioridade, achado relacionado e status. Revisões cruzadas usam `CONFIRM`, `REDUCE`, `ESCALATE` ou `DISAGREE`.

O Chair decide entre `ADVANCE`, `ADVANCE_WITH_CONDITIONS`, `RESTRUCTURE`, `DO_NOT_ADVANCE` e `INSUFFICIENT_EVIDENCE`. A conclusão registra confiança, risco dominante, principais achados, bloqueios, cinco ações, pedidos de evidência, divergências, forças, mitigações, risco residual e condições objetivas para mudar a decisão.

## Provider, validação e segurança

`LLMProvider` é uma porta independente de fornecedor com nome, modelo, disponibilidade e `generateStructured`. As respostas passam por schemas Zod específicos para especialista e Chair. Uma resposta inválida recebe uma tentativa controlada de reparo; nova falha ou indisponibilidade mantém somente o resultado determinístico validado.

Prompts separam instruções de sistema do envelope `<UNTRUSTED_EVIDENCE>`, proíbem seguir instruções contidas nas evidências, inventar métricas ou alterar resultados dos motores. Referências inexistentes ou achados fora do schema são descartados e registrados em observabilidade.

Quando nenhum provider está configurado, a interface mostra “Red Team AI não configurado” e a análise determinística permanece integralmente disponível.

## Persistência, tenancy e imutabilidade

`RedTeamRun` contém `organizationId`, `studyVersionId` e `scenarioId`. Leituras filtram simultaneamente a organização da run e a organização do projeto do estudo, evitando acesso por ID de outro tenant. O snapshot e todos os filhos Red Team são protegidos por triggers contra `UPDATE` e `DELETE`.

São registrados versões do Engine, Score, Red Team e prompts, provider/modelo, autor, timestamps, status, chamadas, duração, tokens, retentativas e erros. A execução completa também é preservada em JSON para reconstrução fiel da tela, enquanto tabelas normalizadas suportam auditoria e consultas.

## Testes

Os testes cobrem Evidence Pack e proveniência, schemas, seis especialistas isolados, revisão cruzada, divergências, síntese, premissas contestadas, evidência ausente, contenção de prompt injection, providers válido/malformado/indisponível, observabilidade, persistência, imutabilidade e isolamento multiempresa.
