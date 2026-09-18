import { requireAuthContext } from "@/application/auth/session";
import { getDataIntelligenceWorkspace } from "@/application/data-intelligence/data-intelligence-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { DataIntelligenceOperabilityPanel } from "@/components/data-intelligence-operability-panel";
import { DataIntelligenceView } from "@/components/data-intelligence-view";
import { SectionTitle } from "@/components/ui";

/** Fase 10C.1 — Inteligência de Dados com operação humana de governança e reprocessamento. */
export default async function InteligenciaDadosPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getDataIntelligenceWorkspace(authContext, context.project.id);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="INTELIGÊNCIA DE DADOS"
        title="Fato → normalização → comparabilidade → métrica → comparativo → confiança → recomendação → explicação → revisão humana"
        description="O histórico operacional do REDE vira ativo proprietário: contratos analíticos, métricas versionadas, comparativos com amostra e confiança visíveis, previsto x realizado, qualidade dos dados, carteira de empreendimentos e Orçamento Inteligente — sempre como sugestão, nunca como base aprovada automaticamente."
      />
      <DataIntelligenceOperabilityPanel workspace={workspace} />
      <DataIntelligenceView workspace={workspace} />
    </div>
  );
}
