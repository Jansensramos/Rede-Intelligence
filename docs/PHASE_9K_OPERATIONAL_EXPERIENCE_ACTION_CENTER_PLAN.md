# REDE Intelligence — Plano técnico da Fase 9K

## Experiência Operacional, Central de Ações e Assistente Contextual

**Status:** planejamento apenas. Nenhum código foi escrito, nenhum schema alterado, nenhuma migration criada, nenhum acesso ao PostgreSQL, nenhum commit.

**Base oficial:** `rede-phase-9j-complete-2026-08-24`
**Branch:** `planning/fase-9k-experiencia-operacional`

---

## A. Diagnóstico atual da UI

A investigação do código real (não da documentação) mostra um quadro bem diferente do que os nomes das fases sugerem. As Fases 9A–9J construíram um **domínio e uma camada de aplicação muito maduros** (345 models Prisma, 15 workspaces de módulo, um registro de IA com ~46 ferramentas). A **interface**, no entanto, não acompanhou essa maturidade:

1. **Uma única tela.** `src/app/page.tsx` carrega um único projeto fixo (`START_BUTANTA_PROJECT`, buscado por nome) e dispara `Promise.all` com **15 workspaces inteiros** (`getLatestLandStudyForOrganization`, `ensureDesignWorkspace`, `getAIBootstrap`, `getLatestProjectBudget`, `getOperationsWorkspace`, `getFinancialWorkspace`, `getProcurementWorkspace`, `getLegalWorkspace`, `getSalesWorkspace`, `getPeoplePerformanceWorkspace`, `getAccountingWorkspace`, `getIntegrationsWorkspace`, `getDataIntelligenceWorkspace`, `getMarketProductWorkspace`, `ensureInvestmentCase`) a cada carregamento, para um único componente cliente gigante.
2. **`src/components/intelligence-workspace.tsx` (543 linhas)** é a aplicação inteira: uma sidebar plana com **24 abas (`ViewKey`)** sem hierarquia nenhuma (`overview`, `assumptions`, `land`, `design`, `budget`, `procurement`, `legal`, `financial`, `accounting`, `integrations`, `dataIntelligence`, `marketIntelligence`, `productIntelligence`, `sales`, `people`, `scenarios`, `sensitivity`, `redteam`, `committee`, `studio`, `dataroom`, `ai`, `cashflow`, `risks`, `audit` — linhas 93-119). Não existe nível 2, nível 3, nem agrupamento por área.
3. **Não existe seletor de portfólio real.** O breadcrumb "Portfólio / {projeto}" (linha 301) tem um `ChevronDown` decorativo sem handler — apesar de o domínio já suportar `Organization → EconomicGroup → Company (SPE) → Project` (ver seção AO).
4. **A "Visão executiva" atual (linhas 318-388)** é uma pilha de ~8 tabelas-resumo por módulo (Pessoas, Contabilidade, Integrações, Dados, Mercado, Produto...), sem priorização por exceção, sem "o que mudou", sem severidade. É um dashboard "tudo de uma vez", exatamente o antipadrão que a Fase 9K deve eliminar.
5. **A IA já tem um gancho de contexto de tela**, mas rudimentar: o botão "Explicar esta tela" (linha 302) e o botão da sidebar "Pergunte ao REDE" (linha 293) chamam `openAI(prompt)` (linhas 262-267) com `Explique esta tela: ${view}` — usando a chave interna em inglês (`ViewKey`), não um rótulo em português — e **trocam a tela inteira** para a aba "ai". Não é um assistente flutuante disponível em qualquer lugar; é a 25ª aba plana.
6. **Nenhum destes conceitos existe hoje, em lugar nenhum do código:** Central de Ações, `ActionCenter`, paleta de comandos (Ctrl+K), busca global, onboarding, "o que mudou desde sua última visita".
7. **Tipografia sistematicamente pequena demais** — confirma o problema relatado pelo usuário. Em `src/app/globals.css`: `.table-row span/strong` 9px, `.table-head span` 7px, `.isolated-row` 8px, `.design-diff-table` linhas 7px, `.metric-card small` 8px, `.section-title p` 10px, `.button` 10px, `.sidebar-module small` 9px, `.empty-state` 10px. Só títulos estão em tamanho adequado (`h2` 30px, `.metric-card strong` clamp 20-26px).
8. **Nenhum `<table>` HTML existe no projeto.** Toda "tabela" é uma grade CSS (`.table-row`, `.isolated-row`, `.design-diff-table`, `.scenario-table`) com `grid-template-columns` fixo por tela, sem ocultação de coluna, sem coluna fixa, sem scroll horizontal controlado.
9. **Não existe biblioteca de componentes compartilhada.** `MetricCard` e `SectionTitle` são definidos dentro do próprio `intelligence-workspace.tsx` (linhas 133-149) e não são exportados/reaproveitados pelas 24 views. Cada view (37 a 375 linhas) reimplementa sua própria marcação e classes CSS.
10. **Estados vazios e erros são exceção, não regra.** O padrão `.empty-state` aparece em só 6 dos 24 arquivos (20 ocorrências, concentradas em `integrations-view.tsx` ×7, `product-intelligence-view.tsx` ×6, `investment-suite-view.tsx` ×4). A maioria das views (ex.: `legal-view.tsx`) não tem estado vazio, estado de carregamento nem tratamento de erro algum. Escritas assíncronas (`updateBudgetItem`, `deleteBudgetItem`, linhas 216-237) fazem `throw new Error(...)` sem `catch` visível no ponto de chamada — hoje, um erro técnico provavelmente **chega cru ao operador**.

**Conclusão do diagnóstico:** a 9K não é uma "reorganização" de uma aplicação de múltiplas páginas existente. É, na prática, um trabalho quase greenfield de arquitetura de navegação e design system, construído **sobre** uma base de domínio excepcionalmente rica. Isso muda a estratégia: o risco não está em "onde estão os dados" (eles existem e são muitos), está em não recriar mais uma tela monolítica com um nome bonito.

---

## B. Inventário de navegação

Estado atual: navegação = 1 array (`viewItems`, `intelligence-workspace.tsx:93-119`), 1 nível, 24 itens, sem submenu, sem breadcrumb funcional, sem deep-link por URL (é tudo estado de componente `useState`, não rota Next.js — confirmado pela ausência de subpastas em `src/app/` além de `actions`, `api`, `login`).

Agrupamento natural dos 24 `ViewKey` atuais, por proximidade de domínio (usado na seção E):

| Cluster atual | ViewKeys |
|---|---|
| Viabilidade / Investment Case | `assumptions`, `scenarios`, `sensitivity`, `redteam`, `committee`, `studio`, `dataroom`, `cashflow`, `risks`, `audit` |
| Terreno | `land` |
| Mercado e Produto | `marketIntelligence`, `productIntelligence` |
| Engenharia e Obra | `design`, `budget` (junto de `operations`, hoje sem aba própria — ver nota) |
| Suprimentos | `procurement` |
| Financeiro | `financial` |
| Comercial | `sales` |
| Jurídico | `legal` |
| Pessoas | `people` |
| Contabilidade e Controladoria | `accounting` |
| Integrações | `integrations` |
| Inteligência de Dados | `dataIntelligence` |
| Transversal (deixa de ser aba) | `overview` (vira Visão Executiva), `ai` (vira assistente global) |

Nota: `getOperationsWorkspace` é carregado em `page.tsx` mas **não tem `ViewKey` próprio** — hoje seus dados provavelmente alimentam outra view (cronograma/medições de obra). Ao redesenhar a navegação (F), a equipe de implementação deve confirmar onde `OperationsWorkspaceView` é hoje renderizado antes de decidir seu lugar em "Engenharia e Obra".

---

## C. Inventário de componentes

Sem biblioteca compartilhada hoje. Peças reaproveitáveis existentes, todas locais a `intelligence-workspace.tsx`:

- `MetricCard` (linhas 133-141) — cartão de KPI com label/valor/meta/tom.
- `SectionTitle` (linhas 142-149) — cabeçalho de seção com eyebrow/título/descrição/ação.
- Classes CSS reaproveitáveis mas não componentizadas: `.metric-card`, `.section-title`, `.empty-state`, `.table-row`/`.table-head`, `.button`/`.button-primary`, `.scenario-strip`.

24 views (`src/components/*-view.tsx` + `BudgetEditor.tsx`, `cash-flow-chart.tsx`, `project-editor.tsx`, `score-summary.tsx`, `sensitivity-view.tsx`, `red-team-view.tsx`, `land-massing-canvas.tsx`, `bim-viewer.tsx`, `rede-mark.tsx`) somam ~3.800 linhas, cada uma bespoke. Login (`src/components/auth/login-form.tsx`) usa `useActionState` (padrão React 19) com `.button.button-primary` e `<label><input>` simples, sem componente de formulário compartilhado.

**Decisão de arquitetura para a 9K:** não propor um redesenho visual de todas as 24 views de uma vez (fora de escopo, ver AW). Propor um pequeno conjunto de primitivos (`src/components/ui/`) — `DataTable`, `Card`, `Badge`, `Button`, `Modal`, `Tabs`, `EmptyState`, `ErrorState`, `FormField`, `SeverityPill` — e adotá-los **incrementalmente**, começando pelas telas novas da 9K (Visão Executiva, Central de Ações, Minha Rotina) e pela extração de `MetricCard`/`SectionTitle` para lá. As 24 views legadas migram ao longo de sprints futuras, uma por vez, sem quebrar comportamento.

---

## D. Arquitetura de informação

Três camadas, nesta ordem de prioridade cognitiva:

1. **Transversal (sempre visível):** Visão Executiva, Central de Ações, Minha Rotina, Busca Global (Ctrl+K), Pergunte ao REDE (flutuante). Não competem por espaço com as áreas operacionais — vivem na topbar/chrome, não na lista de "grandes áreas".
2. **Grandes áreas (nível 1):** conjunto fechado e pequeno (seção E), cada uma com identidade visual e ponto de entrada único.
3. **Funções e detalhamento (níveis 2 e 3):** dentro de cada área, replicando a granularidade que os workspaces de domínio já têm (ex.: Jurídico já devolve `alerts`, `obligations`, `licenses`, `timeline` como sub-coleções distintas — isso vira diretamente os itens de nível 2).

Princípio de implementação: nível 1 e 2 devem ser **rotas Next.js reais** (`/executivo`, `/acoes`, `/rotina`, `/financeiro`, `/financeiro/contas-a-pagar`, ...), não estado de componente como hoje. Isso resolve de graça: deep-link, botão voltar do navegador, compartilhamento de link, e permite que o assistente (seção R) navegue de fato ("me leve para X") sem reinventar roteamento.

---

## E. Grandes áreas

Lista fechada, adaptando o exemplo da Fase 9K ao inventário real de módulos (12 áreas operacionais, nenhuma nova — todas já têm workspace de domínio implementado):

1. **Viabilidade** — Engine, Score, Sensibilidade, Red Team, Comitê, Studio, Data Room, Fluxo de caixa, Riscos, Trilha de cálculo.
2. **Terreno** — Land Intelligence / Zoning Lab.
3. **Mercado e Produto** — Inteligência de Mercado, Inteligência de Produto.
4. **Engenharia e Obra** — Cronograma/Operações, Design Intelligence/BIM, Orçamento.
5. **Suprimentos** — Necessidades, Requisições, Cotações, Contratos, Medições, Ordens de Compra.
6. **Financeiro** — Contas a Pagar, Contas a Receber, Bancos, Conciliação, Fluxo de Caixa.
7. **Comercial** — Clientes, Unidades/Estoque, Propostas, Vendas, Recebíveis, Pós-venda.
8. **Jurídico** — Diligência, Obrigações, Licenças, Contratos, Documentos.
9. **Pessoas** — Equipe, Alocação, Eficiência, Causa-raiz, Incentivos.
10. **Contabilidade e Controladoria** — Plano de Contas, Lançamentos, Fechamento, Impostos, Consolidação.
11. **Integrações** — Conectores, Sincronizações, Conflitos, Credenciais.
12. **Inteligência de Dados** — Contratos Analíticos, Métricas, Benchmarks, Qualidade de Dados, Portfólio.

Fora da grade de "grandes áreas" (transversais, seção D): Visão Executiva, Central de Ações, Minha Rotina, REDE AI.

---

## F. Navegação

- **Nível 1:** grade de 12 cards na entrada (após Visão Executiva), ícone + nome + 1 métrica de destaque (ex.: "Jurídico — 3 obrigações vencendo em 14 dias").
- **Nível 2:** sidebar contextual dentro da área, com as funções principais listadas na seção E (mapeadas 1:1 aos sub-blocos que os workspaces de domínio já devolvem — ex.: `getLegalWorkspace` já separa `alerts`/`obligations`/`licenses`/`timeline`).
- **Nível 3:** detalhamento de registro (drawer lateral ou rota `/[area]/[funcao]/[id]`), reaproveitando o padrão de "detalhamento lateral" pedido na seção X (Tabelas).
- Nunca mais que 3 níveis. Se uma tela pedir um 4º nível, ela pertence a outra função de nível 2, não a um submenu mais fundo.
- Cada nível 1/2 é uma rota real (ver D). O componente `IntelligenceWorkspace` de 543 linhas é decomposto em: um shell de navegação (topbar + sidebar contextual) e páginas por rota, cada uma buscando **apenas** o workspace de que precisa — resolve também o problema de performance descrito em AS.

---

## G. Experiência por perfil

Mesma fonte de dados, mesma autorização (RBAC nunca contornado — seção AN), **prioridades e atalhos diferentes** na Visão Executiva e na Central de Ações:

| Perfil | Prioridade na Visão Executiva | Atalhos em destaque |
|---|---|---|
| Diretoria | Exceções críticas, caixa, margem, decisões pendentes de alçada | Central de Ações filtrada em "Decisão" e "Crítico" |
| Financeiro | Vencimentos (AP/AR), conciliação pendente, caixa projetado | Contas a Pagar, Bancos |
| Engenharia | Cronograma, medições pendentes, compras críticas | Suprimentos (medições), Obra |
| Comercial | Funil, estoque, recebíveis, pós-venda aberto | Propostas, Recebíveis |
| Jurídico | Obrigações a vencer, licenças, contratos aguardando decisão | Diligência, Licenças |

Implementação: um `roleDefaults` (mapa `MembershipRole → { pinnedAreas, actionFilters }`) client-side, sem duplicar layout — é o mesmo componente de Central de Ações recebendo um filtro pré-selecionado diferente por papel, ajustável pelo usuário a qualquer momento.

---

## H. Visão Executiva

Substitui integralmente a "overview" atual (kitchen-sink de 8 tabelas empilhadas). Estrutura proposta, de cima para baixo:

1. **Faixa "Desde sua última visita"** (seção J).
2. **Exceções priorizadas** (seção I), não métricas completas — no máximo 5-7 cartões por vez, com link "ver todas".
3. **KPIs essenciais** (caixa, margem, VGV vendido, obra %), reaproveitando `MetricCard`.
4. **Atalho para Central de Ações e Minha Rotina** (contagens, não a lista inteira).

Duas variantes de rota: **Central Corporativa** (`/executivo`, seção AE) e **Central do Empreendimento** (`/executivo/[projectId]`, seção AF) — mesmo layout, escopo de dado diferente.

---

## I. Gestão por Exceção

Taxonomia única de 5 estados, obrigatória em toda superfície nova (Visão Executiva, Central de Ações, Minha Rotina):

`NORMAL` → `ATENÇÃO` → `AÇÃO_NECESSÁRIA` → `DECISÃO` → `CRÍTICO`

**Achado central da investigação:** essa taxonomia **não existe hoje de forma unificada**. Existem pelo menos 4 vocabulários de severidade incompatíveis já implementados:

- `src/domain/financial-ops/engine.ts:135` — `classifyDueSeverity()` → `VERDE`/`AMARELO`/`VERMELHO`.
- `src/application/legal/legal-service.ts` — `legalAlert.status` (`OPEN`/`ACKNOWLEDGED`/`RESOLVED`/`DISMISSED`) + campo `criticality` separado.
- `src/application/integrations/integrations-service.ts` — `uiState` (`CRITICAL`/`ATTENTION`), só 2 níveis, sem "normal" explícito.
- `src/domain/risk/rules.ts:4` — `FindingSeverity` (`critical`/`warning`/`positive`), nível de viabilidade do projeto, não de operação do dia a dia.

Nenhum dos quatro é "errado" — cada um foi desenhado para o problema local do seu módulo. A 9K **não deve substituí-los**. Deve introduzir uma **camada fina de mapeamento** (um `SeverityMapper` por módulo) que traduz cada vocabulário nativo para a taxonomia de 5 estados, só para fins de exibição transversal (Central de Ações, Visão Executiva). O dado de origem e seu vocabulário original continuam existindo e sendo a fonte oficial dentro do módulo.

Mapeamento inicial sugerido (a validar com cada área no detalhamento técnico):

| Taxonomia 9K | financial-ops (`VERDE/AMARELO/VERMELHO`) | legal (`status`+`criticality`) | integrations (`uiState`) | risk (`FindingSeverity`) |
|---|---|---|---|---|
| NORMAL | VERDE | RESOLVED/DISMISSED | (ausente hoje) | positive |
| ATENÇÃO | AMARELO | OPEN + criticality baixa | ATTENTION | warning |
| AÇÃO_NECESSÁRIA | AMARELO vencendo | OPEN + criticality média | ATTENTION recorrente | warning + ação sugerida |
| DECISÃO | — (requer alçada, ver ApprovalPolicy em AN) | OPEN aguardando decisão jurídica | — | — |
| CRÍTICO | VERMELHO | OPEN + criticality alta | CRITICAL | critical |

---

## J. O que Mudou

Faixa "Desde sua última visita..." no topo da Visão Executiva. Fonte determinística, não é a IA que decide o que mudou — a IA apenas **redige a frase**.

Mecanismo: comparar o snapshot dos indicadores-chave (contagens de exceção por severidade, caixa projetado, margem, VGV vendido) entre o `lastSeenAt` do usuário (novo campo, ver AP) e agora, usando os mesmos read models da Central de Ações. Exemplos do briefing (seção 8) viram, tecnicamente:

- "3 novas vendas" → diff de `Sale` criadas desde `lastSeenAt`, filtradas por projeto.
- "margem caiu 0,7 p.p." → diff entre o `FinancialResult` mais recente e o anterior ao `lastSeenAt`.
- "novo boleto de R$ 180 mil" → diff de `PayableInstallment` criadas.
- "obra atrasou 2 dias" → diff de `ScheduleActivity` (baseline vs. atual).
- "licença entra em D-14" → não é diff, é uma regra de janela fixa sobre `LegalLicense.expiresAt` (não depende de `lastSeenAt`, é sempre recalculado).

`lastSeenAt` é armazenado por usuário (não por sessão), para que "desde sua última visita" sobreviva a logout/login. Não requer nova fonte de verdade de negócio — é um carimbo de UX, análogo ao que se propõe para reconhecimento de ações (seção AQ).

---

## K. Central de Ações

Consolidação **transversal** de tudo que exige ação humana, sem duplicar a tarefa original do módulo. Não é uma 25ª aba — é peça de chrome permanente, acessível de qualquer tela, com contador visível (estilo "caixa de entrada").

**Fontes por módulo, já existentes hoje** (não hipotéticas — confirmadas na investigação):

- Legal: `getLegalWorkspace().alerts` (status `OPEN`), `.obligations` (status `OVERDUE`), `.licenses` (por `expiresAt`), `.timeline` (`blocksSchedule`). Já tem `summary.openAlerts/criticalFindings/pendingDocuments/overdueObligations/scheduleBlockers` pronto — **é o módulo mais maduro para servir de referência de implementação**.
- Integrações: `getIntegrationsWorkspace().summary` já devolve `staleInstallations/criticalInstallations/attentionInstallations/openConflicts/pendingQuarantine/unresolvedDeadLetters/expiringCredentials` — segundo módulo mais maduro.
- Financeiro: `overdueItems` (payables/receivables com `id/descrição/fornecedor|cliente/vencimento/saldo`) — existe, mas sem bloco `summary` agregado; a 9K precisa agregá-lo.
- Suprimentos, Comercial: têm enums de status/transição (`SalesUnitStatus`, etc.) mas nenhum array de "pendências" pronto — precisa de projeção nova (não nova fonte, apenas nova leitura sobre `status`/datas já existentes).
- Pessoas, Contabilidade, Operações, Inteligência de Dados, Mercado/Produto: **nenhum conceito de alerta/pendência hoje**. A 9K projeta "precisa de ação" a partir de campos de status e data já existentes (ex.: uma `AccountingPeriod` não fechada após seu prazo) — sem inventar fatos novos.

**Sem duplicar tarefas de módulo (princípio da seção 9):** a Central de Ações nunca é editável diretamente para o fato em si — cada item linka para o registro original (seção L, campo "link para o registro original") onde a ação de fato acontece (aprovar, validar, revisar). A Central de Ações é a lista de leitura + roteamento, não um segundo formulário de aprovação.

---

## L. Contrato de Ação

`Ação Canônica` — contrato de leitura (projeção), não uma nova tabela de fatos de negócio:

```
AcaoCanonica {
  id                string   // determinístico, ver AQ
  organizationId    string
  companyId?        string
  projectId?        string
  origem            string   // ex: "legal.obligation", "financial.payable"
  tipo              string   // ex: "obrigacao_vencendo", "boleto_pendente_validacao"
  titulo            string
  descricao         string
  severidade        "NORMAL" | "ATENCAO" | "ACAO_NECESSARIA" | "DECISAO" | "CRITICO"
  responsavelId?    string
  equipeId?         string
  prazo?            DateTime
  status            "ABERTA" | "RECONHECIDA" | "RESOLVIDA" | "DISPENSADA"
  impacto?          { financeiro?: Decimal, cronograma?: boolean, juridico?: boolean }
  confianca         "ALTA" | "MEDIA" | "BAIXA"   // ver nota abaixo
  linkRegistroOriginal string   // rota interna para o fato real
  evidencia         string[]   // ids/paths do que sustenta o item
  alcada?           { perfilMinimo: MembershipRole, valorLimite?: Decimal }
  acaoSugerida?      string
  criadoEm          DateTime
  resolvidoEm?      DateTime
}
```

Nota sobre `confianca`: itens vindos de status/data explícitos no banco (ex.: `LegalObligation.status = OVERDUE`) têm confiança `ALTA` (fato determinístico). Itens que dependem de inferência (ex.: heurística de materialidade cruzando módulos) devem ser marcados `MEDIA`/`BAIXA` e nunca aparecer como `CRITICO` sem revisão — evita que uma inferência errada vire alarme falso de prioridade máxima.

Campo `alcada` reaproveita, quando aplicável, `ApprovalPolicy`/`ApprovalRequest`/`ApprovalDecisionRecord` — modelos **já existentes** em Suprimentos (`prisma/schema.prisma:5749,5774,5800`) — em vez de inventar um novo conceito de autoridade de aprovação. Ver AN.

---

## M. Minha Rotina

Rota `/rotina`, view pessoal sobre a mesma Central de Ações, filtrada por `responsavelId = usuário atual` OR `equipeId ∈ equipes do usuário`, particionada em:

- **Hoje** — `prazo` = hoje.
- **Atrasadas** — `prazo` < hoje AND `status = ABERTA`.
- **Próximas** — `prazo` nos próximos 7 dias.
- **Aguardando terceiros** — `status = ABERTA` AND responsável ≠ usuário atual, mas usuário é solicitante/interessado.
- **Aguardando minha aprovação** — `alcada.perfilMinimo` compatível com o papel do usuário AND ainda `ABERTA`.
- **Concluídas recentemente** — `status = RESOLVIDA` AND `resolvidoEm` nos últimos 7 dias (depende do log de reconhecimento, ver AQ).

Mesma fonte de dado da Central de Ações — Minha Rotina é um filtro, não uma segunda implementação.

---

## N. Priorização

Motor determinístico (não é a IA que ordena). Score de prioridade combina, com pesos configuráveis por organização (não hardcoded):

- criticidade (peso da severidade mapeada, seção I);
- proximidade do vencimento (dias até/após `prazo`);
- materialidade (`impacto.financeiro`, quando disponível);
- impacto em caixa (cruzamento com fluxo de caixa projetado do módulo Financeiro);
- impacto em cronograma (`impacto.cronograma`);
- risco jurídico (`impacto.juridico`, ou origem = `legal.*`);
- dependências (itens que bloqueiam outros itens, ex. `blocksSchedule` já existe no Jurídico);
- alçada (itens `DECISAO` sobem de prioridade para quem tem a alçada correspondente).

**Papel da IA aqui:** explicar por que um item está no topo ("este item está em Crítico porque vence em 2 dias e bloqueia o cronograma da torre B"), nunca decidir a ordem. Isso é literal ao princípio da seção 12 ("IA explica. Engine prioriza.") e evita que a ordenação da Central de Ações fique não-determinística/não-auditável.

---

## O. Assistente Contextual

Hoje a IA já existe, mas como 25ª aba (`ai`, ocupando a tela inteira). A 9K não recria o motor de IA — ele já tem ~46 ferramentas tipadas `READ_ONLY` no registro (`src/application/ai/tool-registry.ts`) e um roteador de modelo/provedor (`src/domain/ai/router.ts`, `provider.ts`). A mudança é de **superfície**: o assistente passa a ser um painel flutuante (slide-over), acionável de qualquer tela via botão fixo "Pergunte ao REDE" e via Ctrl+K (seção T/22), **sem** navegar para longe da tela atual — diferente do comportamento hoje (`openAI()` troca a `view` inteira).

Reaproveitamento explícito: `AIContextSelection` já existe (`src/domain/ai/types.ts:17-28`) com `currentModule`, `projectId`, `studyId`, `studyVersionId`, `financialScenario`, `urbanScenarioId` — já passa por `context-builder.ts`, `ai-service.ts`, `app/actions/ai.ts`. Isso cobre a maior parte da seção P.

---

## P. Contexto da Tela

Lacuna real identificada: `AIContextSelection` tem granularidade de **módulo**, não de **registro**. Hoje é possível dizer "o usuário está em Jurídico", mas não "o usuário está olhando a obrigação X". O exemplo da seção 14 ("por que essa medição não pode ser aprovada?") exige esse nível.

Extensão mínima proposta (contrato, não implementação): adicionar `recordType?: string` e `recordId?: string` a `AIContextSelection`, populados pela rota/página atual (viável naturalmente após D, quando nível 2/3 vira rota real com `id` na URL). Permissões do usuário e filtros ativos já fluem pelo `requireAuthContext()` existente — não precisam de novo transporte, só precisam ser incluídos no payload que já viaja para `context-builder.ts`.

---

## Q. Ajuda do Sistema

Não depender do modelo "lembrar" como o sistema funciona (princípio da seção 18). O schema já tem os modelos certos para isso — não é preciso criar fonte de dado nova: `AIDocumentChunk`, `AIOrganizationPrompt`, `AISystemPromptVersion`, `AIFavoritePrompt` (todos em `prisma/schema.prisma`, bloco de IA, linhas ~3684-3733). Proposta: usar `AIDocumentChunk` (o pipeline de retrieval que a IA já usa para documentos) para indexar um **conteúdo de ajuda por tela**, versionado, com: descrição, finalidade, campos, regras, ações, erros comuns, permissões, processo relacionado (seção 18) — como se fosse mais um "documento" que o assistente já sabe recuperar, em vez de uma segunda infraestrutura de help paralela.

---

## R. Navegação via IA

"Me leve para o orçamento do START BUTANTÃ" (seção 16). Como a navegação nível 1/2 vira rota real (D), isso deixa de ser um problema de execução arbitrária e vira **resolução de rota + link clicável**. Proposta de contrato: adicionar a `AIAnswer` um campo opcional `navegacaoSugerida?: { area: string; rota: string; entidadeId?: string; rotulo: string }`. O assistente nunca navega sozinho — devolve a sugestão, o usuário clica. Isso é consistente com o restante do produto (nenhuma ação crítica automática) e não exige um novo `AIToolMode` — continua sendo uma ferramenta `READ_ONLY` (resolve nome → rota), só muda o que a resposta carrega.

---

## S. Preparação de Ações

Achado importante: o padrão "IA prepara, humano confirma" (seção 17) **já está parcialmente construído no domínio**, só não está ligado a nada ainda:

- `AIAnswer.pendingAction: { id, actionType, preview }` (`src/domain/ai/types.ts:79`);
- `AIIntentPlan.mutationIntent: { actionType, arguments }` (`types.ts:152`);
- status de resultado de ferramenta `"PENDING_CONFIRMATION"` (`types.ts:91`);
- `AIToolMode = READ_ONLY | SIMULATION | MUTATION` (`types.ts:15`) — hoje todas as ~46 ferramentas amostradas são `READ_ONLY`; nenhuma implementação `MUTATION` foi encontrada.

A 9K **não implementa** nenhuma ferramenta `MUTATION` real (fora de escopo — ver AW, itens "compra automática"/"pagamento automático"). O que a 9K deve planejar é o **contrato de UI** para quando a primeira ferramenta `MUTATION` existir (ex.: "cadastrar nota fiscal", exemplo da seção 17): um painel de revisão que renderiza `pendingAction.preview` de forma genérica (chave/valor + evidências), com dois botões — confirmar (chama a ferramenta em modo `MUTATION`) ou descartar. Não modela a ferramenta em si.

---

## T. Busca Global

Campo único, resultado agrupado por categoria (seção 21): empreendimento, cliente, fornecedor, contrato, unidade, pagamento, documento, processo, orçamento. Fonte: uma função de busca federada que consulta os identificadores textuais já existentes por módulo (`Project.name`, `Customer.name`, `Supplier.name`, `OperationalContract.number`, `SalesUnit.code`, ...) — não é um novo índice de negócio, é uma camada de busca (pode evoluir para Postgres full-text search sobre colunas já existentes; decisão de implementação, não de escopo da 9K).

---

## U. Command Palette (Ctrl+K)

Avaliação, não compromisso de entrega na 9K (seção 22 pede "avaliar"). Interface 100% em português mesmo com atalho técnico `Ctrl+K`. Ações cobertas: abrir área (nível 1), buscar empreendimento (usa T), criar ação (abre formulário de nível 2 relevante), perguntar ao REDE (abre o painel de O). Não é um mecanismo novo de dados — é uma casca de UI sobre D, K e T. Proposto para sprint 9K.5 (seção AU) como "avaliação com protótipo", não como entrega obrigatória de produção.

---

## V. Onboarding

Primeiro acesso: perguntar papel (se ainda não vier de `MembershipRole`/RH), área principal de trabalho, empreendimento(s) de interesse. Usado só para popular `roleDefaults` (seção G) — não bloqueia o uso do sistema, é pulável.

---

## W. Onboarding Contextual

Dica única por tela, na primeira visita daquele usuário àquela tela (ex.: "Esta tela compara movimentações bancárias com obrigações do REDE", ao entrar em Conciliação pela primeira vez). Controle: campo `telasVisitadas: string[]` (ou tabela `UserScreenVisit`) por usuário — não repete depois da primeira vez. Reaproveita a mesma base de conteúdo de Q (Ajuda do Sistema), só muda o gatilho (automático na primeira visita vs. sob demanda via assistente).

---

## X. Design System

Ver inventário completo em C. Decisão: criar `src/components/ui/` com os primitivos listados, **sem reescrever as 24 views legadas na 9K** — a 9J entregou funcionalidade; a 9K entrega a casca nova (Visão Executiva, Central de Ações, Minha Rotina, Busca, Assistente) já com os primitivos, e deixa a migração das 24 views existentes como trabalho incremental de fases seguintes, tela por tela, priorizado pelas mais usadas (telemetria, seção AL, deve informar essa priorização).

---

## Y. Tipografia

Escala mínima proposta (substitui os 7-9px encontrados no diagnóstico A.7):

| Uso | Hoje | Proposto (mínimo) |
|---|---|---|
| Corpo de tabela/dado | 7-9px | 13px |
| Cabeçalho de coluna | 7px | 12px |
| Legenda/meta (`small`) | 8-9px | 12px |
| Botão | 10px | 13px |
| Parágrafo de seção | 10px | 14px |
| Título de seção (`h2`) | 30px | mantém |

Regra: nenhum texto de dado ou ação abaixo de 12px em telas desktop/notebook (prioridade declarada na seção 30). Zoom do navegador não é considerado solução — a escala base muda.

---

## Z. Tabelas

Hoje: zero elementos `<table>`, grids CSS por tela, sem coluna prioritária, sem ocultação configurável, sem coluna fixa, sem scroll horizontal controlado, sem detalhamento lateral padronizado. Proposta: um componente `DataTable` único em `src/components/ui/` com:

- definição de colunas com prioridade (`essential | default | optional`);
- ocultação configurável pelo usuário (persistida em preferência local, não em `localStorage` de negócio — ver restrição do README: "`localStorage` não é usado para dados de negócio", isso é preferência de UI, não dado);
- primeira coluna fixa em scroll horizontal;
- container com `overflow-x` próprio (nunca a página inteira rola horizontalmente);
- clique em linha abre detalhamento lateral (nível 3, seção F) em vez de navegar para longe.

---

## AA. Formulários

Componente `FormField` compartilhado cobrindo: agrupamento lógico por seção, preenchimento automático a partir de contexto já conhecido (organização/projeto/usuário atual), defaults inteligentes, campos dependentes (ex.: fornecedor → contratos daquele fornecedor), validação inline, "salvar rascunho" (reaproveita o padrão já existente de `StudyVersion` em `DRAFT` antes de promover — mesma filosofia, aplicada a formulários operacionais). Sugestão por IA (seção 26) é opt-in, nunca preenche campo sem o usuário ver a sugestão antes de aceitar.

---

## AB. Estados Vazios

Hoje: `.empty-state` existe como classe CSS mas é usado em só 6/24 views. Proposta: componente `EmptyState` obrigatório em toda tela nova da 9K, com 4 elementos fixos: o que é a tela, como criar o primeiro registro, como importar/integrar (link para Integrações), botão "Perguntar ao REDE" pré-preenchido com a pergunta certa para aquele contexto.

---

## AC. Erros

Hoje: escritas assíncronas fazem `throw new Error(...)` sem `catch` visível no ponto de chamada (`intelligence-workspace.tsx:216-237`) — risco real de erro técnico cru chegar ao operador, exatamente o problema que a seção 28 pede para evitar. Proposta: componente `ErrorState`/toast padronizado que traduz qualquer falha em 4 perguntas fixas: o que aconteceu, o que fazer, existe risco, quem pode resolver — mais o botão "Perguntar ao REDE" com o erro técnico anexado como contexto (não exibido cru ao usuário, mas disponível para o assistente explicar). Isso exige também uma correção estrutural: envolver as chamadas de `app/actions/*.ts` em tratamento consistente no client, hoje ausente.

---

## AD. Permissões

RBAC hoje: `MembershipRole { OWNER, ADMIN, ANALYST, REVIEWER, VIEWER }` (`prisma/schema.prisma:10-16`). Ferramentas de IA já declaram `minimumRole` por ferramenta. `RelevantContextPackage.permissions` já tem `{ canRead, canSimulate, canMutate, canViewConfidential }`. Não existe hoje um helper de UI reutilizável tipo `useCapability()`, nem conceito de "alçada" fora de Suprimentos.

Proposta: quando uma ação estiver visível mas bloqueada pelo papel do usuário, nunca escondê-la (princípio da seção 29) — mostrar com um `Badge` de motivo: "Você pode visualizar, mas a aprovação exige perfil Gerente Financeiro" (ou o papel/alçada real aplicável). Isso exige popular `alcada` no contrato de Ação (L) a partir de `ApprovalPolicy` (Suprimentos, já existe) generalizada para outros módulos que ainda não têm política de aprovação formal — trabalho de modelagem a detalhar em implementação, fora do escopo de decisão da 9K além de apontar o reuso.

---

## AE. Responsividade

Desktop é prioridade (declarado na seção 30, e reforçado pelo próprio design atual, que já é desktop-first). Notebook e tablet seguem o mesmo layout com colunas de `DataTable` recolhendo para `essential` primeiro. Mobile não replica funções operacionais complexas — ver AF.

---

## AF. Mobile Executivo

Superfície mobile restrita a: Visão Executiva (leitura), alertas/exceções, aprovações (ação em 1 toque quando dentro da alçada do usuário), consulta (busca global), assistente (O). Formulários operacionais complexos (ex.: lançamento de medição, cadastro de contrato) permanecem desktop-only na 9K — declarar isso explicitamente evita ambição de escopo.

---

## AG. Central Executiva Corporativa

Rota `/executivo`, escopo Organização/Grupo Econômico. Responde (seção 33): quais projetos precisam de atenção, onde a margem piorou, onde o caixa está pressionado, qual obra atrasou, onde vendas estão abaixo, quais decisões aguardam diretoria, quais SPEs (=`Company` com `type=SPE`) apresentam risco. É a Visão Executiva (H) com `projectId` não fixado — agregando todos os projetos visíveis ao usuário.

Alternância Grupo → Empresa → SPE → Empreendimento (seção 31) é possível **sem mudança de schema**: a cadeia `Organization → EconomicGroup → Company (type=SPE é só um valor de `CompanyType`, não um model separado) → Project` já existe em `prisma/schema.prisma:895,1314,1334,1131`. O que falta é 100% UI (um seletor real, substituindo o `ChevronDown` decorativo hoje em `intelligence-workspace.tsx:285-289`).

---

## AH. Central Executiva do Empreendimento

Rota `/executivo/[projectId]`. Responde em segundos (seção 32): vendido, a vender, obra, custo, caixa, margem, prazo, compras críticas, jurídico, riscos, decisões — todos já calculáveis a partir dos workspaces existentes (Sales, Operations/Budget, Financial-ops, Legal, Procurement), sem necessidade de novo modelo de dado.

---

## AI. Resumo de Gestão

Modo de reunião (seção 34): uma view somente-leitura, projetável, que lista só Decisões + Exceções + o que precisa da diretoria hoje — filtrando a Central de Ações por severidade `DECISAO`/`CRITICO`. "5 temas que precisam da diretoria hoje" é literalmente a Central de Ações ordenada pelo motor de priorização (N), truncada em 5, com a narrativa redigida pela IA (não decidida por ela).

---

## AJ. Briefings

Briefing diário/semanal (seção 35): mesmo dado de "O que mudou" (J), em cadência agendada em vez de sob demanda, mais um resumo de caixa/margem/vendas/obra/riscos do período. Determinístico na composição dos fatos; a IA só redige o texto corrido a partir dos fatos já calculados — nunca inventa um fato que não veio do read model.

---

## AK. Integrações e Adoção

Cada dado exibido na UI que vier de um conector externo carrega uma etiqueta de proveniência: "Fonte: Sienge — atualizado há 3 minutos" ou "Fonte Oficial: REDE" (seção 36). Isso já é parcialmente suportado pelo domínio: `getIntegrationsWorkspace()` já expõe `installations`/`healthSnapshots` com estado por conector, e o schema já tem `ExternalEntityReference`/`DataOwnershipPolicy` (`prisma/schema.prisma`, bloco de integrações) — a etiqueta de proveniência na UI é uma leitura desses campos já existentes, não uma nova fonte.

---

## AL. Central de Integrações Simplificada

A Central técnica da 9H (`getIntegrationsWorkspace().summary`: `staleInstallations`, `criticalInstallations`, `attentionInstallations`, `openConflicts`, `pendingQuarantine`, `unresolvedDeadLetters`, `expiringCredentials`) já tem exatamente os campos certos para a visão amigável pedida na seção 38. A 9K não precisa de nova agregação — precisa de uma segunda renderização, mais simples (conectado/atenção/desconectado, última atualização, dados recebidos, pendências), reservando o detalhamento técnico (jobs, cursores, circuit breaker) para uma visão "Avançado" restrita a Admin/Owner (`minimumRole` já suporta esse corte).

---

## AM. Migração Progressiva

Não existe hoje nenhum conceito de "maturidade por domínio" (sistema externo ainda ativo → REDE lê → REDE compara → REDE opera → sistema externo desativado). Proposta: um campo leve por par (organização, domínio funcional) — ex. `DomainAdoptionStage` com valores `EXTERNO_APENAS | REDE_LE | REDE_COMPARA | REDE_OPERA | REDE_NATIVO` — exibido na Central de Integrações Simplificada (AL) e usado para adaptar mensagens da UI (ex.: "Contas a Pagar: REDE já opera nativamente" vs. "Contas a Pagar: REDE ainda só lê do Sienge"). É um novo conceito pequeno, não uma nova fonte de fato de negócio; fica registrado aqui como contrato para implementação futura, não implementado na 9K (ver AW).

---

## AN. RBAC

Ver AD. Resumo do estado real: 5 papéis (`MembershipRole`), sem hierarquia de alçada cross-módulo hoje, exceto em Suprimentos (`ApprovalPolicy`/`ApprovalRequest`/`ApprovalDecisionRecord`, já existentes). A 9K deve generalizar o **padrão** de alçada de Suprimentos como referência para o campo `alcada` do Contrato de Ação (L), sem duplicar os modelos de Suprimentos — outros módulos que ainda não têm política de aprovação formal continuam sem alçada até serem modelados (não é bloqueador para a 9K: o campo é opcional no contrato).

---

## AO. Multi-tenancy

Confirmado: `Organization` (`prisma/schema.prisma:895`) → `EconomicGroup` (`:1314`) → `Company` (`:1334`, `type: CompanyType` inclui `SPE` como valor de enum, não model separado) → `Project` (`:1131`, `companyId` opcional). A hierarquia "Grupo → Empresa → SPE → Empreendimento" pedida na seção 31 **já é a realidade do dado** — zero mudança de schema necessária. Toda navegação nova (D, F, AG) deve filtrar estritamente por essa cadeia, nunca contornando `organizationId` (o mesmo padrão de isolamento já usado em todo o domínio, conforme README).

---

## AP. Dados / Read Models

Central de Ações, Visão Executiva e Assistente são **read models derivados**, não novas tabelas de fato de negócio (princípio da seção 43, reforçado pela investigação: Legal e Integrações já provam que dá para montar um `summary` agregado por cima de dados existentes, sem duplicar nada). Exceção mínima e deliberada: dois metadados de UX, não de negócio (ver AQ) — `lastSeenAt` por usuário (seção J) e um log de reconhecimento de ação (seção AQ). Nenhum dos dois duplica AP, compras, contratos, medições, jurídico, venda ou orçamento — ambos apontam para eles.

---

## AQ. Idempotência

Resposta à pergunta aberta da seção 44 ("read model derivado, entidade persistida, ou combinação"): **combinação, deliberadamente mínima.**

- A **lista de ações em si** é sempre computada (read model), nunca persistida como cópia — uma obrigação vencida não pode gerar 50 ações duplicadas porque ela nunca é "gerada": o `id` da `AcaoCanonica` é determinístico, derivado de `(organizationId, origem, tipo, id-do-registro-original[, período/competência quando o item for recorrente])`. Recalcular o read model duas vezes produz o mesmo `id` — não há criação, só leitura.
- O que **precisa** de persistência é a camada fina de anotação do usuário sobre essa leitura: reconhecimento e resolução manual. Um item pode "sumir" da lista de leitura porque o fato de origem mudou (ex.: pagamento efetuado) — mas o usuário pode querer ver "eu resolvi isso ontem" mesmo que o item natural já não apareça mais. Proposta: uma tabela append-only `AcaoReconhecimento { acaoCanonicaId, organizationId, userId, tipo: "RECONHECIDA"|"DISPENSADA"|"RESOLVIDA_MANUALMENTE", criadoEm, observacao? }`. Ela nunca é a fonte do fato — é só a trilha de "alguém olhou para isso". `Minha Rotina → Concluídas recentemente` (M) consulta essa tabela, não recalcula o fato original.

Isso é a única adição de persistência sugerida por este plano, e é explicitamente de UX, não de negócio.

---

## AR. REDE AI

Resumo de reuso (ver O, P, Q, R, S para detalhe): a 9K **não constrói um novo motor de IA**. Reaproveita o registro de ~46 ferramentas `READ_ONLY`, o roteador de modelo/provedor, o `AIContextSelection`, o padrão `pendingAction`/`mutationIntent`/`PENDING_CONFIRMATION` já modelado, e os modelos `AIDocumentChunk`/`AIOrganizationPrompt`/`AISystemPromptVersion` para conteúdo de ajuda. As mudanças da 9K no domínio de IA são **de superfície e de contrato**, não de motor: virar painel flutuante, ganhar `recordId`/`recordType` no contexto, ganhar `navegacaoSugerida` na resposta. Nenhuma ferramenta `MUTATION` é implementada nesta fase.

---

## AS. Performance

Risco concreto identificado no diagnóstico (A.1): hoje **todo** carregamento da aplicação dispara `Promise.all` com 15 workspaces inteiros para um único projeto fixo. Ao introduzir navegação real por rota (D, F), isso deve necessariamente ser desfeito — cada rota de nível 1/2 busca só o workspace de que precisa, via server component próprio. Sem essa mudança, adicionar Visão Executiva + Central de Ações como novas superfícies **pioraria** a performance (mais uma agregação por cima de um bootstrap já pesado), o oposto do objetivo da fase. Esta é uma dependência técnica dura da 9K, não opcional.

---

## AT. Testes

Estratégia recomendada para a implementação (fora do escopo desta fase de planejamento executar, mas necessária de registrar):

- teste unitário por `SeverityMapper` de módulo (I) — garante que a tradução para a taxonomia de 5 estados não diverge silenciosamente do vocabulário nativo quando este mudar;
- teste de idempotência do `id` da `AcaoCanonica` (AQ) — mesmo fato, computado duas vezes, mesmo id;
- teste de fronteira de RBAC nas novas superfícies (AN) — usando os mesmos padrões de teste de `requireAuthContext` já existentes no projeto (`vitest.config.ts`, testes de integração citados no README);
- teste de "5 minutos" (AU/AV) como script de aceitação manual, não automatizável por natureza, mas documentado como checklist formal.

---

## AU. Sprints

Adaptando a sugestão da seção 50 ao que a investigação real mostrou (a 9K.0 precisa ser maior do que "inventário" porque a navegação por rota é pré-requisito estrutural, não polimento):

- **9K.0 — Fundação técnica.** Extrair `MetricCard`/`SectionTitle` para `src/components/ui/`; criar `DataTable`, `EmptyState`, `ErrorState`, `Badge`/`SeverityPill`, `FormField`; decompor `intelligence-workspace.tsx` em shell de navegação + rotas Next.js reais (D); corrigir escala tipográfica (Y) nos primitivos novos.
- **9K.1 — Navegação por Grandes Áreas.** Implementar as 12 áreas (E) como rotas nível 1/2, migrando o roteamento dos 24 `ViewKey` para as novas rotas sem alterar o conteúdo de cada view ainda.
- **9K.2 — Nova Visão Executiva.** Substituir a "overview" atual; implementar `SeverityMapper` por módulo (I); Central Executiva Corporativa e do Empreendimento (AG/AH); "O que mudou" (J) com `lastSeenAt`.
- **9K.3 — Central de Ações / Minha Rotina.** Read model agregador (K), Contrato de Ação (L), motor de priorização (N), `AcaoReconhecimento` (AQ), Minha Rotina (M).
- **9K.4 — Assistente Contextual / Ajuda.** Painel flutuante (O), extensão de contexto por registro (P), `navegacaoSugerida` (R), indexação de conteúdo de ajuda via `AIDocumentChunk` (Q).
- **9K.5 — Busca / Onboarding / Command Palette.** Busca global (T), onboarding progressivo e contextual (V/W), protótipo avaliativo de Ctrl+K (U).
- **9K.6 — Responsividade / Acessibilidade.** Mobile executivo (AF), acessibilidade (seção 40), migração incremental de mais views legadas para os primitivos de X/Y/Z.
- **9K.7 — QA / Teste de Adoção.** Execução formal do Teste de 5 Minutos (AV) com usuários reais de cada perfil (G); telemetria de UX inicial (seção 41) instrumentada nas novas superfícies.

---

## AV. Critérios de Aceite

1. **Teste de 5 minutos** (seção 42), literal: um usuário novo, sem treinamento extenso, consegue (a) achar o resultado de um empreendimento; (b) ver contas a pagar da semana; (c) localizar um contrato; (d) identificar uma pendência jurídica; (e) verificar uma venda; (f) perguntar ao REDE como fazer algo. Falha em qualquer item = UX reprovada, mesmo que o código funcione.
2. Nenhuma nova fonte de verdade de negócio foi criada (AP) — apenas as duas anotações de UX (AQ).
3. RBAC nunca contornado por atalho de UI (AN/AD).
4. Nenhuma ação crítica (mutação) executada automaticamente pelo assistente (S, R).
5. Interface 100% em português, inclusive nos rótulos técnicos citados na seção 45.
6. Performance de carregamento inicial não piora em relação ao estado atual (AS) — idealmente melhora, por deixar de buscar 15 workspaces de uma vez.
7. Nenhuma tabela renderiza abaixo de 12px (Y) nas superfícies novas da 9K.
8. `lint`, `typecheck`, `test`, `build` passam (mesmo padrão de todas as fases anteriores, conforme README).

---

## AW. Não Escopo

Repetindo integralmente a seção 47, sem ambiguidade: não implementar nesta fase — Open Finance real, DDA real, pagamento automático, compra automática, worker de automação de obra completo, Funding, Engenharia AI completa, Market Timing. Adicionalmente, reforçando as restrições operacionais desta fase de planejamento: nenhuma alteração em `schema.prisma`, nenhuma migration, nenhum acesso/alteração ao PostgreSQL, nenhuma cópia de `.env`, nenhuma execução de seed, nenhum commit/push/tag. Nenhuma reescrita das 24 views legadas dentro da 9K (migração incremental fica para fases seguintes, priorizada por telemetria). Nenhuma ferramenta de IA em modo `MUTATION` implementada.

---

## AX. Relação com Operação Viva

A Central de Ações (K) é o destino natural, já desenhado por contrato (L), para os eventos que a fase seguinte — Operação Viva e Automação (seção 46) — vai passar a emitir: banco, DDA, obra, compra, medição, licença, CRM, contratos. Como a `AcaoCanonica` já é uma projeção com `origem` e `tipo` abertos, novas origens (ex. `origem: "banco.dda"`) se encaixam sem mudança de contrato — só um novo `SeverityMapper` e uma nova regra de projeção. Isso é o motivo pelo qual a 9K prioriza construir o contrato certo agora, mesmo sem esses eventos existirem ainda.

---

## AY. Riscos

1. **Risco de virar a 25ª aba.** Se Central de Ações/Visão Executiva/Assistente não forem implementados como chrome transversal de verdade (D), a 9K corre o risco de só adicionar mais itens à lista plana que já existe hoje — repetindo o problema diagnosticado em A, não resolvendo.
2. **Risco de divergência de severidade.** Os 4 vocabulários de severidade (I) evoluem independentemente por módulo; sem teste automatizado do `SeverityMapper` (AT), a Central de Ações pode silenciosamente parar de refletir a realidade de um módulo específico.
3. **Risco de expectativa de IA além do implementado.** Como o padrão `pendingAction`/`mutationIntent` já existe no domínio (S), há risco de a equipe de implementação assumir que "só falta UI" quando na verdade nenhuma ferramenta `MUTATION` real existe — a 9K deve deixar isso explícito para não gerar promessa de produto não cumprida.
4. **Risco de performance regressiva.** Se a decomposição de `page.tsx`/`intelligence-workspace.tsx` (AS) não acontecer junto com a navegação nova, o sistema fica mais lento, não mais simples de operar — o oposto do objetivo central da fase.
5. **Risco de escopo de alçada incompleto.** Só Suprimentos tem `ApprovalPolicy` hoje (AN); generalizar o campo `alcada` do Contrato de Ação para outros módulos sem essa política formal exige decisão de negócio (quem aprova o quê), não é uma decisão técnica que a 9K pode resolver sozinha.

---

## AZ. Evolução

Esta fase organiza experiência e contratos; não os esgota. Evoluções esperadas em fases seguintes, fora do escopo de decisão aqui, mas habilitadas pelo que este plano define:

- expansão do Contrato de Ação (L) para novas origens quando a Operação Viva (AX) entrar em produção;
- primeira ferramenta de IA em modo `MUTATION` real, usando o contrato de preparação já existente (S);
- migração incremental das 24 views legadas para os primitivos de design system (X), priorizada por telemetria de uso (seção 41, AU/9K.7);
- generalização de `ApprovalPolicy` (hoje só em Suprimentos) para os demais módulos, à medida que cada um definir sua própria política de alçada;
- amadurecimento do `DomainAdoptionStage` (AM) de conceito estático para indicador vivo, alimentado por telemetria de uso real de cada sistema paralelo.

---

## Relatório de entrega

**Diagnóstico:** a plataforma tem um domínio excepcionalmente maduro (345 models Prisma, 15 workspaces, ~46 ferramentas de IA) atrás de uma interface que é, hoje, uma única tela com 24 abas planas, projeto fixo, tipografia sistematicamente pequena (7-10px), zero componentes de tabela reutilizáveis, estados vazios/erros tratados em só 1/4 das views, e nenhum dos mecanismos centrais que a 9K pede (Central de Ações, Visão Executiva por exceção, assistente flutuante, busca global, onboarding) — todos inexistentes no código atual, apesar de o README sugerir uma experiência mais avançada.

**Principais problemas atuais:** navegação sem hierarquia; ausência de multi-projeto na UI apesar do domínio já suportar Grupo→Empresa→SPE→Empreendimento; bootstrap de página que busca 15 workspaces de uma vez; 4 vocabulários de severidade incompatíveis sem camada de tradução; assistente de IA preso como aba, sem contexto de registro; nenhuma trilha de reconhecimento/resolução de pendências.

**Arquitetura proposta:** navegação em 3 níveis por rota real (12 grandes áreas), com Visão Executiva, Central de Ações, Minha Rotina, Busca Global e Assistente como chrome transversal, não como abas. Central de Ações e Visão Executiva são **read models** sobre os workspaces de módulo já existentes, nunca uma nova fonte de verdade.

**Componentes reutilizáveis:** `MetricCard`, `SectionTitle` (a extrair de `intelligence-workspace.tsx`), classes `.empty-state`/`.metric-card` existentes, os 46 ferramentas de IA, `AIContextSelection`, o padrão `pendingAction`/`mutationIntent`, `AIDocumentChunk` para conteúdo de ajuda, `ApprovalPolicy` de Suprimentos como referência de alçada, `getLegalWorkspace`/`getIntegrationsWorkspace` como referência de `summary` agregado.

**Componentes novos:** `DataTable`, `EmptyState`, `ErrorState`, `Badge`/`SeverityPill`, `FormField`, shell de navegação por rota, painel flutuante de assistente, command palette (avaliação).

**Modelos/read models propostos:** nenhuma nova fonte de fato de negócio. Duas adições mínimas de UX: `lastSeenAt` por usuário (seção J) e `AcaoReconhecimento` (log append-only de reconhecimento/resolução manual, seção AQ). Um conceito futuro registrado mas não implementado: `DomainAdoptionStage` (AM).

**Estratégia da Central de Ações:** read model derivado, com `SeverityMapper` por módulo traduzindo os 4 vocabulários de severidade nativos existentes para a taxonomia de 5 estados; idempotência via `id` determinístico; nunca duplica o fato original, sempre linka para ele.

**Arquitetura do assistente contextual:** reaproveita 100% do motor de IA já construído (ferramentas, roteador, contexto, padrão de preparação de ação); muda de aba fixa para painel flutuante; ganha granularidade de registro no contexto; ganha sugestão de navegação clicável; nenhuma mutação automática.

**Navegação proposta:** 3 níveis, rotas reais, 12 grandes áreas fechadas, chrome transversal para os mecanismos centrais da fase.

**Estratégia de adoção:** sistemas externos continuam ativos; REDE consolida leitura primeiro (reaproveitando a Central de Integrações da 9H); migração de domínio por domínio registrada via `DomainAdoptionStage`; nenhuma imposição, só preferência por confiabilidade demonstrada.

**Sprints:** 9K.0 (fundação técnica e rotas) a 9K.7 (QA e teste de adoção), 8 sprints, detalhadas em AU.

**Riscos:** virar mais uma aba plana se o chrome transversal não for real; divergência silenciosa de severidade sem testes; expectativa de mutação por IA além do implementado; regressão de performance se o bootstrap monolítico não for desmontado junto com a navegação; alçada incompleta fora de Suprimentos.

**Critérios de aceite:** Teste de 5 Minutos (AV.1) como critério formal e literal de sucesso da fase, mais os 7 critérios técnicos/de escopo listados em AV.

Fim do plano. Nenhuma implementação foi realizada.
