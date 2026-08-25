"use client";

/**
 * Central de Ações (Fase 9K.3, plano §L "Central de Ações"). Read model de apresentação sobre o
 * MESMO contrato `ExecutiveException` da Gestão Executiva (9K.2) — nunca duplica o fato operacional
 * (cada linha aponta, via `href`, para o registro original). Toda a filtragem/ordenação é feita por
 * funções puras de `src/domain/workspace/action-center.ts`; este componente só decide o que mostrar.
 */
import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { EmptyState, SectionTitle, Tabs, type TabItem } from "@/components/ui";
import { ActionsTable } from "./actions-table";
import { buildActionCenterBuckets } from "@/domain/workspace/action-center";
import { ALL_EXECUTIVE_DOMAINS, EXECUTIVE_DOMAIN_LABELS } from "@/domain/workspace/executive-capabilities";
import type { ActionCenterOverview } from "@/application/actions/action-service";

const TABS: TabItem[] = [
  { key: "all", label: "Todas" },
  { key: "mine", label: "Minhas" },
  { key: "today", label: "Hoje" },
  { key: "overdue", label: "Atrasadas" },
  { key: "upcoming", label: "Próximas" },
  { key: "awaitingApproval", label: "Aguardando aprovação" },
  { key: "recentlyResolved", label: "Concluídas recentemente" },
];

const EMPTY_MESSAGES: Record<string, string> = {
  all: "Nenhuma ação em aberto agora — com os dados e a política de materialidade atuais, nada cruzou o limiar de atenção.",
  mine: "Nenhuma ação em aberto está atribuída a você no momento.",
  today: "Nenhuma ação com prazo para hoje.",
  overdue: "Nenhuma ação atrasada — parabéns!",
  upcoming: "Nenhuma ação com prazo nos próximos dias.",
  awaitingApproval: "Nenhuma decisão aguardando aprovação no momento.",
  recentlyResolved: "Nenhuma ação concluída na janela recente.",
};

export function CentralDeAcoesView({ overview, currentUserId }: { overview: ActionCenterOverview; currentUserId: string }) {
  const [activeTab, setActiveTab] = useState<string>("all");

  const buckets = useMemo(
    () => buildActionCenterBuckets(overview.openActions, overview.resolvedActions, { referenceDate: new Date(overview.generatedAt), userId: currentUserId }),
    [overview, currentUserId],
  );

  const restrictedDomains = ALL_EXECUTIVE_DOMAINS.filter((domain) => !overview.authorizedDomains.includes(domain));
  const activeActions = buckets[activeTab as keyof typeof buckets];

  return (
    <div className="view-stack">
      <section className="ds-exec-header">
        <div>
          <span className="eyebrow">CENTRAL DE AÇÕES</span>
          <h1>{overview.project.name}</h1>
          <p>Tudo que precisa de uma decisão ou execução, consolidado a partir dos módulos operacionais — nunca uma segunda fonte de verdade.</p>
        </div>
      </section>

      {restrictedDomains.length > 0 && (
        <p className="ds-restricted-note">
          Seu perfil não tem permissão para ver ações de: {restrictedDomains.map((domain) => EXECUTIVE_DOMAIN_LABELS[domain]).join(", ")}.
        </p>
      )}

      <section>
        <SectionTitle
          eyebrow="AÇÕES"
          title="Resumo"
          description={`${buckets.all.length} em aberto · ${buckets.overdue.length} atrasada(s) · ${buckets.awaitingApproval.length} aguardando aprovação · ${buckets.recentlyResolved.length} concluída(s) recentemente.`}
        />
        <Tabs items={TABS} activeKey={activeTab} onChange={setActiveTab} />
        <div style={{ marginTop: 14 }}>
          {activeActions.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Nada por aqui" description={EMPTY_MESSAGES[activeTab]} />
          ) : (
            <ActionsTable actions={activeActions} responsibleNames={overview.responsibleNames} emptyMessage={EMPTY_MESSAGES[activeTab]} />
          )}
        </div>
      </section>
    </div>
  );
}
