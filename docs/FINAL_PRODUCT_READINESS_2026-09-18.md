# REDE Intelligence — Fechamento das Fases e Prontidão Final

Data: 18/09/2026  
Branch: `codex/final-product-readiness`

## Objetivo

Consolidar o encerramento técnico das fases implementadas da REDE Intelligence, sem declarar como concluído aquilo que depende de credenciais, fornecedores externos, dados de produção ou validação operacional humana fora do repositório.

## Estado das fases

- Fases 0–9S: base funcional, domínios operacionais, governança, encerramento e controles entregues no repositório.
- Fases 10A–10C: AI Gateway, Context Engine e Tool Layer entregues com gates, evidência, RBAC e auditoria.
- Fase 10C.1: operabilidade humana ampliada e fechamento das superfícies que ainda estavam registradas como lacunas.
- Fases 10D–10J: Agent Framework, Red Team 2.0, Decision Engine, Investment Committee, Operator, Autopilot e Learning Loop entregues e conectados ao produto.

## Fechamentos desta rodada

### Governança cognitiva executiva

A linha do tempo cognitiva passou a aparecer também na Gestão Executiva do empreendimento. As rodadas do Comitê Cognitivo, desafios do Red Team, proposta do Decision Engine e decisão humana auditada ficam disponíveis sem depender da conversa do Assistente.

### Jurídico

Foram expostas operações humanas para:

- pedidos documentais;
- achados jurídicos;
- licenças;
- processos administrativos;
- obrigações jurídicas;
- reconhecimento e resolução de alertas;
- transições de estado auditadas.

As mutações permanecem sujeitas a `LEGAL_WRITE` e atos materiais continuam usando `LEGAL_APPROVE`.

### Comercial

Foram expostas operações humanas adicionais para:

- cadastro e bloqueio/desbloqueio de unidades;
- tabelas de preço versionadas e ativação;
- perfil de corretor;
- política e lançamento de comissões;
- vistorias e resultado;
- entrega de unidade sujeita ao gate existente;
- abertura e gestão de pós-venda;
- fornecedor, custo e reincidência de assistência técnica.

### Pessoas

Foram expostas operações humanas adicionais para:

- vínculo profissional;
- alocação no empreendimento;
- centro de custo;
- critério de capacidade;
- custo mensal do vínculo com acesso restrito.

### Contabilidade

Foram expostas operações de governança para:

- estorno de lançamento com segregação;
- reabertura de período com autorização segregada;
- conciliação contábil com evidência.

### Mercado & Produto

As mutações de cenários e registros de mercado agora exigem explicitamente `MARKET_PRODUCT_WRITE`, além da leitura de domínio. A REDE não inventa uma fonte de mercado ao vivo: ingestão externa continua condicionada a um conector ou provedor real.

## Limites externos — não são fases de código pendentes

Os itens abaixo não podem ser encerrados apenas com alterações no repositório e permanecem deliberadamente como ativação de ambiente:

1. **Provider comercial de IA** — exige credencial, política de custo, configuração do ambiente e aceite operacional.
2. **Fontes de mercado ao vivo** — exigem contrato/conector/API real e política de proveniência.
3. **REDE Operator sobre sistemas externos** — exige adapters e autorizações específicas de cada sistema alvo; não deve existir adapter fictício apenas para marcar escopo como concluído.
4. **Learning Loop institucional** — o motor existe; qualidade estatística depende de histórico real de decisões e realizado.
5. **Smoke test de produção** — deve ser executado no ambiente final com usuários e dados autorizados.

## Gate técnico final

O fechamento só pode ser promovido para a branch-base após:

- Prisma validate/generate/migrate/seed;
- TypeScript;
- ESLint;
- suíte Vitest integral;
- build Next.js;
- manifesto de superfícies revisadas coerente;
- nenhuma migration histórica alterada;
- CI integral verde.

## Gate operacional final

Antes de classificar um ambiente como produção operacional:

- criar organização e empreendimento novos com OWNER;
- confirmar VIEWER sem escrita;
- testar isolamento entre tenant e projeto;
- percorrer estudo → obra/suprimentos → financeiro → comercial → jurídico/pessoas → contabilidade → encerramento;
- configurar apenas os providers externos realmente contratados e autorizados;
- registrar qualquer exceção encontrada, sem mascarar ausência de fonte externa como dado integrado.

## Conclusão

Com esta rodada, não resta uma fase numerada de implementação interna conhecida no roadmap atual. O que permanecer após CI verde pertence a **ativação de ambiente, integração externa ou validação operacional com dados reais**, e não deve ser confundido com código ausente.
