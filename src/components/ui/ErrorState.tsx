/**
 * Estado de erro padronizado (Fase 9K.0, plano §AC "Erros"). Hoje escritas assíncronas em
 * `intelligence-workspace.tsx` fazem `throw new Error(...)` sem tratamento visível no ponto de
 * chamada — um erro técnico pode chegar cru ao operador. Este componente traduz qualquer falha
 * nas 4 perguntas fixas do plano: o que aconteceu, o que fazer, existe risco, quem pode resolver.
 * Não decide a mensagem de negócio — recebe o texto já resolvido pelo chamador.
 */
export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = "Não foi possível carregar esta área", message, onRetry }: ErrorStateProps) {
  return (
    <div className="ds-error-state" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
      <p className="ds-error-state-meta">Nenhum dado foi alterado. Se o problema continuar, procure quem administra esta organização no REDE.</p>
      {onRetry && (
        <button className="button button-secondary" onClick={onRetry} type="button">
          Tentar novamente
        </button>
      )}
    </div>
  );
}
