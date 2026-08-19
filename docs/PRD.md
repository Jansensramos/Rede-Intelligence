# REDE Intelligence — PRD do MVP

## Problema

Estudos de incorporação combinam planilhas, documentos e julgamentos pouco rastreáveis. Isso dificulta comparar oportunidades, contestar premissas e manter uma única versão dos números.

## Objetivo do MVP

Entregar o **REDE Engine v1**: entrada estruturada de um empreendimento, cálculo financeiro determinístico, comparação de cenários, alertas objetivos e dashboard executivo. O produto deve ser útil sem IA e deixar uma fronteira clara para Red Team, Score, Studio e dados de previsto × realizado.

## Usuários

- Incorporador ou executivo que decide se o projeto avança.
- Analista financeiro que estrutura e revisa premissas.
- Investidor/CFO que avalia retorno, caixa exposto e downside.

## Jornada principal

1. Criar ou abrir um empreendimento.
2. Informar produto, custos, prazos, vendas, recebimentos, funding e política de investimento.
3. Validar os dados e executar o cálculo.
4. Ver KPIs, fluxo mensal, cenários e alertas com explicação.
5. Ajustar premissas e comparar o impacto imediatamente.

## Escopo desta entrega

- formulário de premissas com um caso demonstrativo editável;
- VGV, receita líquida, custos, lucro, margens, ROI, TIR, VPL e payback;
- fluxo mensal de vendas, recebimentos, custos, financiamento e capital próprio;
- exposição máxima, mês crítico, capital necessário e break-even;
- cenários Conservador, Base e Agressivo;
- regras iniciais de alerta e recomendação;
- trilha de cálculo em memória;
- esquema PostgreSQL/Prisma preparado para evolução.

## Fora do escopo imediato

- autenticação e autorização em produção;
- persistência conectada a uma instância PostgreSQL;
- agentes LLM, score definitivo e parecer jurídico;
- importação/exportação de Excel e geração de documentos;
- acompanhamento previsto × realizado.

## Critérios de aceite

- nenhuma fórmula financeira fundamental depende de IA;
- valores financeiros usam aritmética decimal;
- fórmulas e cenários têm testes unitários;
- o dashboard permite editar o caso demonstrativo e recalcula sem recarregar;
- toda recomendação aponta regras e métricas observáveis;
- lint, typecheck, testes e build passam.

## Questões que exigem decisão de negócio

- regime tributário e momento de reconhecimento dos tributos;
- datas reais de lançamento, início das vendas e repasses bancários;
- curva de obra oficial e eventos de pagamento do terreno;
- tratamento de permutas física e financeira;
- distrato, inadimplência, correção monetária e inflação;
- definição institucional dos pesos do REDE Score;
- critérios de alocação de custos entre SPE, empreendimento e sócios.

Estas lacunas são parâmetros explícitos ou simplificações documentadas; não ficam ocultas no motor.
