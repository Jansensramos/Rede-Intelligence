"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, CheckCircle2, RotateCcw, WalletCards } from "lucide-react";
import {
  approveProjectClosureDistributionAction,
  approveProjectClosureResultAction,
  createProjectClosureDistributionAction,
  listProjectClosureDistributionsAction,
  prepareProjectClosureResultAction,
  reopenProjectClosureResultAction,
} from "@/app/actions/closure";

type LatestClosure = { id: string; status: string; version: number } | null;
type Gate = { overall: string; operational: { status: string }; contractual: { status: string }; legal: { status: string }; financial: { status: string }; accounting: { status: string } };

export function ClosureOperabilityPanel({ projectId, latest, gate }: { projectId: string; latest: LatestClosure; gate: Gate }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (op: () => Promise<{ ok: boolean; error?: string }>) => startTransition(async () => {
    const result = await op();
    if (!result.ok) alert(result.error ?? "Não foi possível concluir a operação de encerramento.");
    else router.refresh();
  });

  const reopen = () => {
    if (!latest) return;
    const reason = prompt("Justificativa da reabertura:"); if (!reason) return;
    const evidence = prompt("Referência da evidência que sustenta a reabertura:"); if (!evidence) return;
    act(() => reopenProjectClosureResultAction({ closureResultId: latest.id, reason, evidenceRefs: [{ type: "MANUAL_REFERENCE", reference: evidence }] }));
  };

  const createDistribution = () => {
    if (!latest) return;
    const beneficiaryName = prompt("Beneficiário:"); if (!beneficiaryName) return;
    const beneficiaryTaxId = prompt("CPF/CNPJ do beneficiário:"); if (!beneficiaryTaxId) return;
    const beneficiaryType = prompt("Tipo: OWNER, PARTNER ou INVESTOR", "PARTNER"); if (!beneficiaryType || !["OWNER", "PARTNER", "INVESTOR"].includes(beneficiaryType)) return;
    const nature = prompt("Natureza: CAPITAL_CONTRIBUTION, CAPITAL_RETURN, REMUNERATION, RESULT_DISTRIBUTION, RETENTION ou PROVISION", "RESULT_DISTRIBUTION"); if (!nature || !["CAPITAL_CONTRIBUTION", "CAPITAL_RETURN", "REMUNERATION", "RESULT_DISTRIBUTION", "RETENTION", "PROVISION"].includes(nature)) return;
    const amount = Number(prompt("Valor:")); if (!Number.isFinite(amount) || amount <= 0) return;
    const sourceType = prompt("Tipo da origem/evidência:", "MANUAL_REFERENCE"); if (!sourceType) return;
    const sourceId = prompt("Identificador da origem/evidência:"); if (!sourceId) return;
    act(() => createProjectClosureDistributionAction({ closureResultId: latest.id, beneficiaryName, beneficiaryTaxId, beneficiaryType: beneficiaryType as "OWNER" | "PARTNER" | "INVESTOR", nature: nature as "CAPITAL_CONTRIBUTION" | "CAPITAL_RETURN" | "REMUNERATION" | "RESULT_DISTRIBUTION" | "RETENTION" | "PROVISION", amount, eventDate: new Date(), sourceType, sourceId, evidenceRefs: [{ type: sourceType, id: sourceId }] }));
  };

  const approvePendingDistribution = () => {
    if (!latest) return;
    startTransition(async () => {
      const listed = await listProjectClosureDistributionsAction(latest.id);
      if (!listed.ok) return alert(listed.error);
      const pendingRows = listed.data.filter((row) => row.status === "DRAFT");
      if (pendingRows.length === 0) return alert("Não há distribuição em rascunho para aprovar.");
      const options = pendingRows.map((row) => `${row.id} · ${row.beneficiaryName} · ${Number(row.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`).join("\n");
      const id = prompt(`Informe o ID da distribuição a aprovar:\n${options}`, pendingRows[0]?.id); if (!id) return;
      const result = await approveProjectClosureDistributionAction({ distributionId: id });
      if (!result.ok) alert(result.error); else router.refresh();
    });
  };

  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">ENCERRAMENTO DO EMPREENDIMENTO</span><h2>Fechamento e distribuição de resultados</h2><p>Consolide as pendências operacionais, contratuais, jurídicas, financeiras e contábeis antes do encerramento definitivo.</p></div><div className="panel-actions">
      {!latest && <button className="button button-primary" disabled={pending} onClick={() => act(() => prepareProjectClosureResultAction({ projectId }))}><Archive size={15}/> Preparar encerramento</button>}
      {latest?.status === "DRAFT" && <><button className="button button-secondary" disabled={pending} onClick={createDistribution}><WalletCards size={15}/> Nova distribuição</button><button className="button button-secondary" disabled={pending} onClick={approvePendingDistribution}>Aprovar distribuição</button><button className="button button-primary" disabled={pending || gate.overall !== "APTO"} onClick={() => act(() => approveProjectClosureResultAction({ closureResultId: latest.id }))}><CheckCircle2 size={15}/> Aprovar encerramento</button></>}
      {latest?.status === "FINAL" && <button className="button button-secondary" disabled={pending} onClick={reopen}><RotateCcw size={15}/> Reabrir</button>}
    </div></div>
    <div className="scenario-deltas"><span>Situação geral: <strong>{gate.overall}</strong></span><span>Operacional: {gate.operational.status}</span><span>Contratual: {gate.contractual.status}</span><span>Jurídico: {gate.legal.status}</span><span>Financeiro: {gate.financial.status}</span><span>Contábil: {gate.accounting.status}</span>{latest && <span>Versão: {latest.version} · {latest.status}</span>}</div>
  </section>;
}
