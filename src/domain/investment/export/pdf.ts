import { createHash } from "node:crypto";
import QRCode from "qrcode";
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { IntermediateDocumentModel, OrganizationBrandConfig } from "../types";
import type { MasterReportModel, MasterReportSection } from "../master-report";

const A4: [number, number] = [595.28, 841.89];
const LETTER: [number, number] = [612, 792];
const MARGIN = 48;
const CONTENT_TOP = 100;
const CONTENT_BOTTOM = 82;

export interface PdfRenderOptions {
  reportId?: string;
  reportVersion?: number;
  watermark?: "DRAFT" | "CONFIDENTIAL" | "FINAL";
  pageSize?: "A4" | "LETTER";
}

export interface RenderedPdf {
  bytes: Uint8Array;
  pageCount: number;
  checksum: string;
  checksumAlgorithm: "SHA-256";
}

interface RenderContext {
  pdf: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  brand: OrganizationBrandConfig;
  size: [number, number];
  sectionPages: { title: string; pageIndex: number }[];
  currentPage: PDFPage;
  y: number;
}

export async function renderDocumentPdf(
  model: IntermediateDocumentModel | MasterReportModel,
  brand: OrganizationBrandConfig,
  options: PdfRenderOptions = {},
): Promise<RenderedPdf> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(model.title);
  pdf.setSubject(model.subtitle);
  pdf.setAuthor(brand.organizationName);
  pdf.setCreator("REDE Intelligence Studio");
  pdf.setProducer("REDE Studio PDF Renderer v1");
  pdf.setCreationDate(new Date(model.generatedAt));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = options.pageSize === "LETTER" ? LETTER : A4;
  const cover = pdf.addPage(size);
  const context: RenderContext = { pdf, regular, bold, brand, size, sectionPages: [], currentPage: cover, y: size[1] - CONTENT_TOP };
  await drawCover(context, model, options);

  const tocPageCount = Math.max(1, Math.ceil(model.sections.length / 34));
  const tocPages = Array.from({ length: tocPageCount }, () => pdf.addPage(size));
  for (const section of model.sections) {
    const page = pdf.addPage(sectionOrientation(section) === "LANDSCAPE" ? [size[1], size[0]] : size);
    context.currentPage = page;
    context.y = page.getHeight() - CONTENT_TOP;
    context.sectionPages.push({ title: section.title, pageIndex: pdf.getPageCount() - 1 });
    drawSectionTitle(context, section.title, section.order);
    for (const block of section.blocks) drawBlock(context, block);
  }

  drawToc(context, tocPages);
  const reportId = options.reportId ?? ("reportId" in model ? model.reportId : `RI-${model.metadata.studyVersionId ?? "DOCUMENT"}`);
  drawHeadersAndFooters(context, model, reportId, options.watermark);
  addBookmarks(pdf, context.sectionPages);
  const bytes = await pdf.save({ useObjectStreams: false, addDefaultPage: false });
  return { bytes, pageCount: pdf.getPageCount(), checksum: createHash("sha256").update(bytes).digest("hex"), checksumAlgorithm: "SHA-256" };
}

async function drawCover(context: RenderContext, model: IntermediateDocumentModel | MasterReportModel, options: PdfRenderOptions) {
  const { currentPage: page, size, brand, bold, regular } = context;
  const primary = color(brand.primaryColor);
  page.drawRectangle({ x: 0, y: 0, width: size[0], height: size[1], color: primary });
  page.drawRectangle({ x: MARGIN, y: size[1] - 128, width: 44, height: 44, borderColor: color(brand.accentColor), borderWidth: 2 });
  page.drawText(safe(brand.monogram).slice(0, 3), { x: MARGIN + 8, y: size[1] - 102, size: 14, font: bold, color: rgb(1, 1, 1) });
  page.drawText("REDE INTELLIGENCE", { x: MARGIN + 58, y: size[1] - 100, size: 10, font: bold, color: rgb(1, 1, 1) });
  const titleLines = wrap(model.title.toUpperCase(), bold, 30, size[0] - MARGIN * 2);
  let y = size[1] - 300;
  titleLines.forEach((line) => { page.drawText(safe(line), { x: MARGIN, y, size: 30, font: bold, color: rgb(1, 1, 1) }); y -= 38; });
  page.drawText(safe(model.subtitle), { x: MARGIN, y: y - 10, size: 14, font: regular, color: rgb(0.82, 0.87, 0.86) });
  page.drawLine({ start: { x: MARGIN, y: y - 42 }, end: { x: size[0] - MARGIN, y: y - 42 }, thickness: 1, color: color(brand.accentColor) });
  const details = [
    `Snapshot: ${model.metadata.studyVersion ?? model.metadata.studyVersionId ?? "identificado no pacote"}`,
    `Cenário: ${model.metadata.scenario ?? "conforme seção"}`,
    `Data: ${new Date(model.generatedAt).toLocaleDateString("pt-BR")}`,
    `Confidencialidade: ${options.watermark ?? "CONFIDENTIAL"}`,
    ...(options.reportId ? [`Report ID: ${options.reportId}`] : []),
  ];
  details.forEach((line, index) => page.drawText(safe(line), { x: MARGIN, y: 190 - index * 20, size: 9, font: regular, color: rgb(0.84, 0.88, 0.88) }));
  if (options.reportId) {
    const snapshotChecksum = "auditMetadata" in model ? model.auditMetadata.snapshotChecksum.slice(0, 12) : "snapshot";
    const qrBytes = await QRCode.toBuffer(`${options.reportId}|${snapshotChecksum}`, { type: "png", width: 160, margin: 1, color: { dark: "#173D4FFF", light: "#FFFFFFFF" } });
    const qr = await context.pdf.embedPng(qrBytes);
    page.drawImage(qr, { x: size[0] - MARGIN - 62, y: 126, width: 62, height: 62 });
    page.drawText("VERIFICAÇÃO", { x: size[0] - MARGIN - 62, y: 113, size: 5.5, font: bold, color: rgb(0.72, 0.78, 0.78) });
  }
  page.drawText(safe(brand.footer), { x: MARGIN, y: 45, size: 8, font: regular, color: rgb(0.68, 0.76, 0.75) });
}

function drawToc(context: RenderContext, pages: PDFPage[]) {
  const { bold, regular, brand } = context;
  context.sectionPages.forEach((entry, index) => {
    const page = pages[Math.floor(index / 34)];
    const localIndex = index % 34;
    const y = page.getHeight() - 112 - localIndex * 19;
    if (localIndex === 0) {
      page.drawText("SUMÁRIO", { x: MARGIN, y: page.getHeight() - 72, size: 21, font: bold, color: color(brand.primaryColor) });
      page.drawLine({ start: { x: MARGIN, y: page.getHeight() - 84 }, end: { x: page.getWidth() - MARGIN, y: page.getHeight() - 84 }, color: color(brand.accentColor), thickness: 1 });
    }
    const title = `${String(index + 1).padStart(2, "0")}  ${safe(entry.title)}`;
    page.drawText(title.slice(0, 72), { x: MARGIN, y, size: 9, font: regular, color: rgb(0.16, 0.22, 0.23) });
    page.drawText(`${entry.pageIndex + 1}`, { x: page.getWidth() - MARGIN - 22, y, size: 9, font: bold, color: color(brand.primaryColor) });
    const annotation = context.pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [MARGIN, y - 3, page.getWidth() - MARGIN, y + 12], Border: [0, 0, 0], Dest: [context.pdf.getPage(entry.pageIndex).ref, PDFName.of("Fit")] });
    page.node.addAnnot(context.pdf.context.register(annotation));
  });
  if (!context.sectionPages.length) pages[0].drawText("Nenhuma seção selecionada.", { x: MARGIN, y: pages[0].getHeight() - 112, size: 10, font: regular });
  pages.forEach((page, index) => page.drawText(`Sumário ${index + 1}/${pages.length}`, { x: MARGIN, y: 36, size: 7, font: regular, color: rgb(0.45, 0.5, 0.5) }));
}

function drawSectionTitle(context: RenderContext, title: string, order: number) {
  const { currentPage: page, bold, brand } = context;
  page.drawText(String(order).padStart(2, "0"), { x: MARGIN, y: context.y + 6, size: 9, font: bold, color: color(brand.accentColor) });
  page.drawText(safe(title.toUpperCase()).slice(0, 85), { x: MARGIN + 30, y: context.y, size: 19, font: bold, color: color(brand.primaryColor) });
  context.y -= 34;
  page.drawLine({ start: { x: MARGIN, y: context.y + 12 }, end: { x: page.getWidth() - MARGIN, y: context.y + 12 }, thickness: 0.8, color: color(brand.accentColor) });
  context.y -= 14;
}

function drawBlock(context: RenderContext, block: IntermediateDocumentModel["sections"][number]["blocks"][number]) {
  if (block.type === "NARRATIVE") drawParagraph(context, block.narrative.text, 10, 15);
  if (block.type === "DISCLAIMER") drawDisclaimer(context, block.text);
  if (block.type === "METRICS") drawMetrics(context, block.metrics);
  if (block.type === "TABLE") drawTable(context, block.headers, block.rows);
  if (block.type === "CHART") drawChart(context, block.title, block.labels, block.values);
  if (block.type === "MASSING") drawMassing(context, block.current, block.proposed);
}

function drawParagraph(context: RenderContext, text: string, fontSize: number, leading: number) {
  const width = context.currentPage.getWidth() - MARGIN * 2;
  const lines = wrap(text, context.regular, fontSize, width);
  ensureSpace(context, lines.length * leading + 12);
  lines.forEach((line) => { context.currentPage.drawText(safe(line), { x: MARGIN, y: context.y, size: fontSize, font: context.regular, color: rgb(0.2, 0.25, 0.25) }); context.y -= leading; });
  context.y -= 10;
}

function drawDisclaimer(context: RenderContext, text: string) {
  const lines = wrap(text, context.regular, 8, context.currentPage.getWidth() - MARGIN * 2 - 24);
  ensureSpace(context, lines.length * 12 + 26);
  context.currentPage.drawRectangle({ x: MARGIN, y: context.y - lines.length * 12 - 12, width: context.currentPage.getWidth() - MARGIN * 2, height: lines.length * 12 + 22, color: rgb(0.95, 0.94, 0.91), borderColor: rgb(0.73, 0.62, 0.43), borderWidth: 0.6 });
  lines.forEach((line, index) => context.currentPage.drawText(safe(line), { x: MARGIN + 12, y: context.y - index * 12, size: 8, font: context.regular, color: rgb(0.28, 0.28, 0.25) }));
  context.y -= lines.length * 12 + 30;
}

function drawMetrics(context: RenderContext, metrics: Extract<IntermediateDocumentModel["sections"][number]["blocks"][number], { type: "METRICS" }>["metrics"]) {
  const pageWidth = context.currentPage.getWidth();
  const columns = pageWidth > 700 ? 4 : 3;
  const gap = 8;
  const cardWidth = (pageWidth - MARGIN * 2 - gap * (columns - 1)) / columns;
  const rows = Math.ceil(metrics.length / columns);
  ensureSpace(context, rows * 72 + 12);
  metrics.forEach((metric, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = MARGIN + col * (cardWidth + gap);
    const y = context.y - row * 72 - 58;
    context.currentPage.drawRectangle({ x, y, width: cardWidth, height: 60, color: rgb(0.96, 0.965, 0.95), borderColor: rgb(0.82, 0.83, 0.79), borderWidth: 0.5 });
    context.currentPage.drawText(safe(metric.label.toUpperCase()).slice(0, 26), { x: x + 9, y: y + 42, size: 6.8, font: context.bold, color: rgb(0.35, 0.42, 0.42) });
    context.currentPage.drawText(safe(metric.value).slice(0, 22), { x: x + 9, y: y + 20, size: metric.value.length > 18 ? 10 : 13, font: context.bold, color: color(context.brand.primaryColor) });
    context.currentPage.drawText(safe(metric.sourceVersion).slice(0, 32), { x: x + 9, y: y + 7, size: 5.5, font: context.regular, color: rgb(0.5, 0.53, 0.51) });
  });
  context.y -= rows * 72 + 12;
}

function drawTable(context: RenderContext, headers: string[], rows: string[][]) {
  const width = context.currentPage.getWidth() - MARGIN * 2;
  const columns = Math.max(1, headers.length);
  const columnWidth = width / columns;
  const rowHeight = 25;
  const headerHeight = 31;
  const drawHeader = () => {
    ensureSpace(context, headerHeight + rowHeight);
    context.currentPage.drawRectangle({ x: MARGIN, y: context.y - headerHeight + 5, width, height: headerHeight, color: color(context.brand.primaryColor) });
    headers.forEach((header, index) => {
      const lines = wrap(header, context.bold, 6.8, columnWidth - 10).slice(0, 2);
      lines.forEach((line, lineIndex) => context.currentPage.drawText(safe(line), { x: MARGIN + index * columnWidth + 5, y: context.y - 11 - lineIndex * 8, size: 6.8, font: context.bold, color: rgb(1, 1, 1) }));
    });
    context.y -= headerHeight;
  };
  drawHeader();
  rows.forEach((row, rowIndex) => {
    const wrapped = row.map((cell, index) => wrap(String(cell), index === 0 ? context.bold : context.regular, 6.5, columnWidth - 10).slice(0, 4));
    const dynamicHeight = Math.max(rowHeight, Math.max(...wrapped.map((lines) => lines.length), 1) * 8.5 + 11);
    if (context.y - dynamicHeight < CONTENT_BOTTOM) { newContinuationPage(context); drawHeader(); }
    if (rowIndex % 2 === 1) context.currentPage.drawRectangle({ x: MARGIN, y: context.y - dynamicHeight + 5, width, height: dynamicHeight, color: rgb(0.965, 0.965, 0.95) });
    wrapped.forEach((lines, index) => lines.forEach((line, lineIndex) => context.currentPage.drawText(safe(line), { x: MARGIN + index * columnWidth + 5, y: context.y - 11 - lineIndex * 8.5, size: 6.5, font: index === 0 ? context.bold : context.regular, color: rgb(0.2, 0.25, 0.25) })));
    context.y -= dynamicHeight;
  });
  context.y -= 14;
}

function drawChart(context: RenderContext, title: string, labels: string[], values: number[]) {
  ensureSpace(context, 250);
  const x = MARGIN;
  const y = context.y - 210;
  const width = context.currentPage.getWidth() - MARGIN * 2;
  const height = 180;
  context.currentPage.drawText(safe(title), { x, y: context.y - 4, size: 10, font: context.bold, color: color(context.brand.primaryColor) });
  context.currentPage.drawRectangle({ x, y, width, height, color: rgb(0.975, 0.975, 0.96), borderColor: rgb(0.82, 0.83, 0.8), borderWidth: 0.5 });
  const max = Math.max(...values.map(Math.abs), 1);
  const zeroY = y + height / 2;
  context.currentPage.drawLine({ start: { x: x + 16, y: zeroY }, end: { x: x + width - 12, y: zeroY }, thickness: 0.6, color: rgb(0.52, 0.55, 0.53) });
  const points = values.map((value, index) => ({ x: x + 18 + (index / Math.max(values.length - 1, 1)) * (width - 36), y: zeroY + (value / max) * (height / 2 - 22) }));
  points.slice(1).forEach((point, index) => context.currentPage.drawLine({ start: points[index], end: point, thickness: 1.6, color: color(context.brand.accentColor) }));
  points.forEach((point, index) => {
    context.currentPage.drawCircle({ x: point.x, y: point.y, size: 2.2, color: color(context.brand.primaryColor) });
    if (index % Math.max(1, Math.ceil(points.length / 8)) === 0) context.currentPage.drawText(safe(labels[index] ?? ""), { x: point.x - 8, y: y + 7, size: 5.5, font: context.regular, color: rgb(0.4, 0.43, 0.42) });
  });
  context.y -= 238;
}

function drawMassing(context: RenderContext, current: { x: number; y: number; width: number; depth: number; floors: number }[], proposed: { x: number; y: number; width: number; depth: number; floors: number }[]) {
  ensureSpace(context, 280);
  const width = context.currentPage.getWidth() - MARGIN * 2;
  const panelWidth = (width - 12) / 2;
  [["AS-IS", current], ["TO-BE", proposed]].forEach(([label, buildings], panel) => {
    const list = buildings as typeof current;
    const x = MARGIN + panel * (panelWidth + 12);
    const y = context.y - 230;
    context.currentPage.drawRectangle({ x, y, width: panelWidth, height: 220, color: rgb(0.94, 0.95, 0.93), borderColor: rgb(0.75, 0.78, 0.75), borderWidth: 0.6 });
    context.currentPage.drawText(label as string, { x: x + 10, y: y + 198, size: 8, font: context.bold, color: color(context.brand.primaryColor) });
    const maxX = Math.max(...list.map((item) => item.x + item.width), 1);
    const maxY = Math.max(...list.map((item) => item.y + item.depth), 1);
    list.slice(0, 20).forEach((item) => {
      const bx = x + 12 + (item.x / maxX) * (panelWidth - 38);
      const by = y + 18 + (item.y / maxY) * 130;
      const bw = Math.max(5, (item.width / maxX) * (panelWidth - 38));
      const bh = Math.max(5, (item.depth / maxY) * 130);
      const rise = Math.min(32, item.floors * 1.2);
      context.currentPage.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: panel === 0 ? rgb(0.55, 0.62, 0.61) : color(context.brand.primaryColor), opacity: 0.72 });
      context.currentPage.drawLine({ start: { x: bx, y: by + bh }, end: { x: bx + rise, y: by + bh + rise * 0.42 }, color: color(context.brand.accentColor), thickness: 0.8 });
      context.currentPage.drawLine({ start: { x: bx + bw, y: by + bh }, end: { x: bx + bw + rise, y: by + bh + rise * 0.42 }, color: color(context.brand.accentColor), thickness: 0.8 });
      context.currentPage.drawLine({ start: { x: bx + rise, y: by + bh + rise * 0.42 }, end: { x: bx + bw + rise, y: by + bh + rise * 0.42 }, color: color(context.brand.accentColor), thickness: 0.8 });
    });
    if (!list.length) context.currentPage.drawText("Visual 3D não congelado", { x: x + 22, y: y + 106, size: 9, font: context.regular, color: rgb(0.5, 0.5, 0.48) });
  });
  context.y -= 255;
}

function ensureSpace(context: RenderContext, required: number) {
  if (context.y - required >= CONTENT_BOTTOM) return;
  newContinuationPage(context);
}

function newContinuationPage(context: RenderContext) {
  const landscape = context.currentPage.getWidth() > context.currentPage.getHeight();
  context.currentPage = context.pdf.addPage(landscape ? [context.size[1], context.size[0]] : context.size);
  context.y = context.currentPage.getHeight() - CONTENT_TOP;
  context.currentPage.drawText("CONTINUAÇÃO", { x: MARGIN, y: context.y, size: 7, font: context.bold, color: color(context.brand.accentColor) });
  context.y -= 26;
}

function drawHeadersAndFooters(context: RenderContext, model: IntermediateDocumentModel | MasterReportModel, reportId: string, watermark?: string) {
  const pages = context.pdf.getPages();
  pages.forEach((page, index) => {
    if (index > 0) {
      page.drawText("REDE INTELLIGENCE", { x: MARGIN, y: page.getHeight() - 28, size: 6.5, font: context.bold, color: color(context.brand.primaryColor) });
      page.drawText(safe(model.subtitle).slice(0, 68), { x: MARGIN + 102, y: page.getHeight() - 28, size: 6.5, font: context.regular, color: rgb(0.4, 0.45, 0.44) });
      page.drawText(safe(model.metadata.studyVersion ?? model.metadata.studyVersionId ?? "snapshot"), { x: page.getWidth() - MARGIN - 72, y: page.getHeight() - 28, size: 6.5, font: context.regular, color: rgb(0.4, 0.45, 0.44) });
    }
    page.drawLine({ start: { x: MARGIN, y: 35 }, end: { x: page.getWidth() - MARGIN, y: 35 }, thickness: 0.4, color: rgb(0.75, 0.77, 0.74) });
    page.drawText(`${safe(reportId)} · ${new Date(model.generatedAt).toLocaleDateString("pt-BR")}`, { x: MARGIN, y: 20, size: 6.2, font: context.regular, color: rgb(0.4, 0.44, 0.43) });
    page.drawText(`${index + 1} / ${pages.length}`, { x: page.getWidth() - MARGIN - 30, y: 20, size: 6.2, font: context.bold, color: rgb(0.3, 0.35, 0.34) });
    if (watermark && watermark !== "FINAL" && index > 0) page.drawText(watermark, { x: page.getWidth() / 2 - 90, y: page.getHeight() / 2, size: 42, rotate: degrees(35), font: context.bold, color: rgb(0.77, 0.78, 0.75), opacity: 0.12 });
  });
}

function addBookmarks(pdf: PDFDocument, entries: { title: string; pageIndex: number }[]) {
  if (!entries.length) return;
  const context = pdf.context;
  const outlineRef = context.nextRef();
  const itemRefs = entries.map(() => context.nextRef());
  entries.forEach((entry, index) => {
    const dict = context.obj({
      Title: PDFHexString.fromText(entry.title),
      Parent: outlineRef,
      ...(index > 0 ? { Prev: itemRefs[index - 1] } : {}),
      ...(index < entries.length - 1 ? { Next: itemRefs[index + 1] } : {}),
      Dest: [pdf.getPage(entry.pageIndex).ref, PDFName.of("Fit")],
    });
    context.assign(itemRefs[index], dict);
  });
  context.assign(outlineRef, context.obj({ Type: "Outlines", First: itemRefs[0], Last: itemRefs.at(-1), Count: entries.length }));
  pdf.catalog.set(PDFName.of("Outlines"), outlineRef);
  pdf.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}

function sectionOrientation(section: IntermediateDocumentModel["sections"][number]): "PORTRAIT" | "LANDSCAPE" {
  return "renderingOptions" in section ? (section as MasterReportSection).renderingOptions.orientation : section.blocks.some((block) => block.type === "TABLE" && block.headers.length > 7) ? "LANDSCAPE" : "PORTRAIT";
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safe(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  words.flatMap((word) => splitToken(word, font, size, maxWidth)).forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else { if (line) lines.push(line); line = word; }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function splitToken(token: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(token, size) <= maxWidth) return [token];
  const chunks: string[] = [];
  let chunk = "";
  for (const character of token) {
    const candidate = `${chunk}${character}`;
    if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) { chunks.push(chunk); chunk = character; }
    else chunk = candidate;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function safe(value: string): string {
  return value.replace(/→/g, "->").replace(/×/g, "x").replace(/[–—]/g, "-").replace(/✓/g, "OK").replace(/•/g, "-").replace(/[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF]/g, "?");
}

function color(hex: string) {
  const normalized = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return rgb(parseInt(normalized.slice(0, 2), 16) / 255, parseInt(normalized.slice(2, 4), 16) / 255, parseInt(normalized.slice(4, 6), 16) / 255);
}
