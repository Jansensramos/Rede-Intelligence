# REDE Intelligence — Plano técnico da Fase 9F

## Pessoas, administração, eficiência, causa-raiz e performance

> Documento de planejamento. Nenhum modelo Prisma, migration, seed, serviço, tela ou cálculo foi implementado nesta preparação.

## 1. Objetivo e premissas

A Fase 9F deve acrescentar uma camada operacional que explique como pessoas, equipes e custos administrativos contribuem para a execução, sem transformar o REDE Intelligence em folha de pagamento e sem produzir rankings simplistas de pessoas.

O desenho preserva a cadeia econômica existente:

```text
Base Aprovada → Orçamento Oficial → Cronograma → Compras/Contratos/Medições
→ Financeiro realizado → Desvio observado → Investigação causal → Ação corretiva
→ Benefício comprovado → Economia validada existente → Simulação de incentivo
```

Princípios obrigatórios:

- `User` continua sendo identidade de acesso; pessoa e vínculo profissional são conceitos separados.
- Toda entidade de negócio pertence a uma `Organization`; empresa, projeto e centro de custo refinam o escopo.
- Plano, compromisso, medição, realizado e projeção atualizada continuam sendo estados econômicos distintos.
- Diferença favorável entre planejado e realizado não é automaticamente economia.
- `ValidatedSaving`, criado na Fase 9C, permanece como única fonte de economia validada.
- Métricas são determinísticas; a REDE IA explica resultados e cita evidências, mas não inventa números nem atribui culpa.
- Dados pessoais e remuneratórios têm autorização, auditoria, minimização e retenção próprias.
- Modelos temporais preservam histórico; alterações não reescrevem retroativamente vínculos ou alocações já fechados.

## 2. Base e estado real analisado

Análise realizada na branch `planning/fase-9f-pessoas-eficiencia`, baseada no tag `rede-phase-9d-complete-2026-08-21` e no commit `93a3cfaf0ca86760e2261193aa1cbaf909ad9ff4`.

### 2.1 Componentes reutilizáveis sem duplicação

| Capacidade atual | Evidência no repositório | Uso na 9F |
|---|---|---|
| Isolamento multiempresa | `Organization`, `EconomicGroup`, `Company`, `Project` | Dimensões obrigatórias de todos os fatos da 9F |
| Identidade e sessão | `User`, `OrganizationMembership`, `Session`; `src/application/auth/session.ts` | Autenticação e ator auditável, sem virar cadastro de colaborador |
| RBAC geral | `MembershipRole`: `OWNER`, `ADMIN`, `ANALYST`, `REVIEWER`, `VIEWER` | Compatibilidade inicial; autorização funcional mais granular é uma extensão futura |
| Estrutura gerencial | `ProjectOperatingUnit`, `CostCenter`, `EconomicItem` | Alocação de pessoas, custos, capacidade e análises |
| Plano oficial | `OperationalBaseline`, `Budget`, `BudgetLineItem` | Fonte do planejado aprovado e das revisões |
| Composição de mão de obra | `BudgetLaborComposition` | Custo e quantidade planejados por função, sem identificar uma pessoa |
| Cronograma | `OperationalSchedule`, `ScheduleActivity`, `ScheduleAllocation` | Período, responsável, avanço físico e desembolso planejado |
| Ponte e materialidade | `BudgetVarianceJustification`, `MaterialityPolicy`; motor de operações | Classificação inicial e priorização de desvios |
| Financeiro | `FinancialObligation`, contas, parcelas, pagamentos e projeção atualizada | Compromisso e realizado financeiro, com competência e rastreabilidade |
| Compras e execução contratada | Necessidades, requisições, cotações, pedidos, contratos, aditivos e medições | Evidência de contratação, execução, quantidade, preço e pendências |
| Economia | `ValidatedSaving` e `SavingClassification` | Único ledger de economia validada; a 9F somente referencia e agrega |
| Aprovações | `ApprovalPolicy`, `ApprovalRequest`, `ApprovalDecisionRecord` | Fluxo reutilizável para atos sensíveis da 9F |
| Jurídico | diligência, obrigações, licenças, processos, prazos e eventos financeiros | Dependências externas, bloqueios e causas regulatórias/contratuais |
| Auditoria | `AuditLog` com organização, usuário, entidade, antes/depois e metadados | Trilha obrigatória de alterações e decisões sensíveis |
| IA governada | `src/application/ai/tool-registry.ts` | Ferramentas de leitura com papéis, evidências e modos explícitos |
| Central Executiva | `src/components/intelligence-workspace.tsx` | Destino de indicadores agregados, preservando a identidade visual |

### 2.2 Lacunas reais

O schema atual não contém cadastro de pessoa profissional, vínculo trabalhista/contratual, departamento, cargo, equipe, alocação temporal, capacidade, custo administrativo realizado, observação de performance, análise causal ou plano de ação da 9F.

Também não existe escopo de permissão por empresa, projeto, área ou campo sensível. `OrganizationMembership` define apenas um papel geral na organização. Os campos `responsibleId` atuais são identificadores operacionais e não formam um cadastro de pessoas.

A composição de mão de obra do orçamento registra função, quantidade, custo mensal, encargos, benefícios e meses, mas é planejamento agregado. Ela não deve ser convertida em folha individual nem tomada como realizado.

### 2.3 Fronteira com a Fase 9E

A Fase 9E está em desenvolvimento em outra branch e não integra esta base congelada. A 9F não deve depender de nomes de tabelas ainda instáveis. A integração comercial será feita por contrato de aplicação após o merge e o congelamento do contrato da 9E.

## 3. Escopo funcional proposto

### 3.1 Incluído

- cadastro organizacional de departamentos, cargos, pessoas profissionais e equipes;
- vínculos efetivos por período e histórico de movimentações;
- alocação de capacidade e custo por empresa, projeto, centro de custo e atividade;
- planejamento e apropriação de custos administrativos corporativos e de obra;
- comparação entre plano, compromisso, executado, realizado e projeção atualizada;
- registro de observações de performance com fonte e período;
- identificação, classificação, investigação e validação de desvios;
- hipóteses causais, evidências, dependências externas e causa-raiz validada;
- planos de ação, responsáveis, prazos, resultados esperados e verificação;
- indicadores agregados na Central Executiva;
- ferramentas de consulta e explicação para a REDE IA;
- simulação futura de incentivo baseada somente em benefício elegível comprovado.

### 3.2 Explicitamente fora do escopo

- folha de pagamento, cálculo de férias, 13º, rescisão ou obrigações acessórias;
- eSocial, relógio de ponto e gestão completa de frequência;
- benefícios reais e operação de fornecedores de benefícios;
- recrutamento e seleção completos;
- contabilidade, fiscal, livro razão e fechamento contábil;
- avaliação psicológica, inferência de atributos sensíveis ou vigilância individual;
- ranking automático de pessoas, demissão ou remuneração decidida por algoritmo;
- pagamento de bônus; a 9F limita-se a política, elegibilidade e simulação auditável.

## 4. Arquitetura proposta

### 4.1 Contextos de domínio

```text
Identidade e acesso (existente)
  └─ User / Membership / Session

Pessoas e organização (novo)
  ├─ Pessoa profissional e vínculos efetivos
  ├─ Departamento, cargo e equipe
  └─ Capacidade e alocações temporais

Custos administrativos (novo, integrado)
  ├─ Plano: Orçamento + composição de mão de obra
  ├─ Compromisso: Compras/Contratos/Financeiro
  └─ Realizado: Financeiro e futuro adaptador contábil

Eficiência e causa-raiz (novo)
  ├─ Observação → caso de desvio → hipóteses/evidências
  ├─ causa validada/dependência externa
  └─ plano de ação → verificação

Benefício econômico (reuso)
  └─ ValidatedSaving da 9C → simulação de incentivo da 9F
```

Os cálculos puros devem residir em `src/domain/people-performance/`; casos de uso e transações em `src/application/people-performance/`; adaptadores leem os módulos existentes sem duplicar seus dados. Essa estrutura é uma proposta para implementação futura, não uma alteração feita agora.

### 4.2 Portas de integração

As interfaces devem devolver valores com origem, versão, competência, moeda, estágio econômico e identificador idempotente:

- `PlannedPeopleCostPort`: Orçamento, `BudgetLaborComposition` e Cronograma.
- `CommittedCostPort`: pedidos, contratos, aditivos e contas pendentes.
- `ExecutedEvidencePort`: medições aprovadas, quantidades e avanço físico.
- `FinancialActualPort`: pagamentos, recebimentos e projeção atualizada da 9B.
- `ValidatedSavingPort`: leitura do `ValidatedSaving` da 9C, sem gravação paralela.
- `LegalDependencyPort`: obrigações, licenças, processos e bloqueios da 9D.
- `CommercialPerformancePort`: contrato a congelar após a integração da 9E.
- `AccountingActualPort`: interface futura para competência contábil, sem implantação nesta fase.

Não se deve copiar valores para tabelas agregadas mutáveis. Quando performance exigir escala, gerar snapshots imutáveis, identificando as fontes e seus checksums.

## 5. Modelo conceitual de entidades

Os nomes abaixo são propostas para o schema futuro. Devem ser validados em cada sprint antes de qualquer migration.

### 5.1 Organização e pessoas

| Entidade proposta | Responsabilidade | Relações essenciais |
|---|---|---|
| `Department` | Hierarquia organizacional efetiva | organização, empresa opcional, pai, responsável, vigência |
| `Position` | Cargo/função normalizada | organização, família, nível, configuração não remuneratória |
| `PersonProfile` | Pessoa profissional, separada do login | organização, `userId` opcional e único por organização, estado, dados mínimos |
| `EmploymentRelationship` | Vínculo com natureza e vigência | pessoa, empresa, departamento, cargo, gestor, início/fim, carga/capacidade |
| `Team` | Equipe permanente ou temporária | organização, empresa/projeto opcionais, propósito e vigência |
| `TeamMembership` | Participação efetiva na equipe | equipe, vínculo, papel, percentual, início/fim |
| `WorkAllocation` | Distribuição temporal de capacidade/custo | vínculo, projeto, centro de custo, item econômico/atividade opcionais, período e percentual |
| `RelationshipCostSnapshot` | Custo normalizado e restrito por competência | vínculo, componentes agregados, moeda, fonte, período, versão e checksum |

Naturezas futuras de vínculo: empregado, sócio/administrador, prestador pessoa física, prestador pessoa jurídica, temporário, aprendiz/estagiário e terceiro alocado. A natureza não deve acionar cálculo trabalhista; serve para governança e análise.

Regras temporais:

- vigências são intervalos `[início, fim)`; fim nulo significa vínculo corrente;
- um vínculo não pode ter alocações conflitantes acima da capacidade configurada no mesmo período;
- a soma de percentuais ativos deve ser validada por período, com tolerância explícita;
- movimentação cria nova vigência; não sobrescreve história fechada;
- hierarquias rejeitam ciclos;
- `PersonProfile` não é obrigatório para terceiros quando a análise agregada puder usar equipe/fornecedor, minimizando dados pessoais.

### 5.2 Custos administrativos

| Entidade proposta | Responsabilidade |
|---|---|
| `AdministrativeCostPlan` | Cabeçalho versionado do plano administrativo corporativo ou de obra |
| `AdministrativeCostPlanLine` | Valor, quantidade, período e dimensões; pode referenciar linha de orçamento existente |
| `AdministrativeCostAllocationRule` | Critério versionado de rateio: direto, headcount, capacidade, área, receita ou driver configurado |
| `AdministrativeCostAllocationSnapshot` | Resultado imutável do rateio, com fonte, driver, memória e checksum |

O realizado administrativo não deve ser digitado em um ledger paralelo. Deve vir de `FinancialObligation`, `PayableAccount`/pagamentos, contratos/medições ou do futuro `AccountingActualPort`. Um lançamento manual só é aceito como observação claramente rotulada e nunca como contabilidade oficial.

### 5.3 Eficiência, causa-raiz e ações

| Entidade proposta | Responsabilidade |
|---|---|
| `PerformanceObservation` | Fato observado por período, dimensão, métrica, fonte, unidade e confiança |
| `EfficiencyAnalysisRun` | Execução imutável/versionada do motor com data de corte e fontes |
| `EfficiencyMetricResult` | Resultado determinístico, denominadores, limites e qualidade dos dados |
| `PerformanceVarianceCase` | Caso gerenciável originado por desvio material |
| `CausalHypothesis` | Hipótese explícita, não tratada como fato |
| `CausalEvidence` | Evidência a favor/contra, fonte, versão, autor e confiança |
| `RootCauseAllocation` | Causa validada e parcela explicada do desvio |
| `ExternalDependency` | Dependência fora do controle direto, inclusive jurídica/regulatória/comercial |
| `CorrectiveAction` | Ação com dono operacional, prazo, impacto esperado e estado |
| `CorrectiveActionEvidence` | Evidência de execução e de verificação do resultado |

O responsável pelo caso ou pela ação não é automaticamente a pessoa que causou o desvio. A interface deve usar linguagem de processo, condição e evidência, não de culpa.

### 5.4 Simulação de incentivo

| Entidade proposta | Responsabilidade |
|---|---|
| `IncentivePolicy` | Política versionada, vigência, taxa, limites, reservas e critérios |
| `IncentiveSimulation` | Simulação imutável sobre uma data de corte e política |
| `ContributionEvidence` | Evidência de contribuição de equipe/pessoa, sem ranking opaco |
| `IncentiveAllocation` | Alocação simulada por equipe/pessoa e memória de cálculo |

A taxa conceitual de pool pode ser configurada na faixa de 10% a 15%, mas nenhum percentual será hardcoded. A política pode inclusive definir outra faixa, sujeita a aprovação e governança.

## 6. Semântica econômica de eficiência

### 6.1 Estados que nunca podem ser misturados

Para cada período e dimensão:

- `P`: planejado temporalizado pelo Orçamento/Cronograma;
- `C`: compromisso concreto ainda não realizado;
- `M`: executado/medido aprovado;
- `R`: realizado financeiro;
- `F`: previsão residual/EAC, conforme o motor da 9B;
- `Qp`: quantidade ou avanço físico planejado;
- `Qr`: quantidade ou avanço físico comprovado.

Indicadores básicos:

```text
desvio_de_caixa = P - R
desvio_de_compromisso = P - (R + C)
desvio_físico = Qr - Qp
custo_esperado_do_executado = P × fator_de_execução_comprovado
desvio_de_produtividade = custo_do_executado - custo_esperado_do_executado
```

Essas diferenças são sinais para investigação, não economia. O motor deve preservar competência mensal e acumulado separadamente, impedir divisão por zero e indicar denominador/qualidade de cada métrica.

### 6.2 Classificação do desvio

Fluxo proposto:

```text
NÃO CLASSIFICADO → EM ANÁLISE → CLASSIFICADO → VALIDADO → ENCERRADO
```

Categorias mínimas:

- diferença temporal/atraso;
- ainda não contratado;
- medição pendente ou rejeitada;
- escopo alterado;
- quantidade diferente;
- variação de preço;
- produtividade;
- erro de estimativa;
- dependência externa;
- evidência insuficiente;
- benefício candidato;
- economia validada, somente por vínculo com `ValidatedSaving`.

Uma alocação causal explica até 100% do desvio. A parcela residual permanece “não explicada”; o sistema nunca força uma causa total artificial.

### 6.3 Caso obrigatório: R$ 350 mil planejados e R$ 200 mil realizados

O saldo de R$ 150 mil inicia como `DIFERENÇA_NÃO_CLASSIFICADA`, nunca como saving. A sequência obrigatória é:

1. comparar a mesma competência e também o acumulado;
2. confirmar entrega física/escopo/qualidade equivalentes;
3. verificar contratos, pedidos, aditivos e compromissos ainda abertos;
4. verificar medições emitidas, pendentes, retornadas ou não integradas;
5. verificar contas a pagar e pagamentos posteriores;
6. apurar previsão para concluir e eventual reprogramação;
7. separar quantidade, preço, produtividade, escopo e tempo;
8. somente para benefício comprovado e comparável, usar o fluxo de validação da 9C.

| Evidência encontrada | Classificação correta dos R$ 150 mil |
|---|---|
| Trabalho atrasado para o mês seguinte | Diferença temporal |
| Contrato assinado, medição ainda não recebida | Compromisso/medição pendente |
| Etapa ainda não contratada | Não contratado; exposição futura |
| Escopo reduzido ou qualidade inferior | Alteração de escopo, não economia comparável |
| Mesma entrega concluída, qualidade preservada, sem passivo futuro | Candidato a benefício; ainda requer `ValidatedSaving` |
| `ValidatedSaving` aprovado, escopo comparável e evidências completas | Economia validada elegível, sujeita à política |

O valor elegível para incentivo é zero enquanto não houver `ValidatedSaving` validado e não revertido. A 9F não criará outro motor ou tabela de saving.

## 7. Investigação de causa-raiz

### 7.1 Taxonomia inicial

- planejamento/estimativa;
- projeto e especificação;
- suprimentos/fornecedor;
- contrato/aditivo;
- execução e produtividade;
- qualidade/retrabalho;
- capacidade e alocação;
- fluxo de decisão/aprovação;
- financeiro/caixa;
- comercial/demanda;
- jurídico/regulatório;
- tecnologia/dados;
- evento externo.

A taxonomia será configurável e versionada por organização. “Cinco porquês” e Ishikawa podem ser métodos de apoio registrados em metadados, não provas automáticas.

### 7.2 Evidência e confiança

Cada hipótese deve registrar autoria, data, método, evidências favoráveis e contrárias. A confiança será derivada de regras transparentes, considerando fonte oficial, atualidade, cobertura e contradições. A validação da causa exige revisor diferente do autor quando a materialidade ultrapassar a política aplicável.

### 7.3 Plano de ação

Estados propostos:

```text
RASCUNHO → EM APROVAÇÃO → ATIVA → BLOQUEADA → CONCLUÍDA → VERIFICADA
                                      ↘ CANCELADA
```

Toda ação deve conter dono, prazo, causa relacionada, resultado esperado, custo de implementação, dependências, indicador de verificação e evidência de conclusão. Ações vencidas alimentam alertas, mas a conclusão só vira resultado após verificação independente.

## 8. Benefício e simulação de incentivo

### 8.1 Base elegível

```text
benefício_elegível = economia_validada
                   - custo_de_implementação
                   - reversões
                   - reserva_de_risco_configurada

pool_simulado = limitar(
  benefício_elegível × taxa_da_política,
  piso_configurado,
  teto_configurado
)
```

Regras:

- o pool nunca supera o benefício elegível;
- somente `ValidatedSaving` com escopo comparável e validação vigente entra na base;
- o mesmo saving não pode ser consumido por duas simulações ativas;
- reclassificação/reversão refaz uma nova versão de simulação, sem editar a antiga;
- gates de qualidade, prazo, retrabalho, segurança e colaboração são configuráveis;
- contribuição deve ser sustentada por evidências e pode ser coletiva;
- aprovação obedece segregação de funções e `ApprovalPolicy` estendida;
- nenhuma simulação gera pagamento, folha ou direito adquirido automaticamente.

### 8.2 Proteção contra ranking simplista

Não haverá placar ordinal público de pessoas. A visão executiva mostra equipes, processos, capacidade e resultados agregados. Informações individuais ficam restritas ao fluxo autorizado, com contexto, evidência, direito de revisão e sem inferência de saúde, gênero, raça, religião, sindicalização ou outros atributos sensíveis.

## 9. Integrações com as Fases 9A–9E

### 9A — Base, Orçamento e Cronograma

- consumir `BudgetLaborComposition` como plano agregado;
- usar `BudgetLineItem`, `EconomicItem`, `CostCenter`, atividade e alocações como dimensões canônicas;
- respeitar versões aprovadas e nunca alterar a Base Aprovada;
- reutilizar materialidade e justificativas, sem substituir a ponte do orçamento.

### 9B — Financeiro

- realizado vem de pagamentos/recebimentos válidos e competência vem das obrigações/contas;
- compromisso pendente e previsão residual seguem `buildUpdatedProjection`;
- não contar pagamento e obrigação como dois custos;
- fechamento mensal impede alteração retroativa silenciosa;
- `AccountingActualPort` complementará competência no futuro, sem reescrever o Financeiro.

### 9C — Compras, contratos, aditivos e medições

- usar contrato/aditivo para compromisso, medição para execução e pagamento para caixa;
- preservar o ledger Orçado → Contratado → Medido → Pago;
- referenciar `ValidatedSaving`; não criar `PeopleSaving` ou equivalente;
- reutilizar aprovações e eventos idempotentes.

### 9D — Jurídico

- obrigações, licenças e processos podem ser dependências externas de um caso;
- um atraso jurídico pode explicar desvio, mas não deve ser imputado a uma pessoa;
- impactos financeiros continuam sendo enviados pelo fluxo idempotente da 9D para a 9B.

### 9E — Comercial, vendas e recebíveis

Após o congelamento do contrato da 9E, o `CommercialPerformancePort` deve fornecer apenas dados aprovados sobre capacidade comercial, funil, estoque, vendas/contratos, cancelamentos, recebíveis e backlog. A 9F correlaciona esses fatos com capacidade e custos, sem copiá-los nem depender do schema em desenvolvimento.

Gate de integração: revisar a versão final da 9E, mapear competência e status canônicos, validar idempotência, confirmar ownership do recebível e executar testes de contrato antes de adicionar qualquer FK.

## 10. Central Executiva

Indicadores propostos, sempre com data de corte e drill-down:

- custo administrativo planejado, comprometido, realizado e projeção atualizada;
- custo administrativo por empresa, projeto, centro de custo e período;
- capacidade planejada, alocada e disponível por equipe;
- avanço físico versus consumo de custo;
- produtividade por processo/equipe, somente com denominador confiável;
- desvios materiais por estado e categoria causal;
- percentual do desvio explicado e confiança das evidências;
- ações ativas, vencidas, bloqueadas e verificadas;
- benefício candidato versus economia validada;
- pool de incentivo apenas como simulação, separado de realizado;
- qualidade/cobertura dos dados.

Para preservar privacidade, métricas pessoais não aparecem na Central Executiva. Recortes com grupos abaixo de um limiar configurável são ocultados ou agregados.

## 11. REDE IA

Ferramentas futuras, prioritariamente de leitura:

- `getAdministrativeCostOverview` — plano, compromisso, realizado e EAC;
- `explainEfficiencyVariance` — decomposição determinística com fontes;
- `getRootCauseSummary` — hipóteses, evidências, confiança e parcela não explicada;
- `getCorrectiveActionStatus` — ações, bloqueios, prazos e verificação;
- `getCapacityAndBacklog` — capacidade agregada e demanda, após integração 9E;
- `getValidatedSavingForIncentive` — saving elegível vindo da 9C;
- `simulateIncentivePool` — simulação marcada como não oficial e sujeita a confirmação.

Perguntas que a Central deve suportar:

- “Por que o custo administrativo ficou abaixo do plano neste mês?”
- “Qual parcela é atraso, compromisso pendente, escopo ou benefício validado?”
- “Quais causas têm evidência suficiente e quais continuam como hipótese?”
- “Quais ações vencidas afetam prazo, custo ou venda?”
- “Quanto da economia validada é elegível na política vigente?”

Restrições: a IA não acessa remuneração individual sem permissão específica, não infere traços sensíveis, não cria causas, aprovações ou savings, não recomenda sanção/demissão e sempre exibe fonte, versão, corte e confiança.

## 12. Segurança, RBAC e LGPD

### 12.1 Autorização

O RBAC geral atual deve ser preservado. A 9F adicionará permissões funcionais e escopos, sem renomear papéis existentes:

- `PEOPLE_READ` e `PEOPLE_MANAGE`;
- `COMPENSATION_READ`;
- `ALLOCATION_MANAGE`;
- `EFFICIENCY_READ`, `EFFICIENCY_ANALYZE`, `EFFICIENCY_APPROVE`;
- `ACTION_MANAGE`, `ACTION_VERIFY`;
- `INCENTIVE_SIMULATE`, `INCENTIVE_APPROVE`.

Escopos possíveis: organização, empresa, projeto, departamento e própria pessoa. Serviços devem filtrar `organizationId` e validar cada referência. DTOs aplicam redaction de campo; esconder controles somente na interface não é segurança. Segregação mínima: autor da causa não a valida; proponente da simulação não a aprova; acesso a remuneração é independente de acesso à eficiência.

### 12.2 LGPD

- coletar somente dados necessários à finalidade declarada;
- registrar base legal/finalidade e política de retenção por categoria;
- criptografar segredos e campos remuneratórios sensíveis em repouso quando aplicável;
- auditar leitura e exportação de dados sensíveis, além de mutações;
- impedir PII em logs, prompts, embeddings e telemetria;
- oferecer correção, anonimização/eliminação conforme obrigação legal e retenção;
- mascarar exportações e aplicar limiar mínimo de coorte;
- manter evidência de consentimento apenas quando consentimento for a base adequada;
- submeter DPIA/RIPD e revisão jurídica antes de uso individual em produção.

## 13. Performance e escala

Premissa inicial para dimensionamento: dezenas de empresas, centenas de projetos, milhares de vínculos, milhões de fatos mensais e evidências ao longo dos anos.

Diretrizes:

- índices iniciados por `organizationId`, seguidos de período/status e dimensão frequente;
- índices de vigência para vínculo, equipe e alocação;
- paginação por cursor e filtros server-side;
- prevenção de N+1 e seleção apenas dos campos autorizados;
- runs de análise assíncronos, idempotentes e reexecutáveis;
- snapshots mensais imutáveis para dashboards, com checksum e ponte para fontes;
- cache com chave de tenant, versão e data de corte;
- particionamento por competência somente após medição justificar a complexidade;
- retenção diferenciada de fatos analíticos, evidências e PII;
- métricas de latência, volume, falhas de integração e cobertura de dados.

## 14. Migrations e implantação futura

Nenhuma migration é criada nesta preparação. Na implementação:

1. usar migrations aditivas por sprint;
2. criar tabelas/campos opcionais e índices antes de ativar leituras;
3. executar backfill idempotente com relatório de divergências;
4. validar isolamento multiempresa e constraints em PostgreSQL real;
5. ativar cada capacidade por feature flag;
6. nunca resetar banco nem editar migrations aplicadas;
7. somente depois tornar obrigatórios campos cuja cobertura esteja comprovada;
8. criar seed demonstrativo aditivo e idempotente, claramente rotulado.

RLS no PostgreSQL pode ser adotado como defesa em profundidade depois que o padrão de conexão/contexto transacional estiver comprovado; não substitui filtros e validações nos serviços.

## 15. Testes futuros

### Domínio

- vigências, sobreposição, hierarquias e soma de alocações;
- rateios e fechamento de resíduos monetários;
- plano versus compromisso versus executado versus realizado;
- classificações de diferença temporal, escopo, quantidade, preço e produtividade;
- caso R$ 350 mil/R$ 200 mil em todas as variantes;
- causa parcial, evidência contraditória e parcela não explicada;
- estados e segregação do plano de ação;
- benefício elegível, limites, reversões e versionamento de simulação;
- invariantes de que diferença não validada gera pool zero.

### Integração PostgreSQL

- isolamento entre organizações em leitura, escrita, exportação e IA;
- referência cruzada entre empresas/projetos rejeitada;
- histórico efetivo preservado e concorrência otimista;
- idempotência de imports/runs/eventos;
- reaproveitamento de `ValidatedSaving` sem dupla contagem;
- fechamento financeiro e versões aprovadas respeitados;
- autorização por papel, escopo e campo sensível;
- auditoria de leitura sensível e de toda decisão.

### Contratos e interface

- testes de contrato com 9A, 9B, 9C, 9D e a versão congelada da 9E;
- Central Executiva sem PII e com totais conciliados ao drill-down;
- REDE IA sem acesso indevido e sempre com evidência;
- acessibilidade, estados vazios, dados parciais e grandes volumes;
- regressão integral do START BUTANTÃ e das abas existentes.

## 16. Divisão detalhada em sprints

### 9F.0 — Congelamento de contratos e privacidade

- revisar a 9E após merge e congelar portas 9A–9E;
- definir dicionário de competência, estágios econômicos e dimensões;
- validar matriz RBAC/LGPD, retenção e classificação dos dados;
- criar ADRs de identidade versus pessoa e saving único.

**Saída:** contratos testáveis, decisões de segurança aprovadas e nenhum schema duplicado.

### 9F.1 — Estrutura organizacional e vínculos

- implementar departamentos, cargos, pessoas profissionais, vínculos e equipes;
- vigência, hierarquias, multiempresa e auditoria;
- vínculo opcional e seguro entre pessoa e `User`.

**Saída:** estrutura temporal navegável, sem folha e sem expor remuneração.

### 9F.2 — Capacidade, alocação e custo administrativo

- alocações por projeto/centro/item/atividade;
- plano administrativo versionado e regras de rateio;
- snapshots de custo restrito e adaptadores 9A/9B/9C;
- conciliação e memória de cálculo.

**Saída:** plano, compromisso e realizado distintos e reconciliáveis.

### 9F.3 — Motor de eficiência e casos de desvio

- observações, runs imutáveis, métricas e qualidade de dados;
- decomposição temporal, física, preço, quantidade e produtividade;
- criação de caso por materialidade, nunca saving automático.

**Saída:** caso R$ 350 mil/R$ 200 mil classificado corretamente em todos os testes.

### 9F.4 — Causa-raiz, dependências e ações

- hipóteses, evidências, confiança e alocação causal parcial;
- integração com bloqueios jurídicos e comerciais;
- plano de ação, alertas, aprovação e verificação independente.

**Saída:** trilha completa de observação até ação verificada, sem linguagem de culpa.

### 9F.5 — Economia e simulação de incentivo

- adaptar `ValidatedSavingPort` sobre a 9C;
- política versionada, taxa configurável, limites, reserva e reversões;
- contribuição baseada em evidência e simulações imutáveis;
- aprovação segregada, sem pagamento automático.

**Saída:** pool zero sem saving válido e memória de cálculo reproduzível.

### 9F.6 — Central Executiva e REDE IA

- indicadores agregados e drill-down autorizado;
- ferramentas de leitura e simulação governada;
- linguagem prioritariamente em português, estados vazios e explicabilidade.

**Saída:** totais conciliados, evidências citadas e nenhuma PII vazada.

### 9F.7 — Escala, integrações e endurecimento

- agregações/snapshots, paginação, cache e observabilidade;
- testes de carga, segurança, concorrência e recuperação;
- adaptar contabilidade apenas se o contrato externo estiver disponível;
- documentação operacional e rollout gradual.

**Saída:** gates de produção aprovados e regressão completa verde.

## 17. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Confundir economia com atraso | Indicador e bônus incorretos | Classificação obrigatória, forecast-to-complete e `ValidatedSaving` único |
| Duplicar realizado financeiro | Custos inflados | Portas de leitura, IDs de origem, estágios e idempotência |
| Transformar `User` em empregado | Acoplamento e vazamento de dados | `PersonProfile` separado e vínculo opcional |
| Expor remuneração/PII | Risco LGPD | permissão por campo, redaction, auditoria de leitura e coortes |
| Culpar pessoas por correlação | Dano humano e jurídico | análise de processo/equipe, evidência, revisão e proibição de decisão automática |
| Dependência de schema instável da 9E | Retrabalho | contrato abstrato e gate após merge/tag |
| Rateios opacos | Perda de confiança | regra versionada, driver e memória de cálculo |
| Retroagir histórico | Auditoria inválida | vigência efetiva, snapshots e versões imutáveis |
| Métricas sem denominador | Conclusão falsa | qualidade/cobertura explícitas e resultado indisponível quando necessário |
| Consultas analíticas pesadas | Central lenta | snapshots mensais, índices, paginação e processamento assíncrono |

## 18. Decisões que exigem validação antes de implementar

- cadastro mestre de pessoa por organização ou compartilhado no grupo econômico;
- fonte oficial de custo por competência antes da integração contábil;
- granularidade diária ou mensal das alocações;
- política de sobrealocação e capacidade padrão;
- atos da 9F que ampliarão `ApprovalActType`;
- limiar mínimo de coorte e política de retenção;
- ownership final de métricas comerciais após a 9E;
- critérios corporativos para benefício elegível e reversão;
- se incentivo será por equipe, pessoa ou modelo híbrido;
- volume esperado para decidir materialização/particionamento.

## 19. Critério de conclusão da Fase 9F

A fase estará concluída quando houver uma cadeia auditável do plano ao resultado, sem dupla contagem e sem automatizar julgamento humano:

```text
Pessoa/vínculo vigente + alocação autorizada
→ custo planejado/comprometido/realizado conciliado
→ desvio material corretamente classificado
→ causa sustentada por evidência
→ ação executada e verificada
→ benefício, quando houver, validado exclusivamente na 9C
→ simulação de incentivo configurável, privada e aprovada
```

O primeiro passo de implementação recomendado é a Sprint 9F.0. Ela deve começar somente após o merge e congelamento dos contratos da Fase 9E, com validação conjunta do dicionário econômico e da matriz LGPD/RBAC.
