# REDE Score e Sensitivity Engine v1

## Princípios

Os dois motores são determinísticos, puros e versionados. Eles não importam React, Next.js ou Prisma. Cada execução recebe as premissas do snapshot, usa o mesmo `calculatedAt` e persiste configuração, entradas, resultados e explicações. O REDE Score não altera fórmulas do Engine financeiro.

## REDE Score v1

Versão da política: `REDE_SCORE_V1.0.0`.

| Dimensão | Peso | Regras internas |
| --- | ---: | --- |
| Retorno | 25% | margem 30%, ROI 25%, TIR 25%, VPL/VGV 20% |
| Capital e funding | 20% | exposição/política 30%, equity/VGV 20%, funding 20%, duração 15%, exposição/VGV 15% |
| Comercial | 15% | duração 20%, vendas pré-entrega 25%, estoque 20%, receita pós-chaves 20%, recebimentos pré-entrega 15% |
| Custos | 15% | custo total 25%, obra 20%, terreno 15%, indiretos 15%, comercial/tributos 15%, contingência 10% |
| Resiliência | 15% | perda de margem 25%, ROI 20%, TIR 20%, aumento de exposição 20%, rupturas de política 15% |
| Execução | 10% | duração total 25%, aprovação 20%, obra 20%, primeira geração de caixa 20%, concentração de desembolso 15% |

Cada regra converte o valor observado para 0–100 por interpolação linear entre quatro bandas explícitas: crítico = 0, mínimo = 50, alvo = 75 e excelente = 100. Mínimos de margem, ROI e TIR vêm da política de investimento do próprio snapshot. O resultado bruto é a soma das dimensões ponderadas.

### Gates

- margem abaixo de 50% do mínimo: score máximo 54;
- exposição acima de 150% do limite: score máximo 54;
- VPL negativo: score máximo 39;
- lucro negativo: score máximo 39;
- stress moderado com lucro ou VPL negativo: score máximo 54.

### Penalidades

- mais de 60% dos recebimentos após entrega: -5;
- exposição negativa por mais de 24 meses: -4;
- folga de margem menor que 2 p.p.: -4;
- uso do funding acima de 90%: -4.

### Classificação

- 85–100: Excelente;
- 70–84: Atrativo;
- 55–69: Atenção;
- 40–54: Frágil;
- abaixo de 40: Crítico.

A explicação persistida contém score bruto, penalidades, gates, cada dimensão, cada regra, valor observado, benchmark e mensagem. A interface apenas apresenta esse resultado.

## Sensitivity Engine v1

Versão da configuração: `REDE_SENSITIVITY_V1.0.0`.

Cada caso isolado altera uma única premissa do snapshot:

- preço: -15%, -10%, -5%, 0%, +5%, +10%;
- custo de obra: 0%, +5%, +10%, +15%, +20%;
- velocidade: -10%, -20%, -30%, -40%;
- prazo de obra: +3, +6, +12 meses;
- financiamento: +2, +4, +6 p.p.;
- terreno: +5%, +10%, +20%;
- comissão e marketing: +10%, +20%, +30%;
- início de vendas: +3, +6, +12 meses.

Stresses combinados:

- moderado: preço -5%, obra +5%, velocidade -15%;
- severo: preço -10%, obra +10%, velocidade -30%, obra +6 meses;
- extremo: preço -15%, obra +20%, velocidade -40%, obra +12 meses, financiamento +4 p.p.

O motor calcula VGV, margem, lucro, ROI, TIR, VPL, exposição, equity e funding para cada execução; identifica políticas violadas; recalcula o Score; ordena variáveis pelo pior impacto; e busca por iteração os break-evens de preço, obra, atraso comercial e velocidade. `FOUND`, `NOT_REACHED` e `BASE_FAILS_POLICY` distinguem limites encontrados, faixas insuficientes e bases já fora da política.

## Persistência

Cada `StudyVersion` possui três `Score`, um por `Scenario`, e uma `SensitivityAnalysis` vinculada ao cenário Base. Casos isolados, stresses e break-evens são normalizados, enquanto o payload completo versionado permanece em JSON para reprodução. Triggers PostgreSQL tornam todos esses registros imutáveis quando a versão chega a `SNAPSHOT`.
