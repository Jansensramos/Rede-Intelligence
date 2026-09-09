"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { attestLocalOnboardingAction } from "@/app/actions/local-readiness";
import { ONBOARDING_LABELS, type OnboardingStep } from "@/domain/release/local-readiness";
export function LocalOnboarding({ steps }: { steps: Array<{ step: OnboardingStep; attestedAt: string | null }> }) {
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const router = useRouter();
  async function confirm(step: OnboardingStep) {
    setBusy(true);
    try { const result = await attestLocalOnboardingAction({ step, confirmed: true }); setMessage(result.message); if (result.ok) router.refresh(); }
    catch { setMessage("Operação indisponível. Tente novamente após conferir sua sessão."); }
    finally { setBusy(false); }
  }
  return <section className="panel"><h2>Checklist de onboarding local</h2><p>Confirme somente etapas realmente ensaiadas. A confirmação registra seu aceite, não substitui evidência externa.</p><ol>{steps.map(row => <li key={row.step} style={{ marginBottom: 16 }}><strong>{ONBOARDING_LABELS[row.step]}</strong>{row.attestedAt ? <p>Confirmado em {new Date(row.attestedAt).toLocaleString("pt-BR")}</p> : <p><button disabled={busy} onClick={() => confirm(row.step)}>Confirmar etapa concluída</button></p>}</li>)}</ol><p role="status">{message}</p></section>;
}
