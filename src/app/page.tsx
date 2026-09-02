import { redirect } from "next/navigation";
import { getAuthContext } from "@/application/auth/session";
import { defaultWorkspacePathForRole } from "@/domain/auth/read-capabilities";

/**
 * Fase 9K.1: a porta de entrada da aplicação passa a ser a Gestão Executiva (ordem de serviço §1),
 * não mais uma única tela monolítica. A navegação legada continua acessível em `/legado` (§13).
 */
export default async function RootPage() {
  const context = await getAuthContext();
  redirect(context ? defaultWorkspacePathForRole(context.role) : "/login");
}
