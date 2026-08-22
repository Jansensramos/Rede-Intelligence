# REDE Intelligence

Plataforma multiempresa de viabilidade imobiliária com **REDE Engine v1**, REDE Score, Sensitivity Engine, REDE Red Team v1, REDE Land Intelligence/Zoning Lab, REDE Design Intelligence, Investment Committee, REDE Studio, Data Room, REDE AI, PostgreSQL, Prisma, autenticação por sessão e snapshots imutáveis.

## Executar localmente

Requisitos: Node.js 20+, pnpm e PostgreSQL 17. No Windows, o projeto pode manter um cluster isolado na porta `55432`:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:local:setup
pnpm db:setup
pnpm dev
```

Acesse `http://localhost:3000` e use:

- e-mail: `admin@rede.local`
- senha: `Rede@2026`

Para usar outro PostgreSQL, ajuste `DATABASE_URL` e execute somente `pnpm db:setup`. O seed é idempotente.

A arquitetura da frente de Pessoas, Administração, Eficiência e Causa-raiz está documentada em [`docs/PHASE_9F_PEOPLE_EFFICIENCY_IMPLEMENTED.md`](docs/PHASE_9F_PEOPLE_EFFICIENCY_IMPLEMENTED.md).

## Persistência e segurança

- o token aleatório de sessão é armazenado somente como hash no banco;
- o navegador recebe cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção;
- a associação do usuário à organização é revalidada em cada sessão;
- consultas e escritas de estudos são filtradas pelo `organizationId` autenticado;
- cada salvamento cria uma `StudyVersion` em `DRAFT`, grava seus artefatos e a promove para `SNAPSHOT` na mesma transação;
- triggers PostgreSQL impedem alterar ou remover snapshots, premissas, deltas de cenário e resultados publicados;
- premissas tipadas (`key`, categoria, valor, unidade, fonte e observação), políticas versionadas, três cenários e somente seus deltas são persistidos;
- resultados escalares e extensíveis, fluxo mensal, trilhas e alertas estruturados são gravados na mesma transação;
- REDE Score por cenário, regras explicáveis, sensibilidade isolada, stresses combinados e break-evens são persistidos por snapshot;
- o REDE Red Team v1 executa seis pareceres independentes sobre um Evidence Pack imutável, faz revisão cruzada e grava achados, proveniência e conclusão executiva;
- sem um provedor de IA configurado, o Red Team permanece funcional em modo determinístico e informa explicitamente o fallback na interface;
- REDE Land separa zoneamento legal atual de cenários simulados, gera envelopes e massing determinísticos e envia cada alternativa ao REDE Engine e ao REDE Score;
- estudos territoriais preservam fontes, confiança, restrições verificadas, solver reverso, gap regulatório, uplift, autoria e snapshots imutáveis;
- cada Investment Case congela as versões exatas de Engine, Score, Sensibilidade, Red Team e Land em um bundle imutável;
- review rounds, decisões, condicionantes, claims, premissas, issues e ledger de decisão têm histórico independente e auditável;
- o Decision Sandbox nunca altera o caso oficial: a promoção cria nova `StudyVersion`, bundle e review round;
- o Data Room mantém checklist por categoria, versões encadeadas, confidencialidade e checksums SHA-256;
- o REDE Studio gera Investment Book, Urban Transformation Case, apresentações e Master Report a partir de um único modelo intermediário;
- relatórios finais ficam vinculados ao bundle, recebem Report ID, checksum, QR, sumário clicável, bookmarks e cópia versionada no Data Room;
- o REDE AI orquestra mais de 37 ferramentas tipadas sobre Engine, Score, Sensibilidade, Red Team, Land, Comitê, Studio, Data Room e Action Center sem substituir seus cálculos;
- respostas de IA persistem contexto, ferramentas, fontes, versões, confiança, prompt/modelo e trilha de execução; documentos são sempre tratados como evidência não confiável;
- simulações ficam isoladas do snapshot oficial e qualquer promoção, geração ou mutação exige preview e confirmação explícita de Owner/Admin;
- sem chave de provedor externo, o copiloto permanece operacional em modo `LIMITED`, com composição determinística e custo zero;
- o REDE Design Intelligence preserva packages e revisões, ingere arquivos privados, calcula somente métricas demonstráveis, registra findings com evidência, prioriza VE e envia alternativas isoladas ao Engine e ao Score;
- PDF/imagem têm visualização autenticada; IFC e DXF recebem inspeção conservadora de metadados, sem alegar geometria 3D, clashes ou medições que não foram extraídas;
- o Design Review Report é gerado pelo Studio, indexado no Data Room e incorporado ao Master Report completo;
- `localStorage` não é usado para dados de negócio.

## Comandos

```bash
pnpm db:local:start
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:local:stop
```

O modo de desenvolvimento usa `.next-dev` e o build usa `.next`, evitando colisão entre manifests do Webpack.

## Estrutura

```text
prisma/                       schema, migration e seed
src/application/auth/         sessão e contexto autenticado
src/application/studies/      casos de uso e transações multiempresa
src/infrastructure/database/  cliente Prisma
src/domain/financial/         motor financeiro puro
src/domain/risk/              regras determinísticas
src/domain/score/             score versionado, dimensões, gates e penalidades
src/domain/sensitivity/       choques isolados, stresses, ranking e break-even
src/domain/red-team/          evidências, especialistas, revisão e síntese executiva
src/domain/land/              geometria, zoneamento, massing, solver e integração econômica
src/application/land/         persistência, tenancy, snapshots e auditoria territorial
src/domain/investment/        governança, readiness, Studio e renderizadores PDF/PPTX
src/application/investment/   casos, rounds, decisões, Data Room e relatórios
src/domain/ai/                contratos, schemas, intent planner, provider e model router
src/application/ai/           context builder, retrieval, ferramentas e orquestração auditável
src/domain/design/            adaptadores, revisão determinística, VE, diff e relatório
src/application/design/       ingestão, tenancy, alternativas, Studio e Data Room
src/infrastructure/storage/   armazenamento privado dos arquivos de design
src/infrastructure/adapters/  portas municipais e fallback manual
src/app/ e src/components/    rotas, actions e interface preservada
```

O Engine v1 continua com as limitações declaradas em `docs/FINANCIAL_ENGINE.md`; a mudança arquitetural não altera suas fórmulas. A política analítica está documentada em `docs/REDE_SCORE_AND_SENSITIVITY.md`, o processo adversarial em `docs/RED_TEAM.md`, o módulo territorial em `docs/LAND_INTELLIGENCE.md`, a Fase 6 em `docs/PHASE_6_STUDIO_COMMITTEE.md`, o REDE AI em `docs/PHASE_7_REDE_AI.md` e a Fase 8 em `docs/PHASE_8_DESIGN_INTELLIGENCE.md`.

Docker não é exigido: neste ambiente ele não estava disponível, então os scripts PowerShell usam a instalação PostgreSQL local sem alterar a instância do sistema. Em ambientes com Docker, basta fornecer qualquer PostgreSQL compatível e apontar `DATABASE_URL`.
