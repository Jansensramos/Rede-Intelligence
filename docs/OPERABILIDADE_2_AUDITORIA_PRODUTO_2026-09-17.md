# REDE Intelligence — Operabilidade 2.0

Data: 17/09/2026
Branch de trabalho: `codex/operabilidade-2-profissional`
Base: `codex/fase-10c1-operabilidade-humana`

## Objetivo

Transformar a camada operacional existente em uma experiência profissional de uso diário para incorporadoras e construtoras, preservando os domínios, regras de aprovação, trilha de auditoria e integração financeira já implementados.

O critério de sucesso deixa de ser apenas "a mutation existe" e passa a ser: o usuário consegue iniciar, revisar, aprovar, documentar, acompanhar e concluir a operação pela interface sem depender de `prompt()`, seed, atalhos técnicos ou conhecimento do roadmap interno.

## Princípio operacional

Toda operação material deve seguir uma cadeia rastreável:

**origem → solicitação/proposta → aprovação → documento/compromisso → execução → medição/recebível → financeiro → realizado → impacto → decisão**

Para custos e contratação, a visão executiva desejada é:

**Orçado → Cotado → Contratado → Autorizado → Medido → A pagar → Pago → Saldo**

Para vendas:

**Unidade → Tabela → Proposta → Reserva → Venda → Contrato → Recebíveis → Recebido → Saldo do cliente**

## Auditoria inicial

| Área / fluxo | Backend transacional | Operação humana atual | Jornada ponta a ponta | Lacuna principal para apresentação/produção |
| --- | --- | --- | --- | --- |
| Comercial — cliente/lead | Existe | Existe, mas baseada em `prompt()` | Parcial | Formulários profissionais, validação, edição, busca e ficha 360 |
| Comercial — proposta/reserva | Existe | Existe, mas baseada em `prompt()` | Parcial | Tela dedicada, condições comerciais estruturadas, histórico e aprovação |
| Comercial — venda | Existe | Existe | Parcial | Wizard de venda, múltiplos compradores, comissões, documentos e plano financeiro |
| Comercial — contrato de venda | Estrutura básica existe | Aprovação cria contrato mínimo | Não adequada para operação real | Contrato completo, parcelas, índices, documentos, versões, geração de documento e assinatura/integrador |
| Comercial — recebíveis | Existe | Gerado na aprovação | Parcial | Recebíveis derivados do plano financeiro real da venda, não de parcela única genérica |
| Suprimentos — necessidade | Existe | Existe | Sim, em nível básico | UX, filtros, anexos, vínculo orçamentário e centro de custo |
| Suprimentos — requisição | Existe | Existe | Sim, em nível básico | Tela/listagem dedicada, aprovação mais legível e histórico |
| Suprimentos — cotação/propostas | Existe | Existe | Sim, em nível básico | Mapa comparativo profissional, equalização, anexos e trilha de negociação |
| Suprimentos — pedido de compra | Existe | Existe | Parcial | Tela própria, documento numerado/imprimível, recebimento e saldo do pedido |
| Contratos de fornecedores | Existe | Existe | Parcial | Visão contratual 360: valor original, aditivos, medido, pago, saldo, prazo e documentos |
| Aditivos | Existe | Existe | Parcial | Evidências, aprovação, impacto em orçamento/prazo/caixa e documento do aditivo |
| Ordem de Serviço | Não identificada como entidade/fluxo explícito | Não identificada | Não | Criar domínio de OS vinculado a contrato, orçamento, frente de serviço e medições |
| Medições | Existe | Existe | Parcialmente integrada ao Financeiro | OS, acumulados, saldo contratual, evidências, anexos, fluxo engenharia→gestão→financeiro e NF |
| Financeiro — obrigação de medição | Existe | Existe via aprovação | Integrada | Tornar origem e rastreabilidade mais claras na UI |
| Engenharia — orçamento oficial | Existe | Operabilidade ampliada em 10C.1 | Parcial | Garantir vínculo explícito com contratado, OS, medido, realizado e desvios |
| Executivo/Decisão | Existe | Predominantemente leitura e aprovação | Parcial | Mostrar causas e efeitos operacionais sem duplicar fonte de verdade |
| Documentos operacionais | Há estruturas documentais em partes do sistema | Não padronizado para PC/OS/contrato/medição | Não | Motor de templates, numeração, versão, visualização, PDF e anexos |
| Design system operacional | CSS/componentes existentes | Inconsistente em telas operacionais novas | Não | Padronizar tipografia, espaçamento, formulários, tabelas, drawers, modais e estados |

## Gap prioritário: Contrato de venda

A venda deve deixar de ser um lançamento simples e passar a possuir uma ficha transacional completa.

### Dados mínimos

- empreendimento, torre/bloco e unidade;
- tabela vigente e preço de tabela;
- comprador(es), CPF/CNPJ, contatos e participação percentual;
- preço negociado, desconto, incentivo e condição especial;
- corretor/imobiliária e comissão;
- origem/canal da venda;
- entrada/sinal;
- parcelas mensais;
- parcelas intermediárias;
- parcela de chaves;
- financiamento/repasse;
- índice de correção e regra de atualização;
- vencimentos;
- observações e condições particulares;
- documentos/anexos;
- responsáveis e aprovações.

### Saídas

- venda registrada;
- snapshot da condição comercial;
- contrato numerado e versionado;
- plano financeiro;
- contas a receber/recebíveis;
- comissão/obrigação quando aplicável;
- documento de contrato visualizável e exportável;
- histórico de alterações e aprovações.

## Gap prioritário: Ordem de Serviço

Criar entidade operacional própria, sem usar contrato como substituto da OS.

### Campos mínimos

- número da OS;
- contrato de origem;
- fornecedor;
- empreendimento/SPE;
- centro de custo;
- orçamento/linha orçamentária;
- torre/bloco/frente de serviço;
- título e escopo;
- itens, unidade, quantidade e preço;
- valor autorizado;
- data de emissão;
- início planejado;
- prazo/fim previsto;
- responsável técnico/gestor;
- retenções/garantias aplicáveis;
- anexos e observações;
- status.

### Estados mínimos

`DRAFT → UNDER_REVIEW → IN_APPROVAL → APPROVED → ISSUED → IN_EXECUTION → COMPLETED → CLOSED`

Estados excepcionais: `SUSPENDED`, `CANCELLED`.

### Regras

- OS não pode autorizar quantidade/valor acima do saldo contratual sem alçada/aditivo;
- medição deve poder referenciar uma ou mais OS;
- aprovação da OS aumenta o valor autorizado, não o pago;
- a OS deve ser visível no contrato e na obra;
- cancelamento deve preservar histórico e liberar saldo autorizado ainda não executado conforme regra de domínio.

## Gap prioritário: Medições 2.0

A medição precisa apresentar, por item:

- quantidade contratada;
- quantidade autorizada por OS;
- quantidade medida anteriormente;
- quantidade do período;
- quantidade acumulada;
- saldo físico;
- preço unitário;
- valor anterior;
- valor do período;
- valor acumulado;
- saldo financeiro;
- retenção;
- descontos;
- amortização de adiantamento;
- percentual físico.

A medição deve aceitar evidências/anexos, responsável pela medição, comentário técnico, vínculo com OS e eventual documento fiscal. O fluxo alvo é:

**Rascunho → Enviada → Revisão técnica → Aprovada tecnicamente → Aprovação gerencial → Aprovada → Obrigação financeira**.

## Gap prioritário: Pedido de compra

O pedido deve possuir uma superfície dedicada com:

- número e status;
- fornecedor;
- SPE/empresa;
- empreendimento;
- origem da cotação;
- centro de custo e vínculo orçamentário;
- itens, quantidades e preços;
- impostos/frete/descontos quando aplicáveis;
- total;
- prazo/local de entrega;
- condições de pagamento;
- aprovadores;
- recebimentos parciais/total;
- saldo em aberto;
- anexos;
- documento imprimível/exportável.

## Contratos 360

Cada contrato operacional deve exibir em uma única visão:

- valor original;
- total de aditivos aprovados;
- valor contratual atualizado;
- valor autorizado por OS;
- valor medido;
- valor aprovado para pagamento;
- valor pago;
- saldo contratual;
- prazo original e prazo atualizado;
- retenções e garantias;
- fornecedor e responsáveis;
- OS vinculadas;
- medições vinculadas;
- aditivos;
- documentos e anexos;
- eventos e trilha de auditoria.

## Arquitetura de navegação alvo

### Comercial
`Visão geral | CRM | Clientes | Unidades | Tabelas | Propostas | Reservas | Vendas | Contratos | Recebíveis`

### Suprimentos
`Visão geral | Necessidades | Requisições | Cotações | Mapa comparativo | Pedidos de compra | Fornecedores`

### Contratos
`Visão geral | Contratos | Ordens de serviço | Aditivos | Medições | Documentos`

### Engenharia e Obra
`Visão geral | Planejamento | Orçamento | Cronograma | Execução | Medições | Evidências | Avanço físico`

### Financeiro
`Visão geral | Contas a pagar | Contas a receber | Compromissos | Caixa | Bancos | Conciliação | Transferências`

### Decisão
`Alertas | Desvios | Aprovações | Decisões | Impactos | Histórico`

## Sanitização obrigatória da interface

Remover da experiência de cliente/usuário qualquer referência a nomes internos de implementação, incluindo:

- `10C.1`;
- `Fase 9`, `Fase 10`, `Phase`;
- nomes de branch;
- `MVP interno`;
- observações de desenvolvimento;
- nomes de testes/seeds;
- termos técnicos de arquitetura que não tenham função operacional para o usuário.

Comentários internos no código e documentação técnica podem permanecer.

## Design system operacional

Padronizar antes de expandir dezenas de telas:

- escala tipográfica;
- largura máxima e grid;
- espaçamento vertical/horizontal;
- altura e estados de input/select/textarea;
- botões primário/secundário/perigoso;
- tabelas e filtros;
- tabs;
- badges de status;
- drawers para criação/edição simples;
- páginas/wizards para operações complexas;
- modais apenas para confirmação/ações pequenas;
- empty states;
- skeleton/loading;
- feedback de sucesso/erro;
- responsividade;
- acessibilidade básica e foco de teclado.

Regra: operações complexas como venda, contrato, pedido, OS e medição não devem ser cadastradas por `prompt()`.

## Sequência de implementação

### Sprint A — Higienização e fundação visual

1. retirar códigos/fases internas da UI;
2. criar tokens/componentes do design system operacional;
3. substituir estilos inline críticos por primitives/classes padronizadas;
4. criar padrão de `PageHeader`, `ModuleTabs`, `DataTable`, `FilterBar`, `FormSection`, `FormField`, `Drawer`, `StatusBadge`, `Timeline` e `DocumentActions`;
5. manter comportamento atual enquanto a superfície é substituída.

### Sprint B — Comercial profissional

1. Cliente/CRM;
2. proposta;
3. reserva;
4. wizard de venda;
5. plano financeiro;
6. contrato de venda;
7. geração de recebíveis a partir do plano;
8. documento/versionamento.

### Sprint C — Suprimentos profissional

1. necessidades;
2. requisições;
3. cotação;
4. mapa comparativo;
5. pedido de compra;
6. recebimento;
7. documento do pedido.

### Sprint D — Contratos + Ordem de Serviço

1. contrato 360;
2. schema/service de Ordem de Serviço;
3. aprovação e emissão de OS;
4. vínculo orçamento/contrato/obra;
5. documento da OS;
6. aditivos e saldo contratual.

### Sprint E — Medições 2.0

1. vínculo a OS;
2. acumulados físicos/financeiros;
3. evidências/anexos;
4. workflow técnico/gerencial;
5. integração com obrigação financeira;
6. rastreabilidade de pagamento e saldo.

### Sprint F — Demonstração integrada

Criar um empreendimento demonstrativo controlado para percorrer:

**venda → contrato → recebíveis**

e

**orçamento → necessidade → cotação → contrato/pedido → OS → execução → medição → obrigação → pagamento → impacto em caixa/margem**.

## Critérios de pronto para demonstração externa

Uma área só deve ser tratada como pronta quando:

1. operação nasce pela UI sem console/seed/manual técnico;
2. dados obrigatórios e erros são compreensíveis;
3. existe edição/retificação quando o domínio permitir;
4. aprovação respeita RBAC/alçadas;
5. histórico é rastreável;
6. documentos materiais podem ser visualizados;
7. impactos financeiros são reconciliáveis;
8. não há labels internos de desenvolvimento;
9. layout é consistente com as demais áreas;
10. jornada foi testada com organização e empreendimento novos.

## Primeira execução

A primeira implementação deve começar por **Sprint A + Comercial**, porque o Comercial atualmente expõe `prompt()` e um contrato/recebível simplificado demais para uma demonstração profissional. Em paralelo, o desenho do schema de Ordem de Serviço deve ser fechado antes de alterar Medições, para evitar retrabalho no vínculo contratual.
