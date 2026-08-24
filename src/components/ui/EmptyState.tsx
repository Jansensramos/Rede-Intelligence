/**
 * Estado vazio padronizado (Fase 9K.0, plano §AB "Estados Vazios"). Hoje `.empty-state` existe
 * como classe CSS mas é usada em só 6 das 24 views legadas, sem estrutura fixa. Este componente é
 * o padrão para as telas novas da 9K; a migração das telas legadas é incremental (fora de escopo
 * desta sprint — ver plano §X).
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  children?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action, children }: EmptyStateProps) {
  return (
    <div className="ds-empty-state" role="status">
      {Icon && <Icon size={22} />}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action && (
        <button className="button button-secondary" onClick={action.onClick} type="button">
          {action.label}
        </button>
      )}
      {children}
    </div>
  );
}
