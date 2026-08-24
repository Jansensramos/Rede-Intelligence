import { redirect } from "next/navigation";

/**
 * Fase 9K.1: a porta de entrada da aplicação passa a ser a Gestão Executiva (ordem de serviço §1),
 * não mais uma única tela monolítica. A navegação legada continua acessível em `/legado` (§13).
 */
export default function RootPage() {
  redirect("/executivo");
}
