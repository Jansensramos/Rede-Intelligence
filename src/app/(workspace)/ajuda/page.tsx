import { HelpCircle } from "lucide-react";
import { EmptyState, SectionTitle } from "@/components/ui";

/**
 * Fase 9K.1, ordem de serviço §11: ponto de entrada estrutural da Central de Ajuda. A arquitetura
 * completa (indexação de conteúdo por tela via `AIDocumentChunk`, plano §Q) é a 9K.4 — aqui só o
 * lugar no shell onde ela vai morar.
 */
export default function AjudaPage() {
  return (
    <div className="view-stack">
      <SectionTitle eyebrow="AJUDA" title="Central de Ajuda" description="Documentação por tela, guiada pelo REDE AI. A arquitetura completa chega na Fase 9K.4." />
      <EmptyState
        icon={HelpCircle}
        title="Central de Ajuda ainda em construção"
        description="Enquanto isso, use o Pergunte ao REDE (na barra lateral) para perguntar sobre qualquer tela do sistema."
      />
    </div>
  );
}
