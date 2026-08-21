export const LEGAL_ENGINE_VERSION = "LEGAL_DEADLINE_V1.0.0";

export type DeadlineMilestone = { code: string; daysBefore: number; criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" };

export const DEFAULT_LEGAL_MILESTONES: DeadlineMilestone[] = [
  { code: "D-90", daysBefore: 90, criticality: "MEDIUM" },
  { code: "D-60", daysBefore: 60, criticality: "MEDIUM" },
  { code: "D-30", daysBefore: 30, criticality: "HIGH" },
  { code: "D-15", daysBefore: 15, criticality: "HIGH" },
  { code: "D-7", daysBefore: 7, criticality: "CRITICAL" },
  { code: "VENCIDO", daysBefore: -1, criticality: "CRITICAL" },
];

const DAY = 86_400_000;
const utcDate = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

export function daysUntil(dueAt: Date, today: Date) {
  return Math.ceil((utcDate(dueAt) - utcDate(today)) / DAY);
}

export function obligationStatus(dueAt: Date, current: string, today = new Date()) {
  if (["FULFILLED", "WAIVED", "CANCELLED"].includes(current)) return current;
  const days = daysUntil(dueAt, today);
  return days < 0 ? "OVERDUE" : days <= 30 ? "DUE_SOON" : "ACTIVE";
}

export function milestonesReached(dueAt: Date, today: Date, milestones = DEFAULT_LEGAL_MILESTONES) {
  const remaining = daysUntil(dueAt, today);
  return milestones.filter((item) => item.code === "VENCIDO" ? remaining < 0 : remaining <= item.daysBefore && remaining >= 0);
}

export function legalReadiness(input: { checklist: Array<{ status: string; criticality: string }>; findings: Array<{ status: string; severity: string }>; obligations: Array<{ status: string }> }) {
  const checklistDone = input.checklist.filter((item) => ["COMPLIANT", "WAIVED", "RESOLVED"].includes(item.status)).length;
  const completion = input.checklist.length ? checklistDone / input.checklist.length : 0;
  const criticalBlockers = input.findings.filter((item) => item.severity === "CRITICAL" && !["RESOLVED", "WAIVED"].includes(item.status)).length
    + input.checklist.filter((item) => item.criticality === "CRITICAL" && item.status === "NON_COMPLIANT").length;
  const overdue = input.obligations.filter((item) => item.status === "OVERDUE").length;
  const score = Math.max(0, Math.round(completion * 100 - criticalBlockers * 20 - overdue * 10));
  return { score, completion, criticalBlockers, overdue, ready: score >= 80 && criticalBlockers === 0 && overdue === 0 };
}
