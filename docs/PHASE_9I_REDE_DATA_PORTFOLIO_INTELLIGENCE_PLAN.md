# REDE Intelligence — Plano técnico da Fase 9I

## REDE Data: inteligência de portfólio, benchmarking, histórico e base proprietária

> Documento de planejamento. Nenhum schema, migration, seed, serviço, API, componente ou teste foi implementado nesta preparação.

## 1. Objetivo estratégico

O REDE Data deve transformar o histórico operacional em um ativo proprietário verificável:

```text
dado operacional
→ histórico estruturado
→ comparabilidade
→ benchmark
→ previsão
→ recomendação explicável
→ validação especializada
→ decisão aprovada
```

Os módulos operacionais permanecem como fontes transacionais. A 9I mantém contratos, snapshots seletivos, fatos analíticos, dimensões conformadas, métricas versionadas, agregados e datasets reproduzíveis — nunca uma segunda versão mutável do negócio.

Valor estratégico: quanto mais empreendimentos corretamente estruturados e encerrados, melhores podem ser os benchmarks e previsões. Qualidade, contexto e governança valem mais que volume bruto.

## 2. Base e estado real analisado

Análise realizada na branch `planning/fase-9i-rede-data-inteligencia`, baseada no tag `rede-phase-9d-complete-2026-08-21`, commit `93a3cfaf0ca86760e2261193aa1cbaf909ad9ff4`.

### 2.1 Reuso existente

| Capacidade | Objetos reais | Uso pela 9I |
|---|---|---|
| Snapshots de decisão | `StudyVersion`, `InvestmentSnapshotBundle`, `LandStudyVersion` | Estado congelado, schema/engine version, checksum e data |
| Base operacional | `OperationalBaseline` e linhas | O que foi aprovado, com revisão e evidência |
| Planejamento | `Budget`, EAP, `OperationalSchedule` e alocações | Orçado e planejado por item/período |
| Forecast | `OperationalForecast` | Projeções versionadas, ainda com conteúdo em JSON |
| Dimensões econômicas | `EconomicItem`, `CostCenter`, `ProjectOperatingUnit` | Chaves canônicas para comparações |
| Viabilidade | `CalculationRun`, fluxo, `FinancialResult`, `CalculatedMetric` | Previsões financeiras com engine/input hash |
| Realizado inicial | `ActualEntry` | Fatos por projeto, métrica e período; cobertura limitada |
| Score e sensibilidade | `Score`, dimensões/regras e `SensitivityAnalysis` | Métricas explicáveis e versionadas |
| Compras | propostas, decisão, `ValidatedSaving`, pedido e contrato | Preço, comparabilidade e saving validado |
| Execução | medição/linhas, obrigações, AP e pagamentos | Medido, comprometido e caixa em estágios distintos |
| Bancos | transações com checksum/external ID | Evidência de caixa importada/reconciliada |
| BIM/Design | revisões, `BimElement`, `DetectedUnit`, `DesignMetric` | Quantidades, áreas, propriedades, origem e confiança |
| Jurídico | diligências, findings, licenças, processos e prazos | Duração, bloqueios e eventos sem julgamento automático |
| Auditoria/materialidade | `AuditLog`, `MaterialityPolicy` | Lineage operacional e priorização de desvios |
| Central/IA | métricas determinísticas, ferramentas com evidência | Consumo futuro da camada semântica |

### 2.2 Padrões confirmados

- Versões e snapshots registram engine/schema/policy, checksum e timestamps.
- A Base Aprovada não é sobrescrita; revisões preservam vínculo anterior.
- Cálculos financeiros persistem input hash, versão do engine, fluxo e métricas.
- REDE Score guarda versão da política, regras, dimensões e penalidades.
- Métricas Design/BIM guardam origem, unidade, confiança e evidências.
- A 9C separa orçamento, contratado, medido, obrigado e pago.
- `ValidatedSaving` já é a única fonte de economia validada.
- A REDE IA consulta engines e evidências; não deve recalcular matemática crítica.

### 2.3 Lacunas

Não existem contratos analíticos comuns, dimensões conformadas, catálogo de dados, registro de métricas canônicas, lineage analítico, framework de qualidade, snapshots de fechamento de portfólio, facts normalizados, benchmarks, similaridade, confiança de benchmark, price observations unificadas, forecast accuracy ou datasets governados para IA.

`ActualEntry` é útil, mas genérico e insuficiente como warehouse. `InvestmentSnapshotBundle` atende decisão de investimento, não deve acumular todos os fatos operacionais. `OperationalForecast.projectedResult` em JSON precisa de contrato antes de análise longitudinal.

### 2.4 Planos futuros consultados

- 9E: unidades, vendas, preços, descontos, recebíveis, distratos e pós-venda.
- 9F: vínculos, custos, eficiência, causa-raiz e performance agregada.
- 9G: razão, competência, estoque contábil, receita, fiscal e consolidação.
- 9H: source of truth, conectores, external identities, provenance, freshness e observações externas de preço.

A 9I usa portas versionadas e somente integra esses domínios após freeze dos contratos finais.

## 3. Princípios arquiteturais

1. OLTP é fonte; REDE Data é projeção analítica reproduzível.
2. Histórico original nunca é alterado para “acertar” uma previsão.
3. Toda métrica possui definição, versão, unidade, granularidade e owner.
4. Todo benchmark declara população, filtros, ajustes, amostra e confiança.
5. Comparar exige contexto e normalização, não apenas mesma moeda/unidade.
6. Internet e fonte externa são observações, não verdade automática.
7. Agregados são reconstruíveis a partir de facts e lineage.
8. Reprocessamento troca versão do read model, não duplica fatos.
9. Dados privados de tenants não entram em benchmark SaaS sem base contratual e governança.
10. IA explica e busca; engines determinísticos e modelos estatísticos versionados calculam.

## 4. Arquitetura evolutiva

```text
OLTP 9A–9H
  → Data Contracts / Outbox ou captura incremental autorizada
  → Staging validado
  → Facts + Dimensions conformadas
  → Semantic Layer / Metric Registry
  → Read Models / Materialized Views
  → Benchmarks / Portfolio / Forecast Accuracy
  → Central REDE Data, API e datasets IA
```

### 4.1 Fase inicial

PostgreSQL atual com schema lógico analítico separado, tabelas incrementais e materialized views/read models. Jobs assíncronos atualizam projeções por evento e fazem reconciliação periódica. Esta opção reduz operação prematura.

### 4.2 Evolução por escala

Quando volume, concorrência ou SLA comprovarem necessidade:

- réplica analítica;
- warehouse colunar dedicado;
- object storage para datasets versionados;
- lake/lakehouse somente para dados e casos adequados;
- feature store apenas quando modelos de produção exigirem consistência online/offline.

A camada semântica e os contratos permanecem estáveis durante a troca de tecnologia.

## 5. Contratos de dados

`DataContract` conceitual por produtor/dataset:

- owner e consumidores;
- schema/version e política de compatibilidade;
- grain, chaves e temporalidade;
- semântica de valores/status;
- unidades, moeda, timezone e calendário;
- freshness/SLA;
- PII/confidencialidade/retenção;
- idempotency/source IDs;
- checks de qualidade;
- depreciação e backfill.

Mudança incompatível cria versão nova e janela de migração. A 9H entrega provenance/external identity; a 9I transforma somente após validação contratual.

## 6. Histórico e snapshots

### 6.1 Três camadas temporais

- **evento/fato:** ocorrência atômica com identidade e datas;
- **estado histórico:** vigência `validFrom/validTo` e, quando necessário, `recordedAt` (bitemporal);
- **snapshot:** fotografia imutável de um marco relevante.

O sistema deve responder:

```text
o que acreditávamos naquela data?
o que estava aprovado?
o que já estava contratado?
o que ocorreu depois?
qual foi o resultado final?
```

### 6.2 Gatilhos seletivos

Snapshots recomendados:

- aprovação de viabilidade/Base/orçamento/rebaseline;
- fechamento mensal operacional/financeiro/contábil;
- início da obra;
- marcos físicos configurados;
- lançamento comercial;
- entrega e encerramento.

Não gerar snapshot a cada edição. Entre marcos, eventos e histórico efetivo preservam mudança. Snapshot guarda referências/versões e métricas essenciais; payload pesado permanece na origem quando recuperável.

### 6.3 Modelo conceitual

| Entidade | Responsabilidade |
|---|---|
| `AnalyticsSnapshot` | Cabeçalho, tipo, projeto, as-of, corte, schema e checksum |
| `AnalyticsSnapshotSource` | Entidade/version/checksum usados |
| `SnapshotMetricValue` | Métrica canônica, versão, valor e dimensões |
| `DataProjectionCheckpoint` | Último evento processado por read model |

## 7. Modelo analítico

Não impor star schema em todo o produto, mas usar facts/dimensions onde melhoram consistência e performance.

### 7.1 Dimensões conformadas

- Tempo e data-base;
- Grupo, empresa/SPE e empreendimento;
- cidade, região e localização normalizada;
- produto, padrão, tipologia e unidade;
- fornecedor e cliente pseudonimizado quando aplicável;
- `EconomicItem`, centro de custo, EAP e atividade;
- contrato e categoria de compra;
- pessoa/equipe agregada após 9F;
- moeda, índice e unidade de medida;
- fonte e nível de confiança.

Dimensões mutáveis usam surrogate key e histórico tipo SCD2 quando o “como era” importa. IDs OLTP continuam no lineage.

### 7.2 Facts propostos

| Fact | Grain |
|---|---|
| `BudgetFact` | versão + linha + período |
| `ForecastFact` | forecast + métrica + período/data de corte |
| `ProcurementPriceFact` | proposta/pedido/contrato + item |
| `MeasurementFact` | medição + linha + competência |
| `FinancialSettlementFact` | pagamento/recebimento + parcela |
| `SalesFact` | venda/unidade/versão após 9E |
| `AccountingFact` | linha contabilizada após 9G |
| `ScheduleProgressFact` | atividade + período/corte |
| `ProductivityFact` | processo/equipe/período após 9F |
| `LegalCycleFact` | caso/licença/processo + marco |
| `PriceObservationFact` | item/especificação/fonte/data/região |
| `ForecastEvaluationFact` | forecast/corte + valor previsto + resultado final |

Grain e chave são explícitos; nenhum fact mistura orçamento, contrato, medição e pagamento.

## 8. Métricas canônicas e camada semântica

### 8.1 Registro

`MetricDefinition` conceitual:

- chave e nome em português;
- owner;
- definição e finalidade;
- fórmula/engine e versão;
- grain, dimensões permitidas e agregação;
- unidade/moeda/base temporal;
- numerator/denominator;
- filtros e exclusões;
- fontes e quality gates;
- vigência/depreciação.

Uma métrica oficial serve Central, relatórios, IA, API e benchmarks. VGV, margem, custo, VSO, preço/m², realizado, contratado, saving e exposição não podem ter fórmulas locais divergentes.

### 8.2 Versionamento

Se a fórmula muda, publicar nova versão. Resultados antigos permanecem associados à versão original. Pode haver backfill comparativo na nova versão, claramente marcado como “recalculado”, sem apagar o valor historicamente publicado.

### 8.3 Regras de agregação

- somáveis: valores monetários no mesmo contexto/base;
- semi-aditivos: saldos apenas no tempo correto;
- razões: recalcular por numerador/denominador, não fazer média ingênua;
- percentis e mediana: preservar distribuição/amostra;
- moeda e índice: normalizar antes de agregar.

## 9. Normalização

### 9.1 Unidades

Registro canônico de unidades e conversões versionadas: m², m³, kg, t, unidade, hora etc. Conversão exige dimensão compatível. “verba” não vira quantidade física artificial.

### 9.2 Moeda e inflação

Guardar sempre:

- valor nominal e moeda;
- data do valor;
- índice/curva e fonte;
- data-base alvo;
- fator aplicado;
- valor normalizado;
- versão da memória de cálculo.

Reutilizar `FinancialIndex` da 9B quando apropriado, com confiabilidade e fonte. Não substituir o nominal.

### 9.3 Contexto construtivo

Região, padrão, produto, tipologia, área, vertical/horizontal, método construtivo, número de unidades, estágio, escopo e escala são dimensões/atributos de comparabilidade.

Caso: R$ 2.340/m² em 2026 e R$ 2.100/m² em 2023 somente são comparados após data-base, escopo e contexto compatíveis.

## 10. Semântica de estágios de custo

```text
estimado/base
→ orçado
→ cotado
→ contratado
→ medido/executado
→ obrigado por competência
→ contabilizado
→ pago
```

Cada estágio possui fonte e data próprias. “Custo real” deve declarar qual definição usa:

- **execução real:** medição aprovada/quantidade comprovada;
- **competência real:** lançamento contábil 9G;
- **caixa real:** pagamento conciliado 9B;
- **custo final:** encerramento aprovado e reconciliado.

Benchmarks exibem estágio, cobertura e reconciliação. Pedido/contrato não vira realizado.

## 11. Benchmark de custos

Indicadores:

- R$/m² construído/privativo, com denominador explícito;
- R$/unidade/tipologia;
- R$/`EconomicItem`;
- estrutura, instalações, acabamento, administração, projetos, aprovação e comercial;
- custo direto, indireto e total conforme definição.

População é filtrada por comparabilidade. Exibir N, mediana, média, percentis, dispersão, data-base, coverage e outliers. Amostra única não vira benchmark.

## 12. Benchmark de compras

Histórico por item/especificação, fornecedor, região, quantidade, data, preço, frete, imposto conhecido, prazo e condição de pagamento.

Comparação ajusta unidade, quantidade/faixa, região, data-base, frete e tributo. Cotações e contratos preservam scope/comparability; compra reconciliada/paga recebe evidência mais forte, sem tornar fornecedor “melhor” apenas pelo preço.

## 13. Price Intelligence

`PriceObservation` conceitual unifica:

- compra, cotação, contrato, fornecedor, tabela pública, índice, marketplace, pesquisa e connector 9H;
- item e especificação normalizada;
- quantidade/unidade, região e data;
- preço, frete, tributos e condição;
- fonte/evidência/licença;
- confiança, validade e checksum;
- mapping para `EconomicItem`.

Níveis de confiança são política versionada baseada em proveniência, reconciliação, formalidade, recência, completude e comparabilidade — não enum fixo arbitrário.

Internet a R$ 500/m³ e histórico real a R$ 455/m³ aparecem lado a lado, contextualizados. Nenhuma observação sobrescreve a outra.

### 13.1 Índices REDE futuros

Concrete, Steel, Labor, Electrical, Plumbing e outros por região/período/padrão/volume. Metodologia publica amostra, ponderação, revisão e confiança. Não implementar índices nesta fase.

### 13.2 Price Watch

Séries de concreto, aço, blocos, elétrica, hidráulica, elevadores, mão de obra etc. Alertas usam métricas oficiais e amostras suficientes:

- variação em janela configurada;
- última cotação versus histórico ajustado;
- orçamento versus comparáveis;
- baixa freshness ou baixa confiança.

## 14. Quantity Intelligence e composições

### 14.1 Quantidades

IFC/BIM, `BimElement.quantities`, áreas, volumes, materiais, propriedades e `DetectedUnit` devem ser ligados a `EconomicItem` por mapping versionado e revisável. Quantidade guarda modelo/revisão, elemento, unidade, método de extração, confiança e evidência.

### 14.2 Composições proprietárias

`CostCompositionDefinition` futura:

- output (ex.: 1 m³ de concreto estrutural);
- insumos: concreto, aço, forma, mão de obra, equipamento, perda e logística;
- coeficiente/unidade;
- região/padrão/vigência;
- fonte/versão/confiança.

Histórico preserva estimado → cotado → contratado → medido → realizado por componente. A 9I cria fundação e contratos, não o motor completo.

## 15. Benchmarks de prazo e produtividade

Comparar previsto, replanejado e realizado por atividade, m², unidade, etapa e método construtivo. Duração usa marcos válidos, calendários e pausas justificadas; não apenas diferença bruta entre datas.

Após 9F: produtividade, backlog, reprocesso e causa-raiz agregados por processo/equipe. Não criar ranking individual. Atraso jurídico, comercial ou externo deve permanecer causa/dependência contextual.

## 16. Comercial, financeiro e jurídico

### 16.1 Comercial após 9E

- preço/m² e ticket;
- velocidade/VSO e absorção;
- desconto e tabela vigente;
- estoque, distrato e inadimplência;
- previsto versus vendido/recebido.

Dados de comprador são pseudonimizados ou removidos quando não necessários.

### 16.2 Financeiro

- margem, ROI, TIR e VPL com versões da métrica;
- exposição máxima e capital necessário;
- curva prevista versus caixa real;
- forecast por data de corte versus resultado final.

### 16.3 Jurídico

- tempo de diligência/licenciamento e por órgão;
- tipo/severidade de finding;
- condicionantes, bloqueios e atraso associado.

Benchmark descreve ciclos e evidência; não decide risco jurídico ou culpa.

## 17. Benchmark de fornecedor

Dimensões balanceadas:

- preço ajustado e comparável;
- prazo prometido/real;
- entrega e qualidade;
- retrabalho/divergências;
- performance contratual;
- saving validado;
- volume, região, escopo e amostra.

Não criar score opaco. Mostrar componentes, pesos/política, N, dispersão e confidence. Fornecedor barato que atrasa e gera retrabalho não pode liderar por preço isolado.

## 18. Comparabilidade e similaridade

### 18.1 Eligibility gate

Antes de calcular benchmark, validar compatibilidade mínima de moeda/data-base, unidade, escopo, estágio, região, padrão, produto, método construtivo e escala. Itens incompatíveis são excluídos com motivo visível.

### 18.2 Similaridade

Motor futuro com critérios transparentes e pesos versionados:

- região/clima/logística;
- produto/padrão;
- área/unidades/torres;
- vertical/horizontal;
- método e estágio;
- tipologias e mix;
- período econômico.

Resultado mostra contribuição por critério e distância, não apenas “parecido”. Especialista pode ajustar filtros sem alterar o modelo oficial.

## 19. Confidence e outliers

### 19.1 Confidence de benchmark

Componentes:

- tamanho efetivo da amostra;
- idade/freshness;
- qualidade/proveniência;
- dispersão e cobertura;
- similaridade contextual;
- completude e reconciliação;
- dependência entre observações.

Política versionada produz score decomposto/faixa. Uma compra extremamente barata não vira referência alta por si só.

### 19.2 Outliers

Detecção robusta por IQR/MAD ou método adequado à distribuição; thresholds versionados. Outlier é sinal, não exclusão automática. Concreto 30% acima pode refletir erro, especificação, região, urgência, logística ou baixa quantidade. Registrar investigação e decisão de incluir/excluir.

## 20. Data Quality

Dimensões:

- completude;
- consistência;
- validade;
- unicidade;
- freshness;
- proveniência;
- reconciliação e cobertura.

`DataQualityRule`, `DataQualityRun` e `DataQualityIssue` conceituais registram dataset/contrato, regra/version, resultado, severidade, amostra afetada, owner e resolução. Quality gate pode bloquear benchmark/modelo oficial.

Qualidade é calculada por dataset e finalidade: dados suficientes para dashboard podem não ser suficientes para benchmark ou ML.

## 21. Lineage e catálogo

### 21.1 Lineage

```text
indicador/benchmark/recomendação
→ metric run e dataset version
→ fact/dimension
→ evento/registro operacional
→ documento/evidência
```

Registrar transformações, inputs, versões de código/configuração, data de corte e checksums. Lineage deve ser consultável e não depender apenas de logs efêmeros.

### 21.2 Data Catalog

`DatasetDefinition` conceitual:

- nome, descrição, owner/steward;
- domínio/origem e consumidores;
- schema/campos/classificação;
- grain/chaves;
- atualização/freshness;
- qualidade e lineage;
- PII/confidencialidade;
- retenção e política cross-tenant;
- versão/status/depreciação.

## 22. Portfólio

Hierarquia Grupo → Empresas → SPEs → Empreendimentos, com data de corte consistente.

Comparações:

- retorno, margem e capital;
- risco/REDE Score sem recalculá-lo;
- prazo e execução;
- comercial e estoque;
- jurídico/licenças;
- qualidade e confiança dos dados.

Consolidação financeira/contábil vem da 9G; portfólio não soma métricas semi-aditivas incorretamente.

## 23. Previsto versus realizado

Núcleo da 9I:

| Previsão congelada | Realizado equivalente |
|---|---|
| VGV/velocidade previstos | vendas aprovadas/resultado final 9E |
| custo previsto | custo final reconciliado segundo definição |
| prazo previsto | marcos realizados |
| margem prevista | margem contábil/gerencial final 9G |
| capital previsto | necessidade/caixa realizado 9B/9G |

Orçamento R$ 40 mi e realizado R$ 45 mi permanecem dois fatos. Erro absoluto: R$ 5 mi; erro percentual usa denominador e sinal definidos. Nunca reescrever orçamento para R$ 45 mi.

## 24. Forecast Accuracy

Avaliar forecasts por horizonte e estágio:

- MAE, MAPE/sMAPE quando denominador permitir;
- bias (otimismo/pessimismo);
- erro monetário e percentual;
- interval coverage quando houver intervalo;
- calibração de confidence;
- erro aos 10%, 20%, 50% e 80% da obra.

Cada avaliação referencia forecast original, data de corte, informação disponível então, métrica versionada e resultado final. Comparar apenas projetos elegíveis.

## 25. Learning Loop

```text
previsão versionada
→ decisão
→ execução
→ realizado reconciliado
→ avaliação de erro
→ atualização de benchmark/modelo
→ nova versão validada
```

Modelo novo não altera previsões antigas. Champion/challenger e backtesting serão futuros. Mudança de benchmark ou modelo exige validação, aprovação e documentação.

## 26. REDE Score

Resultados realizados podem calibrar futuramente gates, pesos e thresholds, mas a 9I não altera o Score. Dataset de calibração preserva versão do Score original, fatores disponíveis naquele momento e outcome definido. Evitar target leakage e validação no mesmo conjunto de treino.

## 27. Datasets para IA e estatística

`AnalyticalDatasetVersion` conceitual contém finalidade, população, corte, filtros, features/labels, schema, lineage, quality, PII treatment, checksum e aprovação.

Não enviar banco bruto ao LLM. Datasets usam minimização, agregação e pseudonimização. Modelos futuros para custo final, prazo, vendas, cash burn, inadimplência e risco terão versão, treino, avaliação, drift e owner.

Feature store fica posterior até existir modelo de produção com necessidade online/offline comprovada.

## 28. Privacidade, LGPD e multitenancy

### 28.1 Tenant privado

Dados e benchmarks internos permanecem isolados por `organizationId`, com scopes por grupo/empresa/projeto. Cache, materialized view, export e IA carregam tenant na chave/filtro.

### 28.2 Benchmark agregado SaaS

É produto e base de processamento separados. Só usar dados de tenants com base contratual/consentimento aplicável, finalidade definida, opt-in/opt-out, retenção e governança.

Proteções:

- desidentificação e pseudonimização na preparação;
- agregação com tamanho mínimo de coorte;
- supressão de células pequenas;
- filtros contra reidentificação por combinações raras;
- remoção de empresa, projeto, fornecedor e pessoa quando não autorizados;
- auditoria, revisão jurídica e DPIA/RIPD;
- impedir drill-down do benchmark SaaS para dado de outro tenant.

Anonimização verdadeira deve ser avaliada juridicamente; pseudonimizado ainda é dado pessoal quando reversível.

## 29. REDE IA e explainability

Perguntas futuras:

- custo médio de estrutura em projetos semelhantes;
- erro histórico dos orçamentos/forecasts;
- desempenho multidimensional de fornecedores;
- custo/m² de instalações;
- regiões com maior variação de concreto;
- projetos mais semelhantes;
- margem prevista versus realizada;
- itens com maior volatilidade.

Ferramentas somente leitura consultam Semantic Layer/benchmark engine. Resposta inclui população, projetos internos autorizados ou coorte agregada, período, normalização, métrica/version, amostra, dispersão, confidence, outliers e lineage.

LLM não recalcula benchmark, previsão ou orçamento.

## 30. REDE Autopilot e Auto Budget

### 30.1 Fluxo futuro

```text
projeto/revisão BIM
→ quantitativos mapeados
→ composições aplicáveis
→ histórico comparável
→ preços internos/externos normalizados
→ orçamento detalhado sugerido
→ confidence e exceções
→ especialista valida
→ responsável aprova
→ orçamento oficial versionado na 9A
→ realizado retroalimenta avaliação
```

Auto Budget nunca grava direto no orçamento aprovado. Saída é proposta com memória de cálculo, fontes e exceções.

### 30.2 START BUTANTÃ

Para aproximadamente 14.820 m², o sistema futuro deve explicar cada linha sugerida: quantitativo, composição, preço, região/data-base, projetos comparáveis, intervalo/confiança e itens ausentes. O valor de mercado citado para orçamento especializado é apenas referência estratégica, não métrica hardcoded.

### 30.3 Human in the loop

IA prepara; especialista valida; responsável aprova; REDE registra. Aprovação reutiliza governança existente. Alterações do especialista ficam auditáveis e viram feedback, não “verdade do modelo” automática.

## 31. Roadmap do Auto Budget

1. Histórico e benchmarks confiáveis.
2. Quantitativos BIM ligados a `EconomicItem`.
3. Composições proprietárias versionadas.
4. Price Intelligence normalizada.
5. Orçamento detalhado sugerido.
6. Confidence, intervalos e exceções.
7. Validação/aprovação humana.
8. Feedback do realizado e forecast accuracy.

Cada etapa possui quality gate; não avançar por volume sem qualidade.

## 32. Observabilidade

Monitorar:

- lag por contrato/dataset/projeção;
- eventos recebidos/processados/rejeitados/duplicados;
- duração/falha/retry/backfill;
- freshness e último checkpoint;
- quality scores/issues;
- cobertura de facts/dimensões;
- materialized view/cache version;
- lineage quebrado;
- benchmark sem amostra/confiança;
- custo de processamento/storage.

Alertas diferenciam pipeline parado, fonte stale e dado inválido.

## 33. Backfill, reprocessamento e retenção

Backfill lê fontes imutáveis/versionadas, usa contrato/métrica alvo e escreve nova versão de projeção. Checkpoints/idempotency impedem duplicação. Publicação acontece por troca atômica de versão/read model.

Retenção:

- fatos e snapshots oficiais conforme obrigação/governança;
- payload bruto por prazo curto e necessidade comprovada;
- agregados reconstruíveis podem expirar;
- datasets/model artifacts conforme finalidade;
- PII conforme LGPD/contrato.

Excluir cache/read model não exclui a fonte; apagar fonte autorizadamente deve propagar tombstone e reconstrução.

## 34. Particionamento, materialized views e cache

- índices por tenant, projeto, período, metric/fact e source ID;
- particionamento por tempo/fact somente após benchmark;
- tenant como partição física apenas se escala/isolamento justificar;
- materialized views para portfólio, séries e benchmarks pesados;
- refresh incremental quando possível e full reconciliatório;
- cache com tenant, métrica/version, filtros, corte e freshness;
- nenhuma resposta “atual” sem `asOf`.

## 35. Central REDE Data

Áreas futuras:

- Saúde dos Dados;
- Catálogo e contratos;
- Histórico e snapshots;
- Portfólio;
- Benchmarks de custo/prazo/comercial;
- Price Intelligence/Price Watch;
- Previsto x Realizado;
- Precisão de Forecast;
- Datasets e lineage;
- Qualidade, outliers e divergências.

Cards na Central Executiva:

- Precisão de Orçamento;
- Precisão de Forecast;
- Custo/m² do portfólio;
- Prazo médio;
- Margem prevista x realizada;
- Saving validado;
- Desvio médio;
- Volatilidade de preços;
- Performance de fornecedores;
- Data Quality.

Todos exibem corte, população, métrica/version e confidence, com drill-down autorizado.

## 36. Segurança e RBAC

Capabilities futuras:

- `DATA_CATALOG_VIEW/MANAGE`;
- `DATA_CONTRACT_MANAGE`;
- `DATA_QUALITY_VIEW/MANAGE`;
- `ANALYTICS_VIEW`;
- `BENCHMARK_INTERNAL_VIEW`;
- `BENCHMARK_AGGREGATED_VIEW`;
- `DATASET_BUILD/APPROVE/EXPORT`;
- `ANALYTICS_REPROCESS`;
- `METRIC_MANAGE/APPROVE`.

Reutilizar RBAC e aprovações, sem sistema paralelo. Quem define métrica não a publica sozinho; quem acessa benchmark interno não recebe acesso a PII; exportações e datasets IA exigem scope e auditoria.

## 37. Testes futuros

### 37.1 Temporalidade e snapshots

- estados as-known/as-approved/as-of;
- snapshot seletivo/checksum;
- forecast original preservado;
- backfill sem alteração da história;
- bitemporalidade quando aplicável.

### 37.2 Métricas e normalização

- metric version e agregação;
- unidade/moeda/inflação/data-base;
- razões e denominadores zero;
- memória de cálculo reproduzível;
- nominal sempre preservado.

### 37.3 Benchmark

- eligibility/comparabilidade;
- similaridade explicável;
- amostra/dispersão/confidence;
- outlier não excluído automaticamente;
- uma compra não vira benchmark;
- fornecedor multidimensional.

### 37.4 Governança

- lineage ponta a ponta;
- qualidade/freshness;
- isolamento tenant/cache/export/IA;
- coorte mínima e supressão;
- pseudonimização/retention;
- contratos e depreciação.

### 37.5 Casos críticos

1. R$ 2.340/m² em 2026 versus R$ 2.100/m² em 2023: normalizar antes.
2. Compra única barata: confidence baixo, não benchmark automático.
3. Internet R$ 500/m³ versus compra R$ 455/m³: fontes coexistem.
4. Orçamento R$ 40 mi versus final R$ 45 mi: erro de R$ 5 mi, histórico intacto.
5. Fornecedor barato com atraso/retrabalho: avaliação não só por preço.
6. Dois tenants: nenhum dado nominal/identificável cruza benchmark.

### 37.6 Performance

- milhões de facts/eventos;
- centenas de projetos/anos;
- séries de preços volumosas;
- rebuild/materialized views;
- consultas de portfólio e similaridade;
- export/dataset grande.

## 38. Sprints recomendadas

### 9I.0 — Data Contracts e métricas canônicas

- catálogo de fontes/grains/datas/owners;
- contratos 9A–9H e estados econômicos;
- Metric Registry e primeiras definições;
- política de privacidade/cross-tenant.

**Saída:** VGV, custo, margem, realizado e saving com uma definição versionada.

### 9I.1 — Fundação histórica e snapshots

- pipeline incremental/checkpoints;
- snapshots seletivos e source refs;
- temporalidade e backfill;
- quality/lineage básicos.

**Saída:** orçamento/forecast/realizado consultáveis por corte sem reescrita.

### 9I.2 — Read models analíticos

- dimensões conformadas e facts iniciais;
- normalização de unidade/moeda/índice;
- materialized views e observabilidade;
- Central de Saúde dos Dados.

**Saída:** previsto x realizado reconciliado para projeto piloto.

### 9I.3 — Benchmark Engine

- eligibility/contexto;
- similaridade, amostra, dispersão, confidence e outliers;
- custos, prazo e fornecedor;
- testes de explicabilidade.

**Saída:** benchmark reproduzível sem comparar projetos incompatíveis.

### 9I.4 — Price & Cost Intelligence

- PriceObservation e provenance 9H;
- séries, ajustes e Price Watch;
- quantitativos BIM ↔ `EconomicItem`;
- fundação de composições.

**Saída:** preço interno/externo contextualizado, sem sobrescrita.

### 9I.5 — Inteligência de Portfólio

- visão grupo/SPE/projeto;
- benchmarks comercial/financeiro/jurídico após contracts freeze;
- Central Executiva e drill-down.

**Saída:** portfólio com corte, confidence e lineage.

### 9I.6 — Forecast Accuracy e Learning Loop

- evaluations por horizonte/estágio;
- bias/erro/calibração;
- feedback e versionamento de modelos/benchmarks;
- dataset de calibração do Score, sem alterá-lo.

**Saída:** medir quanto e quando as previsões erram.

### 9I.7 — REDE IA e fundação do Autopilot

- datasets governados e ferramentas read-only;
- proposta Auto Budget com sources/confidence/exceptions;
- aprovação humana e auditoria;
- hardening, carga e rollout.

**Saída:** orçamento sugerido demonstrativo, nunca oficial automaticamente.

## 39. Riscos e mitigação

| Risco | Consequência | Mitigação |
|---|---|---|
| Segunda fonte de verdade | números divergentes | facts por contrato e lineage até OLTP |
| Snapshot indiscriminado | volume/custo | gatilhos por marco e referências |
| Fórmulas duplicadas | dashboards divergentes | Metric Registry/Semantic Layer |
| Comparação sem contexto | benchmark falso | eligibility e normalização |
| Nominal sobrescrito | perda histórica | nominal + normalizado + memória |
| Realizado ambíguo | erro de custo | estágio explicitamente declarado |
| Uma observação vira benchmark | falsa confiança | N/dispersão/confidence |
| Outlier removido | viés | investigar e registrar decisão |
| Score opaco de fornecedor | decisão injusta | componentes/pesos/amostra visíveis |
| Leakage de tenant | incidente grave | isolamento, coorte e testes |
| Reidentificação SaaS | risco contratual/LGPD | supressão, governança e DPIA |
| Warehouse prematuro | complexidade | PostgreSQL/read models primeiro |
| Backfill duplica facts | métricas infladas | idempotency e publicação por versão |
| IA calcula matemática | erro não reproduzível | engines determinísticos |
| Auto Budget vira oficial | risco operacional | proposta + especialista + aprovação |
| Qualidade baixa em volume alto | modelo ruim | quality gates antes de treino |

## 40. Itens posteriores

- machine learning de produção;
- orçamento autônomo completo;
- scraping indiscriminado;
- compra autônoma;
- modelos proprietários treinados;
- marketplace;
- venda de dados;
- compartilhamento cross-tenant sem governança;
- feature store prematura;
- lakehouse/warehouse complexo sem necessidade;
- alteração automática do REDE Score;
- recomendação automática sem validação humana.

## 41. Migrations e rollout futuros

Nenhuma migration foi criada neste planejamento. Implementação futura:

1. migrations aditivas por sprint;
2. contratos/métricas antes dos facts;
3. shadow build e reconciliação com fontes;
4. backfill idempotente sem reset;
5. feature flag por tenant/dataset;
6. publicação versionada de read models;
7. projeto piloto interno antes do agregado SaaS;
8. privacy review antes de qualquer coorte externa;
9. seed demonstrativo somente aditivo e rotulado;
10. rollback por versão, nunca apagando fatos originais.

## 42. Critério de conclusão

A Fase 9I estará pronta quando o REDE conseguir responder, com fonte, cálculo e confiança:

```text
o que aconteceu?
→ o que normalmente acontece em casos comparáveis?
→ o que deveria custar/durar?
→ quanto nossa previsão costuma errar?
→ que recomendação os dados sustentam?
```

Sempre preservando:

```text
dado → evidência → cálculo versionado → confiança
→ recomendação explicável → validação especializada → aprovação humana
```

O primeiro passo recomendado é a Sprint 9I.0: contratos de dados e métricas canônicas. Nenhum warehouse, benchmark ou modelo deve anteceder essa fundação.
