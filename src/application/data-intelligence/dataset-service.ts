import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "@/application/auth/session";
import { prisma } from "@/infrastructure/database/prisma";
import { assertDataIntelligenceCapability, DATA_INTELLIGENCE_ENGINE_VERSION, type DataIntelligenceCapability } from "@/domain/data-intelligence";

type DIContext = Pick<AuthContext, "organizationId" | "userId" | "role">;
const json = (value: unknown) => value as Prisma.InputJsonValue;

// Canonicaliza antes de fazer hash: chaves ordenadas recursivamente, para que
// a mesma informação sempre produza a mesma string de entrada do checksum,
// independentemente da ordem em que os campos foram montados em memória.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}
const checksumOf = (value: unknown) => createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");

function requireCapability(context: Pick<DIContext, "role">, capability: DataIntelligenceCapability) {
  assertDataIntelligenceCapability(context.role, capability);
}

async function assertProjectScope(context: Pick<DIContext, "organizationId">, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: context.organizationId } });
  if (!project) throw new Error("Empreendimento não encontrado nesta organização.");
  return project;
}

export interface GenerateDatasetInput {
  key: string;
  purpose: string;
  projectId: string;
  populationDescription: string;
  parameters?: Record<string, unknown>;
  classification?: "PUBLIC_INTERNAL" | "CONFIDENTIAL" | "RESTRICTED_PII";
  piiTreatment?: string;
}

// Gerador mínimo e determinístico (plano 9I, item 3 da task de fechamento):
// mesmos fatos + mesmas versões + mesmos parâmetros = mesmo checksum. O
// checksum NUNCA inclui timestamp de execução (snapshotDate/createdAt ficam
// de fora do hash) — só o conteúdo determina o resultado, para que rodar o
// gerador em dias diferentes com os mesmos fatos produza o mesmo dataset.
// Não treina ML; apenas empacota um recorte minimizado e reproduzível.
export async function generateAnalyticalDatasetVersion(context: DIContext, input: GenerateDatasetInput) {
  requireCapability(context, "DATASET_EXPORT");
  await assertProjectScope(context, input.projectId);

  const [facts, metricDefinitions, policy, contracts, qualityRuns] = await Promise.all([
    prisma.analyticsFact.findMany({ where: { organizationId: context.organizationId, projectId: input.projectId }, orderBy: { id: "asc" } }),
    prisma.metricDefinition.findMany({ where: { organizationId: context.organizationId, status: "ACTIVE" }, orderBy: { key: "asc" } }),
    prisma.comparabilityPolicy.findFirst({ where: { organizationId: context.organizationId, key: "default", status: "ACTIVE" } }),
    prisma.analyticsDataContract.findMany({ where: { organizationId: context.organizationId, status: "ACTIVE" }, orderBy: { key: "asc" } }),
    prisma.dataQualityRun.findMany({ where: { organizationId: context.organizationId }, include: { rule: true }, orderBy: { executedAt: "desc" }, take: 200 }),
  ]);

  const sourceVersions = {
    contracts: contracts.map((c) => ({ key: c.key, version: c.version })),
    metrics: metricDefinitions.map((m) => ({ key: m.key, version: m.version })),
    policy: policy ? { key: policy.key, version: policy.version } : null,
  };

  const parameters = { projectId: input.projectId, ...(input.parameters ?? {}) };

  // Features minimizadas: agregados por tipo de fato, nunca a linha bruta com
  // qualquer identificador de fornecedor/cliente (minimização LGPD — plano
  // 9I, seção 27/68). Só o suficiente para descrever a população.
  const featuresByType = new Map<string, { count: number; totalAmount: number }>();
  for (const fact of facts) {
    const bucket = featuresByType.get(fact.factType) ?? { count: 0, totalAmount: 0 };
    bucket.count += 1;
    bucket.totalAmount += fact.amount ? Number(fact.amount) : 0;
    featuresByType.set(fact.factType, bucket);
  }
  const features = Object.fromEntries([...featuresByType.entries()].sort(([a], [b]) => a.localeCompare(b)));

  const lineage = facts.map((f) => ({ factId: f.id, sourceModule: f.sourceModule, sourceEntityType: f.sourceEntityType, sourceEntityId: f.sourceEntityId, checksum: f.checksum })).sort((a, b) => a.factId.localeCompare(b.factId));

  const qualityByRule = new Map<string, { ruleName: string; passed: boolean; rowsFailed: number }>();
  for (const run of qualityRuns) {
    if (!qualityByRule.has(run.ruleId)) qualityByRule.set(run.ruleId, { ruleName: run.rule.name, passed: run.passed, rowsFailed: run.rowsFailed });
  }
  const quality = { rules: [...qualityByRule.values()].sort((a, b) => a.ruleName.localeCompare(b.ruleName)) };

  const checksumInput = { sourceVersions, parameters, features, lineage };
  const checksum = checksumOf(checksumInput);

  const existingWithSameContent = await prisma.analyticalDatasetVersion.findFirst({ where: { organizationId: context.organizationId, key: input.key, checksum } });
  if (existingWithSameContent) return existingWithSameContent; // reprodutibilidade: mesmo conteúdo nunca cria uma nova versão

  const latest = await prisma.analyticalDatasetVersion.findFirst({ where: { organizationId: context.organizationId, key: input.key }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;

  return prisma.analyticalDatasetVersion.create({
    data: {
      organizationId: context.organizationId, key: input.key, version, purpose: input.purpose, populationDescription: input.populationDescription,
      snapshotDate: new Date(new Date().toISOString().slice(0, 10)), sourceVersions: json(sourceVersions), parameters: json(parameters),
      features: json(features), lineage: json(lineage), quality: json(quality), engineVersion: DATA_INTELLIGENCE_ENGINE_VERSION,
      filters: json(parameters), schema: json({ factTypes: Object.keys(features) }), rowCount: facts.length,
      classification: input.classification ?? "PUBLIC_INTERNAL", piiTreatment: input.piiTreatment ?? "Nenhum dado pessoal incluído — apenas agregados por tipo de fato e referências a IDs operacionais.",
      checksum, status: "DRAFT", createdById: context.userId,
    },
  });
}

export async function listAnalyticalDatasetVersions(context: DIContext) {
  requireCapability(context, "DATA_VIEW");
  const versions = await prisma.analyticalDatasetVersion.findMany({ where: { organizationId: context.organizationId }, orderBy: [{ key: "asc" }, { version: "desc" }] });
  return versions.map((v) => ({
    id: v.id, key: v.key, version: v.version, purpose: v.purpose, snapshotDate: v.snapshotDate.toISOString(), rowCount: v.rowCount,
    classification: v.classification, checksum: v.checksum, status: v.status, engineVersion: v.engineVersion,
  }));
}
