"use client";

import { useState, useTransition } from "react";
import { createGoogleDriveInstallationAction, configureGoogleDriveInstallationAction, syncGoogleDriveInstallationAction, getGoogleDriveConfigurationAction } from "@/app/actions/google-drive";

export function GoogleDriveControls({ projectId, installations, onChanged }: { projectId: string; installations: { id: string; name: string }[]; onChanged: () => void }) {
  const [installationId, setInstallationId] = useState("");
  const [name, setName] = useState("Google Drive");
  const [driveId, setDriveId] = useState("MY_DRIVE");
  const [folderId, setFolderId] = useState("");
  const [mode, setMode] = useState<"DISABLED" | "MOCK" | "REAL">("DISABLED");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  function run(operation: () => Promise<unknown>, success: string) {
    startTransition(async () => {
      setMessage("");
      try { await operation(); setMessage(success); onChanged(); }
      catch { setMessage("Não foi possível concluir. Confira o acesso, o escopo e a configuração da conexão."); }
    });
  }
  return <section className="panel" aria-label="Conexão Google Drive">
    <h3>Google Drive</h3>
    <p>Referencie arquivos de uma pasta do Meu Drive ou de um Drive compartilhado. Uma pasta inclui apenas seus arquivos diretos. A simulação não consulta o Google. O modo conectado exige autorização previamente configurada.</p>
    <form onSubmit={event => { event.preventDefault(); run(async () => {
      if (installationId) await configureGoogleDriveInstallationAction(installationId, { mode, driveId, ...(folderId ? { folderId } : {}) });
      else { const created = await createGoogleDriveInstallationAction({ name, projectId, driveId, ...(folderId ? { folderId } : {}) }); setInstallationId(created.id); }
    }, installationId ? "Configuração salva." : "Conexão criada e desativada."); }}>
      <label>Conexão<select value={installationId} disabled={pending} onChange={e => { const id = e.target.value; setInstallationId(id); setMode("DISABLED"); setDriveId(""); setFolderId(""); if (id) run(async () => { const saved = await getGoogleDriveConfigurationAction(id); setMode(saved.mode); setDriveId(saved.driveId); setFolderId(saved.folderId ?? ""); }, "Configuração salva carregada."); }}><option value="">Nova conexão</option>{installations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      {!installationId && <label>Nome<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>}
      <label>Origem<select value={driveId === "MY_DRIVE" ? "PERSONAL" : "SHARED"} onChange={e => setDriveId(e.target.value === "PERSONAL" ? "MY_DRIVE" : "")}><option value="PERSONAL">Meu Drive</option><option value="SHARED">Drive compartilhado</option></select></label>
      {driveId !== "MY_DRIVE" && <label>ID do Drive compartilhado<input required maxLength={256} value={driveId} onChange={e => setDriveId(e.target.value)} /></label>}
      <label>ID da pasta {driveId === "MY_DRIVE" ? "(obrigatório)" : "(opcional)"}<input required={driveId === "MY_DRIVE"} maxLength={256} value={folderId} onChange={e => setFolderId(e.target.value)} /></label>
      {installationId && <label>Modo<select value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="DISABLED">Desativado</option><option value="MOCK">Simulação</option><option value="REAL">Conectado</option></select></label>}
      <button className="button button-secondary" disabled={pending} type="submit">{installationId ? "Salvar configuração" : "Criar conexão desativada"}</button>
      {installationId && <button className="button button-secondary" disabled={pending} type="button" onClick={() => run(() => syncGoogleDriveInstallationAction(installationId), "Sincronização enfileirada. Acompanhe em Sincronizações.")}>Sincronizar configuração salva</button>}
    </form>
    {message && <p role="status">{message}</p>}
  </section>;
}
