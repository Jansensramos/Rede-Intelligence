import Image from "next/image";

export function RedeMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`} aria-label="REDE Intelligence">
      <Image
        className="brand-logo"
        src="/branding/rede-intelligence-logo.svg"
        alt="REDE Intelligence"
        width={360}
        height={120}
        priority
      />
    </div>
  );
}
