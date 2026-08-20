import { IfcAPI } from "web-ifc";
import type { BimElementGeometry, BimGeometryArtifact, BimGeometryChunk } from "./bim-geometry";
import { boundsFromPositions, calculatedQuantities, elementFingerprint, mergeBounds, transformVertex } from "./bim-geometry";

const value = (input: unknown) => input && typeof input === "object" && "value" in input ? String((input as { value?: unknown }).value ?? "") : undefined;
const safeRecord = (input: unknown): Record<string, unknown> => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};

interface SpatialNode { expressID: number; type: string; children?: SpatialNode[]; Name?: unknown }

function serializable(input: unknown, depth = 0): unknown {
  if (depth > 5 || input === null || ["string", "number", "boolean"].includes(typeof input)) return input ?? null;
  if (Array.isArray(input)) return input.slice(0, 500).map((item) => serializable(item, depth + 1));
  if (typeof input === "object") return Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([key]) => key !== "expressID").slice(0, 300).map(([key, item]) => [key, serializable(item, depth + 1)]));
  return String(input);
}

export async function parseIfcGeometry(bytes: Uint8Array): Promise<BimGeometryArtifact> {
  const started = performance.now();
  const api = new IfcAPI();
  await api.Init();
  const modelId = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true, CIRCLE_SEGMENTS: 12, MEMORY_LIMIT: 512_000_000 });
  try {
    const schema = api.GetModelSchema(modelId) || "UNKNOWN";
    const spatialTree = await api.properties.getSpatialStructure(modelId, true);
    const elements: BimElementGeometry[] = [];
    let triangleCount = 0;
    api.StreamAllMeshes(modelId, (flatMesh) => {
      const chunks: BimGeometryChunk[] = [];
      const allPositions: number[] = [];
      for (let index = 0; index < flatMesh.geometries.size(); index += 1) {
        const placed = flatMesh.geometries.get(index);
        const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
        const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const rawIndices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        const positions: number[] = []; const normals: number[] = [];
        for (let vertex = 0; vertex < vertices.length; vertex += 6) {
          const transformed = transformVertex([vertices[vertex], vertices[vertex + 1], vertices[vertex + 2]], placed.flatTransformation);
          positions.push(...transformed); allPositions.push(...transformed);
          normals.push(vertices[vertex + 3], vertices[vertex + 4], vertices[vertex + 5]);
        }
        const indices = Array.from(rawIndices); triangleCount += Math.floor(indices.length / 3);
        chunks.push({ positions, normals, indices, color: [placed.color.x, placed.color.y, placed.color.z, placed.color.w] });
        geometry.delete();
      }
      const line = safeRecord(api.GetLine(modelId, flatMesh.expressID, false));
      const bounds = boundsFromPositions(allPositions);
      const properties = serializable(line) as Record<string, unknown>;
      const ifcType = (api.GetNameFromTypeCode(Number(line.type ?? 0)) || "IFCBUILDINGELEMENT").toUpperCase();
      const name = value(line.Name); const ifcGuid = value(line.GlobalId); const code = value(line.Tag);
      const indices = chunks.flatMap((chunk) => chunk.indices);
      elements.push({ expressId: flatMesh.expressID, ifcGuid, ifcType, name, code, properties, quantities: calculatedQuantities(bounds, indices), chunks, bounds, centroid: [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2) as [number, number, number], fingerprint: elementFingerprint({ ifcType, name, bounds, properties }) });
    });
    const byExpressId = new Map(elements.map((element) => [element.expressId, element]));
    const walkSpatialTree = (node: SpatialNode, parentExpressId?: number, context: { building?: string; tower?: string; storey?: string; space?: string } = {}) => {
      const nodeType = String(node.type ?? "").toUpperCase();
      const nodeName = value(node.Name) ?? nodeType;
      const next = { ...context };
      if (nodeType === "IFCBUILDING") { next.building = nodeName; if (/torre|tower|bloco/i.test(nodeName)) next.tower = nodeName; }
      if (nodeType === "IFCBUILDINGSTOREY") next.storey = nodeName;
      if (nodeType === "IFCSPACE") next.space = nodeName;
      const element = byExpressId.get(node.expressID);
      if (element) Object.assign(element, next, { parentExpressId });
      for (const child of node.children ?? []) walkSpatialTree(child, node.expressID, next);
    };
    walkSpatialTree(spatialTree as SpatialNode);

    // Psets and materials are resolved separately from the geometry stream. Batches
    // keep large models bounded while retaining the native IFC provenance.
    for (let start = 0; start < elements.length; start += 40) {
      await Promise.all(elements.slice(start, start + 40).map(async (element) => {
        const [propertySets, materials] = await Promise.all([
          api.properties.getPropertySets(modelId, element.expressId, true).catch(() => []),
          api.properties.getMaterialsProperties(modelId, element.expressId, true).catch(() => []),
        ]);
        element.properties = { attributes: element.properties, propertySets: serializable(propertySets), materials: serializable(materials) };
        element.fingerprint = elementFingerprint({ ifcType: element.ifcType, name: element.name, bounds: element.bounds, properties: element.properties });
      }));
    }
    return { version: "REDE_BIM_GEOMETRY_V1", schema, units: "m", elements, bounds: mergeBounds(elements.map((item) => item.bounds)), triangleCount, spatialTree: serializable(spatialTree), processing: { durationMs: Math.round(performance.now() - started), sourceBytes: bytes.length, adapter: "web-ifc", adapterVersion: "0.0.77" } };
  } finally { api.CloseModel(modelId); api.Dispose(); }
}
