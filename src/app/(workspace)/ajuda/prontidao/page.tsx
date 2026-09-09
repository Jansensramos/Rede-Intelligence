import { requireDomainActionContext } from "@/app/actions/authorization";
import { getLocalReadiness, ReadinessAccessError } from "@/application/release/local-readiness-service";
import { LocalOnboarding } from "@/components/local-onboarding";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
const checkLabels: Record<string, string> = { RUNTIME_CONFIGURATION: "Configuração do ambiente", LOCAL_DATABASE: "Banco local", SESSION_SECRET: "Proteção da sessão", INTEGRATION_SECRET_KEY: "Chave local de evidências", LOCAL_DEPENDENCIES: "Dependências locais", NON_PRODUCTION: "Ambiente de ensaio", MIGRATION_INTEGRITY: "Integridade das migrations", RELEASE_IDENTITY: "Identificação da versão" };
export default async function LocalReadinessPage() {
  const context = await requireDomainActionContext("HELP_READ");
  let report;
  try { report = await getLocalReadiness(context); }
  catch (error) { if (error instanceof ReadinessAccessError) redirect("/acesso-negado"); return <section className="panel"><h1>Prontidão local indisponível</h1><p>Não foi possível verificar os dados. Nenhum gate foi aprovado.</p></section>; }
  return <div className="view-stack"><section className="panel"><h1>Prontidão do piloto — ensaio local</h1><p>{report.localReady ? "Verificações técnicas locais atendidas." : "Existem verificações técnicas locais pendentes."} Cloud, APIs reais e liberação produtiva permanecem não comprovadas.</p><p>Referência de atendimento: {report.correlationId}</p><p>Release: {report.identity.commit ?? "não identificado"} · Build: {report.identity.build ?? "não identificado"} · Migrations: {report.migrationCount}</p><ul>{report.checks.map(check => <li key={check.code}>{checkLabels[check.code] ?? "Verificação operacional"}: {check.ok ? "atendido" : "pendente"}</li>)}</ul></section><section className="panel"><h2>Operação desta organização</h2><p>Dead-letter pendente: {report.metrics.deadLetters} · Quarentena pendente: {report.metrics.quarantine} · Atraso da fila: {report.metrics.overdueSeconds}s</p><ul>{report.metrics.jobs.map(row => <li key={row.status}>Fila {row.status}: {row.count}</li>)}</ul><ul>{report.metrics.installations.map(row => <li key={row.status}>Integrações {row.status}: {row.count}</li>)}</ul><p>Alertas: {report.alerts.join(", ") || "nenhum limiar local excedido"}. Estado REAL: não verificado.</p></section><LocalOnboarding steps={report.onboarding.map(row => ({ ...row, attestedAt: row.attestedAt?.toISOString() ?? null }))} /></div>;
}

