/**
 * Campo de formulário padronizado, v1 (Fase 9K.0, plano §AA "Formulários" e §3 "Design System
 * base"). Cobre agrupamento visual (label + hint + erro), não os comportamentos mais avançados do
 * plano (preenchimento automático, campos dependentes, sugestão por IA) — esses dependem de cada
 * fluxo de domínio e ficam para quando as telas legadas migrarem para este primitivo.
 */
import type { ReactNode } from "react";

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function FormField({ label, htmlFor, hint, error, required, children }: FormFieldProps) {
  return (
    <div className="ds-field">
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="ds-field-required" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && <small className="ds-field-hint">{hint}</small>}
      {error && (
        <small className="ds-field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
