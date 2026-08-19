# Fase 7 — REDE AI

## Resultado arquitetural

O REDE AI é uma camada de orquestração e apoio à decisão acima dos módulos determinísticos existentes. Ele não recalcula nem substitui Engine, Score, Sensibilidade, Red Team, Land, Comitê, Studio ou Master Report. Toda métrica crítica vem de um registro estruturado, com versão, cenário e `evidenceRef` persistidos.

Fluxo principal:

1. a sessão autenticada resolve usuário, organização e papel;
2. a conversa carrega seu contexto persistido e o snapshot exato;
3. o intent planner escolhe somente ferramentas registradas e valida seus argumentos com Zod;
4. as ferramentas consultam módulos estruturados ou executam simulações temporárias;
5. o compositor gera resposta, cards e referências sem inventar valores;
6. o provedor externo, quando configurado, só pode reescrever o conteúdo fundamentado e passa por proteção numérica;
7. mensagens, fontes, chamadas, duração, modelo, prompt e custo são auditados no PostgreSQL.

## Segurança e governança

- todas as consultas de conversa e evidência incluem `organizationId`;
- o Context Builder recalcula permissões a cada requisição;
- Viewer possui somente leitura; Reviewer e Analyst podem simular; somente Owner/Admin confirmam mutações;
- simulações carregam o rótulo `SIMULAÇÃO — NÃO OFICIAL` e não alteram `StudyVersion` ou bundle;
- promover uma simulação cria uma nova versão e um novo snapshot, somente após confirmação;
- geração de Studio/Master Report e promoções para Ação, Risco, Condição ou Pergunta do Comitê usam `AIPendingAction`, preview, expiração, idempotency key e auditoria;
- conteúdo documental é marcado `UNTRUSTED_EVIDENCE`; instruções contidas em arquivos nunca são tratadas como comandos;
- respostas externas com números ausentes do texto fundamentado são descartadas;
- erros externos causam fallback `LIMITED`, sem interromper os módulos determinísticos;
- rate limit, orçamento mensal, limite por usuário e quantidade máxima de ferramentas são configuráveis por organização.

## Persistência

A migration `20260818000000_rede_ai` cria:

- `ai_conversations` e `ai_messages`;
- `ai_response_evidence`;
- `ai_execution_logs` e `ai_tool_call_logs`;
- `ai_pending_actions`;
- `ai_insights` e `ai_feedback`;
- `ai_task_policies` e `ai_usage_budgets`;
- `ai_document_chunks`;
- `ai_favorite_prompts` e `ai_organization_prompts`;
- `ai_system_prompt_versions` e `ai_feature_flags`.

Conversas preservam `StudyVersion`, snapshot bundle, cenário financeiro, cenário urbanístico, módulo de origem e modo de resposta. Quando uma versão mais nova existe, a interface exibe estado desatualizado sem alterar retroativamente mensagens anteriores.

## Catálogo de ferramentas

O registro tipado contém ferramentas reais de leitura e simulação:

- contexto e viabilidade: `getProject`, `getStudy`, `getStudyVersion`, `getAssumptions`, `getEngineResults`, `getCashFlow`;
- score e stress: `getScore`, `getScoreExplanation`, `getSensitivity`, `getStressTests`, `getBreakEven`;
- Red Team e governança: `getRedTeam`, `getFindings`, `getCommitteeDecision`, `getConditions`, `getBlockers`, `getRiskRegister`, `getIssues`, `getCriticalPath`, `getReadiness`, `getActionCenter`;
- Data Room: `getDocuments`, `getDocumentStatus`, `searchInternalEvidence`;
- Land e transformação urbana: `getUrbanScenario`, `getLandAsset`, `getMasterplan`, `getPhases`, `getUrbanGap`, `getUrbanUplift`, `runReverseZoningSolver`, `compareUrbanScenarios`;
- decisão: `compareVersions`, `compareScenarios`, `createDecisionSimulation`, `runEngineSimulation`, `runSensitivitySimulation`, `calculateLandValueCeiling`, `calculateCostOfDelay`;
- Comitê e Studio: `prepareCommitteeBrief`, `preflightMasterReport`, `getStudioArtifacts`, `generateStudioDraft`;
- seleção explícita: `changeContext`.

## Provedor e Model Router

Sem configuração externa, `DeterministicAIProvider` mantém a aplicação funcional em modo `LIMITED`. Para um endpoint HTTP compatível com Chat Completions:

```dotenv
AI_PROVIDER_NAME="provedor-interno"
AI_PROVIDER_BASE_URL="https://endpoint.example/v1/chat/completions"
AI_PROVIDER_API_KEY="defina-fora-do-repositorio"
AI_DEFAULT_MODEL="modelo-autorizado"
AI_INPUT_COST_PER_MILLION="0"
AI_OUTPUT_COST_PER_MILLION="0"
```

O adaptador aplica timeout de 45 segundos, uma nova tentativa para `429`/erros transitórios e fallback seguro. `AITaskPolicy` define provider, modelo, temperatura e limite de tokens por tipo de tarefa. Nunca grave chaves no banco, seed ou repositório.

## Uso funcional

1. abra **REDE AI** no menu lateral ou use **Explicar esta tela** no cabeçalho;
2. confirme projeto, StudyVersion e cenários na barra de contexto;
3. escolha modo Executivo, Detalhado ou Técnico;
4. faça uma pergunta ou use a Prompt Library;
5. abra os chips de evidência para ver módulo, versão, cenário, confiança e localização;
6. em simulações, revise base, resultado e delta;
7. para criar uma versão ou artefato, revise o preview e confirme somente se autorizado;
8. salve insights, envie feedback, promova uma resposta para módulos de governança ou exporte a conversa em PDF.

Exemplos validados:

- `Explique este projeto.`
- `Qual é o maior risco?`
- `O que falta para aprovar?`
- `Compare os cenários.`
- `E se o custo de obra subir 10%?`
- `Quanto podemos pagar pelo terreno?`
- `Qual CA preciso para 1.300 unidades?`
- `Prepare o Comitê.`
- `Quais documentos faltam?`

## Execução e validação

```powershell
pnpm db:local:start
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

A credencial demonstrativa continua sendo `admin@rede.local` / `Rede@2026`. A interface funciona sem chave de IA; nesse caso o status visual é `LIMITED`.

## Limites declarados

- o retrieval documental v1 indexa arquivos textuais (`text/*`, `.txt`, `.md`, `.csv`); PDFs e imagens continuam cadastrados no Data Room, mas exigem pipeline de extração/OCR futuro para busca por trecho;
- o endpoint externo deve ser compatível com o formato Chat Completions;
- projeções não são garantia de retorno;
- cenário urbanístico simulado não equivale a aprovação municipal;
- respostas são apoio à decisão e não substituem validação técnica, jurídica, regulatória ou do Comitê.
