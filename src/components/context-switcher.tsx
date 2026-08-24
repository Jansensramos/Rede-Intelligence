"use client";

/**
 * Seletor de Contexto (Fase 9K.1, ordem de serviço §7): Grupo → Empresa/SPE → Empreendimento,
 * sobre o `OperationalContext` da 9K.0. Regras aplicadas aqui:
 *
 * - só lista opções da organização autenticada (`getContextSelectorOptions`, escopo por tenant);
 * - a troca só acontece quando o usuário confirma explicitamente ("Aplicar seleção") — nunca ao
 *   simplesmente abrir um `<select>` em cascata;
 * - `setActiveProjectAction` revalida o `projectId` contra `organizationId` no servidor antes de
 *   gravar o cookie de sessão — um id inválido nunca é aceito silenciosamente.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { setActiveProjectAction } from "@/app/actions/workspace-context";
import type { ContextOptionGroup } from "@/application/workspace/context-options";

const companyTypeLabel: Record<string, string> = {
  HOLDING: "Holding",
  SPE: "SPE",
  INCORPORATOR: "Incorporadora",
  CONSTRUCTION: "Construtora",
  SERVICES: "Serviços",
  OTHER: "Outra",
};

export function ContextSwitcher({
  organizationName,
  groups,
  currentProjectId,
  onClose,
}: {
  organizationName: string;
  groups: ContextOptionGroup[];
  currentProjectId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const initial = useMemo(() => {
    for (const group of groups) {
      for (const company of group.companies) {
        const project = company.projects.find((item) => item.id === currentProjectId);
        if (project) return { groupKey: group.id ?? "", companyId: company.id, projectId: project.id };
      }
    }
    return { groupKey: groups[0]?.id ?? "", companyId: groups[0]?.companies[0]?.id ?? "", projectId: "" };
  }, [groups, currentProjectId]);

  const [groupKey, setGroupKey] = useState(initial.groupKey);
  const [companyId, setCompanyId] = useState(initial.companyId);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedGroup = groups.find((group) => (group.id ?? "") === groupKey);
  const companies = selectedGroup?.companies ?? [];
  const selectedCompany = companies.find((company) => company.id === companyId);
  const projects = selectedCompany?.projects ?? [];

  function handleGroupChange(nextKey: string) {
    setGroupKey(nextKey);
    const nextGroup = groups.find((group) => (group.id ?? "") === nextKey);
    const nextCompany = nextGroup?.companies[0];
    setCompanyId(nextCompany?.id ?? "");
    setProjectId(nextCompany?.projects[0]?.id ?? "");
  }

  function handleCompanyChange(nextCompanyId: string) {
    setCompanyId(nextCompanyId);
    const nextCompany = companies.find((company) => company.id === nextCompanyId);
    setProjectId(nextCompany?.projects[0]?.id ?? "");
  }

  async function applySelection() {
    if (!projectId) {
      setError("Selecione um empreendimento.");
      return;
    }
    setSaving(true);
    setError(null);
    const response = await setActiveProjectAction(projectId);
    if (!response.ok) {
      setError(response.error);
      setSaving(false);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ctx-switcher-panel" role="dialog" aria-modal="true" aria-labelledby="ctx-switcher-title">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 id="ctx-switcher-title">Trocar de contexto</h2>
            <p>{organizationName} · Grupo, Empresa/SPE e Empreendimento</p>
          </div>
          <button className="sidebar-close" style={{ color: "var(--ink-muted)" }} onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>

        <div className="ctx-switcher-fields">
          <label className="ctx-switcher-field">
            <span>Grupo econômico</span>
            <select value={groupKey} onChange={(event) => handleGroupChange(event.target.value)} disabled={groups.length === 0}>
              {groups.length === 0 && <option value="">Nenhum grupo disponível</option>}
              {groups.map((group) => <option key={group.id ?? "sem-grupo"} value={group.id ?? ""}>{group.name}</option>)}
            </select>
          </label>

          <label className="ctx-switcher-field">
            <span>Empresa / SPE</span>
            <select value={companyId} onChange={(event) => handleCompanyChange(event.target.value)} disabled={companies.length === 0}>
              {companies.length === 0 && <option value="">Nenhuma empresa disponível</option>}
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name} · {companyTypeLabel[company.type] ?? company.type}</option>)}
            </select>
          </label>

          <label className="ctx-switcher-field">
            <span>Empreendimento</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={projects.length === 0}>
              {projects.length === 0 && <option value="">Nenhum empreendimento disponível</option>}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.city}/{project.state}</option>)}
            </select>
          </label>
        </div>

        {error && <p className="ctx-switcher-error">{error}</p>}

        <div className="ctx-switcher-actions">
          <button className="button button-secondary" onClick={onClose} type="button">Cancelar</button>
          <button className="button button-primary" onClick={() => void applySelection()} disabled={saving || !projectId} type="button">
            {saving ? "Aplicando…" : "Aplicar seleção"}
          </button>
        </div>
      </section>
    </div>
  );
}
