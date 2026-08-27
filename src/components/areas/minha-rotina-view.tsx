"use client";

/**
 * Minha Rotina (Fase 9K.3, plano §L "Minha Rotina"): responde "o que eu preciso fazer hoje?".
 * Diferente da Central de Ações, todo bucket de prazo aqui já vem restrito a `responsibleId ===
 * usuário atual` (ver `buildMyRoutineBuckets`) — nunca mostra o item de outra pessoa nem inventa um
 * responsável para preencher a tela (ordem de serviço §M).
 */
import { useMemo } from "react";
import type { MembershipRole } from "@prisma/client";
import { CalendarCheck2, CalendarClock, CheckCircle2, ClipboardCheck, ListTodo } from "lucide-react";
import { EmptyState, SectionTitle } from "@/components/ui";
import { ActionsTable } from "./actions-table";
import { buildMyRoutineBuckets, filterMine } from "@/domain/workspace/action-center";
import { buildDailyOperationalSummary, sortRoutinePriority } from "@/domain/workspace/operational-live";
import type { ActionCenterOverview } from "@/application/actions/action-service";
import type { ExecutiveException } from "@/domain/workspace/exceptions";

function Block({ icon: Icon, eyebrow, title, description, actions, responsibleNames, emptyMessage }: { icon: typeof ListTodo; eyebrow: string; title: string; description: string; actions: ExecutiveException[]; responsibleNames: Record<string, string>; emptyMessage: string }) {
  return (
    <section>
      <SectionTitle eyebrow={eyebrow} title={title} description={description} action={<Icon size={18} />} />
      {actions.length === 0 ? <EmptyState title="Nada por aqui" description={emptyMessage} /> : <ActionsTable actions={actions} responsibleNames={responsibleNames} emptyMessage={emptyMessage} />}
    </section>
  );
}

export function MinhaRotinaView({ overview, currentUserId, currentUserRole }: { overview: ActionCenterOverview; currentUserId: string; currentUserRole: MembershipRole }) {
  const buckets = useMemo(
    () => buildMyRoutineBuckets(overview.openActions, overview.resolvedActions, { referenceDate: new Date(overview.generatedAt), userId: currentUserId, userRole: currentUserRole }),
    [overview, currentUserId, currentUserRole],
  );

  const totalToday = buckets.today.length + buckets.overdue.length;
  const priorityActions = useMemo(() => {
    const mine = filterMine(overview.openActions, currentUserId);
    const unique = new Map([...mine, ...buckets.awaitingMyApproval].map((item) => [item.id, item]));
    return sortRoutinePriority([...unique.values()], new Date(overview.generatedAt));
  }, [buckets.awaitingMyApproval, currentUserId, overview.generatedAt, overview.openActions]);
  const myDailySummary = useMemo(() => buildDailyOperationalSummary(priorityActions, new Date(overview.generatedAt)), [priorityActions, overview.generatedAt]);

  return (
    <div className="view-stack">
      <section className="ds-exec-header">
        <div>
          <span className="eyebrow">MINHA ROTINA</span>
          <h1>O que eu preciso fazer hoje?</h1>
          <p>
            {totalToday > 0
              ? `${buckets.today.length} ação(ões) para hoje e ${buckets.overdue.length} atrasada(s), atribuídas a você nos módulos operacionais.`
              : "Nenhuma ação com prazo hoje ou atrasada atribuída a você."}
          </p>
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="RESUMO DO DIA" title="Resumo operacional de hoje" description="Consolidado determinístico dos fatos aos quais seu perfil tem acesso." />
        {myDailySummary.lines.length === 0 ? (
          <EmptyState title="Nada relevante no resumo de hoje" description="Nenhum fato operacional cruzou as regras de atenção." />
        ) : (
          <div className="ds-whatchanged">
            {myDailySummary.lines.map((line) => <div className="ds-whatchanged-item" key={line}><strong>{line}</strong></div>)}
          </div>
        )}
      </section>

      <Block icon={ListTodo} eyebrow="ORDEM DE RESOLUÇÃO" title="Prioridades de hoje" description="Críticas vencidas, críticas de hoje, aprovações, próximas com risco e demais — nesta ordem." actions={priorityActions} responsibleNames={overview.responsibleNames} emptyMessage="Nenhuma prioridade atribuída a você ou à sua alçada." />

      <Block icon={CalendarClock} eyebrow="ATRASADAS" title="Atrasadas" description="Prazo já vencido — atribuídas a você no registro de origem, nunca inferido." actions={buckets.overdue} responsibleNames={overview.responsibleNames} emptyMessage="Nenhuma ação sua está atrasada." />
      <Block icon={CalendarCheck2} eyebrow="HOJE" title="Hoje" description="Prazo vence hoje." actions={buckets.today} responsibleNames={overview.responsibleNames} emptyMessage="Nenhuma ação sua vence hoje." />
      <Block icon={ListTodo} eyebrow="PRÓXIMAS" title="Próximas" description="Prazo nos próximos dias." actions={buckets.upcoming} responsibleNames={overview.responsibleNames} emptyMessage="Nenhuma ação sua com prazo próximo." />
      <Block icon={ClipboardCheck} eyebrow="DECISÕES" title="Aguardando minha aprovação" description="Sua alçada (papel) é suficiente para decidir estes itens." actions={buckets.awaitingMyApproval} responsibleNames={overview.responsibleNames} emptyMessage="Nenhuma decisão aguardando sua alçada." />
      <Block icon={CheckCircle2} eyebrow="CONCLUÍDO" title="Concluídas recentemente" description="Itens atribuídos a você que foram concluídos na janela recente." actions={buckets.recentlyResolved} responsibleNames={overview.responsibleNames} emptyMessage="Nenhuma ação sua concluída recentemente." />
    </div>
  );
}
