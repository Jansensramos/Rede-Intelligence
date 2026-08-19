import { redirect } from "next/navigation";
import { getAuthContext } from "@/application/auth/session";
import { LoginForm } from "@/components/auth/login-form";
import { RedeMark } from "@/components/rede-mark";

export default async function LoginPage() {
  if (await getAuthContext()) redirect("/");
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand"><RedeMark /></div>
        <span className="eyebrow">AMBIENTE MULTIEMPRESA</span>
        <h1>Inteligência para decisões imobiliárias.</h1>
        <p>Acesse os estudos, snapshots e evidências da sua organização.</p>
        <LoginForm />
        <small className="login-demo">Demonstração: admin@rede.local · Rede@2026</small>
      </section>
    </main>
  );
}
