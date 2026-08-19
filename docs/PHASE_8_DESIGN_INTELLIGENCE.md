# Fase 8 — REDE Design Intelligence

## Resultado

A Fase 8 introduz uma camada auditável de revisão de projeto sobre o REDE Intelligence. O módulo recebe arquivos privados, preserva revisões, extrai apenas fatos demonstráveis, calcula métricas determinísticas, registra findings com evidência, prioriza Value Engineering e permite testar alternativas no Engine e no REDE Score sem alterar a baseline oficial.

O princípio central é conservador: um dado ausente permanece `UNKNOWN`, `NOT_INFORMED` ou com confiança explícita. O sistema não cria paredes, áreas, layers, clashes, escalas ou quantitativos que o arquivo não contém e o adaptador não consegue demonstrar.

## Fluxo implementado

```text
Project Package
  -> Revision imutável
    -> Upload privado + SHA-256 + validação de magic bytes
      -> Processing Job persistido
        -> adaptador por formato
          -> Sheets / métricas observadas / proveniência
            -> revisão determinística
              -> findings + evidências + scorecard de design
                -> oportunidades de VE
                  -> alternativa isolada
                    -> REDE Engine + REDE Score
                      -> Studio + Data Room + Master Report
```

O processamento ocorre hoje no request da aplicação, mas cada transição fica persistida em `DesignProcessingJob`. A fronteira `DesignFileAdapter` permite substituir o executor inline por uma fila durável e integrar OCR, conversores CAD ou serviços BIM sem alterar o domínio.

## Modelo de dados e auditoria

A migration `20260818030000_rede_design_intelligence` adiciona entidades tenant-scoped para:

- packages, revisions, files, sheets e processing jobs;
- metrics com unidade, origem, confiança, método e localização;
- findings, evidências, respostas, rodadas e decisões;
- oportunidades de VE, alternativas, impactos e mudanças;
- baselines, requirements, rule sets, rules e checks;
- unidades detectadas, clashes e audit log.

As migrations complementares adicionam `DESIGN` às fontes de evidência do REDE AI e `DESIGN_REVIEW_REPORT` aos artefatos do Studio. Todas as leituras e mutações da aplicação filtram `organizationId`; o download também revalida organização e projeto.

## Ingestão e suporte por formato

| Formato | Estado | Extração demonstrável |
|---|---|---|
| PDF | funcional, conservador | número e tamanho das páginas, metadados do documento; visualização nativa autenticada |
| PNG/JPG/WEBP | funcional | dimensões e visualização autenticada |
| IFC | parcial e seguro | schema STEP, projeto, edifício, pavimentos e contagem de entidades; árvore de metadados |
| DXF | parcial | identificação do cabeçalho e layers textuais disponíveis |
| CSV/GeoJSON | funcional | conteúdo tabular/estruturado com validação |
| XLSX/DOCX | parcial | identificação OpenXML e metadados do pacote |
| DWG/RVT | conversão requerida | arquivo preservado; nenhum parser frágil ou geometria fictícia |

Arquivos são gravados pelo `LocalPrivateFileStorage` em namespace de organização/package, com chave aleatória, permissão restrita e checksum SHA-256. Não existe URL pública. A rota autenticada suporta `Range`, `Cache-Control: private, no-store`, `nosniff` e CSP sandbox.

Validações atuais: extensão, MIME, assinatura/magic bytes, tamanho máximo de 250 MB, nome seguro e resolução de path contra traversal.

## Métricas, revisão e proveniência

O review engine é puro e determinístico. Ele calcula, quando as entradas necessárias existem:

- área privativa, total, circulação, core e áreas comuns;
- eficiência privativa/total e fator de circulação;
- vagas por unidade;
- reconciliação do quadro de áreas com tolerâncias;
- desvios contra requisitos e contra o Engine;
- variações entre revisões por métrica;
- Design Scorecard separado do REDE Score.

Cada métrica calculada recebe evidência de cálculo e registra método, unidade e inputs. Findings carregam tipo, severidade, status, confiança, disciplina, localização, regra/método e evidências. Ordenação, thresholds e matriz valor × esforço são determinísticos.

A escala de prancha começa como `UNKNOWN`. A calibração manual exige uma distância em pixels e uma distância real, persiste fator, unidade, método e auditoria. Nenhuma medição é apresentada como precisa sem essa base.

## Workspace

O item **Design** da navegação entrega:

- dashboard de prontidão, eficiência, drift, scorecard e limitações;
- browser de arquivos e revisões;
- viewer PDF/imagem autenticado;
- árvore IFC de metadados, explicitamente sem geometria 3D;
- histórico e diff de revisões;
- register e detalhe de findings com evidências;
- pins/manuais e calibração de escala;
- matriz de Value Engineering;
- Design Sandbox com comparação antes/depois no Engine e Score;
- geração e download do Design Review Report.

## Integrações

- **Engine e Score:** toda alternativa usa o motor financeiro e o score versionados já existentes. O impacto persistido inclui baseline, cenário e deltas; não há fórmula financeira duplicada no módulo de design.
- **Data Room:** uploads são indexados como `ProjectDocument` sem duplicar o conteúdo; relatórios finais recebem artefato Studio e documento `DESIGN_REPORT` com checksum.
- **Studio:** gera PDF institucional real de Design Review, com 26 seções, Report ID, versão, páginas e checksum.
- **Master Report:** o nível completo inclui seção Design Intelligence e preflight quando não há Design Review final.
- **REDE AI:** contexto, métricas, findings, oportunidades e comparação de revisões estão disponíveis como ferramentas read-only com evidência `DESIGN`. “Gere o Design Review Report” cria uma ação pendente e somente Owner/Admin pode confirmá-la.
- **Baseline e revisão:** criar nova revisão preserva a anterior, atualiza o ponteiro corrente, produz diff e grava auditoria.

## Segurança e isolamento

- storage privado com path canônico e proteção contra traversal;
- consulta tenant-scoped em package, arquivo, relatório e download;
- SHA-256 no upload e no relatório;
- resposta de arquivo sem cache público e com headers de hardening;
- ações de IA mutáveis exigem preview, confirmação e papel Owner/Admin;
- upload não é usado como prompt ou fonte de instruções confiáveis;
- nenhum dado de negócio é gravado em `localStorage`.

## Limites reais desta entrega

Estes itens não são vendidos como concluídos:

- PDF não tem ainda extração vetorial/textual completa, OCR, leitura automática de carimbo ou detecção geométrica de ambientes;
- IFC não tem tesselação, viewer 3D, seleção por GUID, propriedades completas, clash geométrico, BCF, 4D ou 5D;
- DXF é metadata/layer inspection, não reconstrução CAD;
- DWG e RVT dependem de conversor externo;
- XLSX/DOCX recebem inspeção OpenXML parcial, não um extrator especializado de quadro de áreas;
- jobs são persistidos, porém executados inline; faltam fila durável, retry worker, heartbeat e observabilidade de workers;
- o upload via Server Action tem limite configurado de 250 MB e usa buffering; grandes arquivos exigem upload streaming/presigned;
- o viewer 2D usa os renderizadores do navegador e pins, sem redline vetorial completo, overlay de revisões ou thumbnails geradas pelo servidor;
- as entidades de rule packs, requirements e clashes existem, mas normas municipais, acessibilidade, incêndio, checks de rota e rule packs configuráveis ainda não foram codificados;
- não há benchmark real de IFC muito grande nem visualização progressiva de geometria;
- promoções diretas de finding para Red Team/Risk/Committee não estão expostas na UI nesta versão;
- o relatório registra localizações/evidências textuais, mas ainda não renderiza snapshots/redlines capturados da prancha.

Esses limites são intencionais: completar os itens acima requer motores CAD/BIM/OCR, filas e datasets normativos específicos. Os contratos e estados persistidos foram preparados para essas integrações, mas sua existência não é tratada como implementação.

## Validação

```powershell
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Os testes da Fase 8 cobrem adaptadores, guardrails de upload, reconciliação de áreas, findings derivados, VE, diff de revisão, relatório de 26 seções, persistência/proveniência, isolamento entre organizações, alternativa no Engine/Score e publicação Studio/Data Room.

## Matriz de aceite em 40 pontos

| # | Entrega | Estado |
|---:|---|---|
| 1 | Item Design na navegação | Implementado |
| 2 | Project Package tenant-scoped | Implementado |
| 3 | Revisions preservadas | Implementado |
| 4 | Files, sheets e jobs persistidos | Implementado |
| 5 | Storage privado e checksum | Implementado |
| 6 | Validação extensão/MIME/magic/size | Implementado |
| 7 | Download autenticado com Range | Implementado |
| 8 | Pipeline com estados e erros | Implementado inline |
| 9 | PDF metadata/page inspection | Implementado parcial |
| 10 | Imagens autenticadas | Implementado |
| 11 | IFC metadata tree | Implementado parcial, sem 3D |
| 12 | DXF layer metadata | Implementado parcial |
| 13 | DWG/RVT preservados | Conversão externa requerida |
| 14 | CSV/GeoJSON | Implementado |
| 15 | XLSX/DOCX OpenXML | Implementado parcial |
| 16 | Métricas com origem/confiança | Implementado |
| 17 | Evidência de cálculo | Implementado |
| 18 | Calibração manual de escala | Implementado |
| 19 | Reconciliação de áreas | Implementado |
| 20 | Eficiência e circulação | Implementado |
| 21 | Produto/unidades/vagas | Implementado conforme dados |
| 22 | Checks urbanos básicos | Implementado conforme dados |
| 23 | Design Scorecard separado | Implementado |
| 24 | Findings com evidência | Implementado |
| 25 | Register e detalhe | Implementado |
| 26 | Pins/findings manuais | Implementado |
| 27 | Review rounds e responses | Modelo/persistência implementados |
| 28 | VE value × effort | Implementado |
| 29 | Benefício sem falsa precisão | Implementado |
| 30 | Alternativas isoladas | Implementado |
| 31 | Alternativa → Engine | Implementado |
| 32 | Alternativa → REDE Score | Implementado |
| 33 | Revision diff/drift | Implementado |
| 34 | Baseline e requirements | Implementado |
| 35 | Data Room sem conteúdo duplicado | Implementado |
| 36 | REDE AI design tools/evidence | Implementado |
| 37 | Relatório via confirmação AI | Implementado |
| 38 | Studio Design Review PDF | Implementado |
| 39 | Master Report Design section | Implementado |
| 40 | Testes, seed, lint, types e build | Automatizado; resultados na entrega |

