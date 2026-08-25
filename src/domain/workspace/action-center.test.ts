import { describe, expect, it } from "vitest";
import {
  buildActionCenterBuckets,
  buildMyRoutineBuckets,
  filterAwaitingMyApproval,
  filterDueToday,
  filterMine,
  filterOverdue,
  filterUpcoming,
  sortExceptionsByActionPriority,
  sortRecentlyResolved,
  UPCOMING_HORIZON_DAYS,
} from "./action-center";
import type { ExecutiveException } from "./exceptions";

const referenceDate = new Date("2026-08-25T12:00:00.000Z");
const days = (n: number) => new Date(referenceDate.getTime() + n * 86_400_000).toISOString();

function exception(overrides: Partial<ExecutiveException>): ExecutiveException {
  return {
    id: overrides.id ?? "id",
    organizationId: "org-1",
    domain: "financial",
    type: "payable_due",
    title: "t",
    summary: "s",
    severity: "ATENCAO",
    confidence: "ALTA",
    source: "REDE",
    occurredAt: "2026-08-20T00:00:00.000Z",
    href: "/financeiro",
    reason: "r",
    status: "ABERTA",
    evidence: [],
    ...overrides,
  };
}

describe("filterMine (9K.3, plano §M — nunca atribui sem responsável real)", () => {
  it("só inclui itens cujo responsibleId é o usuário atual", () => {
    const items = [exception({ id: "1", responsibleId: "user-1" }), exception({ id: "2", responsibleId: "user-2" })];
    expect(filterMine(items, "user-1").map((item) => item.id)).toEqual(["1"]);
  });

  it("item sem responsável nunca entra em 'Minhas', mesmo que o userId seja vazio/undefined", () => {
    const items = [exception({ id: "1", responsibleId: undefined }), exception({ id: "2", responsibleId: null })];
    expect(filterMine(items, "")).toHaveLength(0);
    expect(filterMine(items, "user-1")).toHaveLength(0);
  });
});

describe("filterDueToday / filterOverdue / filterUpcoming (9K.3 — nunca fabrica prazo)", () => {
  const today = exception({ id: "today", dueDate: days(0) });
  const overdue = exception({ id: "overdue", dueDate: days(-3) });
  const upcoming = exception({ id: "upcoming", dueDate: days(5) });
  const farAway = exception({ id: "far", dueDate: days(UPCOMING_HORIZON_DAYS + 10) });
  const noDeadline = exception({ id: "none", dueDate: null });
  const resolved = exception({ id: "resolved", status: "RESOLVIDA", dueDate: days(0) });
  const all = [today, overdue, upcoming, farAway, noDeadline, resolved];

  it("Hoje: só o item ABERTO com dueDate no mesmo dia calendário", () => {
    expect(filterDueToday(all, referenceDate).map((item) => item.id)).toEqual(["today"]);
  });

  it("Atrasadas: só o item ABERTO com dueDate em dia anterior", () => {
    expect(filterOverdue(all, referenceDate).map((item) => item.id)).toEqual(["overdue"]);
  });

  it("Próximas: item dentro do horizonte, nunca o que está além dele nem o vencido/hoje", () => {
    const result = filterUpcoming(all, referenceDate).map((item) => item.id);
    expect(result).toEqual(["upcoming"]);
    expect(result).not.toContain("far");
  });

  it("item sem prazo nunca aparece em Hoje/Atrasadas/Próximas", () => {
    expect(filterDueToday(all, referenceDate).map((i) => i.id)).not.toContain("none");
    expect(filterOverdue(all, referenceDate).map((i) => i.id)).not.toContain("none");
    expect(filterUpcoming(all, referenceDate).map((i) => i.id)).not.toContain("none");
  });

  it("item RESOLVIDA nunca aparece nos buckets de prazo (só existe 'aberto' ali)", () => {
    expect(filterDueToday(all, referenceDate).map((i) => i.id)).not.toContain("resolved");
  });
});

describe("filterAwaitingMyApproval (9K.3 — alçada por papel, plano §AN)", () => {
  const forAdmin = exception({ id: "admin-req", approvalCapability: { requiredRole: "ADMIN" } });
  const forOwner = exception({ id: "owner-req", approvalCapability: { requiredRole: "OWNER" } });
  const noApproval = exception({ id: "plain" });

  it("ANALYST não vê nenhuma aprovação que exige ADMIN/OWNER", () => {
    expect(filterAwaitingMyApproval([forAdmin, forOwner, noApproval], "ANALYST")).toHaveLength(0);
  });

  it("ADMIN vê o que exige ADMIN, mas não o que exige OWNER", () => {
    expect(filterAwaitingMyApproval([forAdmin, forOwner], "ADMIN").map((item) => item.id)).toEqual(["admin-req"]);
  });

  it("OWNER vê ambos (alçada superior cobre a inferior)", () => {
    expect(filterAwaitingMyApproval([forAdmin, forOwner], "OWNER").map((item) => item.id).sort()).toEqual(["admin-req", "owner-req"]);
  });
});

describe("sortExceptionsByActionPriority (9K.3 — severidade → prazo → materialidade → occurredAt)", () => {
  it("severidade decide primeiro", () => {
    const items = [exception({ id: "low", severity: "ATENCAO" }), exception({ id: "high", severity: "CRITICO" })];
    expect(sortExceptionsByActionPriority(items).map((i) => i.id)).toEqual(["high", "low"]);
  });

  it("dentro da mesma severidade, prazo mais próximo vence materialidade maior", () => {
    const items = [
      exception({ id: "far-rich", severity: "CRITICO", dueDate: days(10), materialityValue: 999999 }),
      exception({ id: "near-poor", severity: "CRITICO", dueDate: days(1), materialityValue: 1 }),
    ];
    expect(sortExceptionsByActionPriority(items).map((i) => i.id)).toEqual(["near-poor", "far-rich"]);
  });

  it("sem prazo em ambos, desempata por materialidade e depois por occurredAt (mais antigo primeiro)", () => {
    const items = [
      exception({ id: "newer", severity: "CRITICO", dueDate: null, materialityValue: null, occurredAt: "2026-08-24T00:00:00.000Z" }),
      exception({ id: "older", severity: "CRITICO", dueDate: null, materialityValue: null, occurredAt: "2026-08-10T00:00:00.000Z" }),
    ];
    expect(sortExceptionsByActionPriority(items).map((i) => i.id)).toEqual(["older", "newer"]);
  });
});

describe("sortRecentlyResolved", () => {
  it("ordena por resolvedAt decrescente e ignora itens sem resolvedAt", () => {
    const items = [
      exception({ id: "old", status: "RESOLVIDA", resolvedAt: "2026-08-01T00:00:00.000Z" }),
      exception({ id: "new", status: "RESOLVIDA", resolvedAt: "2026-08-20T00:00:00.000Z" }),
      exception({ id: "broken", status: "RESOLVIDA", resolvedAt: null }),
    ];
    expect(sortRecentlyResolved(items).map((i) => i.id)).toEqual(["new", "old"]);
  });
});

describe("buildActionCenterBuckets / buildMyRoutineBuckets (composição, sem I/O)", () => {
  const mineOverdue = exception({ id: "mine-overdue", responsibleId: "user-1", dueDate: days(-1) });
  const otherOverdue = exception({ id: "other-overdue", responsibleId: "user-2", dueDate: days(-1) });
  const approvalForAdmin = exception({ id: "approval", domain: "approvals", severity: "DECISAO", approvalCapability: { requiredRole: "ADMIN" } });
  const resolvedMine = exception({ id: "resolved-mine", responsibleId: "user-1", status: "RESOLVIDA", resolvedAt: days(-1) });
  const resolvedOther = exception({ id: "resolved-other", responsibleId: "user-2", status: "RESOLVIDA", resolvedAt: days(-1) });
  const open = [mineOverdue, otherOverdue, approvalForAdmin];
  const resolved = [resolvedMine, resolvedOther];

  it("Central de Ações: 'Todas' inclui todo mundo, 'Minhas' só o usuário atual", () => {
    const buckets = buildActionCenterBuckets(open, resolved, { referenceDate, userId: "user-1" });
    expect(buckets.all.map((i) => i.id).sort()).toEqual(["approval", "mine-overdue", "other-overdue"]);
    expect(buckets.mine.map((i) => i.id)).toEqual(["mine-overdue"]);
    expect(buckets.overdue.map((i) => i.id).sort()).toEqual(["mine-overdue", "other-overdue"]);
    expect(buckets.awaitingApproval.map((i) => i.id)).toEqual(["approval"]);
    expect(buckets.recentlyResolved.map((i) => i.id).sort()).toEqual(["resolved-mine", "resolved-other"]);
  });

  it("Minha Rotina: nunca mostra o item atrasado de outra pessoa nem a aprovação fora da alçada do papel", () => {
    const buckets = buildMyRoutineBuckets(open, resolved, { referenceDate, userId: "user-1", userRole: "ANALYST" });
    expect(buckets.overdue.map((i) => i.id)).toEqual(["mine-overdue"]);
    expect(buckets.awaitingMyApproval).toHaveLength(0);
    expect(buckets.recentlyResolved.map((i) => i.id)).toEqual(["resolved-mine"]);
  });

  it("Minha Rotina: ADMIN vê 'aguardando minha aprovação' mesmo sem responsibleId nenhum", () => {
    const buckets = buildMyRoutineBuckets(open, resolved, { referenceDate, userId: "user-1", userRole: "ADMIN" });
    expect(buckets.awaitingMyApproval.map((i) => i.id)).toEqual(["approval"]);
  });
});
