# Fase 6 — Investment Committee, REDE Studio e Data Room

## Arquitetura

A Fase 6 foi adicionada sobre os módulos analíticos existentes, sem recalcular ou substituir resultados publicados. O `InvestmentSnapshotBundle` referencia e congela as versões exatas de Study/Engine, Score, Sensitivity, Red Team e Land. O bundle é a fonte comum para Committee, Studio e Master Report.

O fluxo principal é:

```text
StudyVersion + LandStudyVersion
  -> InvestmentSnapshotBundle imutável
  -> InvestmentReviewRound
  -> decisão / condicionantes / ledger
  -> modelo intermediário de documento
  -> PDF ou PPTX
  -> StudioArtifact FINAL imutável
  -> cópia versionada no Data Room
```

Todas as consultas mutáveis passam pelo contexto autenticado e pelo `organizationId`. Triggers PostgreSQL impedem `UPDATE` e `DELETE` de bundles e artefatos finais.

## Entidades persistidas

- `InvestmentCase`, `InvestmentSnapshotBundle` e `InvestmentReviewRound`;
- `CommitteeDecision`, `CommitteeMember`, `CommitteeVote`, `CommitteeMinutes` e `CommitteeQuestion`;
- `InvestmentCondition`, `DecisionLedgerEntry`, `DecisionSandbox`, `InvestmentAuditLog`;
- `AssumptionRegisterItem`, `InvestmentClaim`, `InvestmentIssue`, `InvestmentStakeholder`;
- `UrbanTransformationProfile`, infraestrutura, impactos, contrapartidas, custos, riscos, milestones e stage gates;
- `ProjectDocument` e `DocumentChecklistItem` para Data Room versionado;
- `StudioArtifact`, `MasterReportConfigRecord` e `MasterReportJob`;
- `OrganizationBrandConfig`, `PreDevelopmentBudgetItem`, `LandControlStrategy` e `DealStructure`.

Migration: `20260817230000_rede_studio_committee_master_report`.

## Master Report

O Master Report usa o mesmo modelo intermediário dos demais materiais do Studio. Métricas são bloqueadas no snapshot, narrativas carregam referências de evidência e seções confidenciais são filtradas pelo público selecionado.

Configurações suportadas:

- presets `EXECUTIVE`, `COMPLETE`, `FULL_DOSSIER` e `CUSTOM`;
- público `INTERNAL`, `COMMITTEE`, `INVESTOR`, `BANK`, `PARTNER` ou `PUBLIC_AUTHORITY`;
- seleção explícita de seções, cenários financeiros, cenários urbanísticos e anexos;
- A4 ou Letter, watermark `DRAFT`, `CONFIDENTIAL` ou `FINAL`;
- preflight bloqueante e `Report Readiness`, mantido separado de Investment Readiness e Data Room Completeness.

O renderizador PDF gera texto real, paginação, cabeçalho/rodapé, tabelas com quebra, gráficos vetoriais, massa 3D esquemática, sumário clicável, bookmarks, QR de verificação, Report ID e checksum SHA-256. O renderizador PPTX consome o mesmo documento intermediário.

O preset Full Dossier possui mais de 60 seções, incluindo tese, cenários, premissas, cash flow, capital stack, sensibilidade, stress, Urban Transformation Case, approvals, Data Room, Red Team, Score, decisão do comitê, histórico, “o que mudou”, fontes, calculation trace, auditoria e limitações.

## Reavaliação e versionamento

Uma mudança de `StudyVersion` ou `LandStudyVersion` cria novo bundle e novo review round. O bundle anterior permanece consultável. O relatório comparativo mostra deltas entre versões. Uma simulação do Decision Sandbox só entra no caso oficial após promoção explícita, que cria uma nova `StudyVersion`.

Documentos do Data Room são encadeados por `previousVersionId`; a versão anterior passa a `SUPERSEDED`, sem remoção. Um Master Report final é salvo em `14_RELATORIOS / MASTER_REPORT`.

## Limitações declaradas

- mapas externos, imagens aéreas e vistas 3D fotorealistas não são inventados; na ausência de evidência anexada, o relatório usa geometria e massing determinísticos;
- o QR codifica Report ID e prefixo do checksum, mas a consulta pública do código exige um portal de verificação futuro;
- a geração possui job e progresso persistidos, mas a execução ainda ocorre no processo da aplicação, sem worker distribuído;
- anexos entram no índice e na matriz de evidências; arquivos arbitrários não são concatenados ao PDF nesta versão;
- o conteúdo é gerado em português; tradução editorial automática não faz parte da Fase 6;
- o módulo não introduz chat ou recomendações autônomas de IA.

## Validação

```powershell
pnpm db:migrate
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Acesso de demonstração: configurado exclusivamente no ambiente local, sem valores versionados.
