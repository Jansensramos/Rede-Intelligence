import { requireDomainActionContext } from "@/app/actions/authorization";
import { getLocalReadiness, ReadinessAccessError } from "@/application/release/local-readiness-service";
import { LocalOnboarding } from "@/components/local-onboarding";
import Link from "next/link";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
const checkLabels: Record<string, string> = { RUNTIME_CONFIGURATION: "Configuração do ambiente", LOCAL_DATABASE: "Banco local", SESSION_SECRET: "Proteção da sessão", INTEGRATION_SECRET_KEY: "Chave local de evidências", LOCAL_DEPENDENCIES: "Dependências locais", NON_PRODUCTION: "Ambiente de ensaio", MIGRATION_INTEGRITY: "Integridade das atualizações do banco", RELEASE_IDENTITY: "Identificação da versão" };
export default async function LocalReadinessPage() {
  const context = await requireDomainActionContext("HELP_READ");
  let report;
  try { report = await getLocalReadiness(context); }
  catch (error) { if (error instanceof ReadinessAccessError) redirect("/acesso-negado"); return <section className="panel"><h1>Prontidão local indisponível</h1><p>Não foi possível verificar os dados. Nenhum gate foi aprovado.</p></section>; }
  const hasIntegrationAttention = report.metrics.deadLetters > 0 || report.metrics.quarantine > 0 || report.metrics.overdueSeconds > 300;
  const alertLabels: Record<string, string> = {
    DEAD_LETTER_PENDING: "há falhas de integração aguardando tratamento",
    QUARANTINE_PENDING: "há itens em quarentena aguardando decisão",
    QUEUE_OVERDUE: "há fila de integração com atraso acima de 5 minutos",
  };
  return <div className="view-stack">
    <section className="panel">
      <h1>Prontidão do piloto — ensaio local</h1>
      <p>{report.localReady ? "As verificações técnicas deste ambiente local foram atendidas." : "Existem verificações técnicas locais pendentes."} Integrações externas e ambiente produtivo exigem validação própria de credenciais, conectividade e operação real.</p>
      <p>Referência de atendimento: {report.correlationId}</p>
      <p>Release: {report.identity.commit ?? "não identificado"} · Build: {report.identity.build ?? "não identificado"} · Migrations: {report.migrationCount}</p>
      <ul>{report.checks.map(check => <li key={check.code}>{checkLabels[check.code] ?? "Verificação operacional"}: {check.ok ? "atendido" : "pendente"}</li>)}</ul>
      {!report.localReady && <div className="panel-actions"><Link className="button button-secondary" href="/ajuda">Revisar orientação</Link></div>}
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h2>Operação desta organização</h2><p>Indicadores técnicos de fila e integrações com próximo passo explícito.</p></div><div className="panel-actions"><Link className="button button-secondary" href="/integracoes">Abrir Integrações</Link><Link className="button button-secondary" href="/acoes">Abrir Central de Ações</Link></div></div>
      <p>Dead-letter pendente: {report.metrics.deadLetters} · Quarentena pendente: {report.metrics.quarantine} · Atraso da fila: {report.metrics.overdueSeconds}s</p>
      <ul>{report.metrics.jobs.map(row => <li key={row.status}>Fila {row.status}: {row.count}</li>)}</ul>
      <ul>{report.metrics.installations.map(row => <li key={row.status}>Integrações {row.status}: {row.count}</li>)}</ul>
      {report.alerts.length > 0
        ? <div className="model-note"><div><strong>Atenção operacional</strong><p>{report.alerts.map(code => code ? (alertLabels[code] ?? code) : "alerta operacional sem código").join(" · ")}.</p></div></div>
        : <p>Nenhum limiar operacional local excedido.</p>}
      <p>Saúde dos provedores externos: {report.providerHealth === "REAL_NOT_VERIFIED" ? "não verificada por esta checagem local" : report.providerHealth}.</p>
      {hasIntegrationAttention && <div className="panel-actions"><Link className="button button-primary" href="/integracoes">Tratar pendências de integração</Link></div>}
    </section>

    <LocalOnboarding steps={report.onboarding.map(row => ({ ...row, attestedAt: row.attestedAt?.toISOString() ?? null }))} />
  </div>;
}

