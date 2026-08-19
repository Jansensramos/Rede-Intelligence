"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { projectAssumptionsSchema } from "@/domain/financial/schema";
import type { ProjectAssumptions } from "@/domain/financial/types";

type DecimalKey = Exclude<{
  [K in keyof ProjectAssumptions]: ProjectAssumptions[K] extends string | null ? K : never
}[keyof ProjectAssumptions], undefined>;

interface ProjectEditorProps {
  initial: ProjectAssumptions;
  onClose: () => void;
  onSave: (value: ProjectAssumptions) => Promise<void> | void;
}

function Field({ label, value, onChange, suffix, type = "text", hint }: { label: string; value: string | number; onChange: (value: string) => void; suffix?: string; type?: string; hint?: string }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <span className="input-wrap">
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
        {suffix && <em>{suffix}</em>}
      </span>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function ProjectEditor({ initial, onClose, onSave }: ProjectEditorProps) {
  const [draft, setDraft] = useState<ProjectAssumptions>(() => structuredClone(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const receiptTotal = useMemo(() => Number(draft.downPaymentRate || 0) + Number(draft.duringConstructionRate || 0) + Number(draft.onDeliveryRate || 0), [draft]);
  const setText = (key: DecimalKey, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const setInteger = (key: "units" | "approvalMonths" | "constructionMonths", value: string) => setDraft((current) => ({ ...current, [key]: Number(value) }));
  const setPolicy = (key: keyof ProjectAssumptions["policy"], value: string) => setDraft((current) => ({ ...current, policy: { ...current.policy, [key]: value } }));

  async function submit() {
    const parsed = projectAssumptionsSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revise os dados informados.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed.data as ProjectAssumptions);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o estudo.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="project-editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <header className="editor-header">
          <div>
            <span className="eyebrow">ESTUDO DE VIABILIDADE</span>
            <h2 id="editor-title">Premissas do empreendimento</h2>
            <p>Os cálculos serão refeitos com a versão 1.0.0 do motor.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>

        <div className="editor-body">
          <fieldset>
            <legend>Identificação</legend>
            <div className="form-grid form-grid-3">
              <Field label="Empreendimento" value={draft.projectName} onChange={(value) => setText("projectName", value)} />
              <Field label="Cidade" value={draft.city} onChange={(value) => setText("city", value)} />
              <Field label="Estado" value={draft.state} onChange={(value) => setText("state", value.toUpperCase().slice(0, 2))} />
            </div>
          </fieldset>

          <fieldset>
            <legend>Produto e terreno</legend>
            <div className="form-grid form-grid-3">
              <Field label="Área do terreno" value={draft.landAreaM2} onChange={(value) => setText("landAreaM2", value)} suffix="m²" type="number" />
              <Field label="Unidades" value={draft.units} onChange={(value) => setInteger("units", value)} type="number" />
              <Field label="Área privativa / un." value={draft.privateAreaPerUnitM2} onChange={(value) => setText("privateAreaPerUnitM2", value)} suffix="m²" type="number" />
              <Field label="Área construída" value={draft.grossBuiltAreaM2 ?? ""} onChange={(value) => setDraft((current) => ({ ...current, grossBuiltAreaM2: value || null }))} suffix="m²" type="number" hint="Vazio: calculada pela eficiência" />
              <Field label="Eficiência" value={draft.efficiencyRate} onChange={(value) => setText("efficiencyRate", value)} suffix="%" type="number" />
              <Field label="Preço / unidade" value={draft.unitPrice} onChange={(value) => setText("unitPrice", value)} suffix="R$" type="number" />
              <Field label="Preço do terreno" value={draft.landPrice} onChange={(value) => setText("landPrice", value)} suffix="R$" type="number" />
            </div>
          </fieldset>

          <fieldset>
            <legend>Custos, vendas e prazo</legend>
            <div className="form-grid form-grid-4">
              <Field label="Obra / m²" value={draft.constructionCostPerM2} onChange={(value) => setText("constructionCostPerM2", value)} suffix="R$" type="number" />
              <Field label="Indiretos" value={draft.indirectCostsRate} onChange={(value) => setText("indirectCostsRate", value)} suffix="%" type="number" />
              <Field label="Contingência" value={draft.contingencyRate} onChange={(value) => setText("contingencyRate", value)} suffix="%" type="number" />
              <Field label="Tributação" value={draft.taxRate} onChange={(value) => setText("taxRate", value)} suffix="%" type="number" />
              <Field label="Comissão" value={draft.commissionRate} onChange={(value) => setText("commissionRate", value)} suffix="%" type="number" />
              <Field label="Marketing" value={draft.marketingRate} onChange={(value) => setText("marketingRate", value)} suffix="%" type="number" />
              <Field label="Aprovação" value={draft.approvalMonths} onChange={(value) => setInteger("approvalMonths", value)} suffix="meses" type="number" />
              <Field label="Obra" value={draft.constructionMonths} onChange={(value) => setInteger("constructionMonths", value)} suffix="meses" type="number" />
              <Field label="Velocidade de vendas" value={draft.salesVelocityUnitsMonth} onChange={(value) => setText("salesVelocityUnitsMonth", value)} suffix="un./mês" type="number" />
            </div>
          </fieldset>

          <fieldset>
            <legend>Recebimentos e funding</legend>
            <div className="form-grid form-grid-4">
              <Field label="Entrada" value={draft.downPaymentRate} onChange={(value) => setText("downPaymentRate", value)} suffix="%" type="number" />
              <Field label="Durante a obra" value={draft.duringConstructionRate} onChange={(value) => setText("duringConstructionRate", value)} suffix="%" type="number" />
              <Field label="Na entrega" value={draft.onDeliveryRate} onChange={(value) => setText("onDeliveryRate", value)} suffix="%" type="number" />
              <div className={`receipt-total ${receiptTotal === 100 ? "is-valid" : "is-invalid"}`}><span>Composição</span><strong>{receiptTotal}%</strong><small>deve somar 100%</small></div>
              <Field label="Limite de financiamento" value={draft.financingLimit} onChange={(value) => setText("financingLimit", value)} suffix="R$" type="number" />
              <Field label="Custo do financiamento" value={draft.annualFinancingRate} onChange={(value) => setText("annualFinancingRate", value)} suffix="% a.a." type="number" />
              <Field label="Taxa de desconto" value={draft.annualDiscountRate} onChange={(value) => setText("annualDiscountRate", value)} suffix="% a.a." type="number" />
            </div>
          </fieldset>

          <fieldset>
            <legend>Política de investimento</legend>
            <div className="form-grid form-grid-5">
              <Field label="Margem mínima" value={draft.policy.minimumMarginRate} onChange={(value) => setPolicy("minimumMarginRate", value)} suffix="%" type="number" />
              <Field label="ROI mínimo" value={draft.policy.minimumRoiRate} onChange={(value) => setPolicy("minimumRoiRate", value)} suffix="%" type="number" />
              <Field label="TIR mínima" value={draft.policy.minimumIrrRate} onChange={(value) => setPolicy("minimumIrrRate", value)} suffix="% a.a." type="number" />
              <Field label="Exposição máxima" value={draft.policy.maximumExposure} onChange={(value) => setPolicy("maximumExposure", value)} suffix="R$" type="number" />
              <Field label="Contingência mínima" value={draft.policy.minimumContingencyRate} onChange={(value) => setPolicy("minimumContingencyRate", value)} suffix="%" type="number" />
            </div>
          </fieldset>
        </div>

        <footer className="editor-footer">
          <div>{error ? <span className="form-error">{error}</span> : <span className="safe-note">Cálculo determinístico · snapshot imutável no PostgreSQL</span>}</div>
          <div className="editor-actions"><button className="button button-secondary" onClick={onClose} disabled={saving}>Cancelar</button><button className="button button-primary" onClick={submit} disabled={saving}>{saving ? "Salvando…" : "Recalcular estudo"}</button></div>
        </footer>
      </section>
    </div>
  );
}
