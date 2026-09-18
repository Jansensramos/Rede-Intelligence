"use client";

import { useState, useTransition } from "react";
import type { IntegrationsWorkspaceView } from "@/application/integrations/integrations-service";
import { createClicksignInstallationAction, storeClicksignCredentialAction, configureClicksignForProjectAction } from "@/app/actions/integrations";

export function ClicksignControls({ projectId, workspace, onChanged }: { projectId: string; workspace: IntegrationsWorkspaceView; onChanged: (workspace: IntegrationsWorkspaceView) => void }) {
  const clicksignInstallations = workspace.installations.filter((item) => item.connectorCode === "CLICKSIGN_API_V3");
  const [installationId, setInstallationId] = useState(clicksignInstallations[0]?.id ?? "");
  const [name, setName] = useState("Clicksign");
  const [mode, setMode] = useState<"DISABLED" | "MOCK" | "REAL">("DISABLED");
  const [environment, setEnvironment] = useState<"SANDBOX" | "PRODUCTION">("SANDBOX");
  const [signatureEnvelopeEnabled, setSignatureEnvelopeEnabled] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const baseUrl = environment === "SANDBOX" ? "https://sandbox.clicksign.com" : "https://app.clicksign.com";

  function run(operation: () => Promise<void>, success: string) {
    startTransition(async () => {
      setMessage("");
      try { await operation(); setMessage(success); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível concluir a configuração."); }
    });
  }

  function createInstallation() {
    run(async () => {
      const response = await createClicksignInstallationAction(projectId, name);
      if (!response.ok) throw new Error(response.error);
      setInstallationId(response.data.installationId);
      onChanged(response.data.workspace);
    }, "Instalação Clicksign criada em modo desativado.");
  }

  function saveCredential() {
    if (!installationId) return setMessage("Crie ou selecione uma instalação primeiro.");
    run(async () => {
      const response = await storeClicksignCredentialAction(projectId, installationId, { accessToken, webhookSecret });
      if (!response.ok) throw new Error(response.error);
      setAccessToken(""); setWebhookSecret(""); onChanged(response.data);
    }, "Credencial armazenada no cofre. O segredo não é exibido pela REDE.");
  }

  function saveConfiguration() {
    if (!installationId) return setMessage("Crie ou selecione uma instalação primeiro.");
    run(async () => {
      const response = await configureClicksignForProjectAction(projectId, installationId, { mode, signatureEnvelopeEnabled, environment, baseUrl, timeoutMs: 15000 });
      if (!response.ok) throw new Error(response.error);
      onChanged(response.data);
    }, "Configuração Clicksign salva.");
  }

  return <section className="panel" aria-label="Conexão Clicksign">
    <div className="panel-heading"><div><span className="eyebrow">ASSINATURA ELETRÔNICA</span><h2>Clicksign</h2><p>Configure ambiente, credencial e ativação do envelope. Tokens e segredos ficam apenas no cofre e nunca são exibidos depois de salvos.</p></div></div>
    <div className="form-grid">
      <label>Instalação<select value={installationId} onChange={(event) => setInstallationId(event.target.value)}><option value="">Nova instalação</option>{clicksignInstallations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {!installationId && <><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} /></label><div className="form-actions"><button className="button button-secondary" disabled={pending || name.trim().length < 2} onClick={createInstallation}>Criar instalação</button></div></>}
      {installationId && <><label>Ambiente<select value={environment} onChange={(event) => setEnvironment(event.target.value as typeof environment)}><option value="SANDBOX">Sandbox</option><option value="PRODUCTION">Produção</option></select></label>
      <label>Modo<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="DISABLED">Desativado</option><option value="MOCK">Simulação</option><option value="REAL">Real</option></select></label>
      <label><input type="checkbox" checked={signatureEnvelopeEnabled} onChange={(event) => setSignatureEnvelopeEnabled(event.target.checked)} /> Habilitar envelopes de assinatura</label>
      <label>Token de acesso<input type="password" autoComplete="new-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Novo token" /></label>
      <label>Segredo do webhook<input type="password" autoComplete="new-password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} placeholder="Novo segredo" /></label>
      <div className="form-actions"><button className="button button-secondary" disabled={pending || !accessToken.trim() || !webhookSecret.trim()} onClick={saveCredential}>Salvar/rotacionar credencial</button><button className="button button-primary" disabled={pending} onClick={saveConfiguration}>Salvar configuração</button></div></>}
    </div>
    {message && <div className="model-note"><div><strong>Clicksign</strong><p>{message}</p></div></div>}
  </section>;
}
