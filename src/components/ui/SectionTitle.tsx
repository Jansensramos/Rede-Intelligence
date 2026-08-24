/**
 * Extraído de `src/components/intelligence-workspace.tsx` (Fase 9K.0, plano §C). Mesma marcação
 * e classes CSS de antes — nenhuma mudança visual.
 */
import type { ReactNode } from "react";

export interface SectionTitleProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function SectionTitle({ eyebrow, title, description, action }: SectionTitleProps) {
  return (
    <header className="section-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
