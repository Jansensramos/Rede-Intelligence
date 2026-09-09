import Link from "next/link";
import { requireDomainActionContext } from "@/app/actions/authorization";
import { manualModules, glossary, roleGuidance, onboardingGuide } from "@/domain/release/manual";
import { canAccessWorkspacePath } from "@/domain/auth/read-capabilities";

/** Manual local versionado; orientação não substitui aprovação de domínio ou evidência REAL. */
export default async function AjudaPage() {
  const context = await requireDomainActionContext("HELP_READ");
  return (
    <div className="view-stack">
      <section className="panel"><h1>Manual Online REDE Intelligence</h1><p>Orientação operacional em português · 9Q.2A. Cloud e integrações reais não comprovadas.</p><h2>Seu papel: {context.role}</h2><p>{roleGuidance[context.role]}</p>{["OWNER", "ADMIN"].includes(context.role) && <Link href="/ajuda/prontidao">Abrir prontidão e checklist do piloto local</Link>}<nav aria-label="Índice do manual">{manualModules.filter(module => canAccessWorkspacePath(context.role, module.path)).map(module => <p key={module.id}><a href={`#${module.id}`}>{module.title}</a></p>)}<p><a href="#onboarding">Primeiros passos</a> · <a href="#glossario">Glossário</a> · <a href="#suporte">Erros e suporte</a></p></nav></section>
      {manualModules.filter(module => canAccessWorkspacePath(context.role, module.path)).map(module => <section className="panel" id={module.id} key={module.id}><h2>{module.title}</h2><ol>{module.steps.map(step => <li key={step}>{step}</li>)}</ol><Link href={module.path}>Abrir módulo</Link></section>)}
      <section className="panel" id="onboarding"><h2>Primeiros passos — onboarding assistido</h2><ol>{onboardingGuide.map(step => <li key={step} style={{ marginBottom: 16 }}>{step}</li>)}</ol></section>
      <section className="panel" id="glossario"><h2>Glossário</h2><dl>{Object.entries(glossary).map(([term, meaning]) => <div key={term}><dt><strong>{term}</strong></dt><dd>{meaning}</dd></div>)}</dl></section>
      <section className="panel" id="suporte"><h2>Erros e suporte</h2><p>Acesso negado: confira a organização e peça revisão do papel ao administrador. Sessão expirada: entre novamente. Divergência ou item em quarentena: revise a origem antes de retentar. Serviço indisponível: preserve o identificador de correlação e acione o responsável local.</p><p>Informe horário, módulo, ação e referência de atendimento. Nunca envie senhas, tokens, connection strings ou documentos pessoais em logs e mensagens. O canal e horário de suporte serão definidos com o cliente antes do piloto.</p></section>
    </div>
  );
}
