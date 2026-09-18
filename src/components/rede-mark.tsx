export function RedeMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`} aria-label="REDE Intelligence">
      <img
        className="brand-logo"
        src="/branding/rede-intelligence-logo.svg"
        alt="REDE Intelligence"
      />
    </div>
  );
}
