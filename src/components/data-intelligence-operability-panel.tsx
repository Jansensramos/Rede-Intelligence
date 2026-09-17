"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { DatabaseZap, RefreshCw } from "lucide-react";
import type { DataIntelligenceWorkspace } from "@/application/data-intelligence/data-intelligence-service";
import { initializeDataIntelligenceAction, refreshDataIntelligenceAction } from "@/app/actions/data-intelligence";

export function DataIntelligenceOperabilityPanel({ workspace }: { workspace: DataIntelligenceWorkspace }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (op: () => Promise<{ ok: boolean; error?: string }>) => startTransition(async () => { const result = await op(); if (!result.ok) alert(result.error ?? "Não foi possível concluir."); else router.refresh(); });
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">INTELIGÊNCIA DE DADOS</span><h2>Governança e atualização dos dados</h2><p>Atualize a base analítica do empreendimento para manter comparativos, previsto x realizado, qualidade das informações e visão consolidada da carteira.</p></div><div className="panel-actions"><button className="button button-secondary" disabled={pending} onClick={() => act(initializeDataIntelligenceAction)}><DatabaseZap size={15}/> Preparar indicadores</button><button className="button button-primary" disabled={pending} onClick={() => act(() => refreshDataIntelligenceAction(workspace.projectId))}><RefreshCw size={15}/> Atualizar dados</button></div></div>
  </section>;
}
