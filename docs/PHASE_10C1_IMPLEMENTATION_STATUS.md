# Fase 10C.1 — Status de Implementação Transversal

Data: 17/09/2026
Branch: `codex/fase-10c1-operabilidade-humana`

## Princípio

A 10C.1 adiciona operabilidade humana sem alterar o contrato da Fase 10C: a camada de IA permanece somente leitura. A mutação de negócio continua sendo feita por usuário autenticado, passando por Server Action/API, RBAC, service de domínio, validação e auditoria.

A fundação de autorização agora separa explicitamente:

- leitura (`*_READ`);
- escrita humana (`*_WRITE`);
- aprovação material (`*_APPROVE`).

VIEWER e REVIEWER não recebem escrita genérica. OWNER/ADMIN recebem escrita e alçada ampla; ANALYST recebe escrita e continua sujeito às regras de aprovação do domínio. Regras mais restritivas permanecem nos services.

## Estado por área

| Área | Estado 10C.1 | Operabilidade humana disponível / decisão arquitetural |
| --- | --- | --- |
| Executivo | Operacional para decisão/encerramento | permanece leitura executiva; encerramento, aprovações e reabertura ficam expostos sem transformar a área em CRUD geral |
| Viabilidade | Operacional | novo estudo, edição de premissas, versões, terreno e cenários já existiam; ações de estudo/terreno agora possuem gate explícito de escrita |
| Mercado & Produto | Operacional no produto; mercado condicionado a fonte | geração e decisão de cenários de produto com gate de escrita; inteligência de mercado ao vivo continua dependente de fonte/conector real, sem inventar CRUD paralelo |
| Engenharia & Obra | Operacional ampliado | pareceres e Orçamento Inteligente já eram mutáveis; Base Aprovada, Orçamento Oficial e Cronograma agora têm fluxo humano visível |
| Suprimentos | Operacional ampliado | necessidade, validação, requisição, cotação, proposta, decisão, pedido, contrato, aditivo, medição e envio ao Financeiro expostos na UI |
| Financeiro | Operacional | contas bancárias, fornecedores/clientes, contas a pagar/receber, pagamentos, recebimentos, importação bancária, conciliação, transferências, intercompany e fechamento já possuíam UI operacional |
| Capital & Funding | Operacional | proposta, revisão, submissão, aprovação/rejeição, desembolso, covenant, condições e serviço da dívida já possuíam UI operacional |
| Comercial | Operacional básico ampliado | cliente, lead, proposta, reserva, venda, confirmação/liberação e aprovação de venda com geração de recebível expostos na UI |
| Jurídico | Operacional básico ampliado | abertura de diligência, decisão jurídica, envio de obrigação ao Financeiro e reversão expostos; cadastros jurídicos especializados continuam sujeitos às operações realmente existentes no backend |
| Pessoas | Operacional básico ampliado | departamento, cargo, pessoa, investigação de causa, hipótese e ação corretiva com workflow DRAFT→PENDING_APPROVAL→ACTIVE→COMPLETED→VERIFIED |
| Contabilidade / Controladoria | Operacional ampliado | contabilização de eventos classificados e fechamento de período expostos; service mantém validações e segregação |
| Integrações | Operacional | resolução de conflitos, quarentena, sincronização e configuração de conectores já possuíam operação humana; credenciais permanecem protegidas |
| Inteligência de Dados | Operacional de governança | inicialização de contratos/métricas e atualização completa de fatos, benchmarks, previsto x realizado, qualidade e carteira pela UI; métricas derivadas não são editáveis manualmente |
| Central de Ações | Fonte transversal, não CRUD paralelo | por arquitetura é um read model de ações/exceções originadas nos domínios; correção/decisão deve ocorrer na fonte para não criar segunda verdade |
| Minha Rotina | Fonte transversal, não CRUD paralelo | reutiliza Central de Ações e organiza o que o usuário precisa tratar; a ação material ocorre no domínio de origem |
| Assistente | Somente leitura/recomendação | intencional nesta fase; nenhuma escrita autônoma de IA foi habilitada |
| Asset / Academy / Ajuda | Fora de CRUD operacional | conteúdo/ecossistema; não foram artificialmente transformados em módulos transacionais |
| Encerramento | Operacional | preparação, distribuição, aprovação, gates e reabertura expostos na Gestão Executiva com segregação de função preservada |

## Entregas transversais desta rodada

1. Painéis de operabilidade em Suprimentos, Jurídico, Comercial, Pessoas, Contabilidade, Inteligência de Dados e Encerramento.
2. Operação de Base Aprovada, Orçamento Oficial e Cronograma conectada à Engenharia/Obra.
3. Server Actions novas para Jurídico, Comercial, Pessoas, Contabilidade e Inteligência de Dados.
4. Matriz explícita de `WRITE` e `APPROVE`, separada das capabilities de leitura.
5. Encerramento final com gates operacional, contratual, jurídico, financeiro e contábil visíveis na UI.
6. Preservação da Central de Ações/Minha Rotina como read models transversais, evitando uma segunda fonte de verdade.
7. Preservação do Assistente/Tool Layer da IA como read-only.

## Itens que NÃO devem ser falsamente tratados como concluídos

A 10C.1 não cria operações de domínio inexistentes só para colocar um botão na tela. Onde o backend ainda não possui uma mutation segura, a lacuna precisa ser implementada no service/schema antes da UI. Os principais pontos para evolução incremental são:

- Jurídico: CRUD especializado de achados, pedidos de documento, licenças, processos e obrigações quando o domínio expuser mutations correspondentes;
- Comercial: aprofundar unidades/tabelas/comissões/pós-venda/inspeções em superfícies humanas adicionais, embora os services já possuam parte desses fluxos;
- Pessoas: expor vínculos, alocações, custos e evidências adicionais já suportados pelo service;
- Contabilidade: ampliar reversões, reabertura e conciliações na superfície conforme necessidade operacional;
- Mercado ao vivo: depende de conectores/fontes reais; não criar entrada manual que finja dado de mercado integrado.

Esses itens não impedem a existência de operação humana nos departamentos, mas impedem classificar a 10C.1 como **produção final** sem a auditoria de jornada completa e a validação de CI.

## Critério de fechamento técnico

Antes de encerrar a fase:

1. CI completo verde: Prisma validate/generate/migrate/seed, TypeScript, ESLint, Vitest e build;
2. testar com OWNER uma organização/empreendimento novos, sem seed de negócio;
3. testar VIEWER sem escrita;
4. testar tenant/project isolation;
5. percorrer a jornada estudo → obra/suprimentos → financeiro → comercial → jurídico/pessoas → contabilidade → encerramento;
6. registrar no documento principal qualquer lacuna remanescente descoberta pela jornada.
