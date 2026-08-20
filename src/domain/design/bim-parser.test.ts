import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseIfcGeometry } from "./bim-parser";

describe("parser IFC real", () => {
  it("converte um IFC pequeno em geometria indexada e propriedades", async () => {
    const fixture = fileURLToPath(new URL("./fixtures/parede-minima.ifc", import.meta.url));
    const artifact = await parseIfcGeometry(new Uint8Array(await readFile(fixture)));
    const wall = artifact.elements.find((element) => element.ifcType === "IFCWALL");

    expect(artifact.schema).toContain("IFC4");
    expect(wall?.name).toBe("Parede de teste");
    expect(wall?.chunks[0]?.positions.length).toBeGreaterThan(0);
    expect(wall?.chunks[0]?.indices.length).toBeGreaterThan(0);
    expect(artifact.triangleCount).toBeGreaterThan(0);
    expect(wall?.storey).toBe("Pavimento Térreo");
    expect(wall?.building).toBe("Torre A");
    expect(wall?.properties).toHaveProperty("propertySets");
    expect(wall?.quantities.triangles.origin).toBe("EXTRACTED");
  }, 20_000);
});
