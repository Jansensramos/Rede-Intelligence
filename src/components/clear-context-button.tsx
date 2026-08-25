"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearActiveProjectAction } from "@/app/actions/workspace-context";

/** Achado da revisão pós-fechamento da 9K.1: dá uma saída real quando o cookie de contexto aponta para um projeto que não resolve mais. */
export function ClearContextButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    await clearActiveProjectAction();
    router.refresh();
  }

  return (
    <button className="button button-secondary" onClick={handleClick} disabled={pending} type="button">
      {pending ? "Limpando seleção…" : "Limpar seleção e tentar novamente"}
    </button>
  );
}
