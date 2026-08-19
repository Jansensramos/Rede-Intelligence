export function RedeMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`} aria-label="REDE Intelligence">
      <span className="brand-mark" aria-hidden="true">
        <i /><i /><i /><i />
      </span>
      {!compact && (
        <span className="brand-name">
          <strong>REDE</strong>
          <small>INTELLIGENCE</small>
        </span>
      )}
    </div>
  );
}
