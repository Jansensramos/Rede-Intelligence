# Arquitetura

## Decisão

O MVP usa um **monólito modular**. É a menor arquitetura que preserva fronteiras de domínio, auditabilidade e evolução para persistência real sem introduzir microserviços prematuros.

## Stack

- Next.js com App Router, React e TypeScript estrito;
- Decimal.js para dinheiro, taxas e cálculos financeiros;
- Zod para contratos de entrada;
- PostgreSQL e Prisma, com colunas `Decimal`, para a camada de dados;
- Vitest para testes unitários do domínio;
- CSS nativo com design tokens para reduzir dependências cosméticas.

## Camadas

```text
Interface / Server Actions
          ↓
Casos de uso da aplicação
          ↓
Land/Zoning ───→ Engine ───→ Score ───→ Audit Trail
          ↓                         ↘ Red Team
Portas de repositório / municípios / provedores de IA
          ↓
Prisma/PostgreSQL | adaptadores externos
```

`src/domain/financial` não importa React, Next.js, Prisma ou SDK de IA. Recebe um contrato validado e devolve resultados reproduzíveis. A aplicação executa o mesmo motor no cliente para resposta visual e no servidor para persistir o snapshot autoritativo.

## Módulos previstos

- `domain/financial`: fórmulas, cronograma, cenários e auditoria;
- `domain/risk`: regras determinísticas e recomendações iniciais;
- `domain/score`: política de score, dimensões, gates, penalidades e explicabilidade;
- `domain/sensitivity`: variações isoladas, stresses combinados, ranking e break-even;
- `domain/red-team`: Evidence Pack, seis especialistas, proveniência, revisão cruzada, divergências e Chair;
- `domain/land`: geometria, cenários urbanísticos, envelope, produto, massing, solver reverso, gap, uplift e ranking/Pareto;
- `application`: autenticação, autorização multiempresa e transações de estudos;
- `application/land`: versionamento territorial, transações, auditoria e escopo organizacional;
- `infrastructure`: Prisma, repositórios, portas de provedores e adaptadores municipais;
- `app`: apresentação e rotas;
- `components`: componentes visuais sem lógica financeira.

## Fronteira de IA

O REDE Red Team usa a porta `LLMProvider.generateStructured`. O adaptador recebe apenas instruções de sistema, um envelope de evidência não confiável e um schema Zod de saída. O provedor pode interpretar e questionar, mas não altera valores do Engine, Score ou Sensitivity. Uma saída inválida é tentada novamente uma única vez e depois descartada; os especialistas determinísticos e a síntese executiva continuam funcionando.

Documentos do usuário são marcados `USER_UNTRUSTED` e ficam dentro de `<UNTRUSTED_EVIDENCE>`. Referências de evidência são validadas contra o Evidence Pack antes de um achado entrar no relatório. Versão do processo, prompts, modelo, consumo, duração, retentativas e erros ficam registrados.

## Segurança e tenancy

`Organization` é o tenant. A sessão contém usuário e organização, mas o vínculo em `OrganizationMembership` é revalidado antes de produzir o contexto autenticado. Leituras de estudos atravessam `Project.organizationId`; escritas localizam o estudo pelo mesmo escopo antes da transação. Senhas usam bcrypt e tokens opacos de sessão são persistidos apenas como SHA-256. O cookie é `HttpOnly`, `SameSite=Lax` e `Secure` em produção.

## Versionamento e transação

Salvar nunca atualiza premissas antigas. Uma transação serializável incrementa a versão, cria o `DRAFT`, persiste `AssumptionSnapshot` e seus `AssumptionEntry`, política versionada, cenários e somente seus overrides, execuções, métricas extensíveis, séries de caixa, resultados, trilhas, achados e recomendações. Só então a versão transiciona para `SNAPSHOT`. Triggers no PostgreSQL bloqueiam `UPDATE` e `DELETE` do snapshot e de seus artefatos.

Alertas carregam código, severidade, descrição, métrica, valor observado, limite e cenário. Isso preserva a recomendação atual e permite novas políticas sem mover fórmulas para componentes React.

## ADRs resumidos

1. **Decimal em toda a fronteira financeira:** evita erros cumulativos de ponto flutuante.
2. **Engine puro:** fórmulas testáveis e reutilizáveis.
3. **Cenário como conjunto de deltas:** preserva o caso base e torna cada stress explícito.
4. **Score versionado e explicável:** pesos, bandas, gates e penalidades são código de domínio documentado; a interface não inventa ou recalibra critérios.
5. **Curvas mensais explícitas:** resultados agregados sempre derivam do mesmo fluxo que alimenta os gráficos.
6. **Snapshots append-only:** revisão de premissas significa nova versão, nunca sobrescrita.
7. **IA não recalcula o negócio:** saídas generativas só complementam a crítica; números autoritativos continuam vindo dos motores determinísticos.
8. **Fallback seguro:** ausência ou falha do provedor não impede a análise determinística nem produz conteúdo não validado.
9. **Zoneamento atual e hipótese são tipos distintos:** uma simulação nunca substitui silenciosamente a regra legal vigente.
10. **Dado territorial ausente permanece ausente:** restrições e parâmetros sem fonte não são inventados; o domínio reduz confiança e cria avisos.
11. **Uma única verdade econômica:** alternativas territoriais são convertidas em `ProjectAssumptions` e avaliadas pelos mesmos REDE Engine e REDE Score já existentes.
