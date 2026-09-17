"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { DatabaseZap, RefreshCw } from "lucide-react";
import type { DataIntelligenceWorkspace } from "@/application/data-intelligence/data-intelligence-service";
import { initializeDataIntelligenceAction, refreshAnalyticsFactsAction } from "@/app/actions/data-intelligence";

export function DataIntelligenceOperabilityPanel({ workspace }: { workspace: DataIntelligenceWorkspace }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (op: () => Promise<{ ok: boolean; error?: string }>) => startTransition(async () => { const result = await op(); if (!result.ok) alert(result.error ?? "Não foi possível concluir."); else router.refresh(); });
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">OPERAÇÃO HUMANA · 10C.1</span><h2>Governança e atualização dos dados</h2><p>A fundação analítica e o reprocessamento são executados por usuário autorizado; métricas derivadas continuam sendo calculadas pelo Engine.</p></div><div className="panel-actions"><button className="button button-secondary" disabled={pending} onClick={() => act(initializeDataIntelligenceAction)}><DatabaseZap size={15}/> Inicializar contratos e métricas</button><button className="button button-primary" disabled={pending} onClick={() => act(() => refreshAnalyticsFactsAction(workspace.projectId))}><RefreshCw size={15}/> Atualizar fatos analíticos</button></div></div>
  </section>;
}
