"use client";

import { GraduationCap } from "lucide-react";
import { EmptyState, SectionTitle } from "@/components/ui";

/**
 * Fase 9K.1, ordem de serviço §9: entrada estrutural da REDE Academy, deliberadamente separada das
 * áreas operacionais e por último na navegação. Sem plataforma de cursos nesta sprint — mentorias,
 * treinamentos, materiais e certificados ficam para quando a Academy for construída. CTA discreto,
 * sem publicidade agressiva nas telas operacionais (item 9 da ordem de serviço).
 */
export default function AcademyPage() {
  return (
    <div className="view-stack">
      <SectionTitle eyebrow="ECOSSISTEMA REDE" title="REDE Academy" description="Mentorias, treinamentos, cursos, materiais e certificados para times que operam com o REDE." />
      <EmptyState
        icon={GraduationCap}
        title="REDE Academy chega em breve"
        description="Próximas turmas, trilhas de treinamento e certificações REDE. Nenhum conteúdo publicado ainda nesta sprint."
        action={{ label: "Ver treinamentos", onClick: () => {} }}
      />
    </div>
  );
}
