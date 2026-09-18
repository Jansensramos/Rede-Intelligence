"use client";

/** Fase 10C.1 — Engenharia e Obra com operação humana na engenharia, orçamento e base operacional. */
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleDollarSign } from "lucide-react";
import { BudgetEditor } from "@/components/BudgetEditor";
import { DesignIntelligenceView } from "@/components/design-intelligence-view";
import { OperationsOperabilityPanel } from "@/components/operations-operability-panel";
import { OperationsView } from "@/components/operations-view";
import { EngineeringIntelligenceView } from "@/components/engineering-intelligence-view";
import { EmptyState, SectionTitle, Tabs } from "@/components/ui";
import type { DesignWorkspaceView } from "@/domain/design";
import type { BudgetWorkspaceView } from "@/application/budget/budget-service";
import type { OperationsWorkspaceView } from "@/application/operations/operations-service";
import type { EngineeringWorkspaceView } from "@/application/engineering/engineering-service";

type Funcao = "design" | "engenharia" | "orcamento";

export function EngenhariaObraWorkspace({ initialDesign, initialBudget, operations, engineering, canMutateDesign, canWriteOperations, canApproveOperations }: { initialDesign: DesignWorkspaceView; initialBudget: BudgetWorkspaceView | null; operations: OperationsWorkspaceView; engineering: EngineeringWorkspaceView; canMutateDesign: boolean; canWriteOperations: boolean; canApproveOperations: boolean; }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [design, setDesign] = useState(initialDesign);
  const [budget, setBudget] = useState(initialBudget);
  const requested = searchParams.get("f");
  const funcao: Funcao = requested === "orcamento" ? "orcamento" : requested === "engenharia" ? "engenharia" : "design";

  function setFuncao(next: Funcao) { router.replace(`/engenharia-obra?f=${next}`, { scroll: false }); }

  async function updateBudgetItem(itemId: string, updates: { description?: string; quantity?: number; unitCost?: number }) {
    if (!budget) return;
    const response = await fetch(`/api/budgets/${budget.id}/items/${itemId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    const payload = (await response.json()) as { success?: boolean; data?: BudgetWorkspaceView; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.error ?? "Não foi possível atualizar o item.");
    setBudget(payload.data);
  }

  async function deleteBudgetItem(itemId: string) {
    if (!budget) return;
    const response = await fetch(`/api/budgets/${budget.id}/items/${itemId}`, { method: "DELETE" });
    const payload = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível excluir o item.");
    const refreshed = await fetch(`/api/budgets/${budget.id}`);
    const refreshedPayload = (await refreshed.json()) as { data?: BudgetWorkspaceView; error?: string };
    if (!refreshed.ok || !refreshedPayload.data) throw new Error(refreshedPayload.error ?? "Não foi possível recarregar o orçamento.");
    setBudget(refreshedPayload.data);
  }

  return <div className="view-stack">
    <Tabs items={[{ key: "design", label: "Projetos e BIM" }, { key: "engenharia", label: "Engenharia e Orçamento Inteligente" }, { key: "orcamento", label: "Base e Execução" }]} activeKey={funcao} onChange={(key) => setFuncao(key as Funcao)} />
    {funcao === "design" && <DesignIntelligenceView initialWorkspace={design} canMutate={canMutateDesign} onWorkspaceChange={setDesign} onAskAI={(prompt) => router.push(`/assistente?prompt=${encodeURIComponent(prompt)}`)} />}
    {funcao === "engenharia" && <EngineeringIntelligenceView workspace={engineering} />}
    {funcao === "orcamento" && <div className="view-stack">
      <SectionTitle eyebrow="GESTÃO OPERACIONAL" title="Base Aprovada, Orçamento e Cronograma" description="Referências separadas, versionadas e rastreáveis para a execução do empreendimento." />
      <OperationsOperabilityPanel workspace={operations} canWrite={canWriteOperations} canApprove={canApproveOperations} />
      <OperationsView workspace={operations} />
      {budget ? <><SectionTitle eyebrow="ESTRUTURA ANALÍTICA" title={`${budget.name} · v${budget.version}`} description="Itens persistidos por empreendimento, organização e versão." /><BudgetEditor budgetId={budget.id} projectName={budget.projectName} lineItems={budget.lineItems} totalBudget={budget.totalBudget} summary={budget.summary} onUpdateItem={updateBudgetItem} onDeleteItem={deleteBudgetItem} readOnly={!canWriteOperations || ["APPROVED", "OFFICIAL", "SUPERSEDED", "CLOSED", "ARCHIVED"].includes(budget.status)} /></> : <EmptyState icon={CircleDollarSign} title="Nenhum orçamento cadastrado" description="Este empreendimento ainda não tem um orçamento oficial cadastrado." />}
    </div>}
  </div>;
}
