import { requireAuthContext } from "@/application/auth/session";
import { getDataIntelligenceWorkspace } from "@/application/data-intelligence/data-intelligence-service";
import { getCurrentOperationalContext } from "@/application/workspace/current-context";
import { DataIntelligenceView } from "@/components/data-intelligence-view";
import { SectionTitle } from "@/components/ui";

/** Fase 9K.1 — área Inteligência de Dados: rota real (ordem de serviço §16). */
export default async function InteligenciaDadosPage() {
  const [authContext, context] = await Promise.all([requireAuthContext(), getCurrentOperationalContext()]);
  if (!context.project) return null;
  const workspace = await getDataIntelligenceWorkspace(authContext, context.project.id);

  return (
    <div className="view-stack">
      <SectionTitle
        eyebrow="INTELIGÊNCIA DE DADOS"
        title="Fato → normalização → comparabilidade → métrica → benchmark → confiança → recomendação → explicação → revisão humana"
        description="O histórico operacional do REDE vira ativo proprietário: contratos analíticos, métricas versionadas, comparativos com amostra e confiança visíveis, previsto x realizado, qualidade dos dados, carteira de empreendimentos e Orçamento Inteligente — sempre como sugestão, nunca como base aprovada automaticamente."
      />
      <DataIntelligenceView workspace={workspace} />
    </div>
  );
}
