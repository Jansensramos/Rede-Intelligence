"use client";

/**
 * Shell de navegação por Grandes Áreas (Fase 9K.1). Substitui a sidebar/topbar de
 * `intelligence-workspace.tsx` (mantido em `/legado`, ordem de serviço §13) por navegação real:
 * `<Link>`/rota Next.js em vez de `useState`+troca de `view` — resolve deep-link, refresh, botão
 * voltar do navegador e compartilhamento de URL de graça (ordem de serviço §5).
 *
 * Gestão Executiva (§1) é renderizada primeiro e com destaque visual (`is-primary`, CSS §12).
 * REDE Academy fica deliberadamente por último (§9); REDE Asset também separada da operação (§10);
 * Ajuda tem ponto de entrada fixo no rodapé (§11) — nenhuma delas é construída nesta sprint, só
 * posicionada.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck,
  Boxes,
  Building2,
  CalendarCheck2,
  ChevronDown,
  ClipboardList,
  Database,
  GraduationCap,
  HandCoins,
  HelpCircle,
  LayoutDashboard,
  Landmark,
  Layers3,
  Menu,
  PanelLeftClose,
  Plug,
  Radar,
  Scale,
  Sparkles,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";
import { ContextSwitcher } from "./context-switcher";
import { RedeMark } from "./rede-mark";
import { logoutAction } from "@/app/actions/auth";
import { ECOSYSTEM_ENTRIES, HELP_ENTRY, OPERATIONAL_AREAS, type OperationalArea } from "@/domain/workspace/areas";
import type { OperationalContext } from "@/application/workspace/operational-context";
import type { ContextOptionGroup } from "@/application/workspace/context-options";

const AREA_ICONS: Record<string, typeof LayoutDashboard> = {
  "gestao-executiva": LayoutDashboard,
  viabilidade: Scale,
  "mercado-produto": Radar,
  "engenharia-obra": Layers3,
  suprimentos: ShoppingCart,
  financeiro: Landmark,
  comercial: HandCoins,
  juridico: Scale,
  pessoas: Users,
  "contabilidade-controladoria": BookOpenCheck,
  integracoes: Plug,
  "inteligencia-dados": Database,
};

const ECOSYSTEM_ICONS: Record<string, typeof Boxes> = {
  "rede-asset": Wallet,
  "rede-academy": GraduationCap,
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RE";
}

function isAreaActive(pathname: string, area: OperationalArea) {
  return pathname === area.path || pathname.startsWith(`${area.path}/`);
}

export function WorkspaceShell({
  context,
  contextGroups,
  children,
}: {
  context: OperationalContext;
  contextGroups: ContextOptionGroup[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const primaryArea = OPERATIONAL_AREAS.find((area) => area.primary)!;
  const secondaryAreas = OPERATIONAL_AREAS.filter((area) => !area.primary);

  const projectLabel = context.project ? `${context.project.city} · ${context.project.state}` : "Nenhum empreendimento selecionado";
  const breadcrumb = context.company?.name ?? context.economicGroup?.name ?? context.organization.name;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <RedeMark />
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu"><PanelLeftClose size={18} /></button>
        </div>

        <div className="portfolio-label">CONTEXTO ATIVO</div>
        <button className="active-project" onClick={() => setSwitcherOpen(true)}>
          <span className="project-monogram">{context.project ? initials(context.project.name) : "RE"}</span>
          <span><strong>{context.project?.name ?? "Selecionar empreendimento"}</strong><small>{projectLabel}</small></span>
          <ChevronDown size={15} />
        </button>

        <nav className="main-nav" aria-label="Navegação principal">
          <Link
            key={primaryArea.id}
            href={primaryArea.path}
            className={`is-primary ${isAreaActive(pathname, primaryArea) ? "is-active" : ""}`}
            onClick={() => setSidebarOpen(false)}
          >
            <LayoutDashboard size={17} />
            <span>{primaryArea.label}</span>
          </Link>

          <div className="ds-nav-group-label">AÇÕES</div>
          <Link href="/acoes" className={pathname === "/acoes" || pathname.startsWith("/acoes/") ? "is-active" : ""} onClick={() => setSidebarOpen(false)}>
            <ClipboardList size={17} />
            <span>Central de Ações</span>
          </Link>
          <Link href="/rotina" className={pathname === "/rotina" || pathname.startsWith("/rotina/") ? "is-active" : ""} onClick={() => setSidebarOpen(false)}>
            <CalendarCheck2 size={17} />
            <span>Minha Rotina</span>
          </Link>

          <div className="ds-nav-group-label">GRANDES ÁREAS</div>
          {secondaryAreas.map((area) => {
            const Icon = AREA_ICONS[area.id] ?? Boxes;
            return (
              <Link key={area.id} href={area.path} className={isAreaActive(pathname, area) ? "is-active" : ""} onClick={() => setSidebarOpen(false)}>
                <Icon size={17} />
                <span>{area.label}</span>
              </Link>
            );
          })}

          <div className="ds-nav-group-label">ECOSSISTEMA REDE</div>
          {ECOSYSTEM_ENTRIES.map((entry) => {
            const Icon = ECOSYSTEM_ICONS[entry.id] ?? Boxes;
            return (
              <Link key={entry.id} href={entry.path} className={pathname === entry.path ? "is-active" : ""} onClick={() => setSidebarOpen(false)}>
                <Icon size={17} />
                <span>{entry.label}</span>
              </Link>
            );
          })}
        </nav>

        <Link href="/assistente" className="sidebar-module sidebar-ai-live" onClick={() => setSidebarOpen(false)}>
          <span>COPILOTO ATIVO</span>
          <Sparkles size={18} />
          <div><strong>Pergunte ao REDE</strong><small>Contexto estruturado</small></div>
          <span className="soon">AI</span>
        </Link>

        <div className="sidebar-footer">
          <button type="button"><Building2 size={17} /><span>{context.organization.name}</span></button>
          <Link href={HELP_ENTRY.path} className="help-trigger" aria-label="Central de Ajuda" title="Central de Ajuda"><HelpCircle size={18} /></Link>
          <form action={logoutAction} className="logout-form">
            <button className="avatar-button" title="Sair" aria-label={`Sair da conta de ${context.user.name}`}>{initials(context.user.name)}</button>
          </form>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />}

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Menu size={20} /></button>
            <span>{breadcrumb}</span>
            <i>/</i>
            <strong>{context.project?.name ?? "—"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="engine-chip"><i /> ENGINE v1.0</span>
          </div>
        </header>

        <div className="workspace-content">{children}</div>
      </main>

      {switcherOpen && (
        <ContextSwitcher
          organizationName={context.organization.name}
          groups={contextGroups}
          currentProjectId={context.project?.id ?? null}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
    </div>
  );
}
