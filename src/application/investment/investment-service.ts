import { createHash } from "node:crypto";
import {
  ArtifactGenerationStatus,
  InvestmentCaseStatus,
  Prisma,
  ReviewRoundStatus,
  type PrismaClient,
} from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import type { FinancialResult, ProjectAssumptions, ScenarioKey } from "@/domain/financial/types";
import { calculateProject } from "@/domain/financial/engine";
import { createStudyVersion } from "@/application/studies/study-service";
import { indexTextDocument } from "@/application/ai/retrieval";
import type { LandStudySnapshot } from "@/domain/land";
import type { RedeScoreResult } from "@/domain/score";
import type { RedTeamReport } from "@/domain/red-team";
import type { SensitivityResult } from "@/domain/sensitivity";
import {
  DEFAULT_DATA_ROOM_CHECKLIST,
  INVESTMENT_BUNDLE_VERSION,
  buildApprovalPath,
  calculateDataRoomCompleteness,
  calculateInvestmentReadiness,
  type AssumptionRegisterItemView,
  type ClaimView,
  type DataRoomCategory,
  type DataRoomChecklistItemView,
  type DecisionLedgerEntryView,
  type InvestmentCaseWorkspace,
  type InvestmentConditionView,
  type InvestmentSnapshotBundle,
  type OrganizationBrandConfig,
  type ProjectDocumentView,
  type ProjectIssueView,
  type StudioArtifactView,
  type UrbanTransformationView,
} from "@/domain/investment";
import { prisma } from "@/infrastructure/database/prisma";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

const DEFAULT_BRAND: OrganizationBrandConfig = {
  organizationName: "REDE — Núcleo de Negócios",
  monogram: "RE",
  primaryColor: "#173D4F",
  secondaryColor: "#789194",
  accentColor: "#B98A43",
  fontHeading: "Helvetica Neue",
  fontBody: "Helvetica Neue",
  footer: "REDE Intelligence · material confidencial",
  disclaimer: "Análise preliminar sujeita às validações indicadas.",
  contactInfo: "admin@rede.local",
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function checksum(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function scenarioKey(kind: string): ScenarioKey | null {
  if (kind === "CONSERVATIVE") return "conservative";
  if (kind === "BASE") return "base";
  if (kind === "AGGRESSIVE") return "aggressive";
  return null;
}

function scoreFromRow(row: {
  globalScore: Prisma.Decimal;
  rawScore: Prisma.Decimal;
  scoreAfterPenalties: Prisma.Decimal;
  policyVersion: string;
  classification: string;
  gates: Prisma.JsonValue;
  penalties: Prisma.JsonValue;
  explanation: Prisma.JsonValue;
  dimensions: { key: string; score: Prisma.Decimal; weight: Prisma.Decimal; weightedScore: Prisma.Decimal }[];
  rules: { dimensionKey: string; ruleKey: string; label: string; score: Prisma.Decimal; tone: string; actualValue: string; benchmark: string; message: string }[];
}): RedeScoreResult {
  return {
    policyVersion: row.policyVersion,
    totalScore: Number(row.globalScore),
    rawScore: Number(row.rawScore),
    scoreAfterPenalties: Number(row.scoreAfterPenalties),
    classification: row.classification as RedeScoreResult["classification"],
    dimensions: row.dimensions.map((dimension) => ({
      key: dimension.key as RedeScoreResult["dimensions"][number]["key"],
      score: Number(dimension.score),
      weight: Number(dimension.weight),
      weightedScore: Number(dimension.weightedScore),
      reasons: row.rules.filter((rule) => rule.dimensionKey === dimension.key).map((rule) => ({
        ruleKey: rule.ruleKey,
        label: rule.label,
        score: Number(rule.score),
        tone: rule.tone as RedeScoreResult["dimensions"][number]["reasons"][number]["tone"],
        message: rule.message,
        actualValue: rule.actualValue,
        benchmark: rule.benchmark,
      })),
    })),
    gates: row.gates as unknown as RedeScoreResult["gates"],
    penalties: row.penalties as unknown as RedeScoreResult["penalties"],
    explanation: row.explanation as unknown as RedeScoreResult["explanation"],
  };
}

async function loadFrozenBundleSource(
  tx: Tx,
  organizationId: string,
  studyVersionId: string,
  landStudyVersionId: string | null,
): Promise<Omit<InvestmentSnapshotBundle, "documents">> {
  const version = await tx.studyVersion.findFirst({
    where: { id: studyVersionId, status: "SNAPSHOT", study: { project: { organizationId } } },
    include: {
      study: { include: { project: true } },
      assumptions: true,
      runs: { include: { scenario: true, result: true } },
      scores: { include: { scenario: true, dimensions: true, rules: true } },
      sensitivity: { where: { status: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 1 },
      redTeamRuns: { where: { status: "COMPLETED", organizationId }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!version?.assumptions || !version.lockedAt) throw new Error("Snapshot financeiro não encontrado nesta organização.");
  const engineResults = {} as Record<ScenarioKey, FinancialResult>;
  version.runs.forEach((run) => {
    const key = scenarioKey(run.scenario.kind);
    if (key && run.result) engineResults[key] = run.result.payload as unknown as FinancialResult;
  });
  const scores = {} as Record<ScenarioKey, RedeScoreResult>;
  version.scores.forEach((score) => {
    const key = scenarioKey(score.scenario.kind);
    if (key) scores[key] = scoreFromRow(score);
  });
  if (!engineResults.base || !engineResults.conservative || !engineResults.aggressive) throw new Error("Snapshot não possui os três resultados persistidos do Engine.");
  if (!scores.base || !scores.conservative || !scores.aggressive) throw new Error("Snapshot não possui os três resultados persistidos do REDE Score.");
  const sensitivity = version.sensitivity[0]?.results as unknown as SensitivityResult | undefined;
  if (!sensitivity) throw new Error("Snapshot não possui análise de sensibilidade persistida.");
  const redTeamRow = version.redTeamRuns[0];
  const redTeam = redTeamRow?.output as unknown as RedTeamReport | undefined;
  let land: LandStudySnapshot | null = null;
  if (landStudyVersionId) {
    const landVersion = await tx.landStudyVersion.findFirst({ where: { id: landStudyVersionId, versionStatus: "SNAPSHOT", landStudy: { organizationId, landAsset: { organizationId } } }, select: { snapshot: true } });
    if (!landVersion) throw new Error("Snapshot urbanístico não encontrado nesta organização.");
    land = landVersion.snapshot as unknown as LandStudySnapshot;
  }
  const assumptions = engineResults.base.assumptions as ProjectAssumptions;
  const missingEvidence = redTeam?.evidenceRequests.filter((item) => item.status === "OPEN").map((item) => item.requestedDocument) ?? [];
  return {
    bundleVersion: INVESTMENT_BUNDLE_VERSION,
    frozenAt: new Date().toISOString(),
    organizationId,
    projectId: version.study.projectId,
    studyId: version.studyId,
    studyVersionId: version.id,
    studyVersionNumber: version.versionNumber,
    landStudyVersionId: landStudyVersionId,
    landVersionNumber: land?.versionNumber ?? null,
    redTeamRunId: redTeamRow?.id ?? null,
    scenario: "base",
    project: { name: version.study.project.name, city: version.study.project.city, state: version.study.project.state },
    assumptions,
    engineResults,
    cashFlow: engineResults.base.cashFlow,
    scores,
    sensitivity,
    redTeam: redTeam ?? null,
    land,
    missingEvidence,
    transformationEconomics: null,
  };
}

/**
 * Fase 9K.0 (fechamento, gate 3 "Unificar REDE AI ao mesmo contexto"): `projectId` agora é
 * obrigatório. Antes, esta função buscava "o Investment Case mais recentemente atualizado da
 * organização" e, se não existisse nenhum, criava um a partir de "a versão de estudo SNAPSHOT mais
 * recente da organização" — ambos escolhidos por atividade, exatamente o mesmo padrão que causou o
 * problema do gate 2 (um teste de integração podia tornar-se "o mais recente" e desviar qual
 * projeto ganhava o Investment Case). Agora tudo é escopado pelo `projectId` já resolvido por
 * `resolveOperationalContext` — nunca por recência entre projetos diferentes.
 */
export async function ensureInvestmentCase(context: Pick<AuthContext, "userId" | "organizationId">, projectId: string): Promise<InvestmentCaseWorkspace> {
  const existing = await getInvestmentCaseForProject(context.organizationId, projectId);
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const latestVersion = await tx.studyVersion.findFirst({ where: { status: "SNAPSHOT", study: { projectId, project: { organizationId: context.organizationId } } }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!latestVersion) throw new Error("Crie um snapshot financeiro antes de abrir um Investment Case.");
    const landVersion = await tx.landStudyVersion.findFirst({ where: { versionStatus: "SNAPSHOT", landStudy: { organizationId: context.organizationId, landAsset: { organizationId: context.organizationId, projectId } } }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return createInvestmentCaseInTransaction(tx, context, latestVersion.id, landVersion?.id ?? null);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function createInvestmentCase(
  context: Pick<AuthContext, "userId" | "organizationId">,
  studyVersionId: string,
  landStudyVersionId: string | null,
): Promise<InvestmentCaseWorkspace> {
  return prisma.$transaction((tx) => createInvestmentCaseInTransaction(tx, context, studyVersionId, landStudyVersionId), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function createInvestmentCaseInTransaction(
  tx: Tx,
  context: Pick<AuthContext, "userId" | "organizationId">,
  studyVersionId: string,
  landStudyVersionId: string | null,
): Promise<InvestmentCaseWorkspace> {
  const source = await loadFrozenBundleSource(tx, context.organizationId, studyVersionId, landStudyVersionId);
  const existing = await tx.investmentCase.findFirst({ where: { organizationId: context.organizationId, studyVersionId, landStudyVersionId } });
  if (existing) return loadWorkspace(tx, context.organizationId, existing.id);
  const caseRow = await tx.investmentCase.create({ data: {
    organizationId: context.organizationId,
    projectId: source.projectId,
    studyId: source.studyId,
    studyVersionId,
    landStudyVersionId,
    redTeamRunId: source.redTeamRunId,
    title: `${source.project.name} · Investment Case`,
    description: "Caso integrado de investimento, transformação urbana e governança.",
    createdById: context.userId,
    updatedById: context.userId,
  } });
  const bundle: InvestmentSnapshotBundle = { ...source, documents: [] };
  const bundleChecksum = checksum(bundle);
  const bundleRow = await tx.investmentSnapshotBundle.create({ data: {
    investmentCaseId: caseRow.id,
    version: 1,
    schemaVersion: bundle.bundleVersion,
    studyVersionId,
    landStudyVersionId,
    redTeamRunId: bundle.redTeamRunId,
    scenario: bundle.scenario,
    content: json(bundle),
    checksum: bundleChecksum,
    frozenAt: new Date(bundle.frozenAt),
    frozenById: context.userId,
  } });
  await tx.investmentReviewRound.create({ data: { investmentCaseId: caseRow.id, snapshotBundleId: bundleRow.id, roundNumber: 1, status: ReviewRoundStatus.DRAFT, agenda: "Primeira revisão do Investment Case.", createdById: context.userId } });
  await tx.committeeMember.create({ data: { investmentCaseId: caseRow.id, userId: context.userId, role: "CHAIR", createdById: context.userId } });
  await tx.documentChecklistItem.createMany({ data: [
    ...DEFAULT_DATA_ROOM_CHECKLIST.map((item) => ({ investmentCaseId: caseRow.id, code: item.code, category: item.category, title: item.title, required: true, critical: item.critical, source: "DEFAULT", status: "REQUESTED" as const, createdById: context.userId, updatedById: context.userId })),
    ...(bundle.redTeam?.evidenceRequests.filter((item) => item.status === "OPEN").map((item) => ({ investmentCaseId: caseRow.id, code: `RED_TEAM_${item.id}`, category: mapDataRoomCategory(item.category), title: item.requestedDocument, required: true, critical: item.priority === "CRITICAL", source: "RED_TEAM", status: "REQUESTED" as const, evidenceRequestId: item.id, createdById: context.userId, updatedById: context.userId })) ?? []),
  ], skipDuplicates: true });
  const selectedOption = bundle.land?.options.find((item) => item.id === bundle.land?.selectedOptionId);
  await tx.urbanTransformationProfile.create({ data: {
    investmentCaseId: caseRow.id,
    version: 1,
    inhabitantsPerUnit: 2.5,
    estimatedPopulation: Math.round((selectedOption?.areaSchedule.units ?? bundle.assumptions.units) * 2.5),
    readiness: bundle.land?.regulatoryConfidence.score ?? 0,
    readinessLabel: bundle.land?.regulatoryConfidence.label ?? "DADOS URBANÍSTICOS NÃO VINCULADOS",
    asIs: json(bundle.land?.scenarios.find((item) => item.type === "CURRENT_LEGAL") ?? {}),
    toBe: json(bundle.land?.scenarios.find((item) => item.id === bundle.land?.selectedScenarioId) ?? {}),
    benefits: json([]), valueBridge: json({}), downcase: json({}), optionEconomics: json({}), createdById: context.userId,
  } });
  await seedGovernance(tx, context, caseRow.id, bundle);
  await ensureBrand(tx, context);
  await tx.investmentAuditLog.create({ data: { investmentCaseId: caseRow.id, userId: context.userId, action: "INVESTMENT_CASE_CREATED", entityType: "InvestmentCase", entityId: caseRow.id, after: json({ bundleId: bundleRow.id, bundleChecksum, studyVersionId, landStudyVersionId }) } });
  return loadWorkspace(tx, context.organizationId, caseRow.id);
}

async function seedGovernance(tx: Tx, context: Pick<AuthContext, "userId" | "organizationId">, investmentCaseId: string, bundle: InvestmentSnapshotBundle) {
  const entries = Object.entries(bundle.assumptions).filter(([, value]) => typeof value !== "object");
  await tx.assumptionRegisterItem.createMany({ data: entries.map(([key, value]) => ({ investmentCaseId, key, category: assumptionCategory(key), value: String(value ?? ""), unit: assumptionUnit(key), confidence: "MANUAL", status: "ACTIVE", evidenceRef: `assumption:${bundle.studyVersionId}:${key}`, sourceVersion: `StudyVersion v${bundle.studyVersionNumber}`, effectiveAt: new Date(bundle.frozenAt), createdById: context.userId })) });
  await tx.investmentClaim.create({ data: { investmentCaseId, statement: `O VGV do cenário base é ${bundle.engineResults.base.metrics.vgv}.`, status: "SUPPORTED", evidenceRefs: json([`engine:${bundle.studyVersionId}:base:vgv`]), ownerId: context.userId, createdById: context.userId } });
  const issues = bundle.redTeam?.findings.filter((item) => item.status !== "RESOLVED" && ["HIGH", "CRITICAL"].includes(item.severity)).slice(0, 8) ?? [];
  if (issues.length) await tx.investmentIssue.createMany({ data: issues.map((item) => ({ investmentCaseId, title: item.title, status: "ACTIVE", priority: item.severity as "HIGH" | "CRITICAL", ownerId: context.userId, nextAction: item.recommendedAction, source: `redteam:${bundle.redTeamRunId}:${item.id}`, createdById: context.userId, updatedById: context.userId })) });
  const urbanRisks = issues.filter((item) => /urban|legal|ambient/i.test(`${item.category} ${item.title}`));
  if (urbanRisks.length) await tx.urbanRiskItem.createMany({ data: urbanRisks.map((item) => ({ investmentCaseId, title: item.title, severity: item.severity as "HIGH" | "CRITICAL", status: "ACTIVE", source: "RED_TEAM", ownerId: context.userId, mitigation: item.recommendedAction, evidenceRef: item.evidenceRefs[0] ?? `redteam:${bundle.redTeamRunId}:${item.id}`, createdById: context.userId })) });
}

async function ensureBrand(tx: Tx, context: Pick<AuthContext, "userId" | "organizationId">) {
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: context.organizationId } });
  const config = { ...DEFAULT_BRAND, organizationName: organization.name };
  await tx.organizationBrandConfig.upsert({ where: { organizationId_name: { organizationId: context.organizationId, name: "REDE Institucional" } }, update: { config: json(config), isDefault: true, updatedById: context.userId }, create: { organizationId: context.organizationId, name: "REDE Institucional", config: json(config), isDefault: true, createdById: context.userId, updatedById: context.userId } });
}

export async function getLatestInvestmentCaseForOrganization(organizationId: string): Promise<InvestmentCaseWorkspace | null> {
  const row = await prisma.investmentCase.findFirst({ where: { organizationId }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  return row ? loadWorkspace(prisma, organizationId, row.id) : null;
}

/**
 * Fase 9K.0 (fechamento, gate 3): variante escopada por projeto de `getLatestInvestmentCaseForOrganization`.
 * Ordenar por `updatedAt` aqui é legítimo — já não decide *qual projeto*, só qual Investment Case
 * (dentro de um projeto já resolvido) está em vigor. Usada por `ensureInvestmentCase` e pelo REDE AI
 * (`ai-service.ts`) para nunca resolver um projeto diferente do que a tela/OperationalContext já
 * determinou.
 */
export async function getInvestmentCaseForProject(organizationId: string, projectId: string): Promise<InvestmentCaseWorkspace | null> {
  const row = await prisma.investmentCase.findFirst({ where: { organizationId, projectId }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  return row ? loadWorkspace(prisma, organizationId, row.id) : null;
}

export async function getInvestmentCaseForOrganization(organizationId: string, investmentCaseId: string): Promise<InvestmentCaseWorkspace | null> {
  const row = await prisma.investmentCase.findFirst({ where: { id: investmentCaseId, organizationId }, select: { id: true } });
  return row ? loadWorkspace(prisma, organizationId, row.id) : null;
}

export async function reassessInvestmentCase(
  context: Pick<AuthContext, "userId" | "organizationId">,
  investmentCaseId: string,
  studyVersionId: string,
  landStudyVersionId: string | null,
): Promise<InvestmentCaseWorkspace> {
  return prisma.$transaction(async (tx) => {
    const caseRow = await tx.investmentCase.findFirst({ where: { id: investmentCaseId, organizationId: context.organizationId }, include: { bundles: { orderBy: { version: "desc" }, take: 1 }, rounds: { orderBy: { roundNumber: "desc" }, take: 1 }, documents: true } });
    if (!caseRow?.bundles[0]) throw new Error("Investment Case não encontrado nesta organização.");
    if (caseRow.studyVersionId === studyVersionId && caseRow.landStudyVersionId === landStudyVersionId) return loadWorkspace(tx, context.organizationId, caseRow.id);
    const source = await loadFrozenBundleSource(tx, context.organizationId, studyVersionId, landStudyVersionId);
    if (source.projectId !== caseRow.projectId || source.studyId !== caseRow.studyId) throw new Error("A reavaliação deve usar uma versão do mesmo empreendimento e estudo.");
    const bundle: InvestmentSnapshotBundle = { ...source, documents: caseRow.documents.map((document) => ({ id: document.id, category: document.category as DataRoomCategory, title: document.title, version: document.version, status: document.status, checksum: document.checksum })) };
    const bundleChecksum = checksum(bundle);
    const existing = await tx.investmentSnapshotBundle.findFirst({ where: { investmentCaseId: caseRow.id, checksum: bundleChecksum } });
    if (existing) return loadWorkspace(tx, context.organizationId, caseRow.id);
    const bundleRow = await tx.investmentSnapshotBundle.create({ data: { investmentCaseId: caseRow.id, version: caseRow.bundles[0].version + 1, schemaVersion: bundle.bundleVersion, studyVersionId, landStudyVersionId, redTeamRunId: bundle.redTeamRunId, scenario: bundle.scenario, content: json(bundle), checksum: bundleChecksum, frozenAt: new Date(bundle.frozenAt), frozenById: context.userId } });
    const currentRound = caseRow.rounds[0];
    if (currentRound && currentRound.status !== "DECIDED") await tx.investmentReviewRound.update({ where: { id: currentRound.id }, data: { status: "SUPERSEDED" } });
    await tx.investmentReviewRound.create({ data: { investmentCaseId: caseRow.id, snapshotBundleId: bundleRow.id, roundNumber: (currentRound?.roundNumber ?? 0) + 1, status: "DRAFT", agenda: "Reavaliação sobre novo snapshot.", createdById: context.userId } });
    await tx.investmentCase.update({ where: { id: caseRow.id }, data: { studyVersionId, landStudyVersionId, redTeamRunId: bundle.redTeamRunId, status: "RESTRUCTURE", updatedById: context.userId } });
    await tx.investmentAuditLog.create({ data: { investmentCaseId: caseRow.id, userId: context.userId, action: "INVESTMENT_CASE_REASSESSED", entityType: "InvestmentSnapshotBundle", entityId: bundleRow.id, before: json({ bundleId: caseRow.bundles[0].id, studyVersionId: caseRow.studyVersionId, landStudyVersionId: caseRow.landStudyVersionId }), after: json({ bundleId: bundleRow.id, studyVersionId, landStudyVersionId, checksum: bundleChecksum }) } });
    return loadWorkspace(tx, context.organizationId, caseRow.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function loadWorkspace(tx: Tx, organizationId: string, investmentCaseId: string): Promise<InvestmentCaseWorkspace> {
  const row = await tx.investmentCase.findFirst({
    where: { id: investmentCaseId, organizationId },
    include: {
      bundles: { orderBy: { version: "desc" } },
      rounds: { orderBy: { roundNumber: "asc" } },
      decisions: { orderBy: { decidedAt: "asc" } },
      conditions: { orderBy: [{ isBlocker: "desc" }, { priority: "desc" }, { createdAt: "asc" }] },
      checklistItems: { orderBy: [{ category: "asc" }, { critical: "desc" }] },
      documents: { orderBy: [{ category: "asc" }, { title: "asc" }, { version: "desc" }] },
      artifacts: { orderBy: { createdAt: "desc" } },
      urbanProfiles: { orderBy: { version: "desc" }, take: 1 },
      infrastructure: true,
      urbanImpacts: true,
      urbanContributions: true,
      urbanCosts: true,
      approvalMilestones: true,
      stageGates: { orderBy: { gateNumber: "asc" } },
      urbanRisks: true,
      assumptionsRegister: { orderBy: { key: "asc" } },
      claims: { orderBy: { createdAt: "asc" } },
      decisionLedger: { orderBy: { decidedAt: "asc" } },
      issues: { orderBy: [{ priority: "desc" }, { createdAt: "asc" }] },
      sandboxes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!row?.bundles[0]) throw new Error("Investment Case não encontrado nesta organização.");
  const brandRow = await tx.organizationBrandConfig.findFirst({ where: { organizationId, isDefault: true }, orderBy: { updatedAt: "desc" } });
  const bundle = row.bundles[0].content as unknown as InvestmentSnapshotBundle;
  const previousBundle = row.bundles[1]?.content as unknown as InvestmentSnapshotBundle | undefined;
  const documents = row.documents.map(documentView);
  bundle.documents = documents.map(({ id, category, title, version, status, checksum: documentChecksum }) => ({ id, category, title, version, status, checksum: documentChecksum }));
  const checklist = row.checklistItems.map(checklistView);
  const conditions = row.conditions.map((condition): InvestmentConditionView => ({ id: condition.id, title: condition.title, description: condition.description, category: condition.category as InvestmentConditionView["category"], priority: condition.priority, status: condition.status, isBlocker: condition.isBlocker, evidenceRequired: condition.evidenceRequired, ownerName: null, dueDate: condition.dueDate?.toISOString().slice(0, 10) ?? null }));
  const readiness = calculateInvestmentReadiness(bundle, checklist, conditions);
  const dataRoomCompleteness = calculateDataRoomCompleteness(checklist);
  const profile = row.urbanProfiles[0];
  const urbanTransformation: UrbanTransformationView = {
    inhabitantsPerUnit: Number(profile?.inhabitantsPerUnit ?? 0),
    estimatedPopulation: profile?.estimatedPopulation ?? 0,
    readiness: Number(profile?.readiness ?? 0),
    readinessLabel: profile?.readinessLabel ?? "NÃO AVALIADO",
    infrastructure: row.infrastructure.map((item) => ({ id: item.id, category: item.category, description: item.description, status: item.status, confidence: item.confidence, source: item.source })),
    impacts: row.urbanImpacts.map((item) => ({ id: item.id, category: item.category as UrbanTransformationView["impacts"][number]["category"], direction: item.direction as UrbanTransformationView["impacts"][number]["direction"], magnitude: item.magnitude, description: item.description, confidence: item.confidence, evidence: item.evidence, mitigation: item.mitigation })),
    contributions: row.urbanContributions.map((item) => ({ id: item.id, category: item.category as UrbanTransformationView["contributions"][number]["category"], title: item.title, estimatedCost: item.estimatedCost === null ? null : Number(item.estimatedCost), phase: item.phase, status: item.status, required: item.required, voluntary: item.voluntary })),
    costs: row.urbanCosts.map((item) => ({ id: item.id, category: item.category, title: item.title, amount: Number(item.amount), includedInEngine: item.includedInEngine })),
    milestones: row.approvalMilestones.map((item) => ({ id: item.id, title: item.title, authority: item.authority, status: item.status, plannedDate: item.plannedDate?.toISOString().slice(0, 10) ?? null })),
    stageGates: row.stageGates.map((item) => ({ id: item.id, gateNumber: item.gateNumber, title: item.title, decision: item.decision, rationale: item.rationale, decidedAt: item.decidedAt.toISOString() })),
    risks: row.urbanRisks.map((item) => ({ id: item.id, title: item.title, severity: item.severity, mitigation: item.mitigation, evidenceRef: item.evidenceRef })),
  };
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    bundleId: row.bundles[0].id,
    bundleChecksum: row.bundles[0].checksum,
    bundle,
    bundleHistory: row.bundles.map((item) => { const content = item.content as unknown as InvestmentSnapshotBundle; return { id: item.id, version: item.version, checksum: item.checksum, studyVersionNumber: content.studyVersionNumber, landVersionNumber: content.landVersionNumber, frozenAt: item.frozenAt.toISOString() }; }),
    changeReport: previousBundle ? buildChangeReport(previousBundle, bundle, row.bundles[1].id, row.bundles[0].id) : [],
    readiness,
    dataRoomCompleteness,
    approvalPath: buildApprovalPath(bundle, conditions),
    rounds: row.rounds.map((round) => ({ id: round.id, roundNumber: round.roundNumber, status: round.status, submittedAt: round.submittedAt?.toISOString() ?? null, decidedAt: round.decidedAt?.toISOString() ?? null, bundleId: round.snapshotBundleId })),
    decisions: row.decisions.map((decision) => ({ id: decision.id, roundNumber: row.rounds.find((round) => round.id === decision.reviewRoundId)?.roundNumber ?? 0, decision: decision.decision, confidence: decision.confidence, rationale: decision.rationale, dominantRisk: decision.dominantRisk, decidedAt: decision.decidedAt.toISOString(), approvedBy: decision.decidedById })),
    conditions,
    checklist,
    documents,
    artifacts: row.artifacts.map((item) => artifactView(item, row.bundles[0].id)),
    brand: brandRow?.config as unknown as OrganizationBrandConfig ?? { ...DEFAULT_BRAND },
    urbanTransformation,
    assumptionsRegister: row.assumptionsRegister.map((item): AssumptionRegisterItemView => ({ id: item.id, key: item.key, category: item.category, value: item.value, unit: item.unit, status: normalizeAssumptionStatus(item.status), ownerName: null, evidenceRef: item.evidenceRef, sourceVersion: item.sourceVersion })),
    claims: row.claims.map((item): ClaimView => ({ id: item.id, statement: item.statement, status: normalizeClaimStatus(item.status), evidenceRefs: item.evidenceRefs as string[], ownerName: null })),
    decisionLedger: row.decisionLedger.map((item): DecisionLedgerEntryView => ({ id: item.id, title: item.title, decision: item.decision, rationale: item.rationale, decidedAt: item.decidedAt.toISOString(), decidedBy: item.decidedById, evidenceRefs: item.evidenceRefs as string[] })),
    issues: row.issues.map((item): ProjectIssueView => ({ id: item.id, title: item.title, status: normalizeIssueStatus(item.status), priority: item.priority, ownerName: null, dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null, nextAction: item.nextAction })),
    sandboxes: row.sandboxes.map((item) => ({ id: item.id, name: item.name, status: item.status as "DRAFT" | "CALCULATED" | "PROMOTED" | "DISCARDED", changes: item.changes as Record<string, string | number>, output: item.output as unknown as FinancialResult | null, promotedStudyVersionId: item.promotedStudyVersionId })),
  };
}

function checklistView(item: { id: string; category: string; title: string; required: boolean; critical: boolean; source: string; status: string; documentId: string | null }): DataRoomChecklistItemView {
  return { id: item.id, category: item.category as DataRoomCategory, title: item.title, required: item.required, critical: item.critical, source: item.source as DataRoomChecklistItemView["source"], status: item.status as DataRoomChecklistItemView["status"], documentId: item.documentId };
}

function documentView(item: { id: string; category: string; title: string; version: number; status: string; checksum: string; fileName: string; mimeType: string; fileSize: number; confidentiality: string; createdAt: Date }): ProjectDocumentView {
  return { id: item.id, category: item.category as DataRoomCategory, title: item.title, version: item.version, status: item.status as ProjectDocumentView["status"], checksum: item.checksum, fileName: item.fileName, mimeType: item.mimeType, fileSize: item.fileSize, confidentiality: item.confidentiality as ProjectDocumentView["confidentiality"], uploadedAt: item.createdAt.toISOString() };
}

function artifactView(item: { id: string; type: string; version: number; status: string; generationStatus: ArtifactGenerationStatus; fileName: string | null; mimeType: string | null; fileSize: number | null; pageCount: number | null; checksum: string | null; generatedAt: Date | null; snapshotBundleId: string }, currentBundleId: string): StudioArtifactView {
  return { id: item.id, type: item.type as StudioArtifactView["type"], version: item.version, status: item.status as StudioArtifactView["status"], generationStatus: item.generationStatus, fileName: item.fileName, mimeType: item.mimeType, fileSize: item.fileSize, pageCount: item.pageCount, checksum: item.checksum, generatedAt: item.generatedAt?.toISOString() ?? null, snapshotBundleId: item.snapshotBundleId, sourceOutdated: item.snapshotBundleId !== currentBundleId };
}

function mapDataRoomCategory(category: string): DataRoomCategory {
  const value = category.toUpperCase();
  if (value.includes("URBAN")) return "02_URBANISTICO";
  if (value.includes("LEGAL")) return "03_JURIDICO";
  if (value.includes("ENGINEER") || value.includes("COST")) return "05_ENGENHARIA";
  if (value.includes("MARKET") || value.includes("COMMERCIAL")) return "07_MERCADO";
  if (value.includes("FUND")) return "10_FUNDING";
  if (value.includes("ENVIRONMENT")) return "12_AMBIENTAL";
  return "15_OUTROS";
}

function assumptionCategory(key: string): string {
  if (/land/i.test(key)) return "LAND";
  if (/cost|contingency|tax|commission|marketing/i.test(key)) return "COST";
  if (/price|sales/i.test(key)) return "COMMERCIAL";
  if (/financing|funding|discount/i.test(key)) return "FUNDING";
  if (/month|delay/i.test(key)) return "TIMELINE";
  return "PRODUCT";
}

function assumptionUnit(key: string): string {
  if (/Rate$/i.test(key)) return "%";
  if (/Price|Cost|Limit|Exposure/i.test(key)) return "BRL";
  if (/Area|M2/i.test(key)) return "m²";
  if (/Months/i.test(key)) return "meses";
  if (/units/i.test(key)) return "unidades";
  return "";
}

function normalizeAssumptionStatus(status: string): AssumptionRegisterItemView["status"] {
  return ["ACTIVE", "CHALLENGED", "VALIDATED", "SUPERSEDED"].includes(status) ? status as AssumptionRegisterItemView["status"] : "ACTIVE";
}

function normalizeClaimStatus(status: string): ClaimView["status"] {
  return ["DRAFT", "SUPPORTED", "CHALLENGED", "RETRACTED"].includes(status) ? status as ClaimView["status"] : "DRAFT";
}

function normalizeIssueStatus(status: string): ProjectIssueView["status"] {
  return ["OPEN", "IN_PROGRESS", "BLOCKED", "RESOLVED", "CLOSED"].includes(status) ? status as ProjectIssueView["status"] : status === "ACTIVE" ? "OPEN" : "OPEN";
}

function buildChangeReport(previous: InvestmentSnapshotBundle, current: InvestmentSnapshotBundle, previousBundleId: string, currentBundleId: string): InvestmentCaseWorkspace["changeReport"] {
  const keys = ["vgv", "totalCost", "profit", "marginOnVgv", "roi", "annualIrr", "npv", "maximumCashExposure", "equityCapitalRequired"] as const;
  return keys.map((key) => {
    const previousValue = previous.engineResults[previous.scenario].metrics[key];
    const currentValue = current.engineResults[current.scenario].metrics[key];
    return { metric: key, previous: String(previousValue ?? "N/D"), current: String(currentValue ?? "N/D"), delta: previousValue === null || currentValue === null ? null : Number(currentValue) - Number(previousValue), previousBundleId, currentBundleId };
  });
}

export async function submitReviewRound(context: Pick<AuthContext, "userId" | "organizationId">, investmentCaseId: string) {
  return prisma.$transaction(async (tx) => {
    const caseRow = await tx.investmentCase.findFirst({ where: { id: investmentCaseId, organizationId: context.organizationId }, include: { rounds: { orderBy: { roundNumber: "desc" }, take: 1 } } });
    if (!caseRow?.rounds[0]) throw new Error("Investment Case não encontrado nesta organização.");
    const round = await tx.investmentReviewRound.update({ where: { id: caseRow.rounds[0].id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    await tx.investmentCase.update({ where: { id: caseRow.id }, data: { status: InvestmentCaseStatus.READY_FOR_REVIEW, updatedById: context.userId } });
    await tx.investmentAuditLog.create({ data: { investmentCaseId, userId: context.userId, action: "REVIEW_ROUND_SUBMITTED", entityType: "InvestmentReviewRound", entityId: round.id, after: json({ roundNumber: round.roundNumber, bundleId: round.snapshotBundleId }) } });
    return loadWorkspace(tx, context.organizationId, investmentCaseId);
  });
}

export async function recordCommitteeDecision(context: Pick<AuthContext, "userId" | "organizationId">, input: { investmentCaseId: string; decision: "APPROVE" | "APPROVE_WITH_CONDITIONS" | "RESTRUCTURE" | "REJECT" | "ON_HOLD"; confidence: "LOW" | "MEDIUM" | "HIGH"; rationale: string; dominantRisk: string; recommendedAction: string }) {
  return prisma.$transaction(async (tx) => {
    const caseRow = await tx.investmentCase.findFirst({ where: { id: input.investmentCaseId, organizationId: context.organizationId }, include: { rounds: { orderBy: { roundNumber: "desc" }, take: 1 } } });
    const round = caseRow?.rounds[0];
    if (!caseRow || !round) throw new Error("Investment Case não encontrado nesta organização.");
    if (round.status === "DECIDED") throw new Error("Este review round já possui decisão. Abra uma nova rodada.");
    const decision = await tx.committeeDecision.create({ data: { investmentCaseId: caseRow.id, reviewRoundId: round.id, decision: input.decision, confidence: input.confidence, rationale: input.rationale, dominantRisk: input.dominantRisk, recommendedAction: input.recommendedAction, decidedById: context.userId, decidedAt: new Date() } });
    await tx.investmentReviewRound.update({ where: { id: round.id }, data: { status: "DECIDED", decidedAt: decision.decidedAt } });
    const status = ({ APPROVE: "APPROVED", APPROVE_WITH_CONDITIONS: "APPROVED_WITH_CONDITIONS", RESTRUCTURE: "RESTRUCTURE", REJECT: "REJECTED", ON_HOLD: "ON_HOLD" } as const)[input.decision];
    await tx.investmentCase.update({ where: { id: caseRow.id }, data: { status, updatedById: context.userId } });
    await tx.decisionLedgerEntry.create({ data: { investmentCaseId: caseRow.id, title: `Comitê · Round ${round.roundNumber}`, decision: input.decision, rationale: input.rationale, evidenceRefs: json([`bundle:${round.snapshotBundleId}`, `committee-decision:${decision.id}`]), decidedById: context.userId, decidedAt: decision.decidedAt } });
    await tx.investmentAuditLog.create({ data: { investmentCaseId: caseRow.id, userId: context.userId, action: "COMMITTEE_DECISION_RECORDED", entityType: "CommitteeDecision", entityId: decision.id, after: json(input) } });
    return loadWorkspace(tx, context.organizationId, caseRow.id);
  });
}

export async function addInvestmentCondition(context: Pick<AuthContext, "userId" | "organizationId">, input: { investmentCaseId: string; title: string; description: string; category: string; priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; isBlocker: boolean; evidenceRequired: string }) {
  return prisma.$transaction(async (tx) => {
    const caseRow = await tx.investmentCase.findFirst({ where: { id: input.investmentCaseId, organizationId: context.organizationId } });
    if (!caseRow) throw new Error("Investment Case não encontrado nesta organização.");
    const condition = await tx.investmentCondition.create({ data: { ...input, createdById: context.userId, updatedById: context.userId } });
    await tx.documentChecklistItem.create({ data: { investmentCaseId: caseRow.id, conditionId: condition.id, code: `CONDITION_${condition.id}`, category: mapDataRoomCategory(input.category), title: input.evidenceRequired, required: true, critical: input.isBlocker, source: "COMMITTEE", createdById: context.userId, updatedById: context.userId } });
    return loadWorkspace(tx, context.organizationId, caseRow.id);
  });
}

export async function verifyInvestmentCondition(context: Pick<AuthContext, "userId" | "organizationId" | "role">, investmentCaseId: string, conditionId: string) {
  if (!['OWNER', 'ADMIN'].includes(context.role)) throw new Error("Apenas Owner ou Admin pode verificar condicionantes.");
  return prisma.$transaction(async (tx) => {
    const condition = await tx.investmentCondition.findFirst({ where: { id: conditionId, investmentCaseId, investmentCase: { organizationId: context.organizationId } } });
    if (!condition) throw new Error("Condicionante não encontrada nesta organização.");
    await tx.investmentCondition.update({ where: { id: condition.id }, data: { status: "VERIFIED", verifiedById: context.userId, verifiedAt: new Date(), updatedById: context.userId } });
    return loadWorkspace(tx, context.organizationId, investmentCaseId);
  });
}

export async function registerProjectDocument(context: Pick<AuthContext, "userId" | "organizationId">, input: { investmentCaseId: string; checklistItemId: string | null; category: DataRoomCategory; title: string; fileName: string; mimeType: string; content: Uint8Array; confidentiality: "PUBLIC_INTERNAL" | "CONFIDENTIAL" | "STRICTLY_CONFIDENTIAL"; source?: string }) {
  const result = await prisma.$transaction(async (tx) => {
    const caseRow = await tx.investmentCase.findFirst({ where: { id: input.investmentCaseId, organizationId: context.organizationId } });
    if (!caseRow) throw new Error("Investment Case não encontrado nesta organização.");
    const previous = await tx.projectDocument.findFirst({ where: { investmentCaseId: caseRow.id, category: input.category, title: input.title }, orderBy: { version: "desc" } });
    const contentChecksum = createHash("sha256").update(input.content).digest("hex");
    const document = await tx.projectDocument.create({ data: { investmentCaseId: caseRow.id, previousVersionId: previous?.id ?? null, category: input.category, title: input.title, version: (previous?.version ?? 0) + 1, status: "RECEIVED", confidentiality: input.confidentiality, fileName: input.fileName, mimeType: input.mimeType, content: Buffer.from(input.content), fileSize: input.content.byteLength, checksum: contentChecksum, source: input.source, createdById: context.userId } });
    if (previous) await tx.projectDocument.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
    if (input.checklistItemId) await tx.documentChecklistItem.updateMany({ where: { id: input.checklistItemId, investmentCaseId: caseRow.id }, data: { documentId: document.id, status: "RECEIVED", updatedById: context.userId } });
    return {
      workspace: await loadWorkspace(tx, context.organizationId, caseRow.id),
      document: { id: document.id, version: document.version, checksum: contentChecksum },
    };
  });
  if (input.mimeType.startsWith("text/") || /\.(txt|md|csv)$/i.test(input.fileName)) {
    await indexTextDocument({ organizationId: context.organizationId, investmentCaseId: input.investmentCaseId, documentId: result.document.id, documentVersion: result.document.version, content: new TextDecoder("utf-8", { fatal: false }).decode(input.content), checksum: result.document.checksum });
  }
  return result.workspace;
}

export async function createDecisionSandbox(
  context: Pick<AuthContext, "userId" | "organizationId">,
  investmentCaseId: string,
  name: string,
  changes: Partial<Pick<ProjectAssumptions, "unitPrice" | "landPrice" | "constructionCostPerM2" | "approvalMonths" | "constructionMonths" | "salesVelocityUnitsMonth" | "financingLimit">>,
): Promise<InvestmentCaseWorkspace> {
  const workspace = await getInvestmentCaseForOrganization(context.organizationId, investmentCaseId);
  if (!workspace) throw new Error("Investment Case não encontrado nesta organização.");
  const assumptions = { ...workspace.bundle.assumptions, ...changes };
  const output = calculateProject(assumptions, workspace.bundle.scenario, new Date().toISOString());
  await prisma.decisionSandbox.create({ data: { investmentCaseId, sourceStudyVersionId: workspace.bundle.studyVersionId, name, status: "CALCULATED", changes: json(changes), output: json(output), createdById: context.userId } });
  return (await getInvestmentCaseForOrganization(context.organizationId, investmentCaseId))!;
}

export async function promoteDecisionSandbox(
  context: Pick<AuthContext, "userId" | "organizationId">,
  investmentCaseId: string,
  sandboxId: string,
): Promise<InvestmentCaseWorkspace> {
  const workspace = await getInvestmentCaseForOrganization(context.organizationId, investmentCaseId);
  if (!workspace) throw new Error("Investment Case não encontrado nesta organização.");
  const sandbox = await prisma.decisionSandbox.findFirst({ where: { id: sandboxId, investmentCaseId, investmentCase: { organizationId: context.organizationId }, status: "CALCULATED" } });
  if (!sandbox) throw new Error("Simulação não encontrada ou já promovida.");
  const assumptions = { ...workspace.bundle.assumptions, ...(sandbox.changes as Partial<ProjectAssumptions>) };
  const version = await createStudyVersion(context, workspace.bundle.projectId, workspace.bundle.studyId, assumptions);
  await prisma.decisionSandbox.update({ where: { id: sandbox.id }, data: { status: "PROMOTED", promotedStudyVersionId: version.studyVersionId } });
  return reassessInvestmentCase(context, investmentCaseId, version.studyVersionId, workspace.bundle.landStudyVersionId);
}

export async function getArtifactDownload(context: Pick<AuthContext, "organizationId">, artifactId: string) {
  const artifact = await prisma.studioArtifact.findFirst({ where: { id: artifactId, investmentCase: { organizationId: context.organizationId } }, select: { fileName: true, mimeType: true, content: true, confidentiality: true } });
  if (!artifact?.content || !artifact.fileName || !artifact.mimeType) throw new Error("Artefato não encontrado nesta organização.");
  return { fileName: artifact.fileName, mimeType: artifact.mimeType, content: new Uint8Array(artifact.content), confidentiality: artifact.confidentiality };
}

export const investmentServiceInternals = { checksum, stableJson, loadFrozenBundleSource };
