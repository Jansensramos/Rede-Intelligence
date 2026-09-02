"use client";

import React, { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/actions/auth";

const initialState: LoginState = { error: null };

export function LoginForm({ demo }: { demo?: { email: string; password: string } }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  return (
    <form action={formAction} className="login-form">
      <label>
        <span>E-mail</span>
        <input name="email" type="email" autoComplete="username" defaultValue={state.email ?? demo?.email} required />
      </label>
      {state.requiresOrganization && state.organizations && (
        <fieldset className="login-organization-picker">
          <legend>Selecione a organização</legend>
          <p>Por segurança, confirme novamente a senha e escolha o contexto que deseja acessar.</p>
          {state.organizations.map((organization, index) => (
            <label key={organization.id}>
              <input type="radio" name="organizationId" value={organization.id} defaultChecked={index === 0} required />
              <span>{organization.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <label>
        <span>Senha</span>
        <input name="password" type="password" autoComplete="current-password" defaultValue={demo?.password} required />
      </label>
      {state.error && <p className="login-error" role="alert">{state.error}</p>}
      <button className="button button-primary login-submit" type="submit" disabled={pending}>
        {pending ? "Entrando…" : state.requiresOrganization ? "Entrar nesta organização" : "Entrar na plataforma"}
      </button>
    </form>
  );
}
