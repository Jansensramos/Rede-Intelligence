import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Fechamento da 9K.1: bug encontrado durante o smoke de troca de contexto (não fazia parte da lista
 * original de gates, mas é do mesmo domínio — "troca de contexto é fluxo central da 9K.1").
 *
 * Causa: os componentes client de área que espelham os dados do servidor em `useState(initialX)`
 * (para permitir edição local depois de uma mutação) não são remontados quando o usuário troca de
 * empreendimento pelo Seletor de Contexto — `router.refresh()` re-executa a página server e passa
 * props novas, mas React só usa `useState(initialX)` no PRIMEIRO mount; sem uma `key` que mude
 * junto com o projeto, o componente continua de pé com o estado do projeto ANTERIOR. Reproduzido
 * manualmente: trocar de projeto e abrir Viabilidade → Comitê mostrava o título do Investment Case
 * do projeto anterior até um refresh manual da página.
 *
 * Correção: `key={projectId}` no componente de área dentro de cada `page.tsx` afetado — força
 * remount completo (e portanto reinicialização de todo `useState(initialX)`) exatamente quando o
 * projeto muda, sem alterar nenhuma lógica de domínio. Não afeta os componentes de área que leem os
 * workspaces direto de props (sem espelhar em `useState`) — esses já reagem a props novas
 * corretamente.
 *
 * Não há harness de teste de componente React neste projeto (sem RTL/jsdom) — este teste é uma
 * rede de segurança estrutural: garante que a `key={projectId}` não seja removida por engano.
 */
const workspaceAppDir = fileURLToPath(new URL("../../app/(workspace)/", import.meta.url));

function readPage(segment: string) {
  return readFileSync(`${workspaceAppDir}${segment}/page.tsx`, "utf-8");
}

describe("componentes de área com estado local espelhado (useState(initialX)) são remontados por projeto", () => {
  it("Viabilidade: ViabilidadeWorkspace tem key por projectId", () => {
    expect(readPage("viabilidade")).toMatch(/<ViabilidadeWorkspace\s+key=\{projectId\}/);
  });

  it("Mercado e Produto: MercadoProdutoWorkspace tem key por projeto", () => {
    expect(readPage("mercado-produto")).toMatch(/<MercadoProdutoWorkspace\s+key=\{context\.project\.id\}/);
  });

  it("Engenharia e Obra: EngenhariaObraWorkspace tem key por projectId", () => {
    expect(readPage("engenharia-obra")).toMatch(/<EngenhariaObraWorkspace\s+key=\{projectId\}/);
  });

  it("Integrações: IntegracoesClient tem key por projeto", () => {
    expect(readPage("integracoes")).toMatch(/<IntegracoesClient\s+key=\{context\.project\.id\}/);
  });

  it("Assistente (REDE AI): AssistenteClient tem key por projeto — preserva projectId sem mostrar bootstrap do projeto anterior", () => {
    expect(readPage("assistente")).toMatch(/<AssistenteClient\s+key=\{context\.project\.id\}/);
  });
});
