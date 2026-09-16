/**
 * Fase 10C (Tool Layer) - superficie publica do pacote (ALTO-2, correcao focal
 * pos-auditoria). Export nomeado e explicito, nunca `export *`: `prepareAiToolInvocation` e
 * `consumeAiToolInvocation` (definidas em `./service`) deliberadamente NAO aparecem aqui.
 * `executeAiTool` e o unico caminho publico capaz de produzir evidencia; `getAiToolSpec`/
 * `listAiTools` sao metadado de catalogo, sem logica de execucao (nunca incluem `execute`).
 */
export { executeAiTool } from "./service";
export { getAiToolSpec, listAiTools } from "./catalog";
