"use client";

/**
 * Fase 9K.1 — área Mercado e Produto. Sub-navegação (nível 2) via query string `?f=`, não estado
 * de componente: preserva a função aberta em refresh e permite compartilhar o link direto para
 * "Inteligência de Produto", por exemplo (ordem de serviço §5).
 */
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MembershipRole } from "@prisma/client";
import { decideProductScenarioAction, generateProductScenariosAction } from "@/app/actions/market-product";
import { MarketIntelligenceView } from "@/components/market-intelligence-view";
import { ProductIntelligenceView } from "@/components/product-intelligence-view";
import { SectionTitle, Tabs } from "@/components/ui";
import type { MarketProductWorkspaceView } from "@/application/market-product";

type Funcao = "mercado" | "produto";

export function MercadoProdutoWorkspace({ initialWorkspace, role }: { initialWorkspace: MarketProductWorkspaceView; role: MembershipRole }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const funcao: Funcao = searchParams.get("f") === "produto" ? "produto" : "mercado";

  function setFuncao(next: Funcao) {
    router.replace(`/mercado-produto?f=${next}`, { scroll: false });
  }

  async function handleGenerate() {
    if (!workspace.marketArea) throw new Error("Nenhuma área de mercado configurada.");
    const response = await generateProductScenariosAction({
      marketAreaId: workspace.marketArea.id,
      landAssetId: workspace.marketArea.landAssetId ?? undefined,
      projectId: workspace.marketArea.projectId ?? undefined,
      standard: "MEDIO",
    });
    if (!response.ok) throw new Error(response.error);
    setWorkspace(response.data);
  }

  async function handleDecide(scenarioId: string, decision: "APPROVED" | "REJECTED", decisionRationale: string) {
    const response = await decideProductScenarioAction({ scenarioId, decision, decisionRationale });
    if (!response.ok) throw new Error(response.error);
    setWorkspace(response.data);
  }

  return (
    <div className="view-stack">
      <Tabs
        items={[{ key: "mercado", label: "Inteligência de Mercado" }, { key: "produto", label: "Inteligência de Produto" }]}
        activeKey={funcao}
        onChange={(key) => setFuncao(key as Funcao)}
      />

      {funcao === "mercado" && (
        <>
          <SectionTitle
            eyebrow="INTELIGÊNCIA DE MERCADO"
            title="Área de influência, demografia, renda, oferta e preços"
            description="Neste terreno e nesta localização: o que o mercado mostra, com proveniência e nível de confiança explícitos."
          />
          <MarketIntelligenceView workspace={workspace} />
        </>
      )}

      {funcao === "produto" && (
        <>
          <SectionTitle
            eyebrow="INTELIGÊNCIA DE PRODUTO"
            title="O que construir, para quem, em qual configuração e em qual faixa de preço"
            description="Três cenários sempre comparáveis, simulados no REDE Engine, com decisão humana obrigatória e memória imutável."
          />
          <ProductIntelligenceView workspace={workspace} role={role} onGenerate={handleGenerate} onDecide={handleDecide} />
        </>
      )}
    </div>
  );
}
