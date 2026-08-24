/**
 * Extraído de `src/components/intelligence-workspace.tsx` (Fase 9K.0, plano §C "Inventário de
 * componentes": "propor um pequeno conjunto de primitivos... e a extração de MetricCard/
 * SectionTitle para lá"). Mesma marcação e classes CSS de antes — nenhuma mudança visual.
 */
import type { LucideIcon } from "lucide-react";

export interface MetricCardProps {
  label: string;
  value: string;
  meta: string;
  tone?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
}

export function MetricCard({ label, value, meta, tone, icon: Icon }: MetricCardProps) {
  return (
    <article className="metric-card">
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <small className={tone ? `metric-${tone}` : ""}>{meta}</small>
    </article>
  );
}
