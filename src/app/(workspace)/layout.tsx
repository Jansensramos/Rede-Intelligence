import { FolderSearch } from "lucide-react";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { getContextSelectorOptions } from "@/application/workspace/context-options";
import { ClearContextButton } from "@/components/clear-context-button";
import { WorkspaceShell } from "@/components/workspace-shell";
import { EmptyState } from "@/components/ui";
import { requireAuthContext, listActiveUserOrganizations } from "@/application/auth/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canAccessWorkspacePath, INTERNAL_REQUEST_PATH_HEADER } from "@/domain/auth/read-capabilities";

/**
 * Layout do shell operacional (Fase 9K.1). Resolve o contexto operacional canônico e o alimenta
 * para todas as rotas de área (nível 1/2 do plano §F) — cada página de área ainda busca só o(s)
 * workspace(s) de que precisa (ordem de serviço §16); este layout nunca busca workspaces de
 * domínio, só a metadata de contexto (Organization → EconomicGroup → Company → Project) e as
 * opções do Seletor de Contexto (§7).
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const authContext = await requireAuthContext();
  const pathname = (await headers()).get(INTERNAL_REQUEST_PATH_HEADER) ?? "";
  if (!canAccessWorkspacePath(authContext.role, pathname)) redirect("/acesso-negado");
  const context = await getCurrentOperationalContext();
  const [contextGroups, memberships] = await Promise.all([
    getContextSelectorOptions(context.organization.id),
    listActiveUserOrganizations(authContext.userId),
  ]);

  if (!context.project) {
    if (pathname === "/ajuda" || pathname.startsWith("/ajuda/")) return <main className="workspace" style={{ marginLeft: 0 }}>{children}</main>;
    return (
      <div className="app-shell app-shell-empty">
        <main className="workspace" style={{ marginLeft: 0, display: "grid", placeItems: "center", minHeight: "100vh" }}>
          <EmptyState
            icon={FolderSearch}
            title="Nenhum empreendimento disponível"
            description="Esta organização ainda não tem nenhum empreendimento cadastrado, ou o empreendimento selecionado não existe mais. Limpe a seleção para tentar o empreendimento mais antigo da organização, ou execute o seed de demonstração."
          >
            <ClearContextButton />
          </EmptyState>
        </main>
      </div>
    );
  }

  return (
    <WorkspaceShell
      context={context}
      contextGroups={contextGroups}
      organizations={memberships.map((membership) => ({ id: membership.organizationId, name: membership.organization.name }))}
    >
      {children}
    </WorkspaceShell>
  );
}
