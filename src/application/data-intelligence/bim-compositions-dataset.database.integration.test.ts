import { beforeAll, describe, expect, it } from "vitest";
import { createBimQuantityMapping, decideBimQuantityMapping, listBimQuantityMappings, reviewBimQuantityMapping } from "./bim-quantities-service";
import { activateCostComposition, createCostComposition, listCostCompositions } from "./compositions-service";
import { generateAnalyticalDatasetVersion, listAnalyticalDatasetVersions } from "./dataset-service";
import { refreshDataIntelligence } from "./data-intelligence-service";
import { prisma } from "@/infrastructure/database/prisma";

describe("Fundação de Quantidades BIM, Composições e Conjunto de Dados 9I contra PostgreSQL real", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };
  let projectId: string;
  let economicItemId: string;
  let bimElementId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    const project = await prisma.project.findUniqueOrThrow({ where: { organizationId_name: { organizationId: membership.organizationId, name: "START BUTANTÃ" } } });
    context = { organizationId: membership.organizationId, userId: membership.userId, role: "OWNER" };
    projectId = project.id;

    const officialLine = await prisma.budgetLineItem.findFirstOrThrow({ where: { budget: { projectId, organizationId: context.organizationId, status: { in: ["OFFICIAL", "APPROVED"] } }, totalCost: { gt: 0 } }, orderBy: { totalCost: "desc" } });
    economicItemId = officialLine.economicItemId!;

    await refreshDataIntelligence(context, projectId);

    // Fixture mínima de BIM: pacote/revisão já existem no seed de Design Intelligence;
    // cria o arquivo/modelo/elemento que faltam só para este teste, sem depender de
    // nenhum job de processamento real.
    const pkg = await prisma.designProjectPackage.findFirstOrThrow({ where: { projectId } });
    const revision = await prisma.designRevision.findFirstOrThrow({ where: { packageId: pkg.id } });
    const file = await prisma.designFile.upsert({
      where: { id: "test-9i-bim-fixture-file" },
      update: {},
      create: {
        id: "test-9i-bim-fixture-file", packageId: pkg.id, revisionId: revision.id, fileName: "estrutura-fundacoes.ifc", fileType: "IFC", mimeType: "application/ifc",
        discipline: "STRUCTURAL", revision: "R01", status: "READY", checksum: "test-fixture-checksum", fileSize: 1024, storageProvider: "TEST", storageKey: "test/9i/fixture.ifc",
        uploadedById: context.userId, processingStatus: "COMPLETED",
      },
    });
    const model = await prisma.bimModel.upsert({
      where: { fileId: file.id },
      update: {},
      create: { organizationId: context.organizationId, projectId, packageId: pkg.id, revisionId: revision.id, fileId: file.id, status: "PROCESSED", ifcSchema: "IFC4" },
    });
    const element = await prisma.bimElement.upsert({
      where: { modelId_expressId: { modelId: model.id, expressId: 1 } },
      update: {},
      create: { modelId: model.id, expressId: 1, ifcGuid: "test-guid-9i", ifcType: "IfcColumn", name: "Pilar P01", quantities: { volume: 2.4 }, fingerprint: "test-fingerprint-9i", confidence: "HIGH" },
    });
    bimElementId = element.id;

    // A fixture do elemento BIM é reaproveitada entre execuções (upsert por ID fixo); os
    // mapeamentos que os testes criam sobre ele não são — cada execução deve começar do
    // mesmo estado (version=1), então limpa o que uma execução anterior tenha deixado.
    await prisma.bimQuantityMapping.deleteMany({ where: { organizationId: context.organizationId, bimElementId, economicItemId } });
  });

  it("mapeia elemento BIM a EconomicItem versionado, exige revisão humana antes de aprovar", async () => {
    const mapping = await createBimQuantityMapping(context, { projectId, bimElementId, economicItemId, quantityKind: "VOLUME", quantity: 2.4, unit: "m3", extractionMethod: "IFC_PROPERTY", confidenceLevel: "MEDIUM" });
    expect(mapping.status).toBe("DRAFT");
    expect(mapping.version).toBe(1);

    await expect(decideBimQuantityMapping(context, mapping.id, "APPROVED")).rejects.toThrow("precisa passar por revisão");

    const reviewed = await reviewBimQuantityMapping(context, mapping.id);
    expect(reviewed.status).toBe("REVIEWED");

    const approved = await decideBimQuantityMapping(context, mapping.id, "APPROVED");
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(context.userId);

    const list = await listBimQuantityMappings(context, projectId);
    expect(list.find((m) => m.id === mapping.id)?.status).toBe("APPROVED");
  });

  it("nova versão de mapeamento não sobrescreve a anterior", async () => {
    const before = await prisma.bimQuantityMapping.count({ where: { organizationId: context.organizationId, bimElementId, economicItemId } });
    const second = await createBimQuantityMapping(context, { projectId, bimElementId, economicItemId, quantityKind: "VOLUME", quantity: 2.5, unit: "m3", extractionMethod: "MANUAL", confidenceLevel: "LOW" });
    expect(second.version).toBe(before + 1);
    const after = await prisma.bimQuantityMapping.count({ where: { organizationId: context.organizationId, bimElementId, economicItemId } });
    expect(after).toBe(before + 1);
  });

  it("composição versionada não trata preço de insumo como fato oficial, só coeficiente/produtividade", async () => {
    const composition = await createCostComposition(context, {
      key: "concreto-estrutural-fck30", name: "Concreto estrutural fck=30MPa", outputDescription: "1 m³ de concreto estrutural aplicado", outputUnit: "m3",
      region: "São Paulo/SP", productStandard: "MCMV", source: "Referência técnica interna (demonstração)", effectiveFrom: new Date("2026-08-01"),
      items: [
        { inputType: "MATERIAL", description: "Concreto usinado fck=30MPa", unit: "m3", coefficient: 1.05, wastageRate: 0.05 },
        { inputType: "LABOR", description: "Equipe de concretagem", unit: "h", coefficient: 0.8, productivity: 1.25 },
        { inputType: "EQUIPMENT", description: "Bomba de concreto", unit: "h", coefficient: 0.15 },
      ],
    });
    expect(composition.items).toHaveLength(3);
    expect(composition.items.every((item) => !("price" in item))).toBe(true);

    const activated = await activateCostComposition(context, composition.id);
    expect(activated.status).toBe("ACTIVE");
    await expect(activateCostComposition(context, composition.id)).rejects.toThrow("não pode ser ativada");

    const list = await listCostCompositions(context);
    expect(list.find((c) => c.id === composition.id)?.status).toBe("ACTIVE");
  });

  it("dataset gerado duas vezes com os mesmos fatos produz o mesmo checksum e não duplica versão", async () => {
    const first = await generateAnalyticalDatasetVersion(context, { key: "custo-fundacoes-estrutura", purpose: "Demonstração de reprodutibilidade 9I", projectId, populationDescription: "Fatos analíticos do item Construção MCMV do START BUTANTÃ" });
    const second = await generateAnalyticalDatasetVersion(context, { key: "custo-fundacoes-estrutura", purpose: "Demonstração de reprodutibilidade 9I", projectId, populationDescription: "Fatos analíticos do item Construção MCMV do START BUTANTÃ" });

    expect(second.id).toBe(first.id); // mesmo conteúdo -> mesma linha, nenhuma versão nova criada
    expect(second.checksum).toBe(first.checksum);
    expect(second.version).toBe(first.version);
    expect(first.rowCount).toBeGreaterThan(0);

    const countRows = await prisma.analyticalDatasetVersion.count({ where: { organizationId: context.organizationId, key: "custo-fundacoes-estrutura" } });
    expect(countRows).toBe(1);

    const list = await listAnalyticalDatasetVersions(context);
    expect(list.some((v) => v.key === "custo-fundacoes-estrutura")).toBe(true);
  });

  it("mudar parâmetros muda o checksum, mesmo com os mesmos fatos", async () => {
    const base = await generateAnalyticalDatasetVersion(context, { key: "custo-fundacoes-parametrizado", purpose: "Teste de parâmetro", projectId, populationDescription: "Teste" });
    const withParam = await generateAnalyticalDatasetVersion(context, { key: "custo-fundacoes-parametrizado", purpose: "Teste de parâmetro", projectId, populationDescription: "Teste", parameters: { economicItemId } });
    expect(withParam.checksum).not.toBe(base.checksum);
    expect(withParam.version).toBe(base.version + 1);
  });

  it("isola organização e bloqueia quem não tem a capacidade", async () => {
    const isolated = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    await expect(listBimQuantityMappings({ organizationId: isolated.id, userId: context.userId, role: "VIEWER" }, projectId)).rejects.toThrow("não encontrado");
    await expect(createBimQuantityMapping({ organizationId: context.organizationId, userId: context.userId, role: "VIEWER" }, { projectId, bimElementId, economicItemId, quantityKind: "VOLUME", quantity: 1, unit: "m3", extractionMethod: "MANUAL", confidenceLevel: "LOW" })).rejects.toThrow("não possui a capacidade");
    await expect(generateAnalyticalDatasetVersion({ organizationId: context.organizationId, userId: context.userId, role: "VIEWER" }, { key: "forbidden", purpose: "x", projectId, populationDescription: "x" })).rejects.toThrow("não possui a capacidade");
  });
});
