/**
 * Abas acessíveis, v1 (Fase 9K.0, plano §3 "Design System base"). Não substitui a navegação
 * principal da sidebar hoje (`intelligence-workspace.tsx`) — é um primitivo para agrupar
 * sub-conteúdo dentro de uma tela (nível 2/3 futuro, plano §F).
 */
"use client";

export interface TabItem {
  key: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function Tabs({ items, activeKey, onChange }: TabsProps) {
  return (
    <div className="ds-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === activeKey}
          className={item.key === activeKey ? "is-active" : ""}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
