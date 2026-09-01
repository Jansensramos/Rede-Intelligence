import React from "react";
import { LoginForm } from "./login-form";
import { RedeMark } from "@/components/rede-mark";
import type { DemoLoginPresentation } from "@/domain/auth/demo-access";

export function LoginScreen({ demo }: { demo: DemoLoginPresentation }) {
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand"><RedeMark /></div>
        <span className="eyebrow">AMBIENTE MULTIEMPRESA</span>
        <h1>Inteligência para decisões imobiliárias.</h1>
        <p>Acesse os estudos, snapshots e evidências da sua organização.</p>
        <LoginForm demo={demo.enabled ? { email: demo.email, password: demo.password } : undefined} />
        {demo.enabled && <small className="login-demo">Acesso demonstrativo habilitado somente neste ambiente.</small>}
      </section>
    </main>
  );
}
