# Roadmap — REDE Intelligence

Atualizado em 18/09/2026.

## Estado consolidado

| Fase | Escopo | Estado |
| --- | --- | --- |
| 0–8 | Fundação, Engine, inteligência imobiliária, Studio, dados e BIM/Design | Concluído no código |
| 9A–9S | Operação empresarial, financeiro, suprimentos, jurídico, comercial, pessoas, contabilidade, integrações, produção, entrega e encerramento | Concluído no código |
| 10A | AI Gateway | Concluído |
| 10B | Context Engine | Concluído |
| 10C | Tool Layer | Concluído |
| 10C.1 | Operabilidade humana transversal | Fechamento técnico em validação final |
| 10D | Agent Framework | Concluído |
| 10E | Red Team 2.0 | Concluído |
| 10F | Decision Engine | Concluído |
| 10G | Investment Committee | Concluído |
| 10H | REDE Operator | Framework concluído; adapters externos dependem dos sistemas alvo |
| 10I | Autopilot | Concluído em modos seguros OFF/ADVISORY/ASSISTED |
| 10J | Learning Loop | Motor concluído; maturação depende de histórico real |

## Fechamento da 10C.1

A rodada final fecha as lacunas de superfície que ainda estavam registradas:

- governança cognitiva visível na Gestão Executiva;
- jurídico especializado;
- estoque, preço, comissão, vistoria e pós-venda comercial;
- vínculos, alocações e custos de pessoas;
- estorno, reabertura e conciliação contábil;
- gate explícito de escrita em Mercado & Produto.

O fechamento técnico está condicionado ao CI integral verde e aos gates descritos em
`docs/FINAL_PRODUCT_READINESS_2026-09-18.md`.

## Próxima etapa após o fechamento das fases

Não há nova fase numerada interna definida neste roadmap. O próximo ciclo é de **ativação de produção e evolução baseada em uso real**, incluindo:

- configurar provider comercial de IA quando houver credenciais e política de custo aprovadas;
- conectar fontes de mercado contratadas;
- criar adapters do REDE Operator somente para sistemas externos reais e autorizados;
- executar smoke test em ambiente final;
- acumular previsto × realizado e decisões para maturar o Learning Loop;
- priorizar novas capacidades a partir de operação real, não por expansão artificial de escopo.

## Gates permanentes de qualidade

Nenhum incremento é promovido quando:

- fórmulas críticas não possuem testes;
- evidência e snapshot não são rastreáveis;
- premissa, cálculo e inferência não estão distinguidos;
- uma mutação material contorna RBAC, segregação ou auditoria;
- dado externo é apresentado como integrado sem fonte real;
- uma automação executa ato material sem a aprovação exigida pelo domínio.
