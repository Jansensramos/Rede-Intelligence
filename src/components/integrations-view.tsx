"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Building2, Check, CircleAlert, CircleCheck, Clock, KeyRound, Landmark, LoaderCircle, MapPinned, Plug, RefreshCw, ShieldAlert, X } from "lucide-react";
import { refreshIntegrationsWorkspaceAction, reprocessQuarantineItemAction, resolveIntegrationConflictAction, syncMockDriveInstallationAction } from "@/app/actions/integrations";
import type { IntegrationsWorkspaceView } from "@/application/integrations/integrations-service";
import { GoogleDriveControls } from "./google-drive-controls";

type ScopeFilter = "ALL" | "GROUP" | "COMPANY" | "SPE" | "PROJECT";
type Area = "installations" | "syncRuns" | "conflicts" | "quarantine" | "deadLetters" | "credentials";

const scopeTabs: Array<{ key: ScopeFilter; label: string; icon: typeof Building2 }> = [
  { key: "ALL", label: "Todos", icon: Plug },
  { key: "GROUP", label: "Grupo", icon: Landmark },
  { key: "COMPANY", label: "Empresa", icon: Building2 },
  { key: "SPE", label: "SPE", icon: Building2 },
  { key: "PROJECT", label: "Empreendimento", icon: MapPinned },
];

const areaTabs: Array<{ key: Area; label: string }> = [
  { key: "installations", label: "Instalações" },
  { key: "syncRuns", label: "Sincronizações" },
  { key: "conflicts", label: "Conflitos" },
  { key: "quarantine", label: "Quarentena" },
  { key: "deadLetters", label: "Dead-letter" },
  { key: "credentials", label: "Credenciais" },
];

const stateLabels: Record<string, string> = { HEALTHY: "Saudável", STALE: "Desatualizado", ATTENTION: "Atenção", CRITICAL: "Crítico" };
const stateIcons: Record<string, typeof Check> = { HEALTHY: CircleCheck, STALE: Clock, ATTENTION: AlertTriangle, CRITICAL: CircleAlert };
const directionLabels: Record<string, string> = { INBOUND: "Entrada", OUTBOUND: "Saída", BIDIRECTIONAL: "Bidirecional" };
const credentialLabels: Record<string, string> = { PENDING: "Pendente", ACTIVE: "Ativa", EXPIRING: "Expirando", EXPIRED: "Expirada", REVOKED: "Revogada", ERROR: "Erro" };
const errorClassLabels: Record<string, string> = { AUTHENTICATION: "Autenticação", AUTHORIZATION: "Autorização", RATE_LIMIT: "Rate limit", VALIDATION: "Validação", MAPPING: "Mapeamento", DUPLICATE: "Duplicata", CONFLICT: "Conflito", NETWORK: "Rede", PROVIDER: "Provedor", BUSINESS_RULE: "Regra de negócio", STORAGE: "Storage", UNKNOWN: "Desconhecido" };

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

export function IntegrationsView({ initialWorkspace, projectId, onWorkspaceChange }: { initialWorkspace: IntegrationsWorkspaceView; projectId: string; onWorkspaceChange: (workspace: IntegrationsWorkspaceView) => void }) {
  const [workspace, setWorkspace] = useState<IntegrationsWorkspaceView>(initialWorkspace);
  const [scope, setScope] = useState<ScopeFilter>("ALL");
  const [area, setArea] = useState<Area>("installations");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update(next: IntegrationsWorkspaceView) {
    setWorkspace(next);
    onWorkspaceChange(next);
    setError(null);
  }

  function runAction(operation: () => Promise<{ ok: true; data: IntegrationsWorkspaceView } | { ok: false; error: string }>) {
    startTransition(async () => {
      const response = await operation();
      if (response.ok) update(response.data);
      else setError(response.error);
    });
  }

  const filteredInstallations = useMemo(() => workspace.installations.filter((item) => scope === "ALL" || item.scope.level === scope), [workspace.installations, scope]);

  if (workspace.installations.length === 0) {
    return (
      <div className="view-stack">
        {workspace.permissions.canConfigure && <GoogleDriveControls projectId={projectId} installations={[]} onChanged={() => runAction(() => refreshIntegrationsWorkspaceAction(projectId))} />}
        <div className="empty-state"><Plug size={18} /> Nenhum conector instalado ainda para esta organização.</div>
      </div>
    );
  }

  return (
    <div className="view-stack">
      {workspace.permissions.canConfigure && <GoogleDriveControls projectId={projectId} installations={workspace.installations.filter(i => i.connectorCode === "GOOGLE_DRIVE_V3").map(i => ({ id: i.id, name: i.name }))} onChanged={() => runAction(() => refreshIntegrationsWorkspaceAction(projectId))} />}
      <section className="metrics-grid">
        <article className="metric-card"><div><span>Instalações</span><Plug size={17} /></div><strong>{workspace.summary.installations}</strong><small>{workspace.summary.staleInstallations} desatualizada(s)</small></article>
        <article className="metric-card"><div><span>Críticas</span><ShieldAlert size={17} /></div><strong className={workspace.summary.criticalInstallations > 0 ? "metric-negative" : undefined}>{workspace.summary.criticalInstallations}</strong><small>Saúde DOWN ou credencial inválida</small></article>
        <article className="metric-card"><div><span>Atenção</span><AlertTriangle size={17} /></div><strong>{workspace.summary.attentionInstallations}</strong><small>Degradadas ou credencial expirando</small></article>
        <article className="metric-card"><div><span>Conflitos abertos</span><AlertTriangle size={17} /></div><strong className={workspace.summary.openConflicts > 0 ? "metric-negative" : undefined}>{workspace.summary.openConflicts}</strong><small>Nunca resolvidos automaticamente</small></article>
        <article className="metric-card"><div><span>Quarentena pendente</span><ShieldAlert size={17} /></div><strong>{workspace.summary.pendingQuarantine}</strong><small>Aguardando revisão humana</small></article>
        <article className="metric-card"><div><span>Credenciais expirando</span><KeyRound size={17} /></div><strong>{workspace.summary.expiringCredentials}</strong><small>Próximos 30 dias</small></article>
      </section>

      {error && <div className="integration-error-banner"><X size={14} /> {error}</div>}
      {pending && <div className="integration-loading"><LoaderCircle className="spin" size={14} /> Atualizando…</div>}

      <div className="scenario-switch" aria-label="Escopo">{scopeTabs.map((tab) => <button key={tab.key} className={scope === tab.key ? "is-active" : ""} onClick={() => setScope(tab.key)}><tab.icon size={13} /> {tab.label}</button>)}</div>
      <div className="scenario-switch" aria-label="Área da Central de Integrações">{areaTabs.map((tab) => <button key={tab.key} className={area === tab.key ? "is-active" : ""} onClick={() => setArea(tab.key)}>{tab.label}</button>)}</div>

      {area === "installations" && (
        filteredInstallations.length === 0 ? (
          <div className="empty-state"><Plug size={16} /> Nenhuma instalação neste escopo.</div>
        ) : (
          <div className="integration-cards">
            {filteredInstallations.map((item) => {
              const StateIcon = stateIcons[item.uiState];
              const scopeLabel = item.scope.level === "GROUP" ? item.scope.groupName : item.scope.level === "PROJECT" ? item.scope.projectName : item.scope.level === "ORGANIZATION" ? "Organização" : item.scope.companyName;
              return (
                <article key={item.id} className={`integration-card integration-state-${item.uiState.toLowerCase()}`}>
                  <div className="integration-card-head">
                    <div><span className="integration-scope-chip">{item.scope.level === "SPE" ? "SPE" : item.scope.level === "COMPANY" ? "Empresa" : item.scope.level === "GROUP" ? "Grupo" : item.scope.level === "PROJECT" ? "Empreendimento" : "Organização"}</span><h3>{item.name}</h3></div>
                    <span className={`integration-state integration-state-${item.uiState.toLowerCase()}`}><StateIcon size={12} /> {stateLabels[item.uiState]}</span>
                  </div>
                  <dl>
                    <div><dt>Provedor</dt><dd>{item.provider}</dd></div>
                    <div><dt>Direção</dt><dd>{directionLabels[item.direction] ?? item.direction}</dd></div>
                    <div><dt>Escopo</dt><dd>{scopeLabel ?? "—"}</dd></div>
                    <div><dt>Última sincronização</dt><dd>{dateTime(item.lastSyncAt)}</dd></div>
                    <div><dt>Próxima sincronização</dt><dd>{dateTime(item.nextSyncAt)}</dd></div>
                    <div><dt>Credencial</dt><dd>{credentialLabels[item.credentialStatus] ?? item.credentialStatus}{item.credentialExpiresAt ? ` · ${dateTime(item.credentialExpiresAt)}` : ""}</dd></div>
                  </dl>
                  {workspace.permissions.canSync && item.connectorCode === "GOOGLE_DRIVE_MOCK" && (
                    <footer><button className="button button-secondary" disabled={pending} onClick={() => runAction(() => syncMockDriveInstallationAction(projectId, item.id))}>{pending ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />} Sincronizar agora</button></footer>
                  )}
                </article>
              );
            })}
          </div>
        )
      )}

      {area === "syncRuns" && (
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">EXECUÇÕES</span><h2>Sincronizações recentes</h2></div></div>
          {workspace.syncRuns.length === 0 ? <div className="empty-state"><Clock size={16} /> Nenhuma sincronização registrada ainda.</div> : (
            <div className="data-table-scroll"><table className="data-table"><thead><tr><th>Modo</th><th>Início</th><th>Fim</th><th>Lidos</th><th>Aplicados</th><th>Erros</th><th>Conflitos</th><th>Situação</th></tr></thead><tbody>
              {workspace.syncRuns.map((run) => <tr key={run.id}><td>{run.mode}</td><td>{dateTime(run.startedAt)}</td><td>{dateTime(run.finishedAt)}</td><td>{run.itemsRead}</td><td>{run.itemsApplied}</td><td className={run.itemsErrored > 0 ? "negative-value" : undefined}>{run.itemsErrored}</td><td>{run.itemsConflicted}</td><td>{run.status}</td></tr>)}
            </tbody></table></div>
          )}
        </article>
      )}

      {area === "conflicts" && (
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">NUNCA SOBRESCRITO SILENCIOSAMENTE</span><h2>Conflitos de integração</h2></div></div>
          {workspace.conflicts.length === 0 ? <div className="empty-state"><Check size={16} /> Nenhum conflito registrado.</div> : (
            <div className="scenario-table">
              <div className="table-row table-head"><span>Entidade</span><span>Campo</span><span>Política</span><span>Situação</span><span>Ação</span></div>
              {workspace.conflicts.map((item) => (
                <div className="table-row" key={item.id}>
                  <strong>{item.entityType}</strong><span>{item.fieldName}</span><span>{item.policyApplied}</span><span>{item.status}</span>
                  <span>{item.status === "OPEN" && workspace.permissions.canApprove ? (
                    <span style={{ display: "flex", gap: 6 }}>
                      <button className="button button-secondary" disabled={pending} onClick={() => runAction(() => resolveIntegrationConflictAction(projectId, item.id, "KEEP_LOCAL"))}>Manter REDE</button>
                      <button className="button button-secondary" disabled={pending} onClick={() => runAction(() => resolveIntegrationConflictAction(projectId, item.id, "APPLY_EXTERNAL"))}>Aplicar externo</button>
                    </span>
                  ) : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      )}

      {area === "quarantine" && (
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">SEM CONTAMINAR O DOMÍNIO PRINCIPAL</span><h2>Itens em quarentena</h2></div></div>
          {workspace.quarantine.length === 0 ? <div className="empty-state"><Check size={16} /> Nenhum item em quarentena.</div> : (
            <div className="scenario-table">
              <div className="table-row table-head"><span>Capability</span><span>Motivo</span><span>Classe</span><span>Situação</span><span>Ação</span></div>
              {workspace.quarantine.map((item) => (
                <div className="table-row" key={item.id}>
                  <strong>{item.capability}</strong><span>{item.reason}</span><span>{errorClassLabels[item.errorClass] ?? item.errorClass}</span><span>{item.status}</span>
                  <span>{item.status === "PENDING" && workspace.permissions.canRetry ? (
                    <span style={{ display: "flex", gap: 6 }}>
                      <button className="button button-secondary" disabled={pending} onClick={() => runAction(() => reprocessQuarantineItemAction(projectId, item.id, false))}>Revisar</button>
                      <button className="button button-secondary" disabled={pending} onClick={() => runAction(() => reprocessQuarantineItemAction(projectId, item.id, true))}>Descartar</button>
                    </span>
                  ) : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      )}

      {area === "deadLetters" && (
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">FALHA PERMANENTE PRESERVADA</span><h2>Dead-letter</h2></div></div>
          {workspace.deadLetters.length === 0 ? <div className="empty-state"><Check size={16} /> Nenhum item em dead-letter.</div> : (
            <div className="scenario-table">
              <div className="table-row table-head"><span>Origem</span><span>Classe</span><span>Motivo</span><span>Situação</span></div>
              {workspace.deadLetters.map((item) => <div className="table-row" key={item.id}><strong>{item.sourceType}</strong><span>{errorClassLabels[item.errorClass] ?? item.errorClass}</span><span>{item.reason}</span><span>{item.resolved ? "Resolvido" : "Aberto"}</span></div>)}
            </div>
          )}
        </article>
      )}

      {area === "credentials" && (
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">NUNCA O SEGREDO — SOMENTE STATUS</span><h2>Credenciais</h2></div></div>
          {workspace.credentials.length === 0 ? <div className="empty-state"><KeyRound size={16} /> Nenhuma credencial cadastrada.</div> : (
            <div className="scenario-table">
              <div className="table-row table-head"><span>Instalação</span><span>Situação</span><span>Expira em</span><span>Fingerprint</span></div>
              {workspace.credentials.map((item) => <div className="table-row" key={item.id}><strong>{workspace.installations.find((installation) => installation.id === item.installationId)?.name ?? item.installationId}</strong><span>{credentialLabels[item.status] ?? item.status}</span><span>{dateTime(item.expiresAt)}</span><span>{item.fingerprint ?? "—"}</span></div>)}
            </div>
          )}
        </article>
      )}

      <button className="text-button" disabled={pending} onClick={() => runAction(() => refreshIntegrationsWorkspaceAction(projectId))}>{pending ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} Recarregar Central de Integrações</button>
    </div>
  );
}
