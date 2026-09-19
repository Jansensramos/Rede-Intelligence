import Image from "next/image";

export function RedeMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`} aria-label="REDE Intelligence">
      <Image
        className="brand-logo"
        src="/branding/rede-intelligence-logo-color.svg"
        alt="REDE Intelligence"
        width={300}
        height={180}
        priority
      />
    </div>
  );
}
