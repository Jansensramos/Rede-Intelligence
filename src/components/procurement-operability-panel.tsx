"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FilePlus2, ShoppingCart, Workflow } from "lucide-react";
import type { ProcurementWorkspaceView } from "@/application/procurement/procurement-service";
import {
  createProcurementNeedAction,
  createPurchaseRequisitionAction,
  createQuotationProcessAction,
  transitionPurchaseRequisitionAction,
  validateProcurementNeedAction,
} from "@/app/actions/procurement";

type FormKey = "need" | "requisition" | "quotation" | null;

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function ProcurementOperabilityPanel({ workspace }: { workspace: ProcurementWorkspaceView }) {
  const router = useRouter();
  const [form, setForm] = useState<FormKey>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedNeedIds, setSelectedNeedIds] = useState<string[]>([]);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);

  const validatedNeeds = useMemo(() => workspace.needs.filter((item) => item.status === "VALIDATED"), [workspace.needs]);
  const requisitionsForQuotation = useMemo(() => workspace.requisitions.filter((item) => ["APPROVED_FOR_QUOTATION", "IN_QUOTATION"].includes(item.status)), [workspace.requisitions]);
  const requisitionsToAdvance = useMemo(() => workspace.requisitions.filter((item) => ["DRAFT", "REQUESTED", "IN_APPROVAL"].includes(item.status)), [workspace.requisitions]);

  async function run<T>(operation: () => Promise<ActionResult<T>>, success: string) {
    setBusy(true);
    setFeedback(null);
    const result = await operation();
    setBusy(false);
    if (!result.ok) {
      setFeedback(result.error);
      return false;
    }
    setFeedback(success);
    setForm(null);
    router.refresh();
    return true;
  }

  async function submitNeed(data: FormData) {
    await run(() => createProcurementNeedAction({
      projectId: workspace.projectId,
      code: String(data.get("code")),
      description: String(data.get("description")),
      specification: String(data.get("specification")),
      quantity: String(data.get("quantity")),
      unit: String(data.get("unit")),
      requiredAt: new Date(`${data.get("requiredAt")}T00:00:00.000Z`),
      expectedLeadDays: Number(data.get("expectedLeadDays") || 30),
      bufferDays: Number(data.get("bufferDays") || 7),
      priority: String(data.get("priority") || "NORMAL") as "LOW" | "NORMAL" | "HIGH" | "CRITICAL",
      origin: "MANUAL",
    }), "Necessidade de compra registrada.");
  }

  async function submitRequisition(data: FormData) {
    if (selectedNeedIds.length === 0) {
      setFeedback("Selecione ao menos uma necessidade validada.");
      return;
    }
    const ok = await run(() => createPurchaseRequisitionAction({
      projectId: workspace.projectId,
      number: String(data.get("number")),
      title: String(data.get("title")),
      justification: String(data.get("justification") || "") || null,
      needIds: selectedNeedIds,
    }), "Requisição criada em rascunho.");
    if (ok) setSelectedNeedIds([]);
  }

  async function submitQuotation(data: FormData) {
    if (selectedSupplierIds.length === 0) {
      setFeedback("Selecione ao menos um fornecedor ativo.");
      return;
    }
    const requisitionId = String(data.get("requisitionId"));
    if (!requisitionId) {
      setFeedback("Selecione uma requisição aprovada para cotação.");
      return;
    }
    const deadline = String(data.get("responseDeadline") || "");
    const ok = await run(() => createQuotationProcessAction({
      requisitionId,
      number: String(data.get("number")),
      title: String(data.get("title")),
      scope: String(data.get("scope")),
      requirements: {},
      deliveryLocation: String(data.get("deliveryLocation") || "") || null,
      deliveryTerm: String(data.get("deliveryTerm") || "") || null,
      responseDeadline: deadline ? new Date(`${deadline}T23:59:59.000Z`) : null,
      supplierIds: selectedSupplierIds,
    }), "Processo de cotação aberto.");
    if (ok) setSelectedSupplierIds([]);
  }

  async function validateNeed(id: string) {
    await run(() => validateProcurementNeedAction(id), "Necessidade validada.");
  }

  async function advanceRequisition(id: string, status: string) {
    const next = status === "DRAFT" ? "REQUESTED" : status === "REQUESTED" ? "IN_APPROVAL" : "APPROVED_FOR_QUOTATION";
    await run(() => transitionPurchaseRequisitionAction(id, next as "REQUESTED" | "IN_APPROVAL" | "APPROVED_FOR_QUOTATION"), `Requisição movida para ${next.replaceAll("_", " ").toLowerCase()}.`);
  }

  function toggleNeed(id: string) {
    setSelectedNeedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleSupplier(id: string) {
    setSelectedSupplierIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <section className="operations-panel">
      <header>
        <div>
          <span className="eyebrow">OPERAÇÃO HUMANA · 10C.1</span>
          <h3>Lançamentos de Suprimentos</h3>
          <p>Crie necessidades, valide, gere requisições e abra cotações sem depender de seed ou banco manual.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="button button-secondary" onClick={() => setForm(form === "need" ? null : "need")}><FilePlus2 size={16} /> Nova necessidade</button>
          <button className="button button-secondary" onClick={() => setForm(form === "requisition" ? null : "requisition")}><Workflow size={16} /> Nova requisição</button>
          <button className="button button-primary" onClick={() => setForm(form === "quotation" ? null : "quotation")}><ShoppingCart size={16} /> Nova cotação</button>
        </div>
      </header>

      {feedback && <div className="model-note" role="status"><CheckCircle2 size={20} /><div><strong>Suprimentos</strong><p>{feedback}</p></div></div>}

      {form === "need" && (
        <form action={submitNeed} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 10, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          <input name="code" placeholder="Código (ex.: NEC-001)" required />
          <input name="description" placeholder="Descrição" required style={{ gridColumn: "span 2" }} />
          <select name="priority" defaultValue="NORMAL"><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select>
          <textarea name="specification" placeholder="Especificação técnica" required style={{ gridColumn: "span 4", minHeight: 90 }} />
          <input name="quantity" type="number" min="0.0001" step="0.0001" placeholder="Quantidade" required />
          <input name="unit" placeholder="Unidade (m², un, kg...)" required />
          <input name="requiredAt" type="date" required />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><input name="expectedLeadDays" type="number" min="0" defaultValue="30" title="Lead time" /><input name="bufferDays" type="number" min="0" defaultValue="7" title="Folga" /></div>
          <button className="button button-primary" disabled={busy} type="submit">Registrar necessidade</button>
          <button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button>
        </form>
      )}

      {form === "requisition" && (
        <form action={submitRequisition} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}><input name="number" placeholder="Número da requisição" required /><input name="title" placeholder="Título" required /></div>
          <textarea name="justification" placeholder="Justificativa" style={{ minHeight: 70 }} />
          <div><strong>Necessidades validadas</strong><div style={{ display: "grid", gap: 8, marginTop: 8 }}>{validatedNeeds.map((item) => <label key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={selectedNeedIds.includes(item.id)} onChange={() => toggleNeed(item.id)} /><span>{item.code} · {item.description} · {item.quantity} {item.unit}</span></label>)}{validatedNeeds.length === 0 && <span className="operations-empty">Nenhuma necessidade validada disponível.</span>}</div></div>
          <div style={{ display: "flex", gap: 8 }}><button className="button button-primary" disabled={busy || validatedNeeds.length === 0} type="submit">Criar requisição</button><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button></div>
        </form>
      )}

      {form === "quotation" && (
        <form action={submitQuotation} className="operations-table-wrap" style={{ padding: 20, display: "grid", gap: 12 }}>
          <select name="requisitionId" required defaultValue=""><option value="" disabled>Selecione a requisição</option>{requisitionsForQuotation.map((item) => <option value={item.id} key={item.id}>{item.number} · {item.title}</option>)}</select>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}><input name="number" placeholder="Número da cotação" required /><input name="title" placeholder="Título da cotação" required /></div>
          <textarea name="scope" placeholder="Escopo da cotação" required style={{ minHeight: 90 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}><input name="deliveryLocation" placeholder="Local de entrega" /><input name="deliveryTerm" placeholder="Prazo/condição de entrega" /><input name="responseDeadline" type="date" /></div>
          <div><strong>Fornecedores convidados</strong><div style={{ display: "grid", gap: 8, marginTop: 8 }}>{workspace.suppliers.filter((item) => item.status === "ACTIVE").map((item) => <label key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={selectedSupplierIds.includes(item.id)} onChange={() => toggleSupplier(item.id)} /><span>{item.name}{item.taxId ? ` · ${item.taxId}` : ""}</span></label>)}{workspace.suppliers.filter((item) => item.status === "ACTIVE").length === 0 && <span className="operations-empty">Nenhum fornecedor ativo disponível.</span>}</div></div>
          <div style={{ display: "flex", gap: 8 }}><button className="button button-primary" disabled={busy || requisitionsForQuotation.length === 0} type="submit">Abrir cotação</button><button className="button button-secondary" type="button" onClick={() => setForm(null)}>Cancelar</button></div>
        </form>
      )}

      <div className="operations-table-wrap" style={{ marginTop: 16 }}>
        <table className="operations-table">
          <thead><tr><th>Fluxo</th><th>Registro</th><th>Situação</th><th>Ação humana</th></tr></thead>
          <tbody>
            {workspace.needs.filter((item) => item.status === "IDENTIFIED").slice(0, 8).map((item) => <tr key={`need-${item.id}`}><td>Necessidade</td><td><strong>{item.code}</strong><small>{item.description}</small></td><td>{item.status}</td><td><button className="button button-secondary" disabled={busy} onClick={() => validateNeed(item.id)}>Validar</button></td></tr>)}
            {requisitionsToAdvance.slice(0, 8).map((item) => <tr key={`req-${item.id}`}><td>Requisição</td><td><strong>{item.number}</strong><small>{item.title}</small></td><td>{item.status.replaceAll("_", " ")}</td><td><button className="button button-secondary" disabled={busy} onClick={() => advanceRequisition(item.id, item.status)}>{item.status === "DRAFT" ? "Solicitar" : item.status === "REQUESTED" ? "Enviar para aprovação" : "Aprovar para cotação"}</button></td></tr>)}
            {workspace.needs.every((item) => item.status !== "IDENTIFIED") && requisitionsToAdvance.length === 0 && <tr><td colSpan={4} className="operations-empty">Nenhum item aguardando ação neste estágio.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
