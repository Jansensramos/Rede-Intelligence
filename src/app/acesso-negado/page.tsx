import { redirect } from "next/navigation";
import { getAuthContext } from "@/application/auth/session";

export default async function AccessDeniedPage() {
  if (!(await getAuthContext())) redirect("/login");
  return (
    <main className="login-shell">
      <section className="login-card">
        <span className="eyebrow">ACESSO RESTRITO</span>
        <h1>Seu perfil não possui acesso a estes dados.</h1>
        <p>Escolha uma área autorizada ou solicite a revisão do seu papel ao administrador da organização.</p>
        <a className="button button-primary" href="/viabilidade">Voltar para Viabilidade</a>
      </section>
    </main>
  );
}
