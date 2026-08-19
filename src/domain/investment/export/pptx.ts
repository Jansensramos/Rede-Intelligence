import { createHash } from "node:crypto";
import PptxGenJS from "pptxgenjs";
import type { IntermediateDocumentModel, OrganizationBrandConfig } from "../types";

export interface RenderedPptx {
  bytes: Uint8Array;
  slideCount: number;
  checksum: string;
  checksumAlgorithm: "SHA-256";
}

export async function renderDocumentPptx(model: IntermediateDocumentModel, brand: OrganizationBrandConfig): Promise<RenderedPptx> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = brand.organizationName;
  pptx.company = brand.organizationName;
  pptx.subject = model.subtitle;
  pptx.title = model.title;
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
  };
  const cover = pptx.addSlide();
  cover.background = { color: hex(brand.primaryColor) };
  cover.addShape(pptx.ShapeType.line, { x: 0.8, y: 1.45, w: 1.2, h: 0, line: { color: hex(brand.accentColor), width: 3 } });
  cover.addText("REDE INTELLIGENCE", { x: 0.8, y: 0.55, w: 4.6, h: 0.35, fontFace: "Aptos", fontSize: 12, bold: true, color: "FFFFFF", charSpacing: 2.2, margin: 0 });
  cover.addText(model.title, { x: 0.8, y: 1.75, w: 10.7, h: 1.55, fontFace: "Aptos Display", fontSize: 34, bold: true, color: "FFFFFF", breakLine: false, margin: 0, valign: "middle", fit: "shrink" });
  cover.addText(model.subtitle, { x: 0.8, y: 3.52, w: 9.8, h: 0.55, fontSize: 18, color: "D6E1E0", margin: 0 });
  cover.addText(`Snapshot ${model.metadata.studyVersion ?? model.metadata.studyVersionId} · ${new Date(model.generatedAt).toLocaleDateString("pt-BR")}`, { x: 0.8, y: 6.72, w: 8.6, h: 0.25, fontSize: 9, color: "B9C9C6", margin: 0 });

  model.sections.forEach((section, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: "F5F4EF" };
    slide.addText(String(index + 1).padStart(2, "0"), { x: 0.62, y: 0.48, w: 0.45, h: 0.28, fontSize: 10, bold: true, color: hex(brand.accentColor), margin: 0 });
    slide.addText(section.title, { x: 1.08, y: 0.38, w: 10.8, h: 0.58, fontFace: "Aptos Display", fontSize: 25, bold: true, color: hex(brand.primaryColor), margin: 0, breakLine: false, fit: "shrink" });
    slide.addShape(pptx.ShapeType.line, { x: 0.62, y: 1.08, w: 12.0, h: 0, line: { color: hex(brand.accentColor), width: 1 } });
    let y = 1.35;
    section.blocks.slice(0, 3).forEach((block) => {
      if (block.type === "NARRATIVE") {
        slide.addText(block.narrative.text, { x: 0.72, y, w: 11.7, h: 1.3, fontSize: 17, color: "263435", margin: 0.05, breakLine: false, fit: "shrink", valign: "top" });
        y += 1.55;
      }
      if (block.type === "DISCLAIMER") {
        slide.addShape(pptx.ShapeType.rect, { x: 0.72, y, w: 11.7, h: 1.0, fill: { color: "EDE9DE" }, line: { color: hex(brand.accentColor), width: 1 } });
        slide.addText(block.text, { x: 0.92, y: y + 0.16, w: 11.25, h: 0.65, fontSize: 10, color: "514B40", margin: 0, fit: "shrink" });
        y += 1.2;
      }
      if (block.type === "METRICS") {
        const items = block.metrics.slice(0, 8);
        const columns = 4;
        items.forEach((metric, metricIndex) => {
          const column = metricIndex % columns;
          const row = Math.floor(metricIndex / columns);
          const x = 0.72 + column * 3.0;
          const metricY = y + row * 1.55;
          slide.addText(metric.label.toUpperCase(), { x, y: metricY, w: 2.7, h: 0.24, fontSize: 8, bold: true, color: "607071", margin: 0, breakLine: false, fit: "shrink" });
          slide.addText(metric.value, { x, y: metricY + 0.3, w: 2.7, h: 0.62, fontSize: 22, bold: true, color: hex(brand.primaryColor), margin: 0, breakLine: false, fit: "shrink" });
          slide.addText(metric.sourceVersion, { x, y: metricY + 0.98, w: 2.7, h: 0.2, fontSize: 6.5, color: "7C8582", margin: 0, breakLine: false, fit: "shrink" });
        });
        y += Math.ceil(items.length / columns) * 1.55 + 0.2;
      }
      if (block.type === "TABLE") {
        const tableRows = [block.headers, ...block.rows.slice(0, 10)].map((row) => row.map((text) => ({ text })));
        slide.addTable(tableRows, { x: 0.72, y, w: 11.7, h: Math.min(4.7, tableRows.length * 0.38), border: { type: "solid", color: "CCD1CD", pt: 0.5 }, color: "263435", fontSize: 9, margin: 0.06, fill: { color: "F9F8F4" }, bold: false, rowH: 0.34 });
        y += Math.min(4.9, tableRows.length * 0.4);
      }
      if (block.type === "CHART") {
        const chartData = [{ name: block.title, labels: block.labels, values: block.values }];
        slide.addChart(pptx.ChartType.line, chartData, { x: 0.72, y, w: 11.7, h: 4.8, showLegend: false, showTitle: false, showValue: false, chartColors: [hex(brand.accentColor)], catAxisLabelFontSize: 8, valAxisLabelFontSize: 8, showValAxisTitle: false, showCatAxisTitle: false });
        y += 5.0;
      }
      if (block.type === "MASSING") {
        const groups = [{ label: "AS-IS", items: block.current }, { label: "TO-BE", items: block.proposed }];
        groups.forEach((group, groupIndex) => {
          const panelX = 0.72 + groupIndex * 6.0;
          slide.addText(group.label, { x: panelX, y, w: 1.2, h: 0.3, fontSize: 11, bold: true, color: hex(brand.primaryColor), margin: 0 });
          slide.addShape(pptx.ShapeType.rect, { x: panelX, y: y + 0.42, w: 5.7, h: 3.9, fill: { color: "E9ECE7" }, line: { color: "C4CAC5", width: 0.8 } });
          const maxX = Math.max(...group.items.map((item) => item.x + item.width), 1);
          const maxY = Math.max(...group.items.map((item) => item.y + item.depth), 1);
          group.items.slice(0, 18).forEach((item) => slide.addShape(pptx.ShapeType.rect, { x: panelX + 0.2 + (item.x / maxX) * 4.8, y: y + 0.75 + (item.y / maxY) * 2.8, w: Math.max(0.08, (item.width / maxX) * 4.8), h: Math.max(0.08, (item.depth / maxY) * 2.8), fill: { color: groupIndex ? hex(brand.primaryColor) : "789194", transparency: 18 }, line: { color: hex(brand.accentColor), width: 0.4 } }));
          if (!group.items.length) slide.addText("Visual 3D não congelado", { x: panelX + 1.4, y: y + 2.2, w: 3.0, h: 0.3, fontSize: 12, color: "79817E", align: "center", margin: 0 });
        });
        y += 4.6;
      }
    });
    slide.addText(`REDE Intelligence · ${model.metadata.studyVersion ?? "snapshot"}`, { x: 0.62, y: 7.18, w: 7.2, h: 0.16, fontSize: 6.5, color: "667370", margin: 0 });
    slide.addText(`${index + 2} / ${model.sections.length + 1}`, { x: 11.7, y: 7.18, w: 0.75, h: 0.16, fontSize: 6.5, bold: true, color: "667370", align: "right", margin: 0 });
    slide.addNotes(`[Sources]\n${section.blocks.flatMap((block) => block.type === "NARRATIVE" ? block.narrative.evidenceRefs.map((item) => item.ref) : block.type === "METRICS" ? block.metrics.map((item) => item.sourceRef) : "evidenceRefs" in block ? block.evidenceRefs : []).join("\n")}`);
  });
  const raw = await pptx.write({ outputType: "nodebuffer" });
  const bytes = raw instanceof Uint8Array ? new Uint8Array(raw) : new Uint8Array(raw as ArrayBuffer);
  return { bytes, slideCount: model.sections.length + 1, checksum: createHash("sha256").update(bytes).digest("hex"), checksumAlgorithm: "SHA-256" };
}

function hex(value: string): string {
  return value.replace("#", "").toUpperCase();
}
