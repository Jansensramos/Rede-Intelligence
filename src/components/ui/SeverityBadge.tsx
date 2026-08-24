/**
 * Badge/pílula de severidade canônica (Fase 9K.0, plano §3 "Design System base" — badges/status —
 * e §5 "Severidade canônica de UI"). Renderiza `CanonicalSeverity` (`src/domain/workspace/
 * severity.ts`) com rótulo em português e tom visual consistente. Não decide severidade — só
 * exibe o que a camada de tradução do módulo já calculou.
 */
import { SEVERITY_LABELS, SEVERITY_TONES, type CanonicalSeverity } from "@/domain/workspace/severity";

export interface SeverityBadgeProps {
  severity: CanonicalSeverity;
  /** Sobrescreve o rótulo padrão (ex.: contagem: "3 críticos"). */
  label?: string;
}

export function SeverityBadge({ severity, label }: SeverityBadgeProps) {
  const tone = SEVERITY_TONES[severity];
  return <span className={`ds-badge ds-badge-${tone}`}>{label ?? SEVERITY_LABELS[severity]}</span>;
}
