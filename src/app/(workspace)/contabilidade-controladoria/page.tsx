import { requireAuthContext } from "@/application/auth/session";
import { getAccountingWorkspace } from "@/application/accounting/accounting-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { AccountingOperabilityPanel } from "@/components/accounting-operability-panel";
import { AccountingView } from "@/components/accounting-view";
import { SectionTitle } from "@/components/ui";

/** Fase 10C.1 — Contabilidade e Controladoria com operação humana sobre o domínio existente. */
export default async function ContabilidadeControladoriaPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getAccountingWorkspace(authContext, context.project.id);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="CONTÁBIL, FISCAL E CONTROLADORIA"
        title="Fato operacional → Política → Razão → Resultado"
        description="Competência e caixa separados, partidas dobradas, estoque, tributos e consolidação sem criar uma segunda verdade financeira."
      />
      <AccountingOperabilityPanel workspace={workspace} />
      <AccountingView workspace={workspace} />
    </div>
  );
}
