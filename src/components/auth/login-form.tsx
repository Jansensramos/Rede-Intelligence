"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/actions/auth";

const initialState: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  return (
    <form action={formAction} className="login-form">
      <label>
        <span>E-mail</span>
        <input name="email" type="email" autoComplete="username" defaultValue="admin@rede.local" required />
      </label>
      <label>
        <span>Senha</span>
        <input name="password" type="password" autoComplete="current-password" defaultValue="Rede@2026" required />
      </label>
      {state.error && <p className="login-error" role="alert">{state.error}</p>}
      <button className="button button-primary login-submit" type="submit" disabled={pending}>
        {pending ? "Entrando…" : "Entrar na plataforma"}
      </button>
    </form>
  );
}
