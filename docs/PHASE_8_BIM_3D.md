# Fase 8 — Projetos, BIM 3D e Engenharia de Valor

## Arquitetura entregue

- O IFC é validado e armazenado no storage privado já existente.
- `DesignProcessingJob` acompanha a fila e o processamento ocorre após a resposta da Server Action.
- `web-ifc` interpreta o STEP/IFC, resolve a árvore espacial, propriedades, materiais e malhas trianguladas.
- A geometria é serializada como artefato privado versionado; metadados, elementos e limites ficam no PostgreSQL.
- O cliente obtém apenas modelos da organização autenticada e renderiza as malhas com Three.js.

## Recursos

- navegação orbital, zoom, pan, ajuste, isolamento e exibição completa;
- seleção, multisseleção, realce, propriedades IFC e quantitativos;
- transparência, cortes horizontal/vertical e medição entre dois pontos;
- filtros por pavimento, tipo e busca;
- interferências rígidas, afastamento e duplicidade com vínculo a apontamento;
- comparação por GUID/fingerprint entre revisões;
- unidades e áreas inferidas com origem e confiança explícitas;
- métricas de área, eficiência e unidades enviadas ao Review Engine, sem duplicar fórmulas financeiras;
- Design Alternatives continuam sendo o sandbox governado para custo, VGV, margem e Índice REDE.

## Persistência

Migration: `20260820161313_bim_geometry_viewer_clashes`.

Novos modelos: `BimModel`, `BimElement` e `BimRevisionComparison`. `DesignClash` recebeu tipologia, estado, elementos relacionados, coordenada, responsável, origem e vínculo com apontamento.

## Limites declarados

- Não é um editor CAD/BIM e não altera o IFC oficial.
- Quantitativos de caixa envolvente são classificados como confiança baixa e exigem validação profissional.
- A detecção v1 usa broad phase por AABB e narrow phase por interseção de triângulos; casos coplanares e modelos sem malha completa ainda precisam de revisão técnica.
- Modelos grandes são fragmentados por elemento e persistidos fora do banco, mas a tesselação ainda ocorre em um único worker do processo de aplicação.

## Validação

A suíte inclui uma fixture IFC4 pequena e real, além de testes de transformação, limites, quantitativos, interferências e diff. Antes da entrega são executados Prisma validate/generate, migration status, TypeScript, lint, testes e build de produção.
