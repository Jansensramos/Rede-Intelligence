import Link from "next/link";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function NotFound() {
  // A leitura torna /_not-found dependente da requisição. O Next extrai o nonce da CSP recebida
  // e o aplica aos scripts gerados para esta resposta, em vez de reutilizar HTML pré-renderizado.
  await headers();

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
      <section style={{ maxWidth: 560, textAlign: "center" }}>
        <p style={{ fontWeight: 700, letterSpacing: "0.08em" }}>ERRO 404</p>
        <h1>Página não encontrada</h1>
        <p>O endereço informado não existe ou não está mais disponível.</p>
        <Link href="/">Voltar ao início</Link>
      </section>
    </main>
  );
}
