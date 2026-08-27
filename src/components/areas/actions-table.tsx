"use client";

/**
 * Tabela compartilhada entre Central de Ações e Minha Rotina (Fase 9K.3, plano §L). Mostra os
 * campos do contrato de ação exigidos pelo plano: severidade, domínio, empreendimento, responsável
 * (quando existir — nunca inventado), prazo, impacto/materialidade, evidência, status e deep link
 * para a origem (`onRowClick`/coluna de ação nunca abre um segundo formulário aqui — a Central de
 * Ações não duplica o fato operacional, plano §L).
 */
import { useRouter } from "next/navigation";
import { DataTable, SeverityBadge, type DataTableColumn } from "@/components/ui";
import { EXECUTIVE_DOMAIN_LABELS } from "@/domain/workspace/executive-capabilities";
import type { ExecutiveException } from "@/domain/workspace/exceptions";
import type { OperationalAction } from "@/domain/workspace/operational-live";

const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

function formatDate(iso: string | null | undefined) {
  return iso ? dateFormatter.format(new Date(iso)) : "—";
}

const STATUS_LABELS: Record<ExecutiveException["status"], string> = {
  ABERTA: "Aberta",
  RECONHECIDA: "Reconhecida",
  RESOLVIDA: "Resolvida",
  DISPENSADA: "Dispensada",
};

const AUTOMATION_LABELS = { RECOMENDAR: "Recomendar", PREPARAR: "Preparar" } as const;

function operationalAction(row: ExecutiveException): OperationalAction | null {
  return "nextStep" in row && "automation" in row ? (row as OperationalAction) : null;
}

export function ActionsTable({ actions, responsibleNames, emptyMessage }: { actions: ExecutiveException[]; responsibleNames: Record<string, string>; emptyMessage: string }) {
  const router = useRouter();

  const columns: DataTableColumn<ExecutiveException>[] = [
    { key: "severity", header: "Severidade", priority: "essential", align: "left", render: (row) => <SeverityBadge severity={row.severity} /> },
    {
      key: "title",
      header: "Ação",
      priority: "essential",
      align: "left",
      render: (row) => (
        <span>
          <strong>{row.title}</strong>
          <br />
          <small style={{ color: "var(--ds-text-muted, inherit)" }}>{row.summary}</small>
        </span>
      ),
    },
    { key: "domain", header: "Domínio", priority: "default", align: "left", render: (row) => EXECUTIVE_DOMAIN_LABELS[row.domain] },
    { key: "project", header: "Empreendimento", priority: "default", align: "left", render: (row) => row.projectName ?? "—" },
    { key: "responsible", header: "Responsável", priority: "default", align: "left", render: (row) => (row.responsibleId ? (responsibleNames[row.responsibleId] ?? row.responsibleId) : "Sem responsável definido") },
    { key: "nextStep", header: "Próximo passo", priority: "default", align: "left", render: (row) => operationalAction(row)?.nextStep.what ?? "Abrir o registro de origem e avaliar." },
    { key: "automation", header: "Automação", priority: "optional", align: "left", render: (row) => {
      const automation = operationalAction(row)?.automation;
      return automation ? `${AUTOMATION_LABELS[automation.level]} · confirmação humana` : "Recomendação manual";
    } },
    { key: "dueDate", header: "Prazo", priority: "default", render: (row) => formatDate(row.dueDate) },
    { key: "impact", header: "Impacto", priority: "optional", render: (row) => (row.materialityValue != null ? compactCurrency.format(row.materialityValue) : "—") },
    { key: "evidence", header: "Evidência", priority: "optional", align: "left", render: (row) => (row.evidence.length > 0 ? row.evidence.join(", ") : "—") },
    { key: "status", header: "Status", priority: "default", align: "left", render: (row) => STATUS_LABELS[row.status] },
    { key: "resolvedAt", header: "Concluída em", priority: "optional", render: (row) => formatDate(row.resolvedAt) },
  ];

  return <DataTable columns={columns} rows={actions} rowKey={(row) => row.id} onRowClick={(row) => router.push(row.href)} emptyMessage={emptyMessage} />;
}
