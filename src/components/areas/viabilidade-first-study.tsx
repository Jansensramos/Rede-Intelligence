"use client";

import { useState } from "react";
import { Calculator, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { createStudyForProjectAction } from "@/app/actions/studies";
import { ProjectEditor } from "@/components/project-editor";
import { EmptyState, SectionTitle } from "@/components/ui";
import { DEMO_PROJECT } from "@/domain/financial/demo";
import type { ProjectAssumptions } from "@/domain/financial/types";

export function ViabilidadeFirstStudy({
  project,
  canWrite,
}: {
  project: { id: string; name: string; city: string; state: string };
  canWrite: boolean;
}) {
  const router = useRouter();
  const [editorOpen, setEditorOpen] = useState(false);
  const initial: ProjectAssumptions = {
    ...structuredClone(DEMO_PROJECT),
    projectName: project.name,
    city: project.city,
    state: project.state,
    landPrice: "0",
    financingLimit: "0",
  };

  async function save(value: ProjectAssumptions) {
    const response = await createStudyForProjectAction(project.id, value);
    if (!response.ok) throw new Error(response.error);
    setEditorOpen(false);
    router.refresh();
  }

  return <div className="view-stack">
    <SectionTitle
      eyebrow="VIABILIDADE"
      title="Primeiro estudo do empreendimento"
      description="Este empreendimento já existe no REDE, mas ainda não possui um estudo de viabilidade. Crie a primeira versão sem duplicar o projeto."
    />
    {!canWrite && <div className="model-note"><div><strong>Modo de leitura</strong><p>Seu perfil pode consultar a área, mas não criar o primeiro estudo.</p></div></div>}
    <EmptyState
      icon={Calculator}
      title="Nenhum estudo ativo neste empreendimento"
      description="Cadastre as premissas iniciais para gerar cenários, índice de viabilidade, sensibilidade, revisão crítica, fluxo de caixa e trilha de cálculo."
    />
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PRÓXIMO PASSO</span>
          <h2>Criar a versão inicial</h2>
          <p>O formulário será preenchido com uma base de referência. Revise os valores antes de salvar; o estudo ficará vinculado ao empreendimento atual.</p>
        </div>
        <div className="panel-actions">
          <button className="button button-primary" disabled={!canWrite} onClick={() => setEditorOpen(true)}>
            <Plus size={16} /> Criar primeiro estudo
          </button>
        </div>
      </div>
    </section>
    {editorOpen && <ProjectEditor initial={initial} onClose={() => setEditorOpen(false)} onSave={save} />}
  </div>;
}
