# REDE Land Intelligence e Zoning Lab

## Escopo da Fase 5

O módulo territorial transforma um terreno em um conjunto auditável de cenários urbanísticos, envelopes edificáveis, alternativas de produto e resultados econômicos. Ele não substitui levantamento topográfico, certidão de uso do solo, consulta jurídica, projeto legal ou aprovação municipal. Cenários simulados são hipóteses de decisão e nunca são apresentados como direito adquirido.

## Fluxo determinístico

```text
LandAsset + fontes + restrições verificadas
                  ↓
        UrbanScenario (atual ou simulado)
                  ↓
          BuildableEnvelope
                  ↓
       ProductMix + Massing + Phases
                  ↓
              LandOption
                  ↓
         REDE Engine → REDE Score
                  ↓
     ranking, Pareto, gap e uplift
```

Cada alternativa carrega a versão do motor territorial, do solver urbanístico, do REDE Engine e do REDE Score usados no cálculo. Entradas idênticas produzem saídas idênticas.

## Geometria e envelope

O lote é persistido como polígono GeoJSON em longitude/latitude ou como geometria cartesiana manual. Antes do cálculo, o domínio normaliza o anel, rejeita polígonos degenerados e detecta autointerseção. A importação e a exportação GeoJSON usam o mesmo contrato.

O envelope é derivado somente de parâmetros explicitamente informados:

- área computável: mínimo entre `área do lote × CA máximo` e a capacidade geométrica por pavimentos;
- projeção máxima: `área do lote × taxa de ocupação`;
- área permeável mínima: `área do lote × taxa de permeabilidade`;
- pavimentos: limite informado ou estimativa por altura máxima e pé-direito;
- recuos: offset convexo por aresta, respeitando frente, laterais e fundos;
- restrições: somente geometrias verificadas reduzem a área; ausência de dado gera aviso, nunca uma restrição inventada.

O 3D é uma representação paramétrica calculada do massing. Não é BIM, projeto arquitetônico nem simulação solar.

## Cenários e proveniência

`CURRENT_LEGAL` representa a leitura legal atual. `SIMULATED` representa alteração hipotética. Os dois contratos são separados no domínio, na persistência e na interface. Toda premissa urbanística contém valor, unidade, tipo da fonte, confiança, referência e data de verificação.

A confiança regulatória mede completude e qualidade das fontes; ela não altera automaticamente o resultado financeiro. Parâmetros ausentes permanecem `null` e aparecem como pendência de verificação.

### Barueri

O adaptador municipal registra como fontes oficiais a [página de zoneamento da Prefeitura de Barueri](https://portal.barueri.sp.gov.br/secretarias/secretaria-planejamento-urbanismo/mapa-zoneamento) e a [Lei Complementar nº 565/2023](https://portal.barueri.sp.gov.br/arquivos/sites/spcu/2024/Lei_Complementar_565_2023_juridico.pdf). O exemplo SRM normaliza apenas parâmetros confirmados no texto oficial. Não foi localizada uma API pública estruturada e estável para consulta cadastral de lotes, geometrias de restrição ou zoneamento por coordenada. Por isso, identificação do lote e restrições dependem de confirmação manual documentada; nenhuma URL de API foi presumida.

## Zoning Lab

O simulador recalcula em cascata, com debounce:

1. parâmetros urbanísticos;
2. envelope edificável;
3. área computável e programa;
4. unidades, torres, pavimentos e fases;
5. premissas do empreendimento;
6. REDE Engine;
7. stress territorial padronizado e REDE Score;
8. ranking, fronteira de Pareto, gap regulatório e uplift.

O solver reverso recebe a meta de produto e estima CA, ocupação, altura, pavimentos, densidade e estacionamento requeridos. O gap compara essa necessidade com a regra atual e marca `MEETS`, `CHANGE_REQUIRED` ou `NOT_VERIFIED`.

O uplift compara a alternativa atual com a proposta selecionada pelo ranking balanceado. Exibe variações calculadas de área, unidades, VGV, lucro, VPL, capital e Score; não representa valorização garantida do terreno.

Para manter a simulação interativa, cada alternativa executa um stress territorial padronizado (preço -10%, construção +10% e vendas +6 meses) como evidência de resiliência para o Score. A matriz completa do Sensitivity Engine permanece disponível para a alternativa escolhida no módulo analítico existente.

## Persistência e imutabilidade

`LandStudyVersion` segue `DRAFT → SNAPSHOT`. Na mesma transação são gravados fontes, cenários, restrições, envelopes, alternativas, execuções financeiras, Scores, solver reverso, gap e uplift. A versão é então bloqueada. Triggers PostgreSQL rejeitam atualização ou remoção do snapshot e de todos os artefatos dependentes.

Cada edição manual cria uma nova versão e um `LandAuditLog` com organização, usuário, entidade, operação e antes/depois. Todas as leituras e escritas atravessam `organizationId`, inclusive por meio do `LandAsset` e do `Project` associados.

## Adaptadores

As portas `GeocoderProvider`, `ParcelProvider`, `UrbanDataProvider`, `MapProvider`, `TerrainProvider` e `MunicipalityAdapter` isolam provedores externos. A Fase 5 inclui:

- `BarueriMunicipalityAdapter`, com metadados oficiais e fallback manual explícito;
- `ManualMunicipalityAdapter`, independente de fornecedor e sem tráfego externo;
- contratos preparados para provedores futuros de mapa, terreno e cadastro.

## Limitações assumidas

- o polígono demonstrativo e suas dimensões são manuais;
- topografia, APP, servidões, contaminação, faixas não edificáveis e tombamento não são inferidos;
- recuo geométrico usa um offset convexo aproximado, adequado a estudo preliminar;
- o 3D não contém insolação, ventilação, estrutura, fachadas ou colisões detalhadas;
- cenários simulados exigem validação técnica e jurídica antes de qualquer decisão de aquisição;
- não há ingestão automática de cadastro municipal enquanto não existir integração oficial confiável.

## Próximas evoluções recomendadas

Sem iniciar a Fase 6, a arquitetura está pronta para: adaptadores municipais adicionais, mapas/terreno com licença adequada, restrições georreferenciadas verificadas, solver multiobjetivo mais amplo, exportação de relatório e conexão da alternativa escolhida à comparação previsto × realizado.
