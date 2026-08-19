# REDE Engine v1 — Fórmulas e premissas

## Convenções

- valores em BRL e áreas em m²;
- taxas na entrada em percentual, convertidas para fração decimal;
- mês `0` representa o início da análise;
- entrega ocorre ao fim de `aprovação + obra`;
- o fluxo é mensal e usa aritmética decimal;
- a versão inicial do motor é `1.0.0`.

## Áreas e receita

```text
área privativa total = unidades × área privativa por unidade
área construída = valor informado ou área privativa total ÷ eficiência
VGV = unidades × preço por unidade
```

## Custos

```text
construção base = área construída × custo de obra/m²
contingência = construção base × taxa de contingência
indiretos = construção base × taxa de indiretos
comissão = VGV × taxa de comissão
marketing = VGV × taxa de marketing
tributos = recebimentos mensais × taxa tributária
custo total = terreno + construção + contingência + indiretos
              + comissão + marketing + tributos + custo financeiro
```

Construção, contingência e indiretos usam uma curva S discreta e normalizada. O terreno é pago no mês zero nesta primeira versão. Marketing usa 30% no lançamento e 70% ao longo das vendas. Comissão acompanha o mês da venda.

## Vendas e recebimentos

As unidades são vendidas a partir do fim da aprovação, limitadas pela velocidade mensal. Para cada venda:

- entrada no mês da venda;
- parcela de obra distribuída do mês da venda até a entrega;
- parcela de entrega no mês da entrega, ou imediatamente se a venda ocorrer depois;
- as três parcelas devem somar 100%.

Não há inflação, inadimplência ou distrato implícitos. Esses riscos aparecem como lacunas e serão parâmetros futuros.

## Financiamento e equity

O financiamento cobre déficit operacional até o limite informado. Juros mensais incidem sobre o saldo inicial; caixa positivo paga juros e amortiza a dívida antes de retornar ao equity. Saldo residual é quitado no último mês se houver caixa.

```text
fluxo operacional = recebimentos - custos operacionais - tributos
fluxo do equity = fluxo operacional + saque - juros - amortização
exposição sem funding = maior déficit acumulado do fluxo operacional
capital próprio necessário = maior déficit acumulado do fluxo do equity
```

## Indicadores

```text
receita líquida = VGV - comissão - marketing - tributos
lucro = VGV - custo total
margem/VGV = lucro ÷ VGV
margem/receita líquida = lucro ÷ receita líquida
ROI = lucro ÷ capital próprio necessário
VPL = Σ fluxo do equity no mês t ÷ (1 + taxa mensal)^t
TIR anual = (1 + TIR mensal)^12 - 1
```

Payback é o primeiro mês em que o acumulado do equity volta a zero após ter sido negativo. TIR só existe quando o fluxo contém sinais negativo e positivo; caso contrário é `null`.

## Break-even

```text
taxa variável = tributos + comissão + marketing
VGV de equilíbrio = custos fixos e financeiros ÷ (1 - taxa variável)
unidades de equilíbrio = teto(VGV de equilíbrio ÷ preço por unidade)
```

## Cenários padrão

| Variável | Conservador | Base | Agressivo |
|---|---:|---:|---:|
| Preço de venda | -8% | 0% | +5% |
| Custo de obra | +10% | 0% | -4% |
| Velocidade de vendas | -25% | 0% | +20% |
| Aprovação | +3 meses | 0 | -1 mês |
| Juros a.a. | +2 p.p. | 0 | -1 p.p. |

Os deltas são transparentes e serão configuráveis em versões posteriores.

## Limitações conscientes

- curva de obra padronizada, sem orçamento por etapa;
- terreno à vista, sem permuta;
- repasse bancário e correção de recebíveis simplificados;
- imposto uniforme sobre recebimentos;
- sem inflação, inadimplência, distrato ou estoque cancelado.

Essas simplificações impedem interpretar o MVP como laudo final. Elas são visíveis na interface e no audit trail.
