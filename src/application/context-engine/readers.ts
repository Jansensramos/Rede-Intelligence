import type { Prisma } from "@prisma/client";
import { injectionSignals, safeContextRef, type ContextExclusionSchema, type ContextItem, type ContextPolicy, type ContextRequest, type ContextSource, type ContextSourceType } from "@/domain/context-engine";
import type { z } from "zod";

type Exclusion = z.infer<typeof ContextExclusionSchema>;
type ReadResult = { items: ContextItem[]; exclusions: Exclusion[] };

function source(request: ContextRequest, policy: ContextPolicy, input: { type: ContextSourceType; id: string; version: string; recordedAt: Date; observedAt?: Date | null; classification: ContextSource["classification"]; state: ContextSource["evidenceState"] }): ContextSource {
  const maxAge = policy.freshnessMsBySource[input.type];
  const requestedAt = new Date(request.requestedAt).getTime();
  const recordedAt = input.recordedAt.getTime();
  const observedAt = input.observedAt?.getTime();
  const freshness: ContextSource["freshness"] = maxAge === undefined || recordedAt > requestedAt || (observedAt !== undefined && observedAt > requestedAt)
    ? "UNKNOWN"
    : requestedAt - recordedAt <= maxAge ? "FRESH" : "STALE";
  return {
    sourceType: input.type, sourceRef: safeContextRef("source", `${input.type}:${input.id}`), version: input.version,
    observedAt: input.observedAt?.toISOString() ?? null, recordedAt: input.recordedAt.toISOString(), freshness,
    classification: input.classification, inclusionReasonCode: policy.requiredSourceTypes.includes(input.type) ? "REQUIRED_FOR_PURPOSE" : "AUTHORIZED_SUPPORTING_EVIDENCE", organizationRef: safeContextRef("org", request.organizationId),
    projectRef: safeContextRef("project", request.projectId), evidenceState: input.state,
  };
}

function known(input: Omit<ContextItem, "value" | "indivisible" | "trustBoundary" | "injectionSignals" | "selectionGroup" | "groupRequirement"> & { value: string | number | boolean; selectionGroup?: string; groupRequirement?: ContextItem["groupRequirement"] }): ContextItem {
  const text = typeof input.value === "string" ? input.value : String(input.value);
  const required = input.sources.some((entry) => entry.inclusionReasonCode === "REQUIRED_FOR_PURPOSE");
  return { ...input, selectionGroup: input.selectionGroup ?? input.sources[0].sourceRef, groupRequirement: input.groupRequirement ?? (required ? "REQUIRED" : "OPTIONAL"), value: { kind: "KNOWN", value: input.value }, indivisible: true, trustBoundary: "DATA_NOT_INSTRUCTION", injectionSignals: injectionSignals(text) };
}

function addIfFresh(result: ReadResult, item: ContextItem) {
  if (item.sources.some((entry) => entry.freshness !== "FRESH")) result.exclusions.push({ sourceType: item.sources[0].sourceType, reasonCode: item.sources.some((entry) => entry.freshness === "STALE") ? "SOURCE_STALE" : "SOURCE_INVALID", count: 1 });
  else result.items.push(item);
}

async function readStudyEvidence(tx: Prisma.TransactionClient, request: ContextRequest, policy: ContextPolicy, result: ReadResult) {
  if (!policy.allowedSourceTypes.some((type) => ["STUDY_VERSION", "ASSUMPTION_SNAPSHOT", "FINANCIAL_RESULT", "RISK_FINDING"].includes(type))) return;
  const version = await tx.studyVersion.findFirst({
    where: { status: "SNAPSHOT", study: { projectId: request.projectId, project: { organizationId: request.organizationId } } },
    orderBy: [{ versionNumber: "desc" }, { id: "asc" }],
    select: {
      id: true, versionNumber: true, engineVersion: true, lockedAt: true, createdAt: true,
      assumptions: { select: { id: true, units: true, unitPrice: true, landPrice: true, constructionCostPerM2: true, updatedAt: true } },
      runs: { where: { organizationId: request.organizationId, projectId: request.projectId }, orderBy: [{ calculatedAt: "desc" }, { id: "asc" }], take: 1,
        select: { id: true, engineVersion: true, calculatedAt: true, result: { select: { id: true, vgv: true, netRevenue: true, totalCost: true, profit: true, marginOnNetRevenue: true, roi: true, annualIrr: true, npv: true, createdAt: true } }, findings: { orderBy: [{ severity: "desc" }, { code: "asc" }, { id: "asc" }], select: { id: true, code: true, severity: true, actualValue: true, thresholdValue: true, createdAt: true } } } },
    },
  });
  if (!version) { result.exclusions.push({ sourceType: "STUDY_VERSION", reasonCode: "SOURCE_MISSING", count: 1 }); return; }
  const studySource = source(request, policy, { type: "STUDY_VERSION", id: version.id, version: String(version.versionNumber), recordedAt: version.lockedAt ?? version.createdAt, classification: "CONFIDENTIAL", state: "TERMINAL" });
  addIfFresh(result, known({ itemKey: "study.version", domain: "EXECUTIVE", label: "Versão terminal do estudo", value: version.versionNumber, unit: null, priority: 100, sources: [studySource] }));
  if (version.assumptions && policy.allowedSourceTypes.includes("ASSUMPTION_SNAPSHOT")) {
    const assumptionSource = source(request, policy, { type: "ASSUMPTION_SNAPSHOT", id: version.assumptions.id, version: String(version.versionNumber), recordedAt: version.assumptions.updatedAt, classification: "CONFIDENTIAL", state: "ASSUMPTION" });
    for (const [key, label, value, unit] of [
      ["assumption.units", "Unidades", version.assumptions.units, "unit"], ["assumption.unit_price", "Preço por unidade", version.assumptions.unitPrice.toString(), "BRL"],
      ["assumption.land_price", "Preço do terreno", version.assumptions.landPrice.toString(), "BRL"], ["assumption.construction_cost_m2", "Custo de construção por m²", version.assumptions.constructionCostPerM2.toString(), "BRL/m2"],
    ] as const) addIfFresh(result, known({ itemKey: key, domain: "FINANCIAL", label, value, unit, priority: 55, sources: [assumptionSource] }));
  }
  const run = version.runs[0];
  if (run?.result && policy.allowedSourceTypes.includes("FINANCIAL_RESULT")) {
    const financialSource = source(request, policy, { type: "FINANCIAL_RESULT", id: run.result.id, version: `${version.versionNumber}:${run.engineVersion}`, observedAt: run.calculatedAt, recordedAt: run.result.createdAt, classification: "FINANCIAL", state: "CONFIRMED" });
    const fields = [
      ["financial.vgv", "VGV", run.result.vgv?.toString(), "BRL"], ["financial.net_revenue", "Receita líquida", run.result.netRevenue?.toString(), "BRL"],
      ["financial.total_cost", "Custo total", run.result.totalCost?.toString(), "BRL"], ["financial.profit", "Lucro", run.result.profit?.toString(), "BRL"],
      ["financial.margin_net", "Margem sobre receita líquida", run.result.marginOnNetRevenue?.toString(), "ratio"], ["financial.roi", "ROI", run.result.roi?.toString(), "ratio"],
      ["financial.annual_irr", "TIR anual", run.result.annualIrr?.toString(), "ratio"], ["financial.npv", "VPL", run.result.npv?.toString(), "BRL"],
    ] as const;
    for (const [key, label, value, unit] of fields) if (value != null) addIfFresh(result, known({ itemKey: key, domain: "FINANCIAL", label, value, unit, priority: 90, sources: [financialSource] }));
  }
  if (run && policy.allowedSourceTypes.includes("RISK_FINDING")) {
    for (const finding of run.findings) {
      if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(finding.code)) { result.exclusions.push({ sourceType: "RISK_FINDING", reasonCode: "SOURCE_INVALID", count: 1 }); continue; }
      const riskSource = source(request, policy, { type: "RISK_FINDING", id: finding.id, version: `${version.versionNumber}:${run.engineVersion}`, observedAt: run.calculatedAt, recordedAt: finding.createdAt, classification: "CONFIDENTIAL", state: "DERIVED" });
      addIfFresh(result, known({ itemKey: `risk.${finding.code}`, selectionGroup: "risk.required_set", domain: "RISK", label: "Achado de risco codificado", value: `code=${finding.code};severity=${finding.severity};actual=${finding.actualValue?.toString() ?? "UNKNOWN"};threshold=${finding.thresholdValue?.toString() ?? "UNKNOWN"}`, unit: null, priority: 80, sources: [riskSource] }));
    }
  }
}

async function readLegalEvidence(tx: Prisma.TransactionClient, request: ContextRequest, policy: ContextPolicy, result: ReadResult) {
  if (!policy.allowedSourceTypes.includes("LEGAL_EVIDENCE_DOCUMENT")) return;
  const documents = await tx.legalEvidenceDocument.findMany({ where: { organizationId: request.organizationId, projectId: request.projectId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, status: true, reviewedAt: true, revokedAt: true, createdAt: true } });
  for (const document of documents) {
    if (document.status === "REVOKED" || document.revokedAt) { result.exclusions.push({ sourceType: "LEGAL_EVIDENCE_DOCUMENT", reasonCode: "SOURCE_REVOKED", count: 1 }); continue; }
    if (document.status !== "VERIFIED" || !document.reviewedAt) { result.exclusions.push({ sourceType: "LEGAL_EVIDENCE_DOCUMENT", reasonCode: "SOURCE_INVALID", count: 1 }); continue; }
    const legalSource = source(request, policy, { type: "LEGAL_EVIDENCE_DOCUMENT", id: document.id, version: document.reviewedAt.toISOString(), observedAt: document.reviewedAt, recordedAt: document.reviewedAt, classification: "LEGAL", state: "VERIFIED" });
    addIfFresh(result, known({ itemKey: `legal.evidence.${legalSource.sourceRef}`, selectionGroup: "legal.required_set", domain: "LEGAL", label: "Evidência jurídica verificada", value: "VERIFIED", unit: null, priority: 100, sources: [legalSource] }));
  }
}

async function readEngineeringEvidence(tx: Prisma.TransactionClient, request: ContextRequest, policy: ContextPolicy, result: ReadResult) {
  if (!policy.allowedSourceTypes.includes("ENGINEERING_TECHNICAL_OPINION")) return;
  const rows = await tx.engineeringTechnicalOpinion.findMany({ where: { organizationId: request.organizationId, projectId: request.projectId }, orderBy: [{ seriesKey: "asc" }, { version: "desc" }, { id: "asc" }], select: { id: true, seriesKey: true, version: true, status: true, code: true, validatedAt: true, createdAt: true, items: { where: { validationStatus: "VALIDATED" }, orderBy: [{ sequence: "asc" }, { id: "asc" }], select: { id: true, sequence: true, topic: true, severity: true, confidence: true, referenceDate: true } } } });
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.seriesKey)) { result.exclusions.push({ sourceType: "ENGINEERING_TECHNICAL_OPINION", reasonCode: "SOURCE_SUPERSEDED", count: 1 }); continue; }
    seen.add(row.seriesKey);
    if (row.status === "SUPERSEDED") { result.exclusions.push({ sourceType: "ENGINEERING_TECHNICAL_OPINION", reasonCode: "SOURCE_SUPERSEDED", count: 1 }); continue; }
    if (row.status !== "VALIDATED" || !row.validatedAt || !/^[A-Za-z0-9_.:-]{1,64}$/.test(row.code)) { result.exclusions.push({ sourceType: "ENGINEERING_TECHNICAL_OPINION", reasonCode: "SOURCE_INVALID", count: 1 }); continue; }
    const engineeringSource = source(request, policy, { type: "ENGINEERING_TECHNICAL_OPINION", id: row.id, version: String(row.version), observedAt: row.validatedAt, recordedAt: row.validatedAt, classification: "CONFIDENTIAL", state: "VERIFIED" });
    const selectionGroup = `engineering.group.${safeContextRef("series", row.seriesKey)}`;
    addIfFresh(result, known({ itemKey: `engineering.opinion.${safeContextRef("series", row.seriesKey)}`, selectionGroup, domain: "ENGINEERING", label: "Parecer técnico validado", value: `code=${row.code};validated_items=${row.items.length}`, unit: null, priority: 100, sources: [engineeringSource] }));
    row.items.forEach((item) => addIfFresh(result, known({ itemKey: `engineering.item.${safeContextRef("item", item.id)}`, selectionGroup, domain: "ENGINEERING", label: "Item técnico validado", value: `topic=${item.topic};severity=${item.severity};confidence=${item.confidence};reference=${item.referenceDate.toISOString().slice(0, 10)}`, unit: null, priority: 80, sources: [engineeringSource] })));
  }
}

export async function readContextCandidates(tx: Prisma.TransactionClient, request: ContextRequest, policy: ContextPolicy): Promise<ReadResult> {
  const result: ReadResult = { items: [], exclusions: [] };
  await readStudyEvidence(tx, request, policy, result);
  await readLegalEvidence(tx, request, policy, result);
  await readEngineeringEvidence(tx, request, policy, result);
  return result;
}
