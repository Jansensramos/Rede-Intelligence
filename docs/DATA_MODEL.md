# Modelo de dados

## Agregados

### Organização e acesso

- `Organization`: tenant e proprietária dos dados.
- `User`, `OrganizationMembership`: identidade, papel e vínculo multiempresa.
- `Session`: token opaco hasheado, organização ativa e expiração.

### Empreendimento

- `Project`: empreendimento pertencente a uma organização.
- `ViabilityStudy`: estudo ativo dentro do empreendimento.
- `StudyVersion`: versão numerada com ciclo `DRAFT → SNAPSHOT`; snapshots são imutáveis.
- `AssumptionSnapshot`: projeção tipada usada pelo Engine v1.
- `AssumptionEntry`: representação extensível por chave, categoria, valor JSON, unidade, fonte e observação.
- `InvestmentPolicy`: limites versionados por organização e referenciados pelo snapshot.

### Análise

- `Scenario`: caso conservador, base, agressivo ou customizado ligado à versão.
- `ScenarioAssumptionOverride`: somente premissas diferentes do caso base, sem duplicar todo o estudo.
- `CalculationRun`: execução imutável, versão do motor e hash do input.
- `CalculatedMetric`: registro extensível de métricas além das colunas executivas de `FinancialResult`.
- `CashFlowEntry`: série mensal calculada.
- `FinancialResult`: KPIs agregados da execução.
- `CalculationTrace`: fórmula, entradas e resultado explicável.
- `RiskFinding`, `Recommendation`: evidência e ação proposta.
- `Score`, `ScoreDimension`, `ScoreRuleResult`: score por cenário, política versionada e explicação por regra.
- `SensitivityAnalysis`, `SensitivityCase`, `StressTestResult`, `BreakEvenResult`: matriz e limites analíticos do snapshot.
- `RedTeamRun`: execução versionada e imutável do processo adversarial, ligada à organização, versão e cenário.
- `RedTeamAgentResult`: parecer e perguntas de cada um dos seis especialistas.
- `RedTeamEvidenceItem`, `RedTeamFindingEvidence`: Evidence Pack normalizado e relação verificável entre achados e suas fontes.
- `RedTeamFinding`, `RedTeamAssumptionChallenge`, `RedTeamEvidenceRequest`: riscos, premissas contestadas e documentação solicitada.
- `RedTeamCrossReview`, `RedTeamDisagreement`: revisão por outro especialista e divergências explícitas.
- `RedTeamExecutiveConclusion`: decisão do Chair, bloqueios, ações, risco residual e condições para mudar a decisão.
- `AIAnalysisRun`: extensão futura, sem afetar o Engine nem habilitar chat nesta fase.

### Inteligência territorial

- `LandAsset`: terreno da organização, polígono, área, testada, endereço, coordenadas e vínculo opcional com empreendimento.
- `LandStudy`, `LandStudyVersion`: estudo territorial e versões numeradas com ciclo `DRAFT → SNAPSHOT`.
- `UrbanSourceRecord`: fonte, tipo, confiança, referência, data de verificação e observação.
- `UrbanScenarioRecord`: cenário `CURRENT_LEGAL` ou `SIMULATED`, com parâmetros completos e proveniência.
- `UrbanRestrictionRecord`: restrição territorial; apenas geometria verificada entra no envelope.
- `BuildableEnvelopeRecord`: resultado geométrico, parâmetros efetivos, áreas e avisos.
- `LandOptionRecord`: produto, massing, fases, cronograma de áreas, resultado do Engine, Score e metadados de ranking/Pareto.
- `ReverseZoningRun`: parâmetros urbanísticos necessários para uma meta de produto.
- `UrbanGapAnalysisRecord`, `UrbanUpliftAnalysisRecord`: diferenças regulatórias e econômicas entre cenário atual e proposta selecionada.
- `LandDocument`: metadados de evidência e documentos territoriais.
- `LandAuditLog`: autoria, operação e estado anterior/posterior de cada alteração manual.

### Realizado e governança

- `ActualEntry`: séries separadas para comparação previsto × realizado.
- `AuditLog`: autoria e operações críticas dentro do tenant.

## Regras de modelagem

- dinheiro e percentuais persistem como `Decimal`; nunca `Float`;
- premissas são snapshots imutáveis depois de usadas em uma execução;
- resultados referenciam `calculationRunId`, `scenarioId` e `engineVersion`;
- `organizationId` participa do contexto de todas as consultas de negócio;
- versões `SNAPSHOT`, premissas, overrides, métricas e artefatos calculados são append-only por trigger;
- execuções Red Team e todos os seus artefatos são append-only quando pertencem a um snapshot;
- versões e artefatos Land são append-only quando o `LandStudyVersion` chega a `SNAPSHOT`;
- cenários legais e simulados são registros diferentes, com fonte e confiança próprias;
- dados municipais ausentes são `null` ou `MANUAL_REQUIRED`, nunca valores presumidos;
- dados realizados serão séries separadas, nunca sobrescrita do previsto.

## Evolução prevista × realizado

Na Fase 6, `ActualEntry` registrará competência, métrica, valor, fonte, responsável e evidência. A reconciliação será feita contra `CashFlowEntry` ou uma premissa versionada. Isso preserva o histórico mesmo quando o orçamento for revisto.

O esquema executável está em `prisma/schema.prisma`; as migrations estão em `prisma/migrations`, incluindo a fundação inicial, `draft_snapshot_policies_alerts`, `rede_score_sensitivity`, `rede_red_team_v1`, o ajuste isolado do estado inicial `QUEUED` e `rede_land_intelligence`.
