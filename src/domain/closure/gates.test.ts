import { describe, expect, it } from "vitest";
import { evaluatePostSaleImpediment, evaluateProjectClosureGate, type PostSaleImpedimentInput } from "./gates";

const NOW = new Date("2026-09-11T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");
const FUTURE = new Date("2026-12-01T00:00:00.000Z");

function basePostSale(overrides: Partial<PostSaleImpedimentInput> = {}): PostSaleImpedimentInput {
  return {
    id: "req-1", category: "ASSISTENCIA", status: "OPEN", slaDueAt: null, responsibleId: "user-1", supplierId: null,
    recurrenceOfId: null, estimatedCost: null, actualCost: null, now: NOW, hasActiveProvision: false, materialityThreshold: null,
    ...overrides,
  };
}

describe("evaluatePostSaleImpediment — decisão 4 da Fase 9S", () => {
  it("GARANTIA aberta bloqueia", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "GARANTIA" }));
    expect(outcome.impeditive).toBe(true);
    expect(outcome.reasons.join(" ")).toMatch(/GARANTIA/);
  });

  it("OCORRENCIA aberta bloqueia", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "OCORRENCIA" }));
    expect(outcome.impeditive).toBe(true);
  });

  it("ASSISTENCIA aberta, sem nenhuma outra condição, não bloqueia (mesmo tratamento de OUTRO)", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "ASSISTENCIA" }));
    expect(outcome.impeditive).toBe(false);
  });

  it("OUTRO não vencido e não impeditivo não bloqueia", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "OUTRO" }));
    expect(outcome.impeditive).toBe(false);
  });

  it("qualquer categoria com SLA vencido sem resolução bloqueia", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "OUTRO", slaDueAt: PAST }));
    expect(outcome.impeditive).toBe(true);
    expect(outcome.reasons.join(" ")).toMatch(/SLA vencido/);
  });

  it("SLA vencido mas chamado já RESOLVED não bloqueia por essa regra", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "OUTRO", status: "RESOLVED", slaDueAt: PAST }));
    expect(outcome.impeditive).toBe(false);
  });

  it("reincidência (recurrenceOfId) não resolvida bloqueia", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "OUTRO", recurrenceOfId: "req-0" }));
    expect(outcome.impeditive).toBe(true);
    expect(outcome.reasons.join(" ")).toMatch(/Reincidência/);
  });

  it("reincidência já CLOSED não bloqueia por essa regra", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "OUTRO", status: "CLOSED", recurrenceOfId: "req-0" }));
    expect(outcome.impeditive).toBe(false);
  });

  it("ausência de responsável e fornecedor em chamado aberto bloqueia", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "OUTRO", responsibleId: null, supplierId: null }));
    expect(outcome.impeditive).toBe(true);
    expect(outcome.reasons.join(" ")).toMatch(/responsável ou fornecedor/);
  });

  it("com responsável OU fornecedor não bloqueia por essa regra", () => {
    expect(evaluatePostSaleImpediment(basePostSale({ category: "OUTRO", responsibleId: "u1", supplierId: null })).impeditive).toBe(false);
    expect(evaluatePostSaleImpediment(basePostSale({ category: "OUTRO", responsibleId: null, supplierId: "s1" })).impeditive).toBe(false);
  });

  it("custo material sem provisão bloqueia — sem política de materialidade, qualquer custo > 0 é material (falha fechado)", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "OUTRO", estimatedCost: "500.00", materialityThreshold: null, hasActiveProvision: false }));
    expect(outcome.impeditive).toBe(true);
    expect(outcome.reasons.join(" ")).toMatch(/Custo material/);
  });

  it("custo abaixo do limiar de materialidade não bloqueia por essa regra", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "OUTRO", estimatedCost: "10.00", materialityThreshold: "1000.00", hasActiveProvision: false }));
    expect(outcome.impeditive).toBe(false);
  });

  it("custo material com provisão ativa não bloqueia por essa regra isoladamente", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "OUTRO", estimatedCost: "5000.00", materialityThreshold: "1000.00", hasActiveProvision: true }));
    expect(outcome.impeditive).toBe(false);
  });

  it("formalmente provisionado (provisão + responsável/fornecedor + custo + prazo) deixa de bloquear GARANTIA aberta", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({
      category: "GARANTIA", responsibleId: "u1", estimatedCost: "5000.00", slaDueAt: FUTURE, hasActiveProvision: true,
    }));
    expect(outcome.impeditive).toBe(false);
    expect(outcome.formallyProvisioned).toBe(true);
    expect(outcome.reasons.length).toBeGreaterThan(0); // continua auditável — os motivos originais são preservados
  });

  it("provisão ativa sozinha, sem prazo definido, NÃO é formalmente provisionado — continua bloqueando", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "GARANTIA", responsibleId: "u1", estimatedCost: "5000.00", slaDueAt: null, hasActiveProvision: true }));
    expect(outcome.impeditive).toBe(true);
    expect(outcome.formallyProvisioned).toBe(false);
  });

  it("provisão ativa sozinha, sem custo nem responsável/fornecedor, NÃO é formalmente provisionado — continua bloqueando", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale({ category: "GARANTIA", responsibleId: null, supplierId: null, estimatedCost: null, slaDueAt: FUTURE, hasActiveProvision: true }));
    expect(outcome.impeditive).toBe(true);
    expect(outcome.formallyProvisioned).toBe(false);
  });

  it("nenhuma condição bloqueante — chamado totalmente elegível", () => {
    const outcome = evaluatePostSaleImpediment(basePostSale());
    expect(outcome.impeditive).toBe(false);
    expect(outcome.reasons).toEqual([]);
  });
});

describe("evaluateProjectClosureGate — combinações dos 5 subgates", () => {
  const PROCEED_DECISION = { decision: "PROCEED" as const, conditions: [] as unknown };
  const APTO_INPUT = {
    operational: { unitsPendingDeliveryCount: 0, condominiumStatus: "IMPLEMENTED" as const, impeditivePostSaleRequestIds: [] },
    contractual: { openContractIds: [] },
    legal: {
      obligations: [{ id: "o1", status: "FULFILLED" as const }],
      closureDiligenceCase: {
        id: "case-1", status: "COMPLETED" as const,
        checklistItems: [{ id: "chk-1", status: "COMPLIANT" as const, criticality: "LOW" as const, reviewedById: null, notes: null, evidenceDocumentIds: null, hasVerifiedEvidence: false }],
        // Vazio deliberadamente: correção final ("evidência jurídica não pode ser string livre")
        // — nenhum LegalDocumentRequest RECEIVED pode mais contribuir para APTO (nenhuma entidade
        // canônica de documento existe para comprovar a evidência); a fixture-base "tudo APTO"
        // não pode incluir um documento "recebido" sem deixar de ser genuinamente APTO.
        documentRequests: [],
        latestDecision: PROCEED_DECISION,
      },
    },
    financial: { overdueInstallmentCount: 0, pendingDisbursementCount: 0 },
    accounting: { periods: [{ id: "p1", status: "CLOSED" as const, ledgerEvidence: "VALID" as const }] },
  };

  it("todos os 5 subgates APTO → overall APTO", () => {
    const result = evaluateProjectClosureGate(APTO_INPUT);
    expect(result.overall).toBe("APTO");
    expect(result.operational.status).toBe("APTO");
    expect(result.contractual.status).toBe("APTO");
    expect(result.legal.status).toBe("APTO");
    expect(result.financial.status).toBe("APTO");
    expect(result.accounting.status).toBe("APTO");
  });

  it("unidade vendida não entregue bloqueia (operacional PENDENTE) mesmo com os outros 4 APTO", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, operational: { ...APTO_INPUT.operational, unitsPendingDeliveryCount: 1 } });
    expect(result.operational.status).toBe("PENDENTE");
    expect(result.overall).toBe("BLOQUEADO");
  });

  it("chamado de assistência impeditivo em aberto bloqueia o gate operacional", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, operational: { ...APTO_INPUT.operational, impeditivePostSaleRequestIds: ["req-1"] } });
    expect(result.operational.status).toBe("PENDENTE");
    expect(result.overall).toBe("BLOQUEADO");
  });

  it("nenhuma implantação de condomínio registrada → SEM_EVIDENCIA, nunca aprovação", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, operational: { ...APTO_INPUT.operational, condominiumStatus: null } });
    expect(result.operational.status).toBe("SEM_EVIDENCIA");
    expect(result.overall).toBe("BLOQUEADO");
  });

  it("condomínio CANCELLED (convenção de 'não aplicável') conta como terminal — APTO", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, operational: { ...APTO_INPUT.operational, condominiumStatus: "CANCELLED" } });
    expect(result.operational.status).toBe("APTO");
  });

  it("condomínio ainda PLANNED/IN_PROGRESS bloqueia", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, operational: { ...APTO_INPUT.operational, condominiumStatus: "IN_PROGRESS" } });
    expect(result.operational.status).toBe("PENDENTE");
  });

  it("contrato operacional em aberto bloqueia o gate contratual", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, contractual: { openContractIds: ["contract-1"] } });
    expect(result.contractual.status).toBe("PENDENTE");
    expect(result.overall).toBe("BLOQUEADO");
  });

  it("obrigação jurídica fora de estado terminal bloqueia o gate jurídico", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, obligations: [{ id: "o1", status: "OVERDUE" }] } });
    expect(result.legal.status).toBe("PENDENTE");
  });

  it("ausência de checklist de encerramento societário → SEM_EVIDENCIA", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: null } });
    expect(result.legal.status).toBe("SEM_EVIDENCIA");
  });

  it("checklist não concluído (status do caso) bloqueia o gate jurídico", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, status: "IN_PROGRESS" } } });
    expect(result.legal.status).toBe("PENDENTE");
  });

  it("caso COMPLETED sem nenhuma decisão registrada → SEM_EVIDENCIA (nunca aprovação silenciosa)", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, latestDecision: null } } });
    expect(result.legal.status).toBe("SEM_EVIDENCIA");
  });

  describe("Bloqueador corrigido — valor real da LegalDecision decide o gate, nunca só a existência de uma decisão", () => {
    it("DO_NOT_PROCEED nunca produz APTO", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, latestDecision: { decision: "DO_NOT_PROCEED", conditions: [] } } } });
      expect(result.legal.status).toBe("PENDENTE");
      expect(result.overall).toBe("BLOQUEADO");
    });

    it("HOLD nunca produz APTO", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, latestDecision: { decision: "HOLD", conditions: [] } } } });
      expect(result.legal.status).toBe("PENDENTE");
    });

    it("INSUFFICIENT_EVIDENCE nunca produz APTO — vira SEM_EVIDENCIA (ausência estrutural), nunca PENDENTE nem aprovação", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, latestDecision: { decision: "INSUFFICIENT_EVIDENCE", conditions: [] } } } });
      expect(result.legal.status).toBe("SEM_EVIDENCIA");
    });

    it("PROCEED produz APTO quando os demais requisitos estão satisfeitos", () => {
      const result = evaluateProjectClosureGate(APTO_INPUT);
      expect(result.legal.status).toBe("APTO");
    });

    it("PROCEED_WITH_CONDITIONS não produz APTO com condição impeditiva aberta (item sem resolved:true)", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, latestDecision: { decision: "PROCEED_WITH_CONDITIONS", conditions: [{ code: "CP-1", resolved: false }] } } } });
      expect(result.legal.status).toBe("PENDENTE");
    });

    it("PROCEED_WITH_CONDITIONS produz APTO quando todas as condições têm resolved:true", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, latestDecision: { decision: "PROCEED_WITH_CONDITIONS", conditions: [{ code: "CP-1", resolved: true }, { code: "CP-2", resolved: true }] } } } });
      expect(result.legal.status).toBe("APTO");
    });

    it("PROCEED_WITH_CONDITIONS sem nenhuma condição (lista vazia) produz APTO — vacuamente satisfeito", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, latestDecision: { decision: "PROCEED_WITH_CONDITIONS", conditions: [] } } } });
      expect(result.legal.status).toBe("APTO");
    });

    it("múltiplas decisões: só a mais recente (maior version na consulta) decide — decisão antiga favorável seguida de negativa bloqueia", () => {
      // A camada de aplicação já entrega só `latestDecision` (maior version) — o teste de unidade
      // simula exatamente esse contrato: a decisão antiga PROCEED nunca chega ao domínio.
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, latestDecision: { decision: "DO_NOT_PROCEED", conditions: [] } } } });
      expect(result.legal.status).toBe("PENDENTE");
    });

    it("decisão antiga negativa seguida de favorável válida: usa a mais recente → APTO", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, latestDecision: { decision: "PROCEED", conditions: [] } } } });
      expect(result.legal.status).toBe("APTO");
    });

    it("valor de decisão estruturalmente desconhecido falha fechado (PENDENTE, nunca APTO)", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, latestDecision: { decision: "SOME_FUTURE_VALUE" as never, conditions: [] } } } });
      expect(result.legal.status).toBe("PENDENTE");
      expect(result.overall).toBe("BLOQUEADO");
    });
  });

  describe("LegalChecklistItem e LegalDocumentRequest — correção focal final (achado Alto: CANCELLED nunca é evidência positiva)", () => {
    // `criticality` padrão LOW e `hasVerifiedEvidence` padrão `false` preservam a semântica
    // pré-existente destes testes (LOW nunca exige evidência canônica — ver `gates.ts`); os
    // testes específicos da correção estrutural final (evidência canônica) sobrescrevem os dois.
    const withChecklist = (items: Array<{ id: string; status: string; criticality?: string; reviewedById?: string | null; notes?: string | null; evidenceDocumentIds?: unknown; hasVerifiedEvidence?: boolean }>) =>
      evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, checklistItems: items.map((i) => ({ criticality: "LOW", reviewedById: null, notes: null, evidenceDocumentIds: null, hasVerifiedEvidence: false, ...i })) as never } } });
    const withDocuments = (items: Array<{ id: string; status: string; documentLinkId?: string | null; hasVerifiedEvidence?: boolean }>) =>
      evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, documentRequests: items.map((i) => ({ documentLinkId: null, hasVerifiedEvidence: false, ...i })) as never } } });

    // 1-2: checklist CANCELLED nunca satisfaz, com ou sem revisor — só WAIVED tem caminho de dispensa.
    it("1. checklist CANCELLED sem revisão → não APTO", () => {
      expect(withChecklist([{ id: "chk-1", status: "CANCELLED" }]).legal.status).toBe("PENDENTE");
    });
    it("2. checklist CANCELLED com reviewedById mas sem justificativa → não APTO", () => {
      expect(withChecklist([{ id: "chk-1", status: "CANCELLED", reviewedById: "user-1" }]).legal.status).toBe("PENDENTE");
    });
    it("CANCELLED com documento/evidência aparentemente válida continua não satisfazendo (CANCELLED nunca é reversível por evidência)", () => {
      expect(withChecklist([{ id: "chk-1", status: "CANCELLED", reviewedById: "user-1", notes: "x", evidenceDocumentIds: ["doc-valido"] }]).legal.status).toBe("PENDENTE");
    });

    // 3-5: WAIVED só satisfaz com revisor identificado E justificativa real (nota não vazia).
    // evidenceDocumentIds NUNCA conta (última correção: sem entidade canônica de documento em
    // todo o schema — string/array livre nunca é evidência, ver `hasAuditableWaiverJustification`).
    it("3. checklist WAIVED sem revisor → não APTO", () => {
      expect(withChecklist([{ id: "chk-1", status: "WAIVED", notes: "Não aplicável a este caso." }]).legal.status).toBe("PENDENTE");
    });
    it("4. checklist WAIVED com revisor mas sem justificativa → não APTO", () => {
      expect(withChecklist([{ id: "chk-1", status: "WAIVED", reviewedById: "user-1" }]).legal.status).toBe("PENDENTE");
    });
    it("checklist WAIVED com nota vazia/só espaços não satisfaz (nota precisa ter conteúdo real)", () => {
      expect(withChecklist([{ id: "chk-1", status: "WAIVED", reviewedById: "user-1", notes: "   " }]).legal.status).toBe("PENDENTE");
    });
    it("5. checklist WAIVED formal e auditável (revisor + nota) → APTO", () => {
      expect(withChecklist([{ id: "chk-1", status: "WAIVED", reviewedById: "user-1", notes: "Dispensado — item não aplicável a este tipo de SPE." }]).legal.status).toBe("APTO");
    });
    it("WAIVED com evidenceDocumentIds (qualquer conteúdo — válido, inválido, misto, duplicado) nunca basta sem nota: evidenceDocumentIds nunca é evidência", () => {
      expect(withChecklist([{ id: "chk-1", status: "WAIVED", reviewedById: "user-1", evidenceDocumentIds: ["doc-x"] }]).legal.status).toBe("PENDENTE");
      expect(withChecklist([{ id: "chk-1", status: "WAIVED", reviewedById: "user-1", evidenceDocumentIds: ["doc-inexistente-123"] }]).legal.status).toBe("PENDENTE");
      expect(withChecklist([{ id: "chk-1", status: "WAIVED", reviewedById: "user-1", evidenceDocumentIds: ["doc-valido", "doc-invalido"] }]).legal.status).toBe("PENDENTE");
      expect(withChecklist([{ id: "chk-1", status: "WAIVED", reviewedById: "user-1", evidenceDocumentIds: ["doc-x", "doc-x", "doc-x"] }]).legal.status).toBe("PENDENTE"); // duplicatas não aumentam evidência
      expect(withChecklist([{ id: "chk-1", status: "WAIVED", reviewedById: "user-1", evidenceDocumentIds: [] }]).legal.status).toBe("PENDENTE"); // lista vazia também não
    });

    // 6-7: demais estados de checklist.
    it("6. checklist NON_COMPLIANT → PENDENTE", () => {
      expect(withChecklist([{ id: "chk-1", status: "NON_COMPLIANT" }]).legal.status).toBe("PENDENTE");
    });
    it("7. checklist NOT_STARTED → PENDENTE (ainda não iniciado é 'pendente', não uma ausência estrutural de evidência)", () => {
      expect(withChecklist([{ id: "chk-1", status: "NOT_STARTED" }]).legal.status).toBe("PENDENTE");
    });
    it("checklist COMPLIANT (materialmente concluído) → APTO, incondicionalmente", () => {
      expect(withChecklist([{ id: "chk-1", status: "COMPLIANT" }]).legal.status).toBe("APTO");
    });

    // 8-9: LegalDocumentRequest — sem reviewedById/notes no schema, então CANCELLED/WAIVED nunca têm prova formal.
    it("8. documento CANCELLED → não APTO (schema não tem campo para provar dispensa formal desta solicitação)", () => {
      expect(withDocuments([{ id: "doc-1", status: "CANCELLED" }]).legal.status).toBe("PENDENTE");
    });
    it("documento CANCELLED com documentLinkId aparentemente válido continua não satisfazendo", () => {
      expect(withDocuments([{ id: "doc-1", status: "CANCELLED", documentLinkId: "doclink-valido" }]).legal.status).toBe("PENDENTE");
    });
    it("9. documento REQUESTED (pendente), NON_COMPLIANT (recusado) ou EXPIRED (vencido) → não APTO", () => {
      expect(withDocuments([{ id: "doc-1", status: "REQUESTED" }]).legal.status).toBe("PENDENTE");
      expect(withDocuments([{ id: "doc-1", status: "NON_COMPLIANT" }]).legal.status).toBe("PENDENTE");
      expect(withDocuments([{ id: "doc-1", status: "EXPIRED" }]).legal.status).toBe("PENDENTE");
    });
    it("documento WAIVED → não APTO (mesmo motivo: nenhum campo real prova dispensa)", () => {
      expect(withDocuments([{ id: "doc-1", status: "WAIVED" }]).legal.status).toBe("PENDENTE");
    });

    // 10: correção final ("evidência jurídica não pode ser string livre") — mapeamento comprovado
    // nesta correção: `documentLinkId` não referencia nenhuma entidade canônica em todo o schema
    // (nenhuma tabela de documento jurídico ligada a `LegalDocumentRequest`; nenhum serviço de
    // aplicação sequer escreve neste campo). Sem verificação estruturalmente possível, `RECEIVED`
    // NUNCA mais satisfaz — vira SEM_EVIDENCIA (evidência alegada, não comprovável), nunca APTO.
    // Todas as variações de `documentLinkId` abaixo (ausente, string aleatória, vazia/espaços,
    // "válida") recebem exatamente o MESMO tratamento — nenhuma branch de código as distingue,
    // o que por construção também garante que uma referência inexistente e uma cruzada de outro
    // tenant/projeto/caso são indistinguíveis (não há consulta alguma a fazer a diferença).
    it("10. RECEIVED nunca satisfaz mais — SEM_EVIDENCIA independente do conteúdo de documentLinkId (inexistente, string aleatória, vazia/espaços, ou aparentemente válida — todos tratados de forma idêntica)", () => {
      expect(withDocuments([{ id: "doc-1", status: "RECEIVED", documentLinkId: null }]).legal.status).toBe("SEM_EVIDENCIA");
      expect(withDocuments([{ id: "doc-1", status: "RECEIVED", documentLinkId: "" }]).legal.status).toBe("SEM_EVIDENCIA");
      expect(withDocuments([{ id: "doc-1", status: "RECEIVED", documentLinkId: "   " }]).legal.status).toBe("SEM_EVIDENCIA");
      expect(withDocuments([{ id: "doc-1", status: "RECEIVED", documentLinkId: "aleatorio-9x7z-nao-existe" }]).legal.status).toBe("SEM_EVIDENCIA");
      expect(withDocuments([{ id: "doc-1", status: "RECEIVED", documentLinkId: "doclink-aparentemente-valido" }]).legal.status).toBe("SEM_EVIDENCIA");
      expect(withDocuments([{ id: "doc-1", status: "RECEIVED", documentLinkId: "outro-tenant/outro-projeto/doc-x" }]).legal.status).toBe("SEM_EVIDENCIA");
    });
    it("RECEIVED nunca satisfaz mesmo indisponível/inválido — sempre SEM_EVIDENCIA, nunca PENDENTE (a solicitação foi 'atendida', mas a evidência não é comprovável)", () => {
      const result = withDocuments([{ id: "doc-1", status: "RECEIVED" }]);
      expect(result.legal.status).toBe("SEM_EVIDENCIA");
      expect(result.legal.snapshot.unverifiableDocumentRequestIds).toEqual(["doc-1"]);
      expect(result.legal.snapshot.pendingDocumentRequestIds).toEqual([]);
    });

    // Correção estrutural final ("evidência jurídica canônica") — `LegalEvidenceDocument`
    // `VERIFIED` (representado aqui por `hasVerifiedEvidence: true`, calculado pela camada de
    // aplicação via consulta real ao banco — nunca pelo domínio) é o único caminho positivo real
    // para `RECEIVED`, e passa a ser exigido também em itens de checklist HIGH/CRITICAL.
    describe("evidência canônica (LegalEvidenceDocument VERIFIED)", () => {
      it("RECEIVED com evidência canônica verificada → SATISFIED/APTO", () => {
        const result = withDocuments([{ id: "doc-1", status: "RECEIVED", hasVerifiedEvidence: true }]);
        expect(result.legal.status).toBe("APTO");
        expect(result.legal.snapshot.unverifiableDocumentRequestIds).toEqual([]);
      });
      it("RECEIVED sem evidência canônica verificada → SEM_EVIDENCIA (reconfirmação)", () => {
        expect(withDocuments([{ id: "doc-1", status: "RECEIVED", hasVerifiedEvidence: false }]).legal.status).toBe("SEM_EVIDENCIA");
      });
      it("checklist COMPLIANT criticidade LOW/MEDIUM não exige evidência canônica (semântica preexistente preservada)", () => {
        expect(withChecklist([{ id: "chk-1", status: "COMPLIANT", criticality: "LOW", hasVerifiedEvidence: false }]).legal.status).toBe("APTO");
        expect(withChecklist([{ id: "chk-1", status: "COMPLIANT", criticality: "MEDIUM", hasVerifiedEvidence: false }]).legal.status).toBe("APTO");
      });
      it("checklist COMPLIANT criticidade HIGH/CRITICAL sem evidência canônica verificada → não APTO", () => {
        expect(withChecklist([{ id: "chk-1", status: "COMPLIANT", criticality: "HIGH", hasVerifiedEvidence: false }]).legal.status).toBe("PENDENTE");
        expect(withChecklist([{ id: "chk-1", status: "COMPLIANT", criticality: "CRITICAL", hasVerifiedEvidence: false }]).legal.status).toBe("PENDENTE");
      });
      it("checklist COMPLIANT criticidade HIGH/CRITICAL com evidência canônica verificada → APTO", () => {
        expect(withChecklist([{ id: "chk-1", status: "COMPLIANT", criticality: "HIGH", hasVerifiedEvidence: true }]).legal.status).toBe("APTO");
        expect(withChecklist([{ id: "chk-1", status: "COMPLIANT", criticality: "CRITICAL", hasVerifiedEvidence: true }]).legal.status).toBe("APTO");
      });
      it("checklist WAIVED criticidade HIGH com justificativa formal mas sem evidência canônica → não APTO", () => {
        expect(withChecklist([{ id: "chk-1", status: "WAIVED", criticality: "HIGH", reviewedById: "user-1", notes: "Dispensado por decisão do comitê.", hasVerifiedEvidence: false }]).legal.status).toBe("PENDENTE");
      });
      it("checklist WAIVED criticidade HIGH com justificativa formal E evidência canônica → APTO", () => {
        expect(withChecklist([{ id: "chk-1", status: "WAIVED", criticality: "HIGH", reviewedById: "user-1", notes: "Dispensado por decisão do comitê.", hasVerifiedEvidence: true }]).legal.status).toBe("APTO");
      });
    });

    // 12: coleções vazias — decisão desta correção: nenhum campo real do schema marca uma
    // diligência como "exige N itens de checklist/documento"; inventar essa exigência violaria
    // "use exclusivamente os campos e enums reais". Tratamento simétrico ao de `obligations`
    // vazio no mesmo gate: vacuamente satisfeito, nunca bloqueia por si só.
    it("12. coleções vazias de checklist/documento são vacuamente satisfeitas (nenhum campo real declara exigência mínima)", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, legal: { ...APTO_INPUT.legal, closureDiligenceCase: { ...APTO_INPUT.legal.closureDiligenceCase, checklistItems: [], documentRequests: [] } } });
      expect(result.legal.status).toBe("APTO");
    });

    // 13: valor de enum desconhecido/incompatível falha fechado (nunca é um branch "bom").
    it("13. valor de status desconhecido em checklist ou documento falha fechado (PENDENTE, nunca APTO)", () => {
      expect(withChecklist([{ id: "chk-1", status: "SOME_FUTURE_STATUS" }]).legal.status).toBe("PENDENTE");
      expect(withDocuments([{ id: "doc-1", status: "SOME_FUTURE_STATUS", documentLinkId: "x" }]).legal.status).toBe("PENDENTE");
    });

    // Múltiplos itens — um só bloqueador entre vários bons ainda bloqueia (comportamento pré-existente, reconfirmado).
    it("múltiplos itens: um só não conforme entre vários conformes ainda bloqueia", () => {
      const result = withChecklist([{ id: "chk-1", status: "COMPLIANT" }, { id: "chk-2", status: "COMPLIANT" }, { id: "chk-3", status: "UNDER_REVIEW" }]);
      expect(result.legal.status).toBe("PENDENTE");
      expect(result.legal.snapshot.openChecklistItemIds).toEqual(["chk-3"]);
    });

    // 14-15: decisão jurídica favorável nunca atropela checklist/documento bloqueador ou inverificável.
    it("14. decisão PROCEED não supera um item de checklist bloqueador", () => {
      const result = withChecklist([{ id: "chk-1", status: "NON_COMPLIANT" }]);
      expect(result.legal.status).toBe("PENDENTE");
    });
    it("14b. decisão PROCEED não supera uma solicitação documental bloqueadora nem uma evidência documental inverificável", () => {
      expect(withDocuments([{ id: "doc-1", status: "REQUESTED" }]).legal.status).toBe("PENDENTE");
      expect(withDocuments([{ id: "doc-1", status: "RECEIVED", documentLinkId: "qualquer-coisa" }]).legal.status).toBe("SEM_EVIDENCIA");
    });
    it("15. PROCEED_WITH_CONDITIONS (mesmo com todas as condições resolved:true) não supera um documento pendente", () => {
      const result = evaluateProjectClosureGate({
        ...APTO_INPUT,
        legal: {
          ...APTO_INPUT.legal,
          closureDiligenceCase: {
            ...APTO_INPUT.legal.closureDiligenceCase,
            documentRequests: [{ id: "doc-1", status: "REQUESTED", documentLinkId: null, hasVerifiedEvidence: false }],
            latestDecision: { decision: "PROCEED_WITH_CONDITIONS", conditions: [{ code: "CP-1", resolved: true }] },
          },
        },
      });
      expect(result.legal.status).toBe("PENDENTE");
    });
  });

  it("parcela vencida bloqueia o gate financeiro", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, financial: { overdueInstallmentCount: 1, pendingDisbursementCount: 0 } });
    expect(result.financial.status).toBe("PENDENTE");
  });

  it("repasse/funding não conciliado bloqueia o gate financeiro", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, financial: { overdueInstallmentCount: 0, pendingDisbursementCount: 1 } });
    expect(result.financial.status).toBe("PENDENTE");
  });

  it("nenhum período contábil/financeiro encontrado → SEM_EVIDENCIA", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, accounting: { periods: [] } });
    expect(result.accounting.status).toBe("SEM_EVIDENCIA");
  });

  it("período contábil não fechado bloqueia o gate contábil", () => {
    const result = evaluateProjectClosureGate({ ...APTO_INPUT, accounting: { periods: [{ id: "p1", status: "OPEN" }] } });
    expect(result.accounting.status).toBe("PENDENTE");
  });

  describe("LedgerSnapshot no gate contábil — achado Médio corrigido", () => {
    it("período CLOSED sem LedgerSnapshot (ledgerEvidence MISSING) → SEM_EVIDENCIA, nunca APTO", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, accounting: { periods: [{ id: "p1", status: "CLOSED", ledgerEvidence: "MISSING" }] } });
      expect(result.accounting.status).toBe("SEM_EVIDENCIA");
    });

    it("período CLOSED com LedgerSnapshot válido → pode ficar APTO", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, accounting: { periods: [{ id: "p1", status: "CLOSED", ledgerEvidence: "VALID" }] } });
      expect(result.accounting.status).toBe("APTO");
    });

    it("LedgerSnapshot inconsistente com o registro de fechamento (checksum não bate) → PENDENTE, estado contraditório falha fechado", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, accounting: { periods: [{ id: "p1", status: "CLOSED", ledgerEvidence: "INCONSISTENT" }] } });
      expect(result.accounting.status).toBe("PENDENTE");
    });

    it("período aberto tem prioridade sobre ausência/inconsistência de evidência — continua PENDENTE", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, accounting: { periods: [{ id: "p1", status: "OPEN", ledgerEvidence: "MISSING" }] } });
      expect(result.accounting.status).toBe("PENDENTE");
    });

    it("múltiplos períodos: um só com evidência ausente entre vários válidos ainda bloqueia (SEM_EVIDENCIA)", () => {
      const result = evaluateProjectClosureGate({
        ...APTO_INPUT,
        accounting: { periods: [{ id: "p1", status: "CLOSED", ledgerEvidence: "VALID" }, { id: "p2", status: "CLOSED", ledgerEvidence: "MISSING" }] },
      });
      expect(result.accounting.status).toBe("SEM_EVIDENCIA");
      expect(result.accounting.snapshot.missingLedgerEvidencePeriodIds).toEqual(["p2"]);
    });

    it("FinancialPeriodClosure (sem ledgerEvidence estrutural — não é AccountingPeriod) CLOSED sozinho continua suficiente — não se inventa exigência de LedgerSnapshot que o schema não sustenta para essa fonte", () => {
      const result = evaluateProjectClosureGate({ ...APTO_INPUT, accounting: { periods: [{ id: "fpc-1", status: "CLOSED" }] } });
      expect(result.accounting.status).toBe("APTO");
    });
  });
});
