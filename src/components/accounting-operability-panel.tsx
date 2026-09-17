"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookCheck, LockKeyhole } from "lucide-react";
import type { AccountingWorkspaceView } from "@/application/accounting/accounting-service";
import { closeAccountingPeriodAction, postAccountingEventAction } from "@/app/actions/accounting";

export function AccountingOperabilityPanel({ workspace }: { workspace: AccountingWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (op: () => Promise<{ ok: boolean; error?: string }>) => startTransition(async () => { const result = await op(); if (!result.ok) alert(result.error ?? "Não foi possível concluir."); else router.refresh(); });
  const classified = workspace.events.filter((event) => event.status === "CLASSIFIED");
  const closable = workspace.periods.filter((period) => ["OPEN", "UNDER_REVIEW", "REOPENED", "ADJUSTMENT"].includes(period.status));
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">OPERAÇÃO HUMANA · 10C.1</span><h2>Contabilização e Fechamento</h2><p>Eventos classificados podem ser contabilizados e períodos podem ser fechados com as validações do domínio.</p></div></div>
    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Tipo</th><th>Registro</th><th>Status</th><th>Ação humana</th></tr></thead><tbody>
      {classified.slice(0,12).map(event => <tr key={event.id}><td>Evento</td><td><strong>{event.sourceModule} · {event.sourceType}</strong><small>{event.sourceId} · {event.netAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</small></td><td>{event.status}</td><td><button className="button button-secondary" disabled={pending || !workspace.permissions.canPost} onClick={() => { const description = prompt("Histórico/descrição do lançamento (opcional):") || undefined; act(() => postAccountingEventAction(event.id, description)); }}><BookCheck size={15}/> Contabilizar</button></td></tr>)}
      {closable.slice(0,8).map(period => <tr key={period.id}><td>Período</td><td><strong>{new Date(period.referenceMonth).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}</strong></td><td>{period.status}</td><td><button className="button button-primary" disabled={pending || !workspace.permissions.canClose} onClick={() => { if (confirm("Confirma que o checklist de fechamento foi revisado e está completo?")) act(() => closeAccountingPeriodAction(period.id)); }}><LockKeyhole size={15}/> Fechar período</button></td></tr>)}
      {classified.length === 0 && closable.length === 0 && <tr><td colSpan={4}>Nenhum evento classificado ou período disponível para ação.</td></tr>}
    </tbody></table></div>
  </section>;
}
