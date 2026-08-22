import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/database/prisma";
import { buildXlsx } from "@/domain/integrations";
import { importUniversalFile, previewImportFile } from "./import-service";

describe("Importador universal — CSV/XLSX/JSON/XML aplicados (PostgreSQL real)", () => {
  let context: { organizationId: string; userId: string; role: "OWNER" };
  let installationId: string;

  beforeAll(async () => {
    const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organization: { slug: "rede-nucleo-de-negocios" }, user: { email: "admin@rede.local" } } });
    context = { organizationId: membership.organizationId, userId: membership.userId, role: "OWNER" };
    const installation = await prisma.connectorInstallation.findFirstOrThrow({ where: { organizationId: context.organizationId, connectorDefinition: { code: "ERP_SUPPLIERS_MOCK" } } });
    installationId = installation.id;
  });

  const mapping = [
    { sourceField: "nome", targetField: "name", required: true, type: "string" as const },
    { sourceField: "cnpj", targetField: "taxId", required: true, type: "string" as const },
  ];

  it("preview não persiste nada e detecta colunas/amostra", () => {
    const preview = previewImportFile(context, "CSV", "nome,cnpj\nAna,12.345.678/0001-90\n");
    expect(preview.format).toBe("CSV");
    expect(preview.columns).toEqual(["nome", "cnpj"]);
    expect(preview.totalRows).toBe(1);
  });

  it("importa CSV com uma linha inválida em quarentena e o restante aplicado", async () => {
    const content = "nome,cnpj\nAna,12.345.678/0001-90\n,99.999.999/0001-99\n";
    const result = await importUniversalFile(context, { installationId, capability: "SUPPLIERS_IMPORT", format: "CSV", content, mapping });
    expect(result.run.status).toBe("PARTIAL");
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    const quarantined = await prisma.integrationQuarantineItem.count({ where: { installationId, capability: "SUPPLIERS_IMPORT", status: "PENDING" } });
    expect(quarantined).toBeGreaterThanOrEqual(1);
  });

  it("importa JSON com sucesso total", async () => {
    const content = JSON.stringify([{ nome: "Beto", cnpj: "11.111.111/0001-11" }]);
    const result = await importUniversalFile(context, { installationId, capability: "SUPPLIERS_IMPORT", format: "JSON", content, mapping });
    expect(result.run.status).toBe("SUCCEEDED");
    expect(result.accepted).toHaveLength(1);
  });

  it("importa XML com sucesso total", async () => {
    const content = "<rows><row><nome>Carla</nome><cnpj>22.222.222/0001-22</cnpj></row></rows>";
    const result = await importUniversalFile(context, { installationId, capability: "SUPPLIERS_IMPORT", format: "XML", content, mapping });
    expect(result.run.status).toBe("SUCCEEDED");
    expect(result.accepted).toHaveLength(1);
  });

  it("importa XLSX real (OOXML) com sucesso total", async () => {
    const content = buildXlsx(["nome", "cnpj"], [["Diana", "33.333.333/0001-33"]]);
    const result = await importUniversalFile(context, { installationId, capability: "SUPPLIERS_IMPORT", format: "XLSX", content, mapping });
    expect(result.run.status).toBe("SUCCEEDED");
    expect(result.accepted).toHaveLength(1);
  });

  it("isola por organização e exige capacidade INTEGRATION_SYNC", async () => {
    const isolated = await prisma.organization.findUniqueOrThrow({ where: { slug: "grupo-atlas" } });
    await expect(importUniversalFile({ organizationId: isolated.id, userId: context.userId, role: "OWNER" }, { installationId, capability: "SUPPLIERS_IMPORT", format: "JSON", content: "[]", mapping })).rejects.toThrow("não encontrada nesta organização");
    await expect(importUniversalFile({ organizationId: context.organizationId, userId: context.userId, role: "VIEWER" }, { installationId, capability: "SUPPLIERS_IMPORT", format: "JSON", content: "[]", mapping })).rejects.toThrow("não possui a capacidade");
  });
});
