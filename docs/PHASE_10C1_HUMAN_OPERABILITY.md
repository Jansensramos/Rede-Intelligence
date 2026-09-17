# Fase 10C.1 — Operabilidade Humana Completa

## 1. Objetivo

Fechar a lacuna entre a camada analítica já existente da REDE e a operação humana cotidiana.

A partir desta fase, todo departamento operacional deve permitir que um usuário autorizado faça o ciclo completo de trabalho sem depender de seed, script, banco manual ou ferramenta externa para alimentar a REDE.

Critério mínimo de operabilidade humana:

**criar → editar → salvar → alterar estado → consultar histórico**, com RBAC, isolamento por organização/empreendimento, validação, rastreabilidade e auditoria.

A Fase 10C continua com Tool Layer de IA somente leitura. A 10C.1 não autoriza a IA a gravar livremente em domínio de negócio. O escopo é a operação feita por usuários humanos.

---

## 2. Diagnóstico atual

O sistema já possui uma camada de leitura e inteligência ampla, porém a operabilidade é desigual entre departamentos.

### 2.1 Estados observados

| Área | Estado atual observado | Direção da 10C.1 |
| --- | --- | --- |
| Executivo | Leitura/decisão | manter leitura executiva; permitir apenas decisões/aprovações onde fizer sentido |
| Viabilidade | Parcialmente operacional | garantir Novo Estudo, edição de premissas, nova versão, terreno, cenários e histórico |
| Mercado & Produto | Parcial | expor cadastro/edição de fontes, concorrentes, produto, premissas e cenários |
| Engenharia & Obra | Parcial | completar operação de pareceres, orçamento, cronograma, avanço físico, eventos, medições e revisões |
| Suprimentos | Backend operacional / UI predominantemente leitura | expor necessidades, requisições, cotações, propostas, fornecedores, pedidos, contratos, aditivos e medições |
| Financeiro | Operacional | manter e fechar lacunas de edição, histórico e permissões |
| Capital & Funding | Backend operacional | garantir UI completa para proposta, revisão, aprovação, desembolso, covenant e condições |
| Comercial | Predominantemente leitura | implementar operação de unidades, tabelas, clientes, propostas, reservas, vendas, contratos, comissões e pós-venda |
| Jurídico | Leitura | implementar diligência, documentos, achados, obrigações, licenças, processos, contratos e prazos |
| Pessoas | Leitura | implementar pessoas, cargos, departamentos, equipes, alocações, custos, investigações, ações e evidências |
| Contabilidade / Controladoria | Predominantemente leitura | implementar entradas/importações, classificação, conciliação, fechamento e reabertura conforme regra do domínio |
| Integrações | Parcial | completar configuração, credenciais, mapeamentos, teste, ativação/desativação, conflitos e quarentena |
| Inteligência de Dados | Leitura/analítica | permitir gestão humana de fontes, regras, qualidade, exceções e evidências; preservar cálculos automáticos |
| Central de Ações | Parcial/analítica | permitir criar, atribuir, priorizar, alterar status, concluir e anexar evidência |
| Rotina / Operações | Backend parcial | expor baseline, revisões, cronograma, justificativas de desvio, ocorrências e acompanhamento |
| Assistente | Leitura/recomendação | manter sem mutação livre nesta fase |
| Asset / Academy / Ajuda | Conteúdo/ecossistema | não transformar em ERP; apenas CRUD administrativo onde houver conteúdo gerenciável |
| Encerramento | Fluxo específico | garantir operação humana para checklist, aprovação e fechamento quando aplicável |

---

## 3. Evidências de que o backend já possui operações importantes

A implementação deve reaproveitar serviços e Server Actions existentes, sem duplicar regra de negócio.

Exemplos observados na base atual:

- **Financeiro**: cadastro de fornecedor/cliente/conta bancária, contas a pagar/receber, pagamentos, recebimentos, importação bancária, conciliação, transferências, intercompany, fechamento e reabertura.
- **Suprimentos**: necessidade, validação, requisição, cotação, proposta de fornecedor, decisão, pedido, contrato, aditivo, medição, aprovação e reversão.
- **Operações**: baseline, aprovação, orçamento oficial, revisão, justificativa de desvio, cronograma e aprovação.
- **Engenharia**: pareceres, versões, submissão, decisão por item, decisão final e propostas de orçamento inteligente.
- **Capital & Funding**: proposta, revisão, submissão, análise, aprovação/rejeição, desembolsos, covenants e condições.
- **Viabilidade**: criação de estudo e novas versões; terreno possui persistência própria.
- **Mercado & Produto**: geração/persistência e decisão de cenários de produto.
- **Integrações**: resolução de conflito, reprocessamento de quarentena, sincronização e configuração de conectores específicos.

Onde já existir serviço de escrita no domínio, a 10C.1 deve priorizar **expor a operação na UI**, não reescrever o backend.

---

## 4. Regra de UX operacional

Toda tela operacional deve apresentar ações humanas visíveis e coerentes com o estado do registro.

Padrão mínimo:

1. botão claro de **Novo / Adicionar / Registrar**;
2. edição em formulário ou painel lateral/modal;
3. validação de campos antes de persistir;
4. feedback explícito de sucesso/erro;
5. atualização da tela após persistência;
6. transições de estado com confirmação quando forem materiais;
7. campos imutáveis depois de aprovação oficial quando a regra do domínio exigir;
8. histórico/versão quando a alteração puder mudar base econômica, contratual ou decisória;
9. exclusão física apenas quando segura; caso contrário cancelar, arquivar, superseder ou reverter;
10. telas vazias devem oferecer uma ação útil, e não apenas informar que não existem dados.

Não usar dados inventados para simular uma operação concluída.

---

## 5. RBAC de escrita

A base atual usa capabilities de leitura como gate comum de Server Actions. A 10C.1 deve revisar isso e separar claramente **capacidade de visualizar** de **capacidade de alterar**.

Criar uma matriz de escrita explícita, por exemplo:

- `*_CREATE`
- `*_EDIT`
- `*_APPROVE`
- `*_CANCEL`
- `*_IMPORT`
- `*_ADMIN`

Não é obrigatório criar uma capability para cada verbo se uma matriz menor for suficiente, mas nenhum endpoint de escrita deve depender somente de uma permissão chamada `*_READ`.

Diretriz inicial de papel:

- `OWNER`: operação e aprovação ampla;
- `ADMIN`: operação ampla, sujeita a segregações materiais;
- `ANALYST`: criar/editar/submeter dentro das áreas autorizadas;
- `REVIEWER`: revisar/aprovar apenas onde a matriz permitir;
- `VIEWER`: nunca gravar em domínio de negócio.

A implementação deve preservar segregação de funções nas decisões materiais.

---

## 6. Escopo por departamento

### 6.1 Viabilidade

Obrigatório:
- criar empreendimento/estudo quando autorizado;
- editar premissas antes da versão oficial;
- salvar nova versão;
- editar cenário urbanístico/terreno;
- gerar/recalcular cenários;
- registrar decisão de cenário;
- comparar versões;
- consultar histórico de premissas e decisões.

### 6.2 Mercado & Produto

Obrigatório:
- cadastrar fonte/pesquisa;
- cadastrar/editar concorrente e evidência de mercado;
- cadastrar tipologias e premissas de produto;
- editar parâmetros de cenário;
- gerar cenários;
- registrar cenário selecionado/rejeitado;
- versionar decisões relevantes.

### 6.3 Engenharia & Obra

Obrigatório:
- criar/editar parecer técnico;
- submeter e decidir parecer;
- criar revisão do parecer;
- criar/editar orçamento quando não oficial;
- revisar item de orçamento;
- gerar/avaliar proposta de orçamento inteligente;
- criar/revisar cronograma;
- registrar avanço físico;
- registrar evento/ocorrência de obra;
- registrar medição técnica quando pertencente ao domínio;
- justificar desvios;
- preservar imutabilidade de base aprovada.

### 6.4 Suprimentos

Obrigatório expor na UI as operações já existentes no backend:
- nova necessidade;
- validar necessidade;
- nova requisição;
- transicionar requisição;
- nova cotação;
- proposta de fornecedor;
- decisão de cotação;
- novo pedido;
- aprovação de pedido;
- novo contrato;
- transição contratual;
- novo aditivo;
- aprovação de aditivo;
- nova medição;
- transição/aprovação/reversão de medição;
- cadastro/edição de fornecedor se ainda não houver superfície adequada.

### 6.5 Financeiro

Manter operação já existente e completar:
- editar cadastros permitidos;
- histórico de alterações;
- confirmação antes de operações materiais;
- fechamento/reabertura visível na UI;
- fornecedores e clientes acessíveis sem depender de fluxo indireto;
- trilha completa do lançamento até pagamento/recebimento/conciliação.

### 6.6 Capital & Funding

Obrigatório:
- criar e revisar proposta;
- submeter;
- mover para análise;
- aprovar/rejeitar;
- programar desembolso;
- solicitar liberação;
- aprovar liberação;
- confirmar desembolso;
- avaliar covenant;
- atualizar condições;
- reprogramar serviço da dívida;
- histórico por versão e decisão.

### 6.7 Comercial

Obrigatório:
- cadastrar/editar unidade e status permitido;
- tabela de preço e vigência;
- cliente;
- proposta;
- aprovação/rejeição quando aplicável;
- reserva;
- cancelamento/expiração;
- venda;
- plano de pagamento;
- contrato e assinatura;
- corretor/comissão;
- distrato quando autorizado;
- pós-venda;
- assistência/entrega/repasse;
- Cliente 360 com ações permitidas, não apenas leitura.

### 6.8 Jurídico

Obrigatório:
- abrir caso de diligência;
- editar escopo/responsáveis;
- checklist;
- solicitar documento;
- anexar/vincular evidência;
- registrar achado;
- classificar severidade/status;
- registrar mitigação;
- decisão jurídica;
- matrícula/cadastro municipal;
- obrigação e prazo;
- licença/processo;
- condição/garantia de contrato;
- atualização de status;
- histórico de versões e evidências.

### 6.9 Pessoas

Obrigatório:
- cadastrar pessoa/vínculo;
- cargo/departamento;
- equipe;
- alocação;
- jornada/capacidade;
- custos administrativos conforme permissão;
- abrir investigação de desvio;
- hipótese/causa;
- ação corretiva;
- responsável/prazo;
- anexar evidência;
- concluir/verificar ação com segregação adequada.

### 6.10 Contabilidade / Controladoria

Obrigatório:
- importação/entrada controlada de movimentos quando cabível;
- classificação e reclassificação;
- conciliação;
- competência;
- fechamento/reabertura com permissão;
- ajustes com justificativa;
- visualização da origem financeira sem dupla escrituração indevida;
- trilha de auditoria.

### 6.11 Integrações

Obrigatório:
- cadastrar/configurar instalação quando suportado;
- testar conexão;
- mapear campos;
- ativar/desativar;
- acompanhar sincronização;
- resolver conflito;
- reprocessar/descartar quarentena;
- permitir credenciais apenas em fluxo seguro e mascarado;
- nunca expor segredo após gravação;
- diferenciar claramente mock, sandbox e produção.

### 6.12 Inteligência de Dados

Obrigatório para operação humana:
- registrar fonte;
- classificação da fonte;
- regra de qualidade;
- exceção;
- justificativa;
- evidência;
- correção/aceite quando autorizado;
- histórico de decisão sobre qualidade.

Não permitir edição manual de métricas derivadas que deveriam ser calculadas pelo Engine.

### 6.13 Central de Ações

Obrigatório:
- criar ação manual;
- atribuir responsável;
- prioridade;
- prazo;
- dependências;
- alterar status;
- comentar;
- anexar evidência;
- concluir;
- reabrir quando permitido;
- filtrar por origem/departamento/empreendimento.

### 6.14 Rotina / Operações

Obrigatório:
- preparar baseline;
- solicitar/aprovar baseline;
- orçamento oficial;
- revisão;
- justificar desvio;
- cronograma;
- aprovação do cronograma;
- ocorrências e fatos operacionais;
- atualização de avanço quando pertencente a este domínio.

### 6.15 Executivo

O Executivo não deve virar tela de digitação geral.

Operabilidade humana aqui significa:
- registrar decisão;
- aprovar/rejeitar quando houver alçada;
- criar ação a partir de um alerta;
- justificar decisão;
- acompanhar execução e resultado.

### 6.16 Assistente

Permanece recomendação/leitura nesta fase.

Nenhuma mutação livre de domínio de negócio via IA entra na 10C.1.

### 6.17 Asset / Academy / Ajuda

Somente CRUD administrativo de conteúdo quando necessário. Não criar rotinas artificiais de operação.

### 6.18 Encerramento

Obrigatório:
- checklist de encerramento;
- pendências;
- responsáveis;
- evidências;
- aprovação;
- bloqueios de fechamento;
- fechamento final e eventual reabertura apenas conforme regra explícita.

---

## 7. Regras de dados e arquitetura

1. nenhuma UI escreve direto no Prisma;
2. UI chama Server Action/API de domínio;
3. Action resolve autenticação/RBAC e delega ao service;
4. service aplica invariantes e tenant/project scope;
5. schema valida payload;
6. toda operação material gera trilha de auditoria existente ou nova quando necessária;
7. nenhuma ausência vira zero automaticamente;
8. estados oficiais/aprovados não são sobrescritos silenciosamente;
9. revisões criam versão quando a semântica exigir;
10. integrações não podem virar atalho para ignorar validação do domínio;
11. seeds continuam servindo demonstração/teste, nunca substituem CRUD humano;
12. a UI deve operar com banco vazio em cada módulo, oferecendo caminho de criação quando autorizado.

---

## 8. Estratégia de implementação

Implementar em ondas para reduzir regressão cruzada.

### Onda A — backend existe, UI falta ou está incompleta

1. Suprimentos
2. Engenharia & Obra
3. Capital & Funding
4. Mercado & Produto
5. Rotina / Operações
6. Integrações
7. completar Viabilidade
8. completar Financeiro

Objetivo: aproveitar ações e serviços já implementados.

### Onda B — domínio existe, superfície humana de escrita é insuficiente

1. Comercial
2. Jurídico
3. Pessoas
4. Contabilidade / Controladoria
5. Inteligência de Dados
6. Central de Ações

Aqui é obrigatório primeiro auditar services/schema existentes antes de criar novas mutations, para não duplicar regra de negócio.

### Onda C — decisões transversais

1. Executivo
2. Encerramento
3. Asset/Academy/Ajuda apenas onde aplicável
4. revisão global de permissões e auditoria

---

## 9. Testes obrigatórios

Cada departamento operacional deve possuir testes cobrindo no mínimo:

- OWNER consegue criar/editar dentro da regra;
- VIEWER não consegue gravar;
- tenant A não altera dado do tenant B;
- projeto A não altera dado do projeto B;
- payload inválido não persiste;
- transição inválida é rejeitada;
- operação aprovada/oficial respeita imutabilidade;
- operação de criação aparece após refresh;
- histórico/versão é preservado quando aplicável;
- rollback/reversão existe onde não pode haver delete destrutivo;
- estado vazio oferece caminho funcional de criação;
- teste de UI para o fluxo principal de cada departamento.

Adicionar teste de regressão que detecte telas operacionais compostas apenas por tabelas/cartões sem qualquer ação quando o papel atual possui permissão de escrita.

---

## 10. Critério de aceite da Fase 10C.1

A fase só encerra quando, usando uma organização nova e um empreendimento novo, um usuário OWNER conseguir alimentar o sistema pela interface, sem seed de negócio, completando uma jornada mínima:

1. criar/configurar estudo e terreno;
2. registrar produto/mercado necessário;
3. montar baseline/orçamento/cronograma;
4. criar necessidade de compra → requisição → cotação → contratação → medição;
5. gerar/registrar obrigação financeira → pagamento/conciliação;
6. cadastrar cliente → proposta → reserva → venda → recebível;
7. registrar diligência/obrigação jurídica;
8. registrar pessoa/equipe/alocação/ação;
9. configurar uma integração suportada ou operar manualmente sem integração;
10. registrar decisão/ação executiva;
11. consultar histórico e evidências de tudo que foi alterado.

Nenhuma área operacional pode depender exclusivamente de dados de seed para parecer funcional.

---

## 11. Não objetivos

A 10C.1 não deve:

- autorizar IA autônoma a mutar negócio;
- reescrever engines determinísticos;
- substituir services já testados por CRUD genérico;
- remover versionamento ou aprovações para facilitar UI;
- transformar Executivo, Assistente ou Academy em módulos artificiais de lançamento;
- implementar integrações reais sem credenciais, autorização, teste, reconciliação e rollback;
- quebrar o princípio: **IA recomenda. Engine calcula. Humano aprova. Sistema registra.**

---

## 12. Ordem de trabalho para Codex

Antes de implementar cada área:

1. localizar página e componente atual;
2. localizar service e schemas do domínio;
3. localizar Server Actions/APIs existentes;
4. listar operações de escrita já implementadas;
5. listar operações necessárias sem backend;
6. implementar primeiro a UI sobre backend existente;
7. somente depois criar novas operações de domínio indispensáveis;
8. adicionar RBAC de escrita explícito;
9. adicionar testes;
10. executar lint, typecheck, testes e build;
11. atualizar este documento marcando o estado real do departamento.

A implementação deve ser incremental, com commits pequenos e auditáveis por departamento.