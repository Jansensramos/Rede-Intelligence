import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RedeOperator } from "./operator";
import { buildLearningReport } from "./learning-loop";

describe("cognitive product final integration", () => {
  it("keeps material Operator mutations behind explicit human approval", async () => {
    let executions = 0;
    const operator = new RedeOperator(
      {
        execute: async (action) => {
          executions += 1;
          return { actionId: action.id, status: "COMPLETED" as const };
        },
      },
      {
        allowedCapabilities: ["PROJECT_MUTATION"],
        allowReadOnlyWithoutApproval: true,
      },
    );

    const refused = await operator.execute({
      id: "mutation-without-human",
      capability: "PROJECT_MUTATION",
      mode: "MUTATION",
      payload: {},
      reason: "test",
    });

    expect(refused.status).toBe("REFUSED");
    expect(refused.reason).toBe("HUMAN_APPROVAL_REQUIRED");
    expect(executions).toBe(0);

    const approved = await operator.execute({
      id: "mutation-with-human",
      capability: "PROJECT_MUTATION",
      mode: "MUTATION",
      payload: {},
      reason: "test",
      humanApprovalId: "approval:human:1",
    });

    expect(approved.status).toBe("COMPLETED");
    expect(executions).toBe(1);
  });

  it("keeps Learning Loop descriptive and unable to mutate policy", () => {
    const report = buildLearningReport([
      {
        id: "obs-1",
        decisionId: "decision-1",
        predicted: { metric: "Margem", value: 20 },
        actual: { value: 15 },
        recordedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "obs-2",
        decisionId: "decision-2",
        predicted: { metric: "Margem", value: 18 },
        actual: { value: 16 },
        recordedAt: "2026-02-01T00:00:00.000Z",
      },
    ]);

    expect(report.policyMutationAllowed).toBe(false);
    expect(report.metrics).toEqual([
      {
        metric: "Margem",
        sampleSize: 2,
        meanAbsoluteError: 3.5,
        meanBias: -3.5,
      },
    ]);
    expect(report.recommendations).toHaveLength(1);
  });

  it("surfaces cognitive governance in both executive routes", () => {
    const current = readFileSync("src/app/(workspace)/executivo/page.tsx", "utf8");
    const drilldown = readFileSync("src/app/(workspace)/executivo/[projectId]/page.tsx", "utf8");

    expect(current).toContain("ExecutiveCognitiveTimeline");
    expect(current).toContain("projectId={context.project.id}");
    expect(drilldown).toContain("ExecutiveCognitiveTimeline");
    expect(drilldown).toContain("projectId={context.project.id}");
  });

  it("grounds readiness and learning in persisted project data instead of fabricated status", () => {
    const source = readFileSync("src/app/actions/cognitive.ts", "utf8");

    expect(source).toContain("prisma.forecastEvaluation.findMany");
    expect(source).toContain("prisma.forecastEvaluation.count");
    expect(source).toContain("prisma.connectorInstallation.count");
    expect(source).toContain("aiGatewayProviderStatus()");
    expect(source).toContain('actualValue: { not: null }');
    expect(source).toContain('status: provider === "AVAILABLE" ? "READY" : "EXTERNAL_DEPENDENCY"');
  });

  it("keeps executive cognitive surfaces read-only with respect to business-domain mutation", () => {
    const source = readFileSync("src/components/executive-cognitive-timeline.tsx", "utf8");

    expect(source).toContain("getCognitiveReviewAction");
    expect(source).toContain("listCognitiveReviewHistoryAction");
    expect(source).toContain("getCognitiveLearningReportAction");
    expect(source).toContain("getCognitiveProductionReadinessAction");
    expect(source).not.toContain("recordCognitiveDecisionAction");
    expect(source).not.toContain("runCognitiveReviewAction");
  });
  it("closes People and Accounting human-operability gaps through guarded surfaces", () => {
    const peopleActions = readFileSync("src/app/actions/people-extended.ts", "utf8");
    const peoplePage = readFileSync("src/app/(workspace)/pessoas/page.tsx", "utf8");
    const accountingActions = readFileSync("src/app/actions/accounting-extended.ts", "utf8");
    const accountingPage = readFileSync("src/app/(workspace)/contabilidade-controladoria/page.tsx", "utf8");

    expect(peopleActions).toContain("createEmploymentRelationshipAction");
    expect(peopleActions).toContain("createWorkAllocationAction");
    expect(peopleActions).toContain("recordRelationshipCostAction");
    expect(peoplePage).toContain("PeopleStructureOperationsPanel");

    expect(accountingActions).toContain("createAccountingReconciliationAction");
    expect(accountingActions).toContain("reverseAccountingEntryAction");
    expect(accountingActions).toContain("reopenAccountingPeriodAction");
    expect(accountingPage).toContain("AccountingExtendedOperationsPanel");
  });

});
