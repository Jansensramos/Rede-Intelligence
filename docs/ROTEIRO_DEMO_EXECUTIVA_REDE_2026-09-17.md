# REDE Intelligence — Roteiro de demonstração executiva

Data: 17/09/2026

## Objetivo

Demonstrar a REDE como sistema operacional e de decisão para incorporação imobiliária, mostrando como um fato nasce em um departamento, gera compromissos, atravessa aprovações, chega ao Financeiro e reaparece na gestão consolidada.

A apresentação deve privilegiar o fluxo de negócio. Códigos de fase, nomes de branch, detalhes de implementação e nomenclaturas internas não fazem parte da demonstração.

## Mensagem central

A REDE organiza a cadeia inteira da decisão:

**fato → impacto → aprovação → compromisso → execução → realizado → desvio → decisão**

Para custos e contratação:

**Orçado → Cotado → Contratado → Autorizado → Medido → A pagar → Pago → Saldo**

Para vendas:

**Unidade → Proposta → Reserva → Venda → Contrato → Recebível**

## Preparação antes da reunião

- utilizar uma organização demonstrativa, nunca dados reais sensíveis;
- selecionar uma SPE e um empreendimento com contexto completo;
- manter pelo menos uma tabela de preços ativa;
- manter unidades disponíveis para o fluxo comercial;
- manter fornecedores ativos para a cotação;
- preparar ao menos uma linha de compra/serviço coerente com o orçamento;
- confirmar que a migração de Ordens de Serviço foi aplicada;
- entrar inicialmente como OWNER/ADMIN para percorrer aprovações;
- reservar um segundo acesso VIEWER para demonstrar segregação de permissões;
- testar previamente impressão de Pedido, Contrato, OS e Medição no navegador.

## Demonstração 1 — Comercial

### 1. Abrir Comercial

Mostrar que a tela trabalha com clientes, leads, propostas, reservas e vendas sem cadastro por prompt ou console.

### 2. Criar cliente

Cadastrar um comprador demonstrativo com nome, CPF/CNPJ, e-mail e telefone.

**Mensagem:** o cliente nasce na operação comercial e passa a ser referenciado pelas próximas transações.

### 3. Criar proposta

Selecionar unidade, cliente e tabela vigente. Informar preço proposto e validade.

**Mostrar:** preço de tabela versus preço proposto e preservação da condição comercial.

### 4. Criar reserva

Reservar a mesma unidade para o cliente e confirmar a reserva.

**Mensagem:** disponibilidade da unidade e negociação deixam de ser controles paralelos.

### 5. Registrar venda

Selecionar unidade e comprador, registrar valor negociado e incentivo comercial.

### 6. Aprovar venda

Gerar o contrato e o recebível pelo fluxo disponível.

**Explicar sem superestimar:** a versão atual já cria contrato e recebível, mas o plano financeiro imobiliário completo — entrada, mensais, intermediárias, chaves, repasse, índices e múltiplos compradores — ainda é um bloco de expansão da Operabilidade 2.0.

## Demonstração 2 — Suprimentos e contratação

### 1. Registrar necessidade

Em Suprimentos, criar uma necessidade realista, por exemplo:

- fundação do Bloco A;
- quantidade e unidade;
- especificação técnica;
- data necessária;
- prazo esperado de contratação.

Validar a necessidade.

### 2. Gerar requisição

Selecionar a necessidade validada e gerar a requisição de compra/contratação.

Avançar pelo fluxo de solicitação e aprovação.

### 3. Abrir cotação

Selecionar a requisição, definir escopo, prazo de resposta e fornecedores convidados.

### 4. Registrar propostas

Registrar valores por item e condições de pelo menos dois fornecedores.

### 5. Decidir cotação

Selecionar a proposta vencedora, registrar parecer técnico e justificativa comercial e informar o valor de referência.

**Mensagem:** a decisão não é apenas o menor preço; a REDE guarda a justificativa e a evidência que produziram a escolha.

## Demonstração 3 — Pedido e contrato

A partir da cotação decidida, mostrar dois caminhos possíveis.

### Pedido de compra

Criar um Pedido de Compra com número, escopo, entrega e pagamento. Depois abrir **Imprimir pedido** e mostrar o documento A4 gerado pela REDE.

### Contrato operacional

Criar um contrato de serviço/construção com:

- número;
- objeto;
- modalidade de faturamento;
- período;
- condições de pagamento;
- retenção;
- garantia;
- itens da proposta selecionada.

Avançar revisão → aprovação → ativação.

Abrir **Imprimir contrato**.

**Mensagem:** a proposta escolhida vira um compromisso formal sem perder a origem da decisão.

## Demonstração 4 — Ordem de Serviço

No contrato aprovado/ativo, criar uma OS para uma frente específica, por exemplo:

**OS-001 — Fundação Bloco A**

Selecionar quantidades autorizadas dos itens contratuais e prazo de execução.

Avançar:

**Rascunho → Em aprovação → Aprovada → Emitida → Em execução**

Abrir **Imprimir OS**.

**Mensagem:** contrato não significa autorização para executar tudo. A OS delimita o que efetivamente foi liberado e quanto do contrato foi autorizado.

## Demonstração 5 — Medição

Criar uma medição a partir da OS.

Na tela, destacar por item:

- quantidade autorizada;
- quantidade medida anteriormente;
- saldo disponível;
- quantidade desta medição.

Demonstrar que a interface impede medir acima do saldo autorizado.

Avançar:

**Rascunho → Enviada → Análise técnica → Aprovada tecnicamente → Em aprovação → Aprovada**

Abrir **Imprimir medição**.

Ao aprovar, mostrar a geração/integração da obrigação financeira pelo fluxo existente.

## Demonstração 6 — Contrato 360

Selecionar o contrato e mostrar a sequência consolidada:

- valor original;
- aditivos aprovados;
- valor atualizado;
- autorizado por OS;
- medido;
- aprovado para pagamento;
- pago;
- saldo contratual.

**Mensagem:** o usuário deixa de comparar planilha de contrato, planilha de medição e extrato financeiro para entender a posição do compromisso.

## Demonstração 7 — Financeiro

Abrir a obrigação originada na medição e mostrar a rastreabilidade de origem.

Se houver dados demonstrativos apropriados, seguir para pagamento/conciliação. Não simular integração bancária real como se estivesse ativa caso esteja em ambiente de teste.

## Demonstração 8 — Gestão Executiva

Retornar à Gestão Executiva e mostrar como fatos de Comercial, Obra, Suprimentos e Financeiro alimentam a visão consolidada.

A mensagem de encerramento deve ser:

> O dado nasce na operação, percorre regras e aprovações, produz efeito financeiro e volta para a gestão como contexto de decisão. A REDE não cria uma segunda verdade paralela.

## Demonstração de permissões

Entrar com VIEWER e confirmar que ações materiais não estão disponíveis para o perfil de consulta.

Depois retornar ao OWNER/ADMIN.

Isso demonstra segregação de função sem precisar explicar a arquitetura de RBAC.

## O que não apresentar como concluído

Até o fechamento técnico destes itens, não apresentar como produto final:

- plano financeiro imobiliário completo da venda;
- assinatura eletrônica real de contratos se o integrador não estiver ativado;
- emissão fiscal;
- integração bancária real quando estiver em modo de teste;
- geração de PDF servidor-side como se fosse diferente da impressão A4 atual;
- qualquer agente/autopilot ainda não liberado para produção.

## Checklist de aceite da demonstração

Antes de mostrar a terceiros:

- CI verde;
- banco com migrations aplicadas;
- build local concluído;
- nenhum `10C.1`, `9R`, `Fase`, branch ou código de roadmap visível nas telas do roteiro;
- nenhum `prompt()` nos fluxos apresentados;
- estados apresentados em português;
- documentos abrem e imprimem corretamente;
- jornada OWNER funciona de ponta a ponta;
- VIEWER permanece somente leitura;
- nenhuma informação demonstrativa é apresentada como dado real de cliente.
