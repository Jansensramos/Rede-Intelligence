import { FolderSearch } from "lucide-react";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { getContextSelectorOptions } from "@/application/workspace/context-options";
import { WorkspaceShell } from "@/components/workspace-shell";
import { EmptyState } from "@/components/ui";

/**
 * Layout do shell operacional (Fase 9K.1). Resolve o contexto operacional canônico e o alimenta
 * para todas as rotas de área (nível 1/2 do plano §F) — cada página de área ainda busca só o(s)
 * workspace(s) de que precisa (ordem de serviço §16); este layout nunca busca workspaces de
 * domínio, só a metadata de contexto (Organization → EconomicGroup → Company → Project) e as
 * opções do Seletor de Contexto (§7).
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const context = await getCurrentOperationalContext();
  const contextGroups = await getContextSelectorOptions(context.organization.id);

  if (!context.project) {
    return (
      <div className="app-shell app-shell-empty">
        <main className="workspace" style={{ marginLeft: 0, display: "grid", placeItems: "center", minHeight: "100vh" }}>
          <EmptyState
            icon={FolderSearch}
            title="Nenhum empreendimento disponível"
            description="Esta organização ainda não tem nenhum empreendimento cadastrado, ou o empreendimento selecionado não existe mais. Execute o seed de demonstração ou crie um novo estudo para começar."
          />
        </main>
      </div>
    );
  }

  return (
    <WorkspaceShell context={context} contextGroups={contextGroups}>
      {children}
    </WorkspaceShell>
  );
}
