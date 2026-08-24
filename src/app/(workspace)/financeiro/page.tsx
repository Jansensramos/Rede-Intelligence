import { requireAuthContext } from "@/application/auth/session";
import { getFinancialWorkspace } from "@/application/financial-ops/financial-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { FinancialView } from "@/components/financial-view";
import { SectionTitle } from "@/components/ui";

/** Fase 9K.1 — área Financeiro: rota real, busca só o workspace Financeiro (ordem de serviço §16). */
export default async function FinanceiroPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getFinancialWorkspace(authContext, context.project.id);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="FINANCEIRO E TESOURARIA"
        title="Contas a Pagar, Contas a Receber e Caixa"
        description="Obrigação → conta → parcela → pagamento → conciliação → realizado, rastreável por SPE e centro de custo."
      />
      <FinancialView workspace={workspace} />
    </div>
  );
}
