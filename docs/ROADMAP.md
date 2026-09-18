# Roadmap — REDE Intelligence

Atualizado em 18/09/2026.

## Estado da linha principal

A linha numerada de produto está implementada até a Fase 10J.

- Fases 0–8: fundação, engine, produto, studio, dados, design/BIM e REDE AI.
- Fases 9A–9S: operação empresarial completa da incorporação, endurecimento, integrações, repasse/chaves/assistência e encerramento.
- Fases 10A–10C: AI Gateway, Context Engine e Tool Layer auditados.
- Fase 10C.1: operabilidade humana transversal.
- Fases 10D–10J: Agent Framework, Red Team 2.0, Decision Engine, Investment Committee, REDE Operator, Autopilot e Learning Loop.

## Fechamento de produto

A evolução atual não abre uma nova fase estrutural. O objetivo é concluir a integração e o aceite operacional do que já foi implementado.

### Integração cognitiva

Fluxo implementado:

`REDE AI → Tool Layer → agentes → Red Team → Decision Engine → Comitê → decisão humana → histórico → Gestão Executiva → Learning Loop`.

### Aceite operacional

O ambiente só deve ser marcado como produção integral depois de validar, com dados reais:

1. organização e empreendimento sem seed de negócio;
2. matriz OWNER/ADMIN/ANALYST/REVIEWER/VIEWER;
3. isolamento organization/project;
4. jornada ponta a ponta de incorporação;
5. decisão cognitiva auditável;
6. previsto × realizado suficiente para o Learning Loop;
7. conectores e provider reais, quando as respectivas credenciais existirem;
8. CI oficial completo verde.

## Dependências de ambiente

Não são tratadas como código faltante e não devem ser simuladas:

- credencial/configuração de provider comercial de IA;
- credenciais e instalação de conectores externos;
- fontes reais de mercado;
- histórico real previsto × realizado;
- evidências reais necessárias ao encerramento.

## Próximas evoluções após o fechamento

Depois do aceite operacional, novos trabalhos devem ser tratados como evolução de produto, e não como “fase faltante” da linha atual. Exemplos:

- ampliar conectores por fornecedor;
- enriquecer superfícies especializadas de Jurídico, Comercial, Pessoas e Contabilidade conforme demanda real;
- calibrar REDE Score e políticas com histórico;
- evoluir Autopilot de ADVISORY para ASSISTED apenas onde houver adapter seguro e aprovação humana;
- expandir Learning Loop com histórico real multiempreendimento.

## Gates permanentes

Nenhuma evolução pode quebrar:

- evidência antes de conclusão;
- rastreabilidade;
- isolamento multi-tenant;
- RBAC;
- Tool Layer como choke point cognitivo;
- aprovação humana de mutações materiais;
- ausência de dados inventados;
- testes, lint, typecheck, Prisma e build verdes.
