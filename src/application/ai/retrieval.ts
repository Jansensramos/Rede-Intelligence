import type { AIResponseEvidenceInput, RelevantContextPackage } from "@/domain/ai";
import { prisma } from "@/infrastructure/database/prisma";

export interface InternalEvidenceHit {
  title: string;
  excerpt: string;
  source: string;
  evidence: AIResponseEvidenceInput;
}

const normalizedTokens = (query: string) => query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").split(/\W+/).filter((item) => item.length > 2).slice(0, 8);
const matches = (value: string, tokens: string[]) => { const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR"); return tokens.some((token) => normalized.includes(token)); };

export async function searchInternalEvidence(context: RelevantContextPackage, query: string, limit = 12): Promise<InternalEvidenceHit[]> {
  const tokens = normalizedTokens(query);
  if (!tokens.length) return [];
  const workspace = context.workspace;
  const hits: InternalEvidenceHit[] = [];
  for (const item of workspace.assumptionsRegister.filter((value) => matches(`${value.key} ${value.category} ${value.value}`, tokens))) hits.push({ title: item.key, excerpt: `${item.value} ${item.unit} · ${item.status}`, source: "Assumption Register", evidence: { statementId: `assumption-${item.id}`, sourceType: "USER_INPUT", entityType: "AssumptionRegisterItem", entityId: item.id, field: item.key, version: item.sourceVersion, evidenceRef: item.evidenceRef, confidence: item.status === "VALIDATED" ? "HIGH" : "MEDIUM", label: `${item.key} · ${item.sourceVersion}`, value: item.value } });
  for (const item of workspace.claims.filter((value) => matches(`${value.statement} ${value.status}`, tokens))) hits.push({ title: "Claim", excerpt: item.statement, source: "Claims Ledger", evidence: { statementId: `claim-${item.id}`, sourceType: "OTHER", entityType: "InvestmentClaim", entityId: item.id, evidenceRef: item.evidenceRefs[0] ?? `claim:${item.id}`, confidence: item.status === "SUPPORTED" ? "HIGH" : "LOW", label: `Claim · ${item.status}` } });
  for (const item of workspace.issues.filter((value) => matches(`${value.title} ${value.nextAction}`, tokens))) hits.push({ title: item.title, excerpt: item.nextAction, source: "Action Center", evidence: { statementId: `issue-${item.id}`, sourceType: "COMMITTEE", entityType: "InvestmentIssue", entityId: item.id, evidenceRef: `issue:${item.id}`, confidence: "HIGH", label: `Issue · ${item.priority}` } });
  for (const item of workspace.conditions.filter((value) => matches(`${value.title} ${value.description} ${value.evidenceRequired}`, tokens))) hits.push({ title: item.title, excerpt: item.description, source: "Committee", evidence: { statementId: `condition-${item.id}`, sourceType: "COMMITTEE", entityType: "InvestmentCondition", entityId: item.id, evidenceRef: `condition:${item.id}`, confidence: "HIGH", label: `Condition · ${item.status}` } });
  for (const item of workspace.documents.filter((value) => matches(`${value.title} ${value.category} ${value.fileName}`, tokens) && (context.permissions.canViewConfidential || value.confidentiality === "PUBLIC_INTERNAL"))) hits.push({ title: item.title, excerpt: `${item.fileName} · v${item.version} · ${item.status}`, source: "Data Room", evidence: { statementId: `document-${item.id}`, sourceType: "DOCUMENT", entityType: "ProjectDocument", entityId: item.id, documentId: item.id, version: `v${item.version}`, evidenceRef: `document:${item.id}:v${item.version}`, confidence: item.status === "VERIFIED" ? "HIGH" : "MEDIUM", label: `${item.title} v${item.version}`, value: item.status } });
  const chunkWhere = tokens.map((token) => ({ content: { contains: token, mode: "insensitive" as const } }));
  const chunks = await prisma.aIDocumentChunk.findMany({ where: { organizationId: context.organizationId, investmentCaseId: workspace.id, OR: chunkWhere }, take: Math.max(1, limit), orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }] });
  const allowedDocuments = new Set(workspace.documents.filter((item) => context.permissions.canViewConfidential || item.confidentiality === "PUBLIC_INTERNAL").map((item) => item.id));
  for (const chunk of chunks.filter((item) => allowedDocuments.has(item.documentId))) hits.push({ title: "Trecho de documento", excerpt: chunk.content.slice(0, 500), source: "Documento — UNTRUSTED EVIDENCE", evidence: { statementId: `chunk-${chunk.id}`, sourceType: "DOCUMENT", entityType: "AIDocumentChunk", entityId: chunk.id, documentId: chunk.documentId, version: `v${chunk.documentVersion}`, evidenceRef: `document:${chunk.documentId}:chunk:${chunk.chunkIndex}`, confidence: "MEDIUM", label: `Documento v${chunk.documentVersion}`, location: chunk.location ?? `trecho ${chunk.chunkIndex + 1}`, metadata: { untrustedEvidence: true } } });
  return hits.slice(0, limit);
}

export async function indexTextDocument(input: { organizationId: string; investmentCaseId: string; documentId: string; documentVersion: number; content: string; checksum: string }) {
  const clean = input.content.replace(/\0/g, "").trim();
  if (!clean) return 0;
  const chunks = clean.match(/[\s\S]{1,1800}(?:\s|$)/g) ?? [clean];
  await prisma.aIDocumentChunk.deleteMany({ where: { documentId: input.documentId } });
  await prisma.aIDocumentChunk.createMany({ data: chunks.map((content, chunkIndex) => ({ organizationId: input.organizationId, investmentCaseId: input.investmentCaseId, documentId: input.documentId, documentVersion: input.documentVersion, chunkIndex, content: content.trim(), location: `trecho ${chunkIndex + 1}`, tokenCount: Math.ceil(content.length / 4), checksum: input.checksum, metadata: { instructionBoundary: "UNTRUSTED_EVIDENCE" }, untrusted: true })) });
  return chunks.length;
}
