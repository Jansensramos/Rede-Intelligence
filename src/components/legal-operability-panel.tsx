"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Gavel, Landmark, RotateCcw } from "lucide-react";
import type { LegalWorkspaceView } from "@/application/legal/legal-service";
import {
  createDueDiligenceCaseAction,
  recordLegalDecisionAction,
  reverseLegalFinancialEventAction,
  sendLegalObligationToFinanceAction,
} from "@/app/actions/legal";

export function LegalOperabilityPanel({ workspace }: { workspace: LegalWorkspaceView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (op: () => Promise<{ ok: boolean; error?: string }>) => startTransition(async () => {
    const result = await op();
    if (!result.ok) window.alert(result.error ?? "Não foi possível concluir a operação.");
    else router.refresh();
  });

  function newDiligence() {
    const code = window.prompt("Código da diligência:", `DD-${Date.now().toString().slice(-6)}`); if (!code) return;
    const title = window.prompt("Título da diligência:"); if (!title) return;
    const scope = window.prompt("Escopo da diligência:"); if (!scope) return;
    act(() => createDueDiligenceCaseAction({ projectId: workspace.projectId, code, title, scope }));
  }

  function decide(caseId: string) {
    const decision = window.prompt("Decisão: PROCEED, PROCEED_WITH_CONDITIONS, HOLD, DO_NOT_PROCEED ou INSUFFICIENT_EVIDENCE", "PROCEED_WITH_CONDITIONS");
    if (!decision || !["PROCEED", "PROCEED_WITH_CONDITIONS", "HOLD", "DO_NOT_PROCEED", "INSUFFICIENT_EVIDENCE"].includes(decision)) return;
    const conclusion = window.prompt("Conclusão jurídica:"); if (!conclusion) return;
    act(() => recordLegalDecisionAction(caseId, { decision: decision as "PROCEED" | "PROCEED_WITH_CONDITIONS" | "HOLD" | "DO_NOT_PROCEED" | "INSUFFICIENT_EVIDENCE", conclusion }));
  }

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">JURÍDICO</span><h2>Operações jurídicas</h2><p>Abra diligências, registre decisões e acompanhe obrigações com reflexo financeiro.</p></div><button className="button button-primary" disabled={pending} onClick={newDiligence}><FilePlus2 size={16}/> Nova diligência</button></div>
    <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Tipo</th><th>Registro</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
      {workspace.cases.filter((item) => item.status !== "COMPLETED").slice(0,10).map((item) => <tr key={item.id}><td>Diligência</td><td><strong>{item.code} · {item.title}</strong></td><td>{item.status}</td><td><button className="button button-secondary" disabled={pending} onClick={() => decide(item.id)}><Gavel size={15}/> Registrar decisão</button></td></tr>)}
      {workspace.obligations.slice(0,10).map((item) => { const processed = item.financialEvents?.some((event) => event.status === "PROCESSED"); return <tr key={item.id}><td>Obrigação</td><td><strong>{item.code} · {item.title}</strong></td><td>{item.status}</td><td>{processed ? <button className="button button-secondary" disabled={pending} onClick={() => { const reason = window.prompt("Motivo da reversão:"); if (reason) act(() => reverseLegalFinancialEventAction(item.id, reason)); }}><RotateCcw size={15}/> Reverter financeiro</button> : <button className="button button-secondary" disabled={pending || !item.amount} onClick={() => act(() => sendLegalObligationToFinanceAction(item.id))}><Landmark size={15}/> Enviar ao Financeiro</button>}</td></tr>})}
      {workspace.cases.length === 0 && workspace.obligations.length === 0 && <tr><td colSpan={4}>Nenhum registro jurídico. Use “Nova diligência” para iniciar.</td></tr>}
    </tbody></table></div>
  </section>;
}
