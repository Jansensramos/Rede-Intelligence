/**
 * Estado de carregamento padronizado (Fase 9K.0, plano §3 "Design System base" — estados de
 * loading). Usado principalmente pelas áreas que agora carregam sob demanda (plano §2, §AS) —
 * ver `src/components/intelligence-workspace.tsx`.
 */
export interface LoadingProps {
  label?: string;
}

export function Loading({ label = "Carregando…" }: LoadingProps) {
  return (
    <div className="ds-loading" role="status" aria-live="polite">
      <span className="ds-loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
