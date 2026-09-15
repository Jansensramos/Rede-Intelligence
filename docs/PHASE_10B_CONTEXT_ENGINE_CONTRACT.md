# Fase 10B — Context Engine — Diagnóstico e contrato

**Etapa:** implementação integral local sobre a base autorizada.
**Data:** 13/09/2026.
**Situação:** implementação local concluída e sujeita à auditoria independente; produção continua não autorizada.
**Base de implementação:** `54c9c905e08d505d1d994c929bee03c76d674018`.

## 1. Estado inicial e limites desta entrega

| Verificação | Resultado observado |
| --- | --- |
| Raiz real | C:\Users\Usuario\Documents\Codex\2026-09-03\rede-claude-9p3 |
| Branch | codex/fase-10b-context-engine |
| HEAD | 570aa5c8c9ddf2ef844684662e04b16dc2b8f16d |
| Worktree inicial | Limpo; nenhuma alteração rastreada ou arquivo não rastreado informado pelo Git |
| Upstream da branch atual | Não configurado |
| Origin | https://github.com/Jansensramos/Rede-Intelligence.git |
| Referência local da 10A | origin/codex/fase-10a-ai-gateway aponta para o mesmo HEAD; não foi realizado fetch |
| Publicação do commit-base | Confirmada pela execução remota de CI vinculada ao SHA exato |
| CI do commit-base | **Reprovado**, divergindo do estado esperado |

A execução [Validação contínua — 34768153027](https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34768153027), evento push da branch codex/fase-10a-ai-gateway, foi criada em 13/09/2026 às 16:17:55 UTC e terminou às 16:23:10 UTC com failure. O job validar, ID 103752749190, passou pelas etapas Prisma, migrations, seed, typecheck e ESLint; falhou no Vitest e não executou o build.

O log identifica 159 arquivos de teste aprovados e 1 reprovado; 1.912 testes aprovados e 1 reprovado. A falha é ENOENT ao escrever src/application/reporting/.reaudit-fixture-extension.js em src/application/ai-gateway/architecture.test.ts:474. O teste usa um diretório ausente no checkout do CI. A causa foi confrontada com o código; não foi corrigida nem reproduzida localmente nesta etapa.

Os documentos da 10A contêm aprovações históricas, mas isso não permite declarar verde este SHA. Este diagnóstico continua como entrega documental; o bloqueio deve ser resolvido e a base revalidada antes da implementação integrada da 10B. Não se presume upstream, merge na branch principal, implantação ou aprovação de produção.

A única alteração autorizada nesta etapa é este arquivo. Não foram executados testes locais, build, seed, migrations ou chamadas de providers. A consulta remota limitou-se à leitura dos metadados e logs de CI solicitada expressamente; não houve acesso a APIs de negócio, uso de credenciais reais de integração ou ativação de transporte de IA.

## 2. Base documental, método e força das evidências

Foram examinados os checkpoints, ROADMAP existente, contrato e registro de auditoria da 10A, a seção integral da Fase 10/Cognitive Layer da documentação mestre disponível localmente, o schema Prisma, inventários globais de modelos e serviços e os caminhos relevantes de seleção, autorização, persistência, auditoria e Gateway.

Referências principais, relativas à raiz do repositório:

| Referência | Uso e ressalva |
| --- | --- |
| docs/REDE_CAMPAIGN_CHECKPOINTS.md | Histórico de fases, decisões e correções; não substitui o estado do código ou do CI |
| docs/ROADMAP.md | Documento existente, com planejamento inicial; não constitui contrato atualizado da 10B |
| docs/PHASE_10A_AI_GATEWAY_CONTRACT.md | Obrigações e decisões da 10A; distinguir revisões históricas da regra final |
| docs/PHASE_10A_AUDIT_RECORD.md | Reauditorias e correções, especialmente seção 13; afirmações confrontadas com a implementação |
| work/master-report.txt, seções 47–49, a partir da linha 1041 | Extração local da documentação mestre: Cognitive Layer, sequência das fases e gates; arquivo de trabalho não rastreado, não criado nesta entrega |
| prisma/schema.prisma | Modelos, tipos, relações, campos opcionais e índices existentes |
| prisma/migrations | 39 diretórios de migrations existentes; leitura das proteções relevantes, sem executar SQL |
| src/application/ai e src/domain/ai | Contexto, recuperação, evidências, conversas e ferramentas legadas |
| src/domain/ai-gateway, src/application/ai-gateway e src/infrastructure/ai-gateway | Contratos, RBAC, segurança, envelope, transporte e ledger da 10A |
| src/application/auth, src/application/workspace, src/domain/auth e src/domain/workspace | Sessão, associação ativa, capabilities, projeto operacional e freshness |
| src/application/investment, studies, design, engineering, financial-ops, legal, sales, closure, market-product, data-intelligence, accounting e integrations | Fontes canônicas, serviços produtores, projeções, linhagens e efeitos colaterais |

As buscas abrangeram AssumptionSnapshot, DecisionLedgerEntry, RiskFinding, ForecastEvaluation, AIExecutionLog, AIPendingAction, documentos/evidências, snapshots, versões, capabilities, scoping, redaction, confidentiality, sourceType/sourceId/evidenceRefs, checksum, freshness e provenance. Foram examinados também modelos correlatos encontrados por relações, e não somente nomes coincidentes. ContextItem já aparece como componente visual em src/components/rede-ai-view.tsx; isso não é um contrato de contexto de domínio.

**Existente** significa observado no código/schema/migrations dessa base. **Proposto** significa obrigação futura ainda sem implementação. Proteções descritas em migrations são evidências do repositório, não atestado de que todo banco implantado possui os mesmos triggers. Esta etapa não é uma auditoria dinâmica completa dos domínios nem comprovação de segurança em produção.

## 3. Problema, objetivo e fronteira entre fases

A aplicação já reúne contexto e evidências para IA, mas não dispõe de uma fronteira única que comprove escopo, origem, validade, minimização, consistência e orçamento antes de entregar dados ao Gateway. A 10B deve localizar, selecionar, classificar, minimizar e empacotar evidências existentes, preservando incertezas e permitindo explicar por que cada item foi incluído ou excluído.

Princípios normativos: fail-closed; fonte canônica; isolamento de organização e projeto; menor privilégio; evidência antes de conclusão; ausência nunca vira zero; contexto não decide; contexto não executa ferramentas; provider não acessa banco.

| Fase | Responsabilidade e limite |
| --- | --- |
| 10A — AI Gateway | Roteamento, adapters, classificação de transporte, envelope, orçamento financeiro, ledger, timeout, rate limit, circuit breaker, validação de resposta e políticas de segurança. A 10B não cria outro Gateway |
| 10B — Context Engine | Comprovação e seleção de evidências; autorização cumulativa; projeção mínima; proveniência; conflitos; freshness; limites; entrega validada ao Gateway |
| 10C — Tool Layer | Execução de ferramentas fora do escopo. Readers fixos de persistência não são ferramentas disponíveis ao modelo |
| 10D — Agent Framework | Nenhum agente, planejamento autônomo ou ciclo de execução |
| 10E — Red Team 2.0 | Nenhuma nova análise adversarial automatizada de negócio; testes de segurança da própria 10B continuam necessários |
| 10F — Decision Engine | Nenhuma recomendação ou nova decisão |
| 10G — Investment Committee | Nenhum voto, parecer de comitê, aprovação ou simulação de governança |
| 10H — Operator | Nenhuma operação de negócio |
| 10I — Autopilot | Nenhuma autonomia ou execução contínua |

A documentação mestre também menciona 10J — Learning Loop. Ela permanece excluída, assim como embeddings remotos, banco vetorial, aprendizado, indexação automática, credenciais e APIs externas. O lema da documentação mestre continua aplicável: IA recomenda, engine calcula, humano aprova e sistema registra; nesta etapa, a 10B apenas prepara evidências, sem assumir qualquer uma das decisões.

## 4. Mapa de reaproveitamento e restrições reais

| Fonte existente | Identidade, escopo e proveniência disponíveis | Reaproveitamento e limite |
| --- | --- | --- |
| OrganizationMembership, Session, Project | Associação ativa, papel, organização; Project.organizationId | Resolver identidade e projeto no servidor. Não existe aqui autorização específica por usuário/projeto equivalente a uma tabela ProjectMembership |
| StudyVersion, AssumptionSnapshot, AssumptionEntry, Scenario, CalculationRun | Versão e estado do estudo, lockedAt, inputHash, engineVersion; relações até Study/Project/Organization | Premissas e cálculos persistidos. AssumptionSnapshot não tem versão independente; a versão pertence ao estudo. SNAPSHOT tem guards existentes; DRAFT não recebe a mesma garantia |
| FinancialResult, CalculatedMetric, Score, SensitivityAnalysis, RiskFinding | Linhagem ao run/estudo/cenário; datas; métricas opcionais | Copiar resultados persistidos, sem recalcular. RiskFinding.classification é string de domínio, não enum de privacidade. Risco isolado não prova imutabilidade: depende da linhagem e estado do estudo |
| InvestmentCase, InvestmentSnapshotBundle | case, versão, schemaVersion, studyVersionId, checksum, frozenAt | Bundle persistido com triggers de bloqueio de UPDATE/DELETE. Validar organização/projeto pelo caso e todas as referências internas; não usar o objeto enriquecido de workspace como se fosse o JSON congelado |
| AssumptionRegisterItem | case, key, value textual, confidence, status, evidenceRef, sourceVersion, effectiveAt, updatedAt | Registro de governança já existente. Não criar outro cadastro de assumptions. Texto e status não provam a premissa numérica nem o snapshot |
| DecisionLedgerEntry e decisões dos domínios | case, evidenceRefs, autor/data e decisão; versões em modelos específicos, como decisões jurídicas | Manter o ledger existente. DecisionLedgerEntry não possui versão/checksum próprios no schema; sua data de criação não prova imutabilidade. Exibir uma decisão registrada não significa reaprovar ou recomendar |
| ProjectDocument | case, versão, previousVersionId, checksum, status, confidentiality, effectiveDate, expiresAt | Metadados canônicos; o documento não vira válido apenas porque foi recebido. Dados binários e metadata.storage.key ficam fora do contexto |
| AIDocumentChunk | org, case, documentId, documentVersion, checksum, chunkIndex, untrusted | Índice derivado, sem FKs para documento/caso no modelo e com unicidade documentId+chunkIndex. Nunca fonte canônica independente nem autorização. Verificar documento pai, versão, validade e método do checksum |
| LegalEvidenceDocument | org/projeto/caso, vínculo XOR à solicitação ou checklist, checksum, revisão e revogação | Fonte jurídica canônica. VERIFIED admite revogação; leitura atual deve verificar estado. Não usar links ou arrays legados como evidência positiva. Não possui número de versão próprio |
| ContractDocument, SignatureReconciliationEvidence, DriveDocumentVersion | Versões de documento, evidência de assinatura, revisão externa e escopo por relações | Reutilizar a linhagem adequada. DriveDocumentVersion registra metadados de revisão; não comprova sozinho conteúdo remoto. Não baixar arquivos nem invocar conectores |
| DesignFile, BimQuantityMapping, EngineeringTechnicalOpinion e seus itens/evidências | Revisões, checksums, status, referência temporal, relações a pacote/projeto e evidências | Selecionar projeções aprovadas e comprovar a proteção aplicável. Fonte de engenharia não se torna orçamento aprovado por inferência |
| Budget, OperationalBaseline, projeções e ciclos de custo de engenharia | Versões, status e relações a estudo/baseline/projeto | Reusar resultados registrados, sem gerar orçamento, calcular ETC/EAC, atualizar composições ou somar subconjuntos como total |
| ReceivableAccount, PayableAccount, ForecastEvaluation, LedgerSnapshot | Org/projeto em contas/avaliações; forecastSourceType/id/version; actualValue opcional; checksum/data; snapshot contábil por company/period | Separar previsto/realizado. ForecastEvaluation é atualizado por upsert; checksum não o torna imutável. LedgerSnapshot não é intrinsecamente fonte de um único projeto |
| SalesUnit, SalesContract, SaleProposal e registros de vendas | Org/projeto direto ou por contrato/unidade, status e eventos | Somente campos autorizados e projeções sem comprador/contato. Não executar expiração de reservas nem formar receita a partir de uma lista paginada |
| ProjectClosureResult e ProjectClosureDistribution | Org/projeto, versão, supersedesId, estado, evidenceStatus, gateSnapshot, refs de forecast/premissas/decisões/riscos | Consumir resultados e gates já persistidos; FINAL/APPROVED possuem proteção em migrations. Arrays JSON de IDs exigem revalidação; não são FKs compostas |
| MarketPriceObservation, MarketInventorySnapshot, MarketArea, séries demográficas/de renda | Fonte, observedAt/data de referência, provenance/isDemo e escopos variáveis | Preservar origem, data, território e caráter demonstrativo. Registro regional ou da organização não é automaticamente do projeto |
| AnalyticsFact, MetricRun, AnalyticalDatasetVersion | sourceEntityType/id/version, inputRefs, checksum, lineage, sourceVersions, classificação/tratamento de PII | Reutilizar projeções existentes quando sua cobertura, autorização e atualidade forem provadas. Não criar dataset paralelo nem executar refreshAnalyticsFacts/evaluateForecasts |
| DataOwnershipPolicy, IntegrationConflict, ExternalEntityReference | Master system, fontes permitidas, consumidor, política/versão, vínculos e conflitos | Respeitar a política do domínio; não escolher autoridade por preferência do modelo nem importar/decriptar payload externo |
| EnterpriseSyncEvidence e FinancialProviderEvidence | Identidade, escopo, histórico protegido, caráter simulado e payload protegido | Metadados estritamente necessários; não decriptar, extrair credenciais ou promover demonstração a dado real |
| AIConversation, AIMessage, AIResponseEvidence | Conversa, autor, escopo, refs de evidência e seleção anterior | Continuidade da interação e citação. Campos escalares/JSON não substituem joins de autorização; mensagem ou resposta de IA não é fonte da verdade |
| AIExecutionLog, AIPendingAction, AIUsageBudget | Ledger, conversa obrigatória, metadados de versão, unicidade org+idempotencyKey para pending action e política de orçamento | Preservar o ledger da 10A. Não criar conversa sintética, segundo ledger ou pending action para montar contexto |
| AuditLog, logger, redaction jurídica, freshness | Auditoria geral, códigos seguros em serviço jurídico; distinção source_updated/queried_now/unavailable | Reusar persistência e padrões, criando payload allowlisted específico. O logger genérico não prova que storageKey/checksum/texto livre serão eliminados |

Proteções verificáveis: prisma/migrations/20260817141500_draft_snapshot_policies_alerts/migration.sql; 20260817230000_rede_studio_committee_master_report/migration.sql, a partir da linha 925; 20260827120000_phase_9m_engineering_auto_budget_proposal/migration.sql; 20260911220000_phase_9s_legal_evidence_document/migration.sql; 20260911235000_phase_9s_legal_evidence_idempotency/migration.sql; 20260911011100_phase_9s_closure_result_distribution/migration.sql. Não generalizar essas proteções a todas as tabelas.

## 5. Lacunas observadas e consequências para a 10B

| Achado estático | Evidência na base | Consequência normativa |
| --- | --- | --- |
| Contexto legado admite fallback e combinação de épocas | src/application/ai/context-builder.ts:26: conversa por org/autor, caso mais recente na ausência de seleção; histórico não encontrado pode recair no atual; contextSnapshot é convertido por cast e mesclado; design vem do estado recente | Validar seleção persistida, projeto e linhagem; histórico indisponível gera recusa explícita, sem troca silenciosa |
| Recuperação de chunks não comprova versão/validade canônica | src/application/ai/retrieval.ts:14; filtros de confidencialidade e corte textual não vinculam integralmente documentoVersion/checksum/status/expiração | Reader canônico antes do derivado; texto documental desabilitado no perfil inicial |
| Workspace enriquecido deixa de representar bytes congelados | src/application/investment/investment-service.ts, loadWorkspace:379 substitui documentos do bundle pelos atuais | Selecionar o registro congelado diretamente e validar seu checksum sobre os bytes/canonicalização correspondentes |
| Alguns getters não são leituras puras | getLegalWorkspace chama refreshLegalDeadlines; getMarketOverview cria políticas padrão; getSalesWorkspace libera reservas expiradas; getAIBootstrap pode criar conversa | Não usar esses getters na montagem; extrair/reaproveitar consultas mínimas no módulo proprietário, com cliente de transação recebido |
| Views podem reconstruir resultados ou converter ausência | study-service.ts:93 usa calculateAnalytics se resultados faltam; closure-service.ts gatherRealizedFacts calcula agregados; views de mercado/financeiro/engenharia contêm defaults e listas limitadas | Ler colunas/resultados persistidos; preservar null/unknown e cobertura. Não executar engines nem copiar defaults de UI |
| Escopo de workspace é mais amplo que um projeto | getFinancialWorkspace inclui contas bancárias por empresa e cadastros da organização; engenharia possui preços/composições gerais; mercado aceita área sem projectId | Sem associação explícita e política autorizadora, excluir. Jamais rebatizar dados de empresa/região como dados do projeto |
| Não existe o conjunto de sete contratos com validação de fronteira | Busca em src e schema; envelope atual do Gateway em src/domain/ai-gateway/types.ts | Criar contratos provider-neutral na implementação futura, com validação real e integração obrigatória |
| trustedContext aceita string | src/domain/ai-gateway/envelope.ts; src/application/ai/ai-service.ts:105 envia conteúdo composto previamente como trustedContext | Evidência será dado não confiável em estrutura própria; nenhum caminho alternativo por string livre |
| Limites não equivalem ao orçamento de contexto completo | envelope valida bytes de três strings; maxTotalItems não é contado; estimativa de tokens usa comprimento/4 | Contar o objeto minimizado serializado, itens e tokens; incluir overhead de Gateway e saída no limite final |
| Elegibilidade externa não está conectada só por existir um helper | isExternalTransportEligible aparece em safety.ts e seu teste, sem chamada produtiva encontrada | Não alegar bloqueio por classe apenas por esse helper. Integração deve aplicar política efetiva no caminho de execução |
| Possível dupla contabilização de consumo legado | ai-service.ts:157 e :169 copiam providerUsage ao log externo; o Gateway grava seu próprio log; agregações em :65 e ledger-service somam logs | Divergência com a alegação histórica de log externo sem custo. Bloqueio de integração a verificar/corrigir em escopo aprovado, sem alteração nesta etapa |
| Idempotência do Gateway não vincula o conteúdo selecionado | requestFingerprint em src/application/ai-gateway/ledger-service.ts usa metadados da requisição, não um ContextBundle/proveniência validada | Vincular propósito/política/versões no handoff futuro; preservar rejeição de replay ambíguo, sem segunda chamada ou reserva paralela |
| Gate da 10A proíbe context-engine no Gateway | architecture.test.ts:387 | Após aprovação, atualizar precisamente essa fronteira para permitir 10B e continuar proibindo 10C–10I; não desligar o scanner |
| CI da base está reprovado | Seção 1 | Bloqueia aceite integrado; resultado documental não transforma a base em verde |

Os achados são limites concretos de reutilização e divergências estáticas. Não constituem alegação de exploração em produção, custo efetivamente duplicado ou banco já corrompido.

## 6. Arquitetura proposta e fluxo

A arquitetura proposta tem contratos/regras puras de contexto no domínio, um coordenador de aplicação, readers estreitos nos módulos que já possuem as fontes, um serializador mínimo e a integração com o Gateway existente. Os readers recebem escopo e cliente transacional do servidor; não têm configuração de provider e não são invocáveis pelo modelo.

Fluxo obrigatório:

1. A entrada autenticada resolve sessão, organização, associação ativa, papel, projeto operacional e finalidade por rota/ação conhecida.
2. Verifica AI_READ, AI_USE e todas as capabilities dos domínios que a finalidade exige; revalida a conversa existente e sua ligação ao mesmo usuário/organização/projeto.
3. Carrega a versão de política do servidor. Não havendo política, reader ou finalidade reconhecida, recusa.
4. Abre leitura consistente e obtém somente campos autorizados das fontes e de suas dependências; verifica pais, versões, estados, classificações e conjuntos relevantes.
5. Constrói candidatos internos; classifica, compara fontes equivalentes, preserva conflitos, minimiza e aplica orçamento por grupos indivisíveis.
6. Produz ContextSelectionResult e o núcleo canônico do ContextBundle, com provas internas de origem e um manifesto de inclusão/exclusão.
7. Antes do consumo, revalida autorização, política, fontes e conjunto relevante em nova fronteira transacional curta; audita o resultado permitido com payload seguro. Mudança invalida o bundle.
8. O Gateway recebe exclusivamente o bundle validado e uma projeção apropriada da pergunta/instruções. Revalida os seus próprios gates e limites antes de reservar/enviar.
9. O adapter recebe somente a representação mínima renderizada pelo Gateway, sem handle de banco, reader, storage, caminho de arquivo ou função de busca.

O Context Engine não escreve em tabelas de negócio. A escrita de AuditLog é a exceção operacional explícita; reservas e execução continuam exclusivamente no ledger da 10A. Manutenção de sessão pertence à autenticação já existente, não a um reader de contexto.

Reutilizar consultas e regras dos módulos proprietários não significa reaproveitar getters com efeitos colaterais ou exportar entidades Prisma completas. Não será introduzido cadastro paralelo de premissas, decisões, riscos, fatos financeiros ou documentos.

## 7. Contratos provider-neutral propostos

Os nomes abaixo são contratos lógicos, não tipos implementados nesta etapa. Não carregam classes Prisma, SDK, modelo, endpoint, chave ou função executável. Todo dado recebido de JSON exige validação de forma, limites, enums e relações; um cast ou campo validated=true não é prova.

### 7.1 ContextRequest

Campos obrigatórios internos: requestId e correlationId gerados pelo servidor; schemaVersion; identityScope com organizationId, projectId e userId; contexto de autorização resolvido; conversationId já autorizado; purpose; policyVersion; selectionMode; referências de seleção derivadas no servidor; instante de avaliação do relógio do servidor.

selectionMode distingue CURRENT de HISTORICAL_PINNED. No segundo, os IDs e versões vêm da seleção existente validada e não de fontes livres do cliente. A pergunta é entrada não confiável, limitada, externa às instruções e sem poder de alterar fontes, finalidade, política ou orçamento. Na primeira entrega, não determina SQL nem descoberta de fontes.

Não aceitar provider, modelo, role, capability, organizationId, projectId, sourceIds, SQL, campos de seleção, joins, contexto pronto, policyVersion ou limites vindos do corpo do cliente. Parâmetros de rota/cookie são seletores não confiáveis até serem resolvidos pelo servidor.

### 7.2 ContextSource

Identifica uma fonte ou dependência canônica com:

| Campo lógico | Regra |
| --- | --- |
| sourceType, sourceId | Tipo em registro fechado e ID canônico; internos, nunca obtidos por interpretação de texto |
| organizationId, projectId | Comprovados diretamente ou pela cadeia de relações; presentes em toda fonte admitida neste perfil |
| scopeProof | Caminho de relações verificado, incluindo case/study/run/document pai quando aplicável |
| sourceVersion | Discriminante NATIVE_VERSION, PARENT_SNAPSHOT_VERSION ou OBSERVED_MUTABLE_REVISION; não inventar versão 1 |
| sourceTimestamp, timestampKind | Instante canônico e semântica: calculatedAt, observedAt, frozenAt, updatedAt etc.; não substituir por queriedAt |
| observedAt | Momento da observação pelo servidor, separado do instante da fonte |
| integrity | Checksum e algoritmo/esquema conhecidos internamente, ou referência segura mais revisão observada; UNKNOWN quando não houver prova |
| mutability | IMMUTABLE_PROVEN ou MUTABLE_OBSERVED; somente classificar como imutável com proteção e linhagem comprovadas |
| lifecycle | Estado original e mapeamento fechado de validade, expiração, revogação e substituição |
| classification | Classe de privacidade efetiva e classes de domínio; classificação nunca deduzida apenas de severity/confidence |
| freshness | Estado, origem temporal, idade/validUntil quando calculáveis e versão da política |
| dependencies | Referências internas às fontes necessárias, com versões próprias, sem referências não verificadas |
| decisionReasonCode | Motivo estático de inclusão ou exclusão; nunca texto da fonte |

OBSERVED_MUTABLE_REVISION inclui marcador temporal existente e fingerprint interno da projeção lida/dependências. Não é versão durável, prova de histórico ou garantia de que uma linha não mudará. Se nem uma observação consistente/integridade mínima puder ser estabelecida, excluir ou recusar conforme obrigatoriedade.

Dados recusados por escopo nunca são materializados como ContextSource pública. Tentativa de referência inválida gera código genérico, sem revelar o tenant, projeto, existência ou conteúdo alheio.

### 7.3 ContextItem

Campos: itemKey estável; sourceRefs internas autorizadas; evidenceRole; domínio e fieldKey allowlisted; payload de projeção mínima tipado; classificação; freshness; razão de inclusão; priority; dependencyGroup; cobertura; untrusted=true.

Valores usam união explícita KNOWN(value, unit, sourceRef) ou UNKNOWN(reasonCode). Distinguir NOT_APPLICABLE quando isso é fato explícito da fonte, sem convertê-lo em zero. Valores monetários/decimais mantêm precisão e unidade; datas UTC e datas civis mantêm semânticas distintas. Booleano só existe como valor explicitamente persistido e autorizado, nunca por coerção de presença/ausência.

evidenceRole distingue fato registrado, premissa registrada, resultado calculado persistido, decisão humana registrada, índice derivado e alerta de qualidade. O Context Engine não muda a natureza de um item ao selecioná-lo.

### 7.4 ContextPolicy

Política imutável por versão no código/configuração aprovada do servidor; não exige tabela própria. Contém finalidades, capabilities cumulativas, sourceTypes/readers e projeções permitidas, estados aceitos, mapeamento de classificação, fontes/dependências obrigatórias, precedência por fato, definição de conflito, temporalidade, orçamento, prioridade, possibilidades de omissão e códigos de decisão.

Inclui schemaVersion, policyVersion, reader/projectionVersion, minimizationVersion, selectionVersion e tokenizerEstimateVersion. Versão desconhecida ou política incompleta recusa. Alterações de política não passam por prompt, provider ou preferência de usuário.

### 7.5 ContextSelectionResult

União discriminada:

- READY: bundle completo e utilizável dentro do propósito.
- READY_WITH_GAPS: somente quando a política permite lacunas opcionais nomeadas, com avisos inseparáveis; não significa aprovação ou completude financeira/jurídica.
- REFUSED: nenhum bundle consumível e um ContextEngineError seguro.

Inclui internamente selected, excluded, grupos conflitantes, códigos de motivos, cobertura, medições de orçamento e versões. Uma exceção de leitura não pode virar selected vazio com READY. Motivos de exclusão não autorizam divulgar fontes que o usuário não pode conhecer.

### 7.6 ContextBundle

Contém núcleo canônico e metadados de execução separados. Núcleo: schemaVersion, propósito, referências opacas de organização/projeto, vínculo seguro de ator/conversa, versão e restrições da política, `preparedAt` e `validUntil` canônicos, manifesto de fontes/dependências e suas versões, itens, classificações, limites, conflitos/lacunas obrigatórios e medições de orçamento. Metadados que não alteram a seleção ficam fora desse núcleo, como a referência da auditoria. `requestId`/idempotency e `correlationId` participam do vínculo de consumo, mesmo quando não são enviados ao provider.

Mantém fingerprint integral somente na validação interna; não o escreve em AuditLog nem o entrega como checksum de documento ao provider. Fonte com checksum ausente não recebe um checksum canônico fictício porque o bundle possui fingerprint próprio.

A representação para transporte é uma projeção do bundle: citações opacas e locais, como E1/E2; dados mínimos; versão/data e qualidade quando necessárias ao sentido. Não transporta userId, IDs de tenant/projeto, checksum integral, scopeProof ou manifestos recusados. O Gateway recebe o objeto interno validado; o provider recebe apenas a projeção.

A validação de origem requer criação por coordenador confiável, validação runtime, vínculo à requisição/autorização e verificação contra mutação. Uma marca de tipo TypeScript, JSON assinado pelo cliente ou mera propriedade booleana não substitui esses controles. Não reidratar bundles arbitrários do cliente ou de filas como previamente autorizados.

### 7.7 ContextEngineError

Campos públicos: código fechado, mensagem estática, correlationId do servidor e retryable definido por política. Sem stack, cause, consulta SQL, IDs não autorizados, texto de origem, checksum, storageKey ou payload.

Códigos propostos: CONTEXT_ACCESS_DENIED, CONTEXT_PURPOSE_UNSUPPORTED, CONTEXT_POLICY_UNAVAILABLE, CONTEXT_SOURCE_MISSING, CONTEXT_SOURCE_INVALID, CONTEXT_SOURCE_STALE, CONTEXT_SOURCE_REVOKED, CONTEXT_SOURCE_CONFLICT, CONTEXT_HISTORY_UNAVAILABLE, CONTEXT_INTEGRITY_FAILED, CONTEXT_CLASSIFICATION_DENIED, CONTEXT_BUDGET_EXCEEDED, CONTEXT_MEANING_UNSAFE, CONTEXT_CONCURRENT_CHANGE, CONTEXT_AUDIT_UNAVAILABLE e CONTEXT_DEPENDENCY_UNAVAILABLE.

Códigos mais específicos só são expostos após comprovação do escopo. Para referência desconhecida, de outro tenant ou outro projeto, a resposta externa é indistinguível: CONTEXT_ACCESS_DENIED. Falhas de autorização, privacidade, integridade e política não são repetidas automaticamente.

## 8. Solicitação e isolamento de organização/projeto

A entrada pública inicial pode identificar a conversa existente e uma ação conhecida da interface. O servidor determina purpose e política; rejeita chaves extras capazes de selecionar fontes. O ID da conversa também é não confiável e deve satisfazer organização, autor e projeto resolvidos.

Reaproveitar src/application/workspace/operational-context.ts: projeto explícito inválido não permite fallback; a ausência de seletor usa apenas a resolução operacional existente, e o Context Engine exige um projeto efetivamente resolvido. Nunca usar getLatestInvestmentCaseForOrganization como alternativa a projeto/caso ausente ou inválido.

Toda referência persistida em AIConversation.contextSnapshot, evidenceRefs, conteúdo de snapshot ou arrays JSON de fechamento é uma alegação que precisa de validação. Para cada filho, verificar pai, organização, projeto, versão e eventual cenário, inclusive quando o filho não tem organizationId próprio. Um sourceId válido no tenant correto, mas de outro projeto, deve ser recusado.

CURRENT e HISTORICAL_PINNED não podem misturar silenciosamente versões de estudo, run, premissas e cenários. Alterar o projeto operacional ou a conversa invalida qualquer bundle preparado. Conversa com projectId nulo não ganha projeto por inferência durante a leitura.

Fontes de organização, empresa ou região com projeto nulo ficam excluídas do perfil inicial. Seu uso futuro dentro da 10B exige vínculo explícito do domínio e autorização específica de política, mantendo visível o escopo real; não basta copiar o projectId da requisição.

## 9. Finalidades e RBAC cumulativo

Proposta de primeira fatia implementável:

| Finalidade interna | Fontes mínimas | Capabilities adicionais |
| --- | --- | --- |
| STUDY_EVIDENCE | StudyVersion SNAPSHOT, premissas, run/cenário e resultados persistidos coerentes; riscos persistidos da mesma linhagem quando requeridos | VIABILITY_READ |
| CLOSURE_EVIDENCE | ProjectClosureResult FINAL, evidenceStatus/gateSnapshot e referências necessárias de previsão/realização, premissas e suporte jurídico verificável | CLOSURE_READ e todas as capabilities dos domínios efetivamente necessários, como FINANCIAL_READ, LEGAL_READ e VIABILITY_READ |

Os identificadores de capability devem ser confirmados pelo enum/matriz existente ao implementar, sem criar equivalentes mais permissivos. Domínio adicional exige sua capability; uma finalidade composta não pode se apoiar em apenas uma checagem. Fontes opcionais sem autorização são excluídas sem revelar sua existência; falta de capability de domínio obrigatório recusa a finalidade.

Aplicar o modelo existente de src/application/ai-gateway/rbac.ts: AI_READ + AI_USE + capability do domínio. OWNER, ADMIN, ANALYST e REVIEWER têm AI_USE; VIEWER não tem AI_READ/AI_USE e não pode consumir contexto para IA. AI_AUDIT_READ permanece restrito a OWNER/ADMIN/REVIEWER; AI_ADMIN e AI_BUDGET_MANAGE continuam OWNER; AI_BUDGET_READ permanece OWNER/ADMIN.

Audience, role e configuração de interface não podem ampliar acesso. Finalidade não conhecida é negada. Leitura para IA não autoriza edição de fonte, aprovação, exportação de documento ou administração de política. Não ampliar RBAC de negócio para acomodar a 10B.

## 10. Hierarquia, autoridade e conflitos

A hierarquia só vale entre fontes autorizadas que descrevam o mesmo fato, unidade, entidade, período, cenário e base de cálculo:

1. Registro canônico do domínio com estado válido e vínculo explícito ao fato.
2. Snapshot aprovado/congelado e protegido, para a versão/período que representa.
3. Resultado determinístico persistido com entradas e versão do engine comprovadas.
4. Registro operacional mutável observado consistentemente, apenas em finalidade que aceite essa limitação.
5. Projeção analítica ou índice derivado com linhagem integralmente verificável.
6. Documento, anotação ou texto livre como evidência não confiável, sem poder instrucional; inicialmente sem extração textual.

Essa ordem não transforma realizado em previsão nem usa snapshot antigo como estado atual. A autoridade específica do domínio e DataOwnershipPolicy prevalecem sobre uma ordenação genérica, dentro das restrições globais de segurança. AssumptionSnapshot documenta uma premissa daquela versão; não comprova realização.

Dois valores incompatíveis do mesmo fato formam grupo de conflito. Não calcular média, escolher o mais recente por conveniência, usar confiança do modelo ou descartar a fonte discordante para caber no orçamento. Conflito obrigatório não resolvido recusa; conflito opcional somente pode ser transportado como grupo completo sinalizado quando a política admitir.

Substituição explícita e válida pode resolver a seleção da versão vigente; isso não apaga a referência histórica. Desempate por ID só estabiliza ordenação de itens equivalentes, nunca resolve divergência de conteúdo. Comparabilidade insuficiente gera incompletude, não falsa contradição ou conciliação.

## 11. Ausência, validade e estados problemáticos

| Situação | Tratamento obrigatório |
| --- | --- |
| Dado ausente/null | UNKNOWN com código e cobertura; se obrigatório, REFUSED |
| Coleção vazia ou paginação incompleta | Declarar ausência de evidência/cobertura parcial; nunca assumir ausência de risco, dívida ou obrigação |
| Dado vencido | SOURCE_STALE/EXPIRED; excluir do uso atual; histórico apenas se o propósito permitir e sem aparência de atual |
| Fonte revogada/retraída/rejeitada | Não pode sustentar afirmação positiva atual. Recusar se obrigatória; sinalização histórica mínima somente após autorização |
| Fonte conflitante | Preservar grupo e aviso ou recusar; nunca escolher silenciosamente |
| Registro mutável | Observação consistente e revalidação obrigatória; não prometer reconstrução histórica |
| Evidência incompleta | Proibir inferir campos ausentes, percentuais, total ou aprovação; política decide recusa ou lacuna opcional |
| Versão superseded | Excluir de CURRENT; permitir em histórico fixado com aviso inseparável e checagem de revogação atual |
| Histórico solicitado inexistente | CONTEXT_HISTORY_UNAVAILABLE; nenhuma troca pelo registro mais recente |
| Cross-tenant/cross-project | Recusa genérica antes de conteúdo, auditoria apenas de escopo legítimo |
| Checksum divergente/linhagem quebrada | CONTEXT_INTEGRITY_FAILED; sem fallback para view ou texto semelhante |
| Fonte de demonstração/simulação | Excluída do perfil factual inicial; nunca promovida a fato real |

**Proibição absoluta:** ausência não vira zero, false, aprovação, “sem riscos”, “sem pendências”, “documentação válida” ou total calculado. São proibidos defaults como valor ?? 0, Boolean(valorAusente), soma de lista parcial como total e approved por inexistência de registro de recusa. Zero ou false somente entram quando explicitamente fornecidos por fonte válida com semântica/cobertura comprovadas. O engine de contexto não executa nem reconstrói cálculo de negócio para preencher falta.

## 12. Minimização e classificação

A projeção é allowlist de campos por fonte e propósito, aplicada na própria consulta quando possível. Não selecionar entidade completa para depois confiar em redaction genérica. Metadados, títulos, nomes de arquivo, URLs, labels, unidades e campos aparentemente inofensivos também são entradas não confiáveis.

Excluir: PII de compradores, contatos, responsáveis e usuários; CPF/CNPJ, e-mail e telefone; conta/agência/chaves bancárias; credenciais, cookies, tokens, connection strings; storageKey inclusive aninhada em metadata; URLs assinadas ou de download; binários, documentos integrais, conteúdo criptografado, razões jurídicas, notas e outros textos livres sensíveis. Não decriptar nem buscar storage durante montagem.

Classes de transporte existentes em src/domain/ai-gateway/types.ts: PUBLIC, INTERNAL, CONFIDENTIAL, PERSONAL, SENSITIVE_PERSONAL, LEGAL, FINANCIAL e SECRET. Não substituir esses nomes por enums históricos divergentes. LEGAL e FINANCIAL são dimensões de sensibilidade, não posições triviais numa escala numérica.

Mapeamento mínimo proposto:

| Origem | Tratamento inicial |
| --- | --- |
| PUBLIC_INTERNAL de ProjectDocument | No mínimo INTERNAL; não significa público na internet |
| CONFIDENTIAL | CONFIDENTIAL ou restrição adicional do domínio |
| STRICTLY_CONFIDENTIAL | Bloqueada no perfil inicial; não rebaixar automaticamente |
| Dados financeiros/jurídicos autorizados | Preservar FINANCIAL/LEGAL e demais restrições; metadados não dispensam classificação |
| PII ou SECRET | Excluir; se indispensável, recusar. Não autorizar por papel elevado |
| Classe desconhecida ou mistura sem mapeamento aprovado | Recusar; não usar INTERNAL como default |

A classificação da projeção deve manter a restrição da origem, salvo política explícita de desclassificação aprovada e verificável, ausente no perfil inicial. O bundle retém o conjunto de restrições; enquanto o Gateway aceitar uma única classe, mistura sem tradução conservadora definida recusa. A minimização não autoriza transporte externo por si só.

O perfil inicial permite apenas projeções estruturadas e metadados mínimos. AIDocumentChunk e textos livres permanecem desabilitados. Futura habilitação textual dentro da 10B exige vínculo canônico/versionado, extração segura e minimização testada, limites e aprovação da política; não requer habilitar 10C ou baixar arquivos externos.

## 13. Orçamento, prioridade e truncamento

Os números abaixo são proposta conservadora para aprovação, não configuração existente nem garantia de capacidade de provider:

| Limite inicial | Valor proposto |
| --- | --- |
| Itens totais serializados, incluindo avisos e lacunas | 40 |
| Tamanho do contexto minimizado em UTF-8 | 48.000 bytes |
| Caracteres Unicode, contados por pontos de código | 24.000 |
| Tokens estimados de contexto | 16.000 |
| Estimativa neutra inicial | 1 unidade estimada por byte UTF-8 do payload serializado, identificada como BYTE_UPPER_ESTIMATE_V1 |
| Candidatos lidos por pedido | 400, incluindo dependências; exceder cobertura necessária recusa, sem amostragem silenciosa |
| Tentativas de leitura/revalidação por mudança concorrente | Até 2 reconstruções, sem provider; depois recusa |

A estimativa em bytes é deliberadamente conservadora e normalmente será o limite efetivo mais restritivo. Não equivale à contagem real de todos os tokenizers. O Gateway deve ainda confirmar compatibilidade do perfil do modelo e espaço para instruções, pergunta, estrutura e resposta máxima; perfil sem margem verificável recusa. Não usar a antiga aproximação por comprimento/4 como prova suficiente.

Contar após canonicalização e escaping, incluindo nomes de campos, citações, provenance mínima, unidades, delimitadores e avisos. Recontar no render final do Gateway. Não confundir orçamento de contexto com orçamento financeiro, rate limit ou janela do modelo.

Prioridade: P0 escopo/qualidade indispensável e dependências; P1 evidências obrigatórias; P2 evidências opcionais diretamente pertinentes; P3 complementos. Grupos de dependências/conflito são indivisíveis. Aplicar ordem estável de política, identidade semântica e ID canônico; não depender da ordem retornada pelo banco.

Truncamento seguro significa remover item/grupo opcional completo ou campo opcional aprovado pela projeção, registrando código e cobertura. Não cortar número, sinal, unidade, negação, data, referência, condição, status, razão de invalidade ou cadeia de evidência. Não usar slice em texto arbitrário nem resumo por IA para “caber”. Se o núcleo obrigatório ou o significado não couber, CONTEXT_BUDGET_EXCEEDED ou CONTEXT_MEANING_UNSAFE, sem chamada de provider.

## 14. Determinismo e idempotência

A identidade lógica da seleção é função do escopo autorizado, propósito, modo/versão fixada, versões de política/reader/projeção/minimização, conjunto canônico de fontes/dependências e seus estados/revisões. A pergunta não escolhe IDs; se uma futura seleção lexical for aprovada, o termo normalizado e a versão dessa regra passam a integrar a identidade.

Canonicalização deve especificar ordenação de objetos/arrays, representação decimal exata, unidades, datas, estados ausentes e UTF-8. Não normalizar destrutivamente texto ou recalcular checksum do documento com outro algoritmo. Reutilizar os padrões de stableJson/checksum existentes após verificar compatibilidade, sem assumir que todos os domínios usam o mesmo esquema.

Para a mesma identidade, instante canônico de preparo e janela de admissibilidade temporal, o núcleo, itens, motivos e ordem devem ser idênticos. `preparedAt` e `validUntil` integram o fingerprint; alterar qualquer um deles muda a identidade do bundle e não permite reutilizar o fingerprint anterior. A referência de auditoria fica fora dessa comparação. Quando o relógio ultrapassar a validade ou a autorização mudar, a admissibilidade muda mesmo sem nova versão da fonte; determinismo não autoriza replay vencido.

Idempotência de contexto significa não criar/alterar fatos de negócio e obter a mesma seleção semântica para a mesma entrada válida. Não significa uma única linha de AuditLog: o modelo geral não tem unicidade específica de requestId, e cada tentativa auditável pode gerar evento. Não usar AIPendingAction como cache de contexto.

A idempotência de execução permanece na 10A. A integração deverá vincular propósito/política e referências/revisões seguras à identidade da tentativa, sem guardar conteúdo, checksum integral de fonte ou fingerprint de texto em logs. Mesmo idempotencyKey com contexto incompatível deve recusar; replay ambíguo/terminal não provoca nova chamada, novo contexto servido como resposta anterior ou liberação de reserva potencialmente cobrável.

Não se promete reconstrução durável de valores mutáveis antigos. Sem prova persistida suficiente, retry que dependa dessa reconstrução é recusado; uma nova solicitação explícita representa uma nova observação.

## 15. Freshness e invalidação

Freshness possui duas dimensões distintas: idade do fato de negócio e validade da autorização/seleção observada. queriedAt não renova observedAt, calculatedAt ou frozenAt. Reutilizar a distinção source_updated/queried_now/unavailable de src/domain/workspace/freshness.ts, sem converter queried_now em fonte atualizada.

Proposta inicial: bundle não reutilizável entre requisições; validade máxima de preparação de 60 segundos, limitada pela menor expiração conhecida; revalidação obrigatória imediatamente antes do consumo. Não introduzir cache global nem job de refresh.

Para HISTORICAL_PINNED, a data antiga é parte do fato; não o chamar de atual. Para CURRENT, política por fonte deve definir qual data governa, TTL de negócio, estados aceitos e expiração explícita. A ausência de TTL/mapeamento temporal aprovado bloqueia reader mutável; não escolher um TTL universal por conveniência. As primeiras finalidades priorizam snapshots e resultados finais, com linhagem e estado atual revalidados.

Invalidam: alteração/revogação de associação, papel, capability, projeto/conversa, política, classificação, fonte, dependência, checksum ou versão; substituição ou surgimento de fonte conflitante relevante; passagem de expiresAt/validUntil; quebra de relação; perda de cobertura; falha de leitura/auditoria; mudança do schema de projeção. Usar a validade mais restritiva das dependências, não a data mais recente do conjunto.

Dado vencido opcional pode ser excluído com lacuna se permitido; evidência obrigatória vencida recusa. Não executar atualização de domínio para sanar freshness.

## 16. AuditLog seguro e observabilidade

Persistir eventos no AuditLog existente. organizationId, userId e projectId vêm do servidor nos campos próprios; action/entityType são constantes; entityId é referência operacional segura, sem valor de negócio. O escopo do leitor de auditoria também deve ser verificado, além de AI_AUDIT_READ.

Payload fechado proposto: versão do contrato/política/projeção, purpose, outcome, correlationId, requestRef, contagens limitadas, métricas de orçamento não sensíveis, referências opacas a fontes já autorizadas e reasonCodes estáticos. before/after não recebem snapshots ou entidades; usar metadata apenas com chaves allowlisted. Eventos: CONTEXT_PREPARED, CONTEXT_REFUSED, CONTEXT_INVALIDATED e CONTEXT_CONSUMED, com semânticas documentadas; nenhum significa que o provider respondeu.

Proibir em todos os caminhos de log, erro e tracing: conteúdo bruto; pergunta/resposta; ContextBundle inteiro; storageKey em qualquer forma; checksum integral; binário; nomes de arquivo; PII; texto livre; labels recuperados; mensagens de exceção/cause de banco/provider/documento; SQL com parâmetros. Não gerar hash, prefixo ou referência a partir de texto livre previsível para fingir anonimização.

Reaproveitar a disciplina de allowlist e códigos de src/application/legal/legal-evidence-service.ts. A referência curta existente de checksum jurídico não é garantia universal de anonimização nem deve ser aplicada a motivos textuais. Para a 10B, preferir referências opacas e IDs canônicos autorizados sem semântica sensível; não registrar checksum de fonte ou fingerprint de payload.

sanitizeLogValue é defesa adicional, não filtro primário: suas regex não constituem allowlist completa para o contexto. Referência opaca permite correlação autorizada; não permite reconstituir documento ou texto suprimido.

Se a persistência de auditoria exigida falhar, não entregar bundle consumível nem iniciar provider; retornar CONTEXT_AUDIT_UNAVAILABLE e observabilidade apenas com constantes seguras. Uma tentativa negada pode gerar registro de segurança do usuário/tenant legítimo, sem IDs ou contagens de outro escopo. Não prometer auditoria exatamente uma vez sem constraint existente.

## 17. Integração obrigatória com o Gateway

A interface produtiva futura deve exigir ContextBundle validado no caminho de dados recuperados. Não basta acrescentar um campo opcional mantendo trustedContext livre como bypass. O Gateway valida vínculo com requisição/conversa, propósito, validade, classificação, integridade da projeção e orçamento, além dos seus controles atuais.

O contentEnvelope precisa separar instruções de sistema controladas pela aplicação, evidências minimizadas e pergunta do usuário. O serializador do Gateway constrói as mensagens a partir dessas estruturas. O adapter não recebe função de busca, Prisma, StorageProvider, caminho, URI assinada ou acesso a documentos.

Não colocar resultados de composeGroundedAnswer ou conteúdo de retrieval diretamente em trustedContext sob a aparência de evidência validada. O fluxo legado de planejamento/ferramentas não será o produtor do bundle. A integração deve provar que a montagem de contexto não chama tool-registry, motor de cálculo, provider ou serviços que escrevem no negócio; isso não autoriza construir a futura Tool Layer.

Preservar as garantias finais da 10A: ledger único; budget pré-transporte; identidade canônica de provider/model; retenção e política de transporte; transições transacionais; uma invocação de adapter por reserva; nenhuma liberação automática de RUNNING potencialmente cobrável; falhas pós-transporte permanecem ambíguas para reconciliação. Não introduzir retries de IA como solução para mudança de fonte.

O helper de elegibilidade externa e a tipagem de classificação devem estar efetivamente conectados ao caminho de execução, com testes. Não se habilita HTTP externo, credencial ou provider real como consequência da 10B. O modo seguro/desabilitado da base e os bloqueios de produção da 10A continuam exigíveis.

Todas as chamadas de IA continuam pelo Gateway. Gate arquitetural deve detectar chamadas diretas, imports indiretos, rotas alternativas, strings livres que contornem a validação e novos arquivos/extensões não cobertos pelo scanner.

## 18. Prompt injection e dados não confiáveis

Confiabilidade factual, autorização de leitura e autoridade instrucional são propriedades diferentes. Até documento VERIFIED, decisão humana registrada ou snapshot protegido permanece untrusted=true para interpretação pelo modelo.

Instruções da aplicação são estáticas/versionadas e ficam fora do payload de evidência. Conteúdo recuperado nunca pode alterar purpose, classificação, fonte permitida, capability, orçamento, role, roteamento, modelo, ferramentas, destination URL ou instruções de sistema.

Não concatenar documento em systemInstructions. Delimitadores textuais e a marca untrusted são defesa insuficiente: texto pode conter fechamento de tag, role falso, JSON, Markdown, Unicode, instrução de exfiltração ou instrução codificada. O renderer deve escapar e serializar estruturas sem permitir mudança de papel/canal. Não interpretar texto como template, código, JSON de comando ou configuração.

IDs de citações são atribuídos pelo servidor; fonte que menciona E1 ou outro ID não cria referência. Source labels também passam por projeção fechada. Nenhum link encontrado é seguido. A pergunta do usuário não pode solicitar ampliação de escopo nem tornar dado em instrução privilegiada.

O perfil inicial sem texto livre reduz a superfície, mas não elimina risco em campos textuais remanescentes. Não prometer prevenção absoluta de persuasão do modelo. A garantia exigida é que dados hostis não mudam controles nem habilitam ações/acesso; qualidade da resposta ainda depende das validações e restrições do Gateway.

## 19. Concorrência, consistência e snapshots

Uma montagem deve ler autorização relevante, fontes e dependências em uma única visão consistente do PostgreSQL, com cliente transacional repassado a todos os readers. RepeatableRead é opção para a fotografia de leitura; a implementação deve justificar o nível e usar Serializable quando necessário para o registro/validação de consumo. Promise.all fora de uma transação, usando clientes independentes, não oferece snapshot comum.

Antes do consumo, uma transação curta revalida associação/papel/projeto/política, estados, versões/checksums e conjunto de candidatos relevante; só validar IDs selecionados não detecta nova revisão ou conflito inserido depois. Consultas de seleção precisam de ordenação determinística e prova de cobertura. Usar limites explícitos; quando o conjunto obrigatório superar o limite, recusar em vez de alegar completude.

Fonte mutável deve ser relida e comparada à observação/projeção completa necessária. Fonte imutável ainda exige checagem de revogação, supersession e dependências mutáveis. Não segurar transação aberta durante transporte de IA. Se a validação de consumo for separada da reserva 10A, integrar nova checagem imediatamente antes da transição de transporte, sem supor atomicidade entre transações independentes.

O ponto de validade é a confirmação da última validação transacional de consumo. Revogação confirmada antes desse ponto deve impedir uso; mudança concorrente deve resultar em ordem serial válida ou recusa. Após esse ponto e especialmente após envio externo, não existe recolhimento retroativo do conteúdo. Esta janela residual entre commit e envio deve ser medida/limitada e explicitamente aceita; não afirmar garantia instantânea global de revogação.

Reconstruções por conflito de leitura são limitadas e nunca executam provider nem alteram negócio. Corridas entre leitura, revogação, mudança de papel, supersession, criação de nova revisão e consumo são casos obrigatórios de teste com barreiras e PostgreSQL real.

## 20. Decisão sobre persistência e migration

**Decisão proposta: nenhuma migration para a primeira implementação da 10B descrita aqui.**

| Necessidade | Modelo/mecanismo existente suficiente | Limite assumido |
| --- | --- | --- |
| Fonte da verdade | Tabelas dos domínios, com relações, versões e proteções já existentes | Não copiar dados para tabelas ContextFact/ContextSource/ContextDocument |
| Montagem e validação | Bundle e manifesto em memória por requisição | Sem histórico durável do payload |
| Política versionada | Código/configuração do servidor sob revisão | Sem UI/administração ou tabela dinâmica nova |
| Proveniência | IDs, versões/linhagem/checksums existentes e observação interna de fonte mutável | Não inventar revision durável para tabela mutável |
| Auditoria mínima | AuditLog com metadata allowlisted | Não garante exatamente uma linha por request |
| Execução/budget/idempotência | AIExecutionLog, AIPendingAction e AIUsageBudget da 10A | Não substituir ledger nem criar conversa sintética |
| Citações | Referências internas e projeção mínima; modelos de evidência existentes quando usados pelo fluxo de resposta | Revalidar referências; não persistir payload bruto por conveniência |

As lacunas de seleção, validação, projeção, orçamento, classificação e handoff são de aplicação/contrato; não provam necessidade de novas tabelas. Índice de chunks sem FK não torna obrigatório persistir outra cópia de documento: inicialmente ele fica excluído.

Existe uma limitação estrutural real: valores antigos de registros mutáveis não são sempre recuperáveis, e AuditLog não é armazenamento imutável de bundles. Como a primeira entrega não exige replay durável de payload nem auditoria exatamente uma vez, essa limitação é tratada por recusa de histórico não comprovado e não exige migration.

Se uma decisão humana posterior tornar obrigatória a vinculação durável de execução a contexto, reabrir análise com caso reproduzível e proposta mínima: por exemplo, campos opcionais de versão de política e referência opaca de contexto no AIExecutionLog existente, somente se os campos/metadados atuais se mostrarem insuficientes. Isso não resolve, por si, histórico de linhas mutáveis; essa necessidade pertence ao versionamento canônico do domínio e requer outro diagnóstico. Nenhuma DDL ou tabela nova está proposta para execução neste contrato.

## 21. Estratégia de testes para a implementação futura

Esta seção planeja testes; nenhum foi criado ou executado nesta etapa.

| Grupo | Casos e resultado objetivo |
| --- | --- |
| Domínio puro | Validação runtime de contratos; enums desconhecidos; ausência versus zero/false; precedência; conflitos; projeções; decimais/unidades; nenhuma dependência de Prisma/provider/clock global |
| PostgreSQL real | Relações reais, triggers aplicáveis, JSON com refs inválidas, versões e snapshots, sem mock como única prova de isolamento |
| IDOR | Outro tenant; outro projeto do mesmo tenant; filho com pai trocado; conversa de outro autor; projectId nulo; cookie inválido; histórico inexistente; nenhuma revelação ou provider |
| RBAC cumulativo | OWNER/ADMIN/ANALYST/REVIEWER/VIEWER; AI_READ sem AI_USE; finalidade multidomínio com capability faltante; associação revogada; audience não amplia acesso |
| Proveniência | Versão de chunk diferente do documento; checksum divergente; algoritmo desconhecido; run/cenário de outro estudo; dependência ausente; decisão/forecast com refs inválidas |
| Ausência/cobertura | actualValue nulo, lista vazia/paginada, payload sem campo obrigatório, evidenceStatus incompleto; nunca produzir zero, false ou aprovação substitutos |
| Revogação/conflito | VERIFIED→REVOKED, RETRACTED, SUPERSEDED, duas fontes divergentes, revisão nova durante montagem; preservar grupo ou recusar |
| Freshness | Relógio fixo, fronteira exata de expiresAt/TTL, timezone/data civil, queriedAt recente com fonte antiga, data ausente ou inválida, passagem de validade entre preparo/consumo |
| Determinismo | Embaralhar ordem do banco; empates de data; mesma fonte/política gera mesmo núcleo; mudanças de política/revisão alteram identidade; IDs de execução não alteram núcleo |
| Orçamento | Limites exatos e +1; UTF-8 multibyte/emoji; escaping; overhead; candidato obrigatório além do limite; grupo conflitante indivisível; nenhum corte que mude sentido |
| Minimização/auditoria | Sentinelas de PII, storageKey aninhada, checksum integral, filename, URL assinada, motivo jurídico e texto hostil ausentes de bundle transportável, AuditLog, ledger, erro e logger |
| Prompt injection | Falsos roles/system, fechamento de tags, JSON/Markdown, instrução em label/metadado, citações forjadas, Unicode e conteúdo codificado; nenhuma alteração de política, tools, escopo ou rota |
| Concorrência real | Promise.all em operações independentes contra PostgreSQL, com barreiras para leitura/revogação/supersession/membership e consumo; comprovar ordem válida ou recusa, não só execução simultânea de mocks |
| Gateway/ledger | Bundle forjado, mutado, expirado e de outro escopo recusados antes do adapter; retry ambíguo não envia novamente; preservar CAS e custo RUNNING; verificar dupla contabilização legada |
| Falhas | Banco/auditoria indisponíveis; timeout de leitura; política desconhecida; provider não chamado; nenhuma mutação parcial de negócio |
| Gates arquiteturais | Contexto não importa tool registry, motor de decisão/cálculo, SDK, HTTP ou storage; readers não escrevem negócio; nenhum bypass de envelope/Gateway; scanner cobre extensões e diretórios reais |

Testes de segurança devem inspecionar conteúdo capturado no adapter desabilitado/falso local e registros realmente persistidos no PostgreSQL de teste. Não usar credenciais, documentos ou providers reais. CI deve rodar de checkout limpo, incluindo diretórios que não existem no Git, para evitar repetição da falha da base.

## 22. Critérios objetivos de aceite e reprovação

Aceite da implementação futura exige cumulativamente:

1. Base/branch e SHA de integração explicitados, CI integral verde, incluindo build, sem confundir execução anterior com o commit entregue.
2. Sete contratos provider-neutral validados em runtime, finalidades/políticas fechadas e projeto obrigatório no perfil inicial.
3. Evidência de isolamento em cada cadeia de fonte, inclusive refs JSON e filhos sem tenant próprio.
4. Nenhum valor obrigatório ausente convertido em zero/false/aprovação; lacunas e conflitos com comportamento testado.
5. Proveniência completa, estado/versão corretos, freshness e checksums verificados com semântica documentada.
6. Limites medidos sobre payload final, significado preservado e recusa antes do provider quando impossível.
7. RBAC cumulativo, revalidação concorrente e auditoria segura com testes negativos.
8. Gateway recebe bundle validado sem bypass por trustedContext livre; providers sem acesso a banco/documentos; nenhum novo caminho externo.
9. Zero escrita em negócio, nenhuma geração de conclusão, recomendação, cálculo ou ferramenta durante montagem.
10. Resultados de testes puros, PostgreSQL real, concorrência e gates arquiteturais anexados ao registro de auditoria futuro.
11. Nenhuma nova tabela/migration sem lacuna e aprovação específicas; nenhum histórico mutável apresentado como imutável.
12. Decisões humanas da seção 24 resolvidas e riscos residuais registrados sem alegações absolutas.

Reprovar se qualquer critério falhar. Exemplos suficientes: provider invocado após revogação anterior à validação final; fonte de outro projeto; fallback de histórico para atual; chunk sem vínculo; texto recuperado em instrução; filtro de privacidade apenas por regex; log de checksum/storageKey; índice ou lista parcial usado como total; ordenação não determinística; auditoria com erro bruto; gate desabilitado para passar CI; uso de ferramentas/refresh sob nome de reader.

Aceite deste documento autoriza somente o escopo que o humano declarar na próxima etapa. Não equivale a aceite de produção, implantação ou ativação de provider.

## 23. Riscos residuais e bloqueios

| Risco/bloqueio | Tratamento e condição de saída |
| --- | --- |
| CI da base reprovado | Corrigir em escopo explicitamente aprovado e confirmar nova base com pipeline inteiro verde |
| Divergência de custo no fluxo legado | Verificar e resolver contabilização antes do aceite da integração com provider, sem duplicar ledger |
| Ausência de políticas detalhadas por finalidade/fonte | Reader correspondente permanece desabilitado até definição de projeção, classificação e validade |
| Imutabilidade heterogênea | Validar proteção por fonte; mutáveis só como observação; sem replay histórico fictício |
| Snapshot antigo com dependência revogada | Estado atual de uso revalidado; histórico nunca implica validade presente |
| TOCTOU após validação e envio | Fronteira definida na seção 19, intervalo limitado, testes e aceite explícito; transporte externo continua bloqueado nesta etapa |
| Metadados também contêm informação sensível | Allowlist no select/renderer/log; texto e documentos completos excluídos |
| Injeção pode influenciar linguagem do modelo | Separação estrutural e ausência de acesso/ação; não declarar imunidade semântica absoluta |
| Tokenizer e janela variam por modelo | Estimativa neutra versionada e verificação final do Gateway; perfil desconhecido recusa |
| Tabelas amplas, filtros incompletos e novos conflitos | Leitura com cobertura definida, conjunto revalidado e limites fail-closed |
| Referências/checksums não são controles de acesso | Verificar tenant/projeto em todas as relações; nunca confiar só no digest |
| Banco implantado pode diferir de migrations | Verificação em PostgreSQL real e implantação futura com gates próprios; não afirmada nesta etapa |
| Requisitos anteriores de produção da 10A | Permanecem cumulativos; 10B não habilita rede, credenciais, retenção ou política externa |

## 24. Decisões humanas pendentes antes da implementação

1. Aprovar ou ajustar este contrato e autorizar explicitamente a próxima fatia; resolver o bloqueio de CI e a referência-base antes da integração.
2. Confirmar primeira finalidade: recomendação de começar por STUDY_EVIDENCE; CLOSURE_EVIDENCE em fatia posterior devido às dependências multidomínio.
3. Aprovar allowlist de fontes/campos, estados e capabilities para cada finalidade, com documentos apenas em metadados e textos/chunks desabilitados inicialmente.
4. Aprovar mapeamento conservador de classificação e tratamento de fontes compartilhadas; recomendação inicial de excluir fontes sem vínculo de projeto comprovado.
5. Aprovar limites da seção 13, validity de 60 segundos e freshness por fonte antes de admitir dados mutáveis.
6. Confirmar ausência de persistência de payload e de garantia de replay durável; eventual requisito diferente exige novo diagnóstico de migration.
7. Definir responsáveis pelo acesso à auditoria e aceitar a janela residual de concorrência descrita, sem relaxar revogação anterior ao consumo.
8. Autorizar separadamente a correção das divergências da 10A que impedem integração, sem ampliar esta etapa documental.

Enquanto uma política necessária não for aprovada, o comportamento é recusa. Nenhum default permissivo será adotado para suprir decisão humana pendente.

## 25. Plano de implementação em fatias pequenas

| Fatia futura | Entrega auditável | Gate de saída |
| --- | --- | --- |
| 0 — Base | Correção autorizada do CI e verificação das divergências de integração 10A; base explícita | Pipeline verde; nenhuma mudança silenciosa do contrato financeiro |
| 1 — Domínio | Sete contratos, políticas iniciais, estados/erros, seleção pura, minimização e orçamento | Testes puros e revisão de ausência/conflito/injeção; sem Prisma/provider |
| 2 — Primeira fonte | Reader transacional de estudo SNAPSHOT e resultados persistidos, com autorização e linhagem | PostgreSQL real; IDOR e cobertura; nenhum getter com efeito colateral |
| 3 — Montagem e auditoria | Coordenador, manifesto, determinismo, freshness, revalidação e AuditLog allowlisted | Testes de concorrência e vazamento; sem chamada de IA |
| 4 — Gateway | Handoff obrigatório do bundle, envelope estruturado, vínculo de idempotência, limites e gates 10A atualizados pontualmente | Adapter local/desabilitado; sem bypass; ledger e segurança da 10A preservados |
| 5 — Fontes adicionais aprovadas | Fechamento e demais readers do mapa, um domínio por vez, sem reconstruir cálculos | Cada reader com política, testes de autorização/qualidade e revisão própria |
| 6 — Auditoria de encerramento | Revisão adversarial, regressão apropriada, checkout limpo e evidências do CI | Aceite humano da 10B; produção permanece decisão separada |

Esta sequência não implementa 10C–10I, não introduz ferramentas de IA e não pressupõe commit, push ou publicação autorizados.

## 26. Revisão adversarial deste diagnóstico

| Ataque/alegação examinada | Resultado incorporado no contrato |
| --- | --- |
| “Precisamos de um novo banco de contexto” | Rejeitado: fontes canônicas + memória + AuditLog/ledger existentes bastam ao escopo inicial |
| “Checksum ou campo version prova imutabilidade” | Rejeitado: separação entre versão nativa, linhagem imutável e observação mutável |
| “O cliente só manda um ID, então é seguro” | Rejeitado: conversa, seleção persistida e cada relação exigem tenant/projeto/autor e estado válidos |
| “Mesmo tenant permite qualquer projeto” | Rejeitado: projeto exato obrigatório; dados de empresa/região não são relabelados |
| “Histórico não encontrado pode usar latest” | Rejeitado: CONTEXT_HISTORY_UNAVAILABLE |
| “Getter não altera nada” | Refutado por serviços jurídicos, mercado, vendas e bootstrap; leitores próprios sem mutação |
| “Bundle congelado da UI tem checksum válido” | Refutado pela incorporação de documentos atuais ao workspace; validar JSON persistido |
| “Fonte verificada pode virar instrução confiável” | Rejeitado: untrusted permanece; instruções e dados são separados |
| “Tag untrusted elimina prompt injection” | Rejeitado: renderer estrutural, controles fora do modelo e nenhum acesso/ação por evidência |
| “Hash de texto sensível é log seguro” | Rejeitado: apenas referências seguras e códigos estáticos; sem hash de motivos/fragmentos |
| “Mesmo conjunto selecionado detecta toda mudança” | Rejeitado: revalidar conjunto relevante, novas revisões/conflitos e dependências |
| “Uma transação impede revogação após envio” | Rejeitado: ponto de validade e janela residual explícitos; sem garantia retroativa |
| “Retries idênticos exigem uma tabela nova” | Rejeitado: idempotência semântica de leitura separada do ledger de execução e de auditoria exatamente uma vez |
| “Todas as proteções já existem” | Rejeitado: controles propostos separados das evidências existentes e das lacunas da seção 5 |
| “10A aprovada significa CI verde deste SHA” | Refutado pela execução remota exata; bloqueio documentado |

## 27. Adendo de implementação local — 14/09/2026

A autorização posterior à etapa de diagnóstico resolveu as decisões da seção 24 com o perfil conservador. A implementação usa sete contratos strict em `src/domain/context-engine`, cinco finalidades fechadas, políticas versionadas, referências opacas, seleção determinística, conflitos explícitos, freshness com clock injetável, validade de bundle de 60 segundos, orçamento por itens/bytes/tokens/domínio/classificação e recusa de item indivisível cujo significado não possa ser preservado.

O coordenador em `src/application/context-engine` revalida membership ativa, papel, conversa, organização e projeto antes de qualquer consulta de domínio. Todos os readers recebem o mesmo `Prisma.TransactionClient` sob `Serializable`. A primeira allowlist implementada lê diretamente versões `SNAPSHOT`, `AssumptionSnapshot`, `FinancialResult`, `RiskFinding`, `LegalEvidenceDocument` verificado e não revogado e `EngineeringTechnicalOpinion` validado e não superseded. Os selects excluem texto livre, PII, payload, storageKey e checksum integral. Fontes sem vínculo de projeto comprovado e as fontes listadas no diagnóstico que não eram necessárias ao perfil inicial permanecem desabilitadas.

**Alegação superada pela correção pós-auditoria:** identidade de objeto e registro process-local não são mais autoridade. Um bundle reidratado pode atravessar web/worker/instâncias, mas não autoriza transporte sozinho. O Gateway valida schema, ator, conversa, organização, projeto, correlação server-side, finalidade/política, idempotencyKey, validade, fingerprint e medições; o ledger persiste um binding strict. Imediatamente antes do transporte, uma transação `Serializable` relê autorização e fontes, reconstrói o fingerprint, grava `CONTEXT_CONSUMED` e faz o CAS `QUEUED → RUNNING`. A composição produtiva exige bundle. O único call site produtivo continua sendo `createOrganizationAiGateway`/`askRedeAI`.

O Context Engine não chama provider, adapter, transporte, ferramenta, engine de cálculo ou getter com escrita. A montagem cria somente `AuditLog` com códigos, contagens e referências opacas. O log externo de orquestração de `askRedeAI` passou a persistir custo/tokens zero; apenas a linha do ledger do Gateway contabiliza a chamada. O fingerprint do request da 10A inclui a identidade do bundle, impedindo reuso da mesma idempotencyKey com contexto divergente.

Nenhuma alteração de schema ou migration foi necessária. `AIExecutionLog` e `AIPendingAction` já oferecem tentativa, vínculo idempotente e CAS duráveis. O replay da mesma operação não provoca segundo transporte nem segunda contabilização; o conteúdo da resposta continua não persistido. Bundles serializados entre processos são aceitos somente após validação e consumo no banco. A validade máxima de 60 segundos limita a idade de preparação e não substitui a revalidação. Providers comerciais e rede externa permanecem bloqueados.

Os testes adicionados cobrem contratos strict antes do acesso por Zod, getters/accessors/proxy/prototypes, limites e duplicatas, TTL explícito, fonte futura, conjunto obrigatório indivisível, determinismo/fingerprint, JSON hostil, IDOR, membership e capability revogadas, conversa/projeto alterados, fonte revogada/superseded/nova, bundle vencido, seis fontes no PostgreSQL, reidratação, consumo concorrente e corrida com `PrismaClient`s independentes. O registro observável e a autorrevisão estão em `docs/PHASE_10B_AUDIT_RECORD.md`.

## 28. Correção focal pós-auditoria reprovada — ponto sem retorno

`TRANSPORT_AUTHORIZED` é o commit que grava `CONTEXT_CONSUMED` e promove `AIExecutionLog` de `QUEUED` para `RUNNING`, com a `AIPendingAction` ainda `EXECUTING`. Antes desse commit, o adapter não pode ser chamado. A transação adquire uma barreira relacional `SHARE` nas tabelas de identidade, escopo e fontes; mutações produtivas usam `ROW EXCLUSIVE` por definição do PostgreSQL. Se a mutação já iniciou, o consumo aguarda e relê seu estado após o commit. Se o consumo adquire a barreira primeiro, a mutação só confirma depois de `TRANSPORT_AUTHORIZED`. Assim, revogação, troca de papel, mudança de conversa/projeto, nova versão, supersession, alteração de risco ou evidência jurídica confirmada antes do ponto sem retorno bloqueia o transporte.

O consumo reconstrói o contexto a partir do banco e compara o fingerprint completo. A descrição anterior do binding apenas com referências opacas foi **superada**: o binding strict persistido contém exatamente política, finalidade, `preparedAt`, `validUntil`, fingerprint, IDs reais de ator, conversa, organização e projeto, idempotencyKey, correlationId e os IDs da execução e da pending action pertinentes. Nenhum conteúdo de evidência é persistido. O CAS de contexto aceita somente `QUEUED`, por isso uma segunda instância não pode consumir novamente. Conflito `P2034` pode ser repetido no máximo três vezes antes do adapter; `P2002` e outros erros não são tratados como conflito serializável. Depois que o commit retorna, a execução já está autorizada e uma alteração posterior não recolhe retroativamente o transporte.

Cada fonte selecionável possui TTL explícito. Timestamp futuro é inválido. A fórmula exata é `validUntil = min(preparedAt + 60_000 ms, source.recordedAt + policy.freshnessMsBySource[source.sourceType] para cada fonte selecionada)`, com exigência de `validUntil > preparedAt`. Datas aceitas usam exclusivamente UTC ISO 8601 com milissegundos, no formato `YYYY-MM-DDTHH:mm:ss.sssZ`, e precisam sobreviver a `Date(value).toISOString() === value`; offsets equivalentes, precisão omitida/diferente e variantes de caixa são recusados. No consumo, política e fontes atuais reconstroem o mesmo prazo, que precisa ser exatamente igual ao bundle e ao binding; `now < validUntil` é conferido novamente imediatamente antes de `CONTEXT_CONSUMED`/CAS. Grupos `REQUIRED` são selecionados por inteiro ou causam recusa; grupos opcionais também são excluídos por inteiro. A projeção de transporte é JSON canônico com allowlist, mantendo instruções de sistema fora da evidência.

Risco residual: a barreira usa locks de tabela para cobrir inserções concorrentes e garantir a ordem de confirmação sem migration. Ela é correta e simples, mas reduz concorrência de escrita enquanto a transação curta de autorização está aberta. Se o volume exigir locks mais granulares, será necessário um protocolo durável compartilhado pelos serviços produtores; qualquer coluna/tabela nova continua dependente de autorização específica para migration.

## 29. Correção focal final — tempo, ciclo do projeto e multi-instância

O fingerprint passou a lacrar os dois timestamps canônicos e todas as restrições da política que governam fontes, classificações, freshness e orçamento. Alterar `preparedAt`, aumentar ou reduzir `validUntil`, trocar offset ou reaproveitar um fingerprint com outra janela falha antes do adapter, mesmo que o atacante recalcule as medições públicas. Um bundle que vence aguardando a barreira também falha antes do audit/CAS e deixa a tentativa liberável somente enquanto comprovadamente `QUEUED`.

O schema Prisma vigente não possui o literal `ACTIVE` em `ProjectStatus` e esta correção foi expressamente proibida de alterar schema ou criar migration. Para preservar uma operação possível sem violar essa proibição, o predicado central define como **estados ativos equivalentes do schema atual** `DRAFT`, `UNDER_REVIEW` e `APPROVED`; `PAUSED`, `ARCHIVED`, `CLOSED` e qualquer valor não reconhecido falham fechados no preparo e no consumo com a mesma resposta segura de projeto inexistente/inacessível. Isso é uma equivalência de compatibilidade, não a alegação de que o banco contém `ACTIVE`. Criar um literal único `ACTIVE` exigiria uma mudança de schema/migration fora do escopo autorizado. Uso histórico de `CLOSED` permanece fora desta rodada.

As propriedades de entrada são inspecionadas por descriptors antes do Zod: objetos comuns recusam propriedade própria não enumerável, Symbol, accessor, prototype não permitido e Proxy cujo trap falhe, sem executar getter/setter. Arrays aceitam somente índices enumeráveis e o descriptor estrutural nativo `length`; objetos congelados ou selados que conservem dados comuns continuam válidos.

A evidência de concorrência tem duas camadas e não é ampliada além do observado. Na camada completa do Gateway, 2, 5 e 10 instâncias lógicas independentes recebem cópias por JSON round-trip/`structuredClone` e produzem exatamente um adapter call, uma execução contabilizada e um `CONTEXT_CONSUMED`. Na camada durável, 2, 5 e 10 subprocessos Node, cada um com seu próprio `PrismaClient` e estado process-local descartado, disputam a mesma reserva; exatamente um promove `QUEUED → RUNNING` e grava o consumo, e os demais observam o CAS perdido. Como adapters injetados não são compartilháveis com segurança entre processos, o teste por subprocesso prova o CAS/consumo; a unicidade de chamada e cobrança é provada pela camada completa no processo superior. Os subprocessos usam vetor de argumentos, sem shell quoting, desconectam o cliente em `finally` e não escrevem credenciais em stdout/stderr.
