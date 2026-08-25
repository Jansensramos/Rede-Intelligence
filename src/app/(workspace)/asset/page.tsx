import { Wallet } from "lucide-react";
import { EmptyState, SectionTitle } from "@/components/ui";

/**
 * Fase 9K.1, ordem de serviço §10: entrada estrutural do ecossistema REDE Asset, separada da
 * operação principal. Sem marketplace, sem funding, sem oferta real nesta sprint — só o lugar
 * onde, no futuro, usuários autorizados verão oportunidades de negócio da REDE Asset e poderão
 * chamar a equipe REDE para negociação.
 *
 * Fechamento 9K.1 (revisão): o CTA fica desabilitado em vez de um `onClick` vazio — clicar não devia
 * parecer "não aconteceu nada". Sem handler nenhum, a página nem precisa ser client component.
 */
export default function AssetPage() {
  return (
    <div className="view-stack">
      <SectionTitle eyebrow="ECOSSISTEMA REDE" title="REDE Asset" description="Oportunidades de negócio do ecossistema REDE Asset, com contato direto com a equipe REDE." />
      <EmptyState icon={Wallet} title="REDE Asset chega em breve" description="Nenhuma oportunidade publicada ainda. Esta área não implementa marketplace, funding ou lógica regulatória de valores mobiliários nesta sprint.">
        <button className="button button-secondary" disabled title="Em breve" type="button">
          Falar com a equipe REDE (em breve)
        </button>
      </EmptyState>
    </div>
  );
}
