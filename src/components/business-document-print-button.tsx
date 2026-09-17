"use client";

import { Printer } from "lucide-react";

type PrintField = { label: string; value: string | number | null | undefined };
type PrintColumn = { key: string; label: string; align?: "left" | "right" };
type PrintRow = Record<string, string | number | null | undefined>;

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

export function BusinessDocumentPrintButton({
  title,
  documentNumber,
  subtitle,
  fields,
  columns = [],
  rows = [],
  totalLabel,
  totalValue,
  label = "Imprimir",
}: {
  title: string;
  documentNumber?: string | null;
  subtitle?: string | null;
  fields: PrintField[];
  columns?: PrintColumn[];
  rows?: PrintRow[];
  totalLabel?: string;
  totalValue?: string;
  label?: string;
}) {
  const print = () => {
    const popup = window.open("", "_blank", "noopener,noreferrer,width=980,height=760");
    if (!popup) return;
    const fieldHtml = fields.filter((field) => field.value !== null && field.value !== undefined && field.value !== "").map((field) => `<div class="field"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(field.value)}</strong></div>`).join("");
    const tableHtml = columns.length && rows.length ? `<table><thead><tr>${columns.map((column) => `<th class="${column.align === "right" ? "right" : ""}">${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td class="${column.align === "right" ? "right" : ""}">${escapeHtml(row[column.key])}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "";
    const totalHtml = totalValue ? `<div class="total"><span>${escapeHtml(totalLabel ?? "Total")}</span><strong>${escapeHtml(totalValue)}</strong></div>` : "";
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)} ${escapeHtml(documentNumber)}</title><style>
      *{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#172033;margin:0;background:#fff}.page{max-width:920px;margin:0 auto;padding:38px 44px}.header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #18283f;padding-bottom:18px;margin-bottom:24px}.brand{font-weight:800;letter-spacing:.08em;color:#18283f}.brand small{display:block;font-size:10px;letter-spacing:.16em;color:#9a7b4f;margin-top:4px}.doc{text-align:right}.doc h1{font-size:22px;margin:0}.doc p{margin:6px 0 0;color:#667085;font-size:12px}.number{font-size:13px;font-weight:700;margin-top:8px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px;margin:20px 0 26px}.field{border-bottom:1px solid #e5e7eb;padding:0 0 8px}.field span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#667085;margin-bottom:4px}.field strong{font-size:13px;font-weight:600}table{width:100%;border-collapse:collapse;margin-top:18px;font-size:12px}th{background:#f5f7fa;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#475467;padding:9px;border-bottom:1px solid #d0d5dd}td{padding:10px 9px;border-bottom:1px solid #eaecf0;vertical-align:top}.right{text-align:right}.total{display:flex;justify-content:flex-end;align-items:baseline;gap:22px;margin-top:18px;padding-top:14px;border-top:2px solid #18283f}.total span{font-size:12px;text-transform:uppercase;letter-spacing:.08em}.total strong{font-size:18px}.footer{margin-top:38px;padding-top:14px;border-top:1px solid #eaecf0;color:#98a2b3;font-size:10px;display:flex;justify-content:space-between}@media print{.page{padding:24px 28px}@page{size:A4;margin:12mm}}
    </style></head><body><div class="page"><div class="header"><div><div class="brand">REDE INTELLIGENCE<small>INTELIGÊNCIA DE DECISÃO IMOBILIÁRIA</small></div></div><div class="doc"><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}${documentNumber ? `<div class="number">${escapeHtml(documentNumber)}</div>` : ""}</div></div><div class="fields">${fieldHtml}</div>${tableHtml}${totalHtml}<div class="footer"><span>Documento gerado pela REDE Intelligence</span><span>${escapeHtml(new Date().toLocaleString("pt-BR"))}</span></div></div><script>window.addEventListener('load',()=>{window.print();});</script></body></html>`);
    popup.document.close();
  };

  return <button type="button" className="button button-secondary" onClick={print}><Printer size={14} /> {label}</button>;
}
