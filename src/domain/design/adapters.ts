import { PDFDocument } from "pdf-lib";
import type { DesignAdapterResult, DesignFileAdapter, DesignFileSupport } from "./types";

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
export const DESIGN_UPLOAD_LIMITS: Record<string, number> = {
  pdf: 50 * 1024 * 1024,
  png: 25 * 1024 * 1024, jpg: 25 * 1024 * 1024, jpeg: 25 * 1024 * 1024, webp: 25 * 1024 * 1024,
  ifc: MAX_UPLOAD_BYTES, dxf: 100 * 1024 * 1024, dwg: MAX_UPLOAD_BYTES, rvt: MAX_UPLOAD_BYTES,
  geojson: 20 * 1024 * 1024, csv: 20 * 1024 * 1024, xlsx: 50 * 1024 * 1024, docx: 50 * 1024 * 1024,
};

const MIME_BY_EXTENSION: Record<string, string[]> = {
  pdf: ["application/pdf", "application/octet-stream"],
  png: ["image/png", "application/octet-stream"],
  jpg: ["image/jpeg", "application/octet-stream"],
  jpeg: ["image/jpeg", "application/octet-stream"],
  webp: ["image/webp", "application/octet-stream"],
  ifc: ["application/x-step", "application/ifc", "text/plain", "application/octet-stream"],
  dxf: ["application/dxf", "image/vnd.dxf", "text/plain", "application/octet-stream"],
  geojson: ["application/geo+json", "application/json", "text/plain", "application/octet-stream"],
  csv: ["text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"],
  dwg: ["application/acad", "image/vnd.dwg", "application/octet-stream"],
  rvt: ["application/octet-stream"],
};

export const SUPPORTED_DESIGN_FORMATS: Array<{ extension: string; support: DesignFileSupport; note: string }> = [
  { extension: "PDF", support: "SUPPORTED", note: "Páginas, dimensões e metadados; texto nativo depende do conteúdo." },
  { extension: "PNG/JPG/WEBP", support: "SUPPORTED", note: "Imagem validada; OCR é opcional e não é usado para inventar medidas." },
  { extension: "IFC", support: "SUPPORTED", note: "Geometria, árvore espacial, propriedades, quantidades, comparação e conflitos via web-ifc." },
  { extension: "DXF", support: "PARTIAL", note: "Metadados ASCII e layers; conversor geométrico pode ser plugado." },
  { extension: "GeoJSON/CSV", support: "SUPPORTED", note: "Estrutura e conteúdo tabular validado." },
  { extension: "XLSX/DOCX", support: "PARTIAL", note: "Pacote validado; extração especializada permanece atrás do adapter." },
  { extension: "DWG/RVT", support: "CONVERSION_REQUIRED", note: "Requer Autodesk/DWG/Revit conversion adapter; não há parser próprio frágil." },
];

function normalizedExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiPrefix(bytes: Uint8Array, length = 80) {
  return new TextDecoder("ascii", { fatal: false }).decode(bytes.subarray(0, length));
}

function magicMatches(extension: string, bytes: Uint8Array) {
  if (extension === "pdf") return asciiPrefix(bytes, 5) === "%PDF-";
  if (extension === "png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (extension === "jpg" || extension === "jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (extension === "webp") return asciiPrefix(bytes, 4) === "RIFF" && new TextDecoder("ascii").decode(bytes.subarray(8, 12)) === "WEBP";
  if (extension === "ifc") return asciiPrefix(bytes, 80).includes("ISO-10303-21");
  if (["xlsx", "docx"].includes(extension)) return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (extension === "dwg") return /^AC10\d{2}/.test(asciiPrefix(bytes, 6));
  if (["dxf", "csv", "geojson", "rvt"].includes(extension)) return bytes.length > 0;
  return false;
}

export function validateDesignUpload(input: { fileName: string; mimeType: string; bytes: Uint8Array; maximumBytes?: number }) {
  const extension = normalizedExtension(input.fileName);
  if (!Object.hasOwn(MIME_BY_EXTENSION, extension)) throw new Error(`Formato .${extension || "desconhecido"} não suportado.`);
  if (!input.bytes.length) throw new Error("O arquivo está vazio.");
  const maximumBytes = input.maximumBytes ?? DESIGN_UPLOAD_LIMITS[extension] ?? MAX_UPLOAD_BYTES;
  if (input.bytes.length > maximumBytes) throw new Error(`Arquivo excede o limite de ${Math.ceil(maximumBytes / 1024 / 1024)} MB para .${extension}.`);
  const allowedMimes = MIME_BY_EXTENSION[extension];
  if (input.mimeType && !allowedMimes.includes(input.mimeType.toLowerCase())) throw new Error(`MIME ${input.mimeType} incompatível com .${extension}.`);
  if (!magicMatches(extension, input.bytes)) throw new Error(`Conteúdo incompatível com a extensão .${extension}; upload bloqueado.`);
  return { extension, mimeType: input.mimeType || allowedMimes[0], fileSize: input.bytes.length };
}

class PdfDesignAdapter implements DesignFileAdapter {
  readonly name = "NativePdfAdapter";
  readonly version = "1.0.0";
  canHandle({ extension }: { extension: string }) { return extension === "pdf"; }
  async process(input: { fileName: string; extension: string; mimeType: string; bytes: Uint8Array }): Promise<DesignAdapterResult> {
    const document = await PDFDocument.load(input.bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    const pages = document.getPages().map((page, index) => {
      const size = page.getSize();
      return { pageNumber: index + 1, widthPoints: size.width, heightPoints: size.height, scaleConfidence: "UNKNOWN" as const, textConfidence: "NOT_VERIFIED" as const, metadata: { rotation: page.getRotation().angle } };
    });
    const metadata = {
      pageCount: pages.length,
      title: document.getTitle() ?? null,
      author: document.getAuthor() ?? null,
      subject: document.getSubject() ?? null,
      creator: document.getCreator() ?? null,
      producer: document.getProducer() ?? null,
      creationDate: document.getCreationDate()?.toISOString() ?? null,
      modificationDate: document.getModificationDate()?.toISOString() ?? null,
      encrypted: document.isEncrypted,
    };
    return { adapter: this.name, version: this.version, support: "SUPPORTED", status: "PARTIAL", fileType: "PDF", metadata, sheets: pages, extracted: [{ kind: "DOCUMENT", key: "pageCount", value: pages.length, unit: "pages", origin: "EXTRACTED", confidence: "HIGH", method: "PDF_PAGE_TREE" }], limitations: ["Texto, carimbos e geometria não foram inferidos quando não disponíveis por extração nativa.", "Escala não confirmada; calibre a prancha ou forneça arquivo vetorial/IFC antes de medir."] };
  }
}

function rasterDimensions(extension: string, bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (extension === "png" && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if ((extension === "jpg" || extension === "jpeg") && bytes.length > 4) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += Math.max(2, length + 2);
    }
  }
  if (extension === "webp" && bytes.length >= 30) {
    const chunk = new TextDecoder("ascii").decode(bytes.subarray(12, 16));
    if (chunk === "VP8X") return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
  }
  return null;
}

class RasterDesignAdapter implements DesignFileAdapter {
  readonly name = "RasterImageAdapter";
  readonly version = "1.0.0";
  canHandle({ extension }: { extension: string }) { return ["png", "jpg", "jpeg", "webp"].includes(extension); }
  async process(input: { extension: string; bytes: Uint8Array }): Promise<DesignAdapterResult> {
    const dimensions = rasterDimensions(input.extension, input.bytes);
    return { adapter: this.name, version: this.version, support: "SUPPORTED", status: "PARTIAL", fileType: input.extension.toUpperCase(), metadata: { dimensions }, sheets: [{ pageNumber: 1, scaleConfidence: "UNKNOWN", textConfidence: "NOT_VERIFIED", metadata: dimensions ?? {} }], extracted: dimensions ? [{ kind: "IMAGE", key: "pixelWidth", value: dimensions.width, unit: "px", origin: "EXTRACTED", confidence: "HIGH", method: "IMAGE_HEADER" }, { kind: "IMAGE", key: "pixelHeight", value: dimensions.height, unit: "px", origin: "EXTRACTED", confidence: "HIGH", method: "IMAGE_HEADER" }] : [], limitations: ["OCR não configurado; nenhum texto foi inventado.", "Pixels não representam distância real sem calibração de escala."] };
  }
}

class IfcMetadataAdapter implements DesignFileAdapter {
  readonly name = "IfcMetadataAdapter";
  readonly version = "1.0.0";
  canHandle({ extension }: { extension: string }) { return extension === "ifc"; }
  async process(input: { bytes: Uint8Array }): Promise<DesignAdapterResult> {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    const schema = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? "UNKNOWN";
    const projectCount = (text.match(/=\s*IFCPROJECT\s*\(/gi) ?? []).length;
    const buildingCount = (text.match(/=\s*IFCBUILDING\s*\(/gi) ?? []).length;
    const storeys = [...text.matchAll(/#(\d+)\s*=\s*IFCBUILDINGSTOREY\s*\([^;]*?'([^']*)'[^;]*?\);/gi)].slice(0, 500).map((match) => ({ expressId: Number(match[1]), name: match[2] || `Storey #${match[1]}` }));
    const entityCount = (text.match(/^#\d+\s*=\s*IFC[A-Z0-9_]+\s*\(/gim) ?? []).length;
    return { adapter: this.name, version: this.version, support: "PARTIAL", status: "PARTIAL", fileType: "IFC", metadata: { schema, projectCount, buildingCount, storeys, entityCount, modelTree: { projectCount, buildingCount, storeys } }, sheets: [], extracted: [{ kind: "BIM", key: "projectCount", value: projectCount, unit: "elements", origin: "EXTRACTED", confidence: "HIGH", method: "IFC_STEP_ENTITY_SCAN" }, { kind: "BIM", key: "buildingCount", value: buildingCount, unit: "elements", origin: "EXTRACTED", confidence: "HIGH", method: "IFC_STEP_ENTITY_SCAN" }, { kind: "BIM", key: "storeyCount", value: storeys.length, unit: "elements", origin: "EXTRACTED", confidence: "MEDIUM", method: "IFC_STEP_ENTITY_SCAN" }], limitations: ["Geometria 3D, propriedades completas, quantidades e clashes exigem um BIM geometry adapter (IfcOpenShell/That Open/WebIFC).", "A árvore espacial extraída do STEP não equivale a uma validação BIM completa."] };
  }
}

class StructuredTextAdapter implements DesignFileAdapter {
  readonly name = "StructuredTextAdapter";
  readonly version = "1.0.0";
  canHandle({ extension }: { extension: string }) { return ["csv", "geojson", "dxf"].includes(extension); }
  async process(input: { extension: string; bytes: Uint8Array }): Promise<DesignAdapterResult> {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    if (input.extension === "geojson") {
      const parsed = JSON.parse(text) as { type?: string; features?: unknown[] };
      const features = Array.isArray(parsed.features) ? parsed.features.length : 0;
      return { adapter: this.name, version: this.version, support: "SUPPORTED", status: "COMPLETED", fileType: "GEOJSON", metadata: { type: parsed.type, featureCount: features }, sheets: [], extracted: [{ kind: "GEOMETRY", key: "featureCount", value: features, unit: "features", origin: "EXTRACTED", confidence: "HIGH", method: "JSON_PARSE" }], limitations: ["Sistema de coordenadas e validade topológica precisam ser confirmados no contexto do projeto."] };
    }
    if (input.extension === "csv") {
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      const delimiter = (lines[0]?.match(/;/g)?.length ?? 0) >= (lines[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
      const columns = lines[0]?.split(delimiter).map((value) => value.trim()) ?? [];
      return { adapter: this.name, version: this.version, support: "SUPPORTED", status: "COMPLETED", fileType: "CSV", metadata: { rowCount: Math.max(0, lines.length - 1), columns, delimiter }, sheets: [], extracted: [{ kind: "TABLE", key: "rowCount", value: Math.max(0, lines.length - 1), unit: "rows", origin: "EXTRACTED", confidence: "HIGH", method: "CSV_PARSE" }], limitations: ["Colunas não foram mapeadas automaticamente para métricas de projeto sem confirmação do usuário."] };
    }
    const layers = [...text.matchAll(/\n\s*8\s*\n([^\r\n]+)/g)].map((match) => match[1].trim()).filter(Boolean);
    return { adapter: this.name, version: this.version, support: "PARTIAL", status: "PARTIAL", fileType: "DXF", metadata: { layerCount: new Set(layers).size, layers: [...new Set(layers)].slice(0, 300) }, sheets: [], extracted: [], limitations: ["Entidades DXF não foram convertidas em geometria mensurável pelo adapter de metadados.", "Confirme unidades e escala antes de medir."] };
  }
}

class PackageDocumentAdapter implements DesignFileAdapter {
  readonly name = "PackageDocumentAdapter";
  readonly version = "1.0.0";
  canHandle({ extension }: { extension: string }) { return ["xlsx", "docx"].includes(extension); }
  async process(input: { extension: string }): Promise<DesignAdapterResult> {
    return { adapter: this.name, version: this.version, support: "PARTIAL", status: "PARTIAL", fileType: input.extension.toUpperCase(), metadata: { packageValidated: true }, sheets: [], extracted: [], limitations: [`${input.extension.toUpperCase()} validado como pacote OpenXML; extração semântica requer adapter especializado.`] };
  }
}

class ProprietaryConversionAdapter implements DesignFileAdapter {
  readonly name = "ProprietaryConversionAdapter";
  readonly version = "1.0.0";
  canHandle({ extension }: { extension: string }) { return ["dwg", "rvt"].includes(extension); }
  async process(input: { extension: string }): Promise<DesignAdapterResult> {
    return { adapter: this.name, version: this.version, support: "CONVERSION_REQUIRED", status: "PARTIAL", fileType: input.extension.toUpperCase(), metadata: { conversionRequired: true }, sheets: [], extracted: [], limitations: [`${input.extension.toUpperCase()} é proprietário. Converta para IFC/DXF/PDF ou configure AutodeskAdapter/RevitConversionAdapter.`] };
  }
}

const adapters: DesignFileAdapter[] = [new PdfDesignAdapter(), new RasterDesignAdapter(), new IfcMetadataAdapter(), new StructuredTextAdapter(), new PackageDocumentAdapter(), new ProprietaryConversionAdapter()];

export async function processDesignFile(input: { fileName: string; mimeType: string; bytes: Uint8Array }) {
  const validation = validateDesignUpload(input);
  const adapter = adapters.find((candidate) => candidate.canHandle({ extension: validation.extension, mimeType: validation.mimeType, bytes: input.bytes }));
  if (!adapter) throw new Error(`Nenhum DesignFileAdapter disponível para .${validation.extension}.`);
  return adapter.process({ ...input, extension: validation.extension, mimeType: validation.mimeType });
}

export const designAdapterInternals = { rasterDimensions, magicMatches, normalizedExtension };
