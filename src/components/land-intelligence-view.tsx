"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Eye, FileJson, Layers3, LocateFixed, LockKeyhole, Map, Maximize2, Save, Sparkles } from "lucide-react";
import { saveUrbanScenarioAction } from "@/app/actions/land";
import { createDemoLandSnapshot, polygonBounds, polygonFromGeoJSON, polygonToGeoJSON, type LandOption, type LandWorkspaceView, type PolygonGeometry, type UrbanScenarioUpdateInput } from "@/domain/land";

const MassingCanvas = dynamic(() => import("./land-massing-canvas"), { ssr: false, loading: () => <div className="land-3d-loading">Preparando massa geométrica…</div> });
const compactBrl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const pct = (value: number) => `${number.format(value)}%`;
const money = (value: string | number) => compactBrl.format(Number(value));
const signedPoints = (value: number) => `${value > 0 ? "+" : ""}${number.format(value)} p.p.`;
const simulatedDisclaimer = "Os parâmetros deste cenário são hipotéticos e não representam direito construtivo adquirido, dependendo de alteração legislativa, aprovações e validações pelos órgãos competentes.";

interface Controls {
  landUse: "RESIDENTIAL_MULTIFAMILY" | "MIXED_USE";
  maximumFAR: number; occupancyRate: number; permeabilityRate: number; maximumHeight: number; maximumFloors: number;
  frontSetback: number; rearSetback: number; sideSetback: number; betweenBuildings: number; parkingRequirement: number; residentialDensity: number;
  targetUnits: number; averageUnitArea: number; numberOfTowers: number; unitsPerFloor: number; floors: number; efficiency: number; parkingRatio: number; compactShare: number;
}

function initialControls(land: LandWorkspaceView): Controls {
  const scenario = land.snapshot.scenarios.find((item) => item.isHypothetical)!;
  const option = land.snapshot.options.find((item) => item.id === "land-option-a")!;
  return {
    landUse: scenario.parameters.permittedUses.value.includes("Uso misto") ? "MIXED_USE" : "RESIDENTIAL_MULTIFAMILY",
    maximumFAR: scenario.parameters.maximumFAR.value ?? 5.8,
    occupancyRate: scenario.parameters.occupancyRate.value ?? 52,
    permeabilityRate: scenario.parameters.permeabilityRate.value ?? 20,
    maximumHeight: scenario.parameters.maximumHeight.value ?? 55,
    maximumFloors: scenario.parameters.maximumFloors.value ?? 18,
    frontSetback: scenario.parameters.setbacks.value.front,
    rearSetback: scenario.parameters.setbacks.value.rear,
    sideSetback: scenario.parameters.setbacks.value.side,
    betweenBuildings: scenario.parameters.setbacks.value.betweenBuildings,
    parkingRequirement: scenario.parameters.parkingRequirement.value ?? 0.55,
    residentialDensity: scenario.parameters.residentialDensity.value ?? 930,
    targetUnits: option.areaSchedule.units,
    averageUnitArea: option.product.averageUnitArea,
    numberOfTowers: option.product.numberOfTowers,
    unitsPerFloor: option.product.unitsPerFloor,
    floors: option.product.floors,
    efficiency: option.product.targetEfficiency,
    parkingRatio: option.product.parkingRatio,
    compactShare: option.areaSchedule.units > 0 ? option.product.unitMix[0].quantity / option.areaSchedule.units * 100 : 65,
  };
}

function RangeField({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void }) {
  return <label className="land-range"><span>{label}<strong>{number.format(value)} {unit}</strong></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function LandPlan({ polygon, envelope, option, layers }: { polygon: PolygonGeometry; envelope: PolygonGeometry; option: LandOption; layers: Record<string, boolean> }) {
  const bounds = polygonBounds(polygon);
  const padding = 16;
  const width = bounds.maxX - bounds.minX + padding * 2;
  const height = bounds.maxY - bounds.minY + padding * 2;
  const points = (shape: PolygonGeometry) => shape.coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  return <svg className="land-plan" viewBox={`${bounds.minX - padding} ${bounds.minY - padding} ${width} ${height}`} role="img" aria-label="Planta esquemática do terreno e implantação">
    <rect x={bounds.minX - padding} y={bounds.minY - padding} width={width} height={height} fill="#edf0e9" />
    {layers.context && <><path d={`M ${bounds.minX - padding} ${bounds.maxY + 7} H ${bounds.maxX + padding}`} stroke="#b7bdb8" strokeWidth="11" /><path d={`M ${bounds.minX - 9} ${bounds.minY - padding} V ${bounds.maxY + padding}`} stroke="#d5d8d1" strokeWidth="7" /></>}
    {layers.site && <polygon points={points(polygon)} fill="#d7ded2" stroke="#173d4f" strokeWidth="1.2" />}
    {layers.permeable && <polygon points={points(polygon)} fill="url(#land-hatch)" opacity=".23" />}
    {layers.envelope && envelope.coordinates.length > 0 && <polygon points={points(envelope)} fill="rgba(185,138,67,.15)" stroke="#b98a43" strokeDasharray="4 2" />}
    {layers.circulation && envelope.coordinates.length > 0 && <polygon points={points(envelope)} fill="none" stroke="#71878b" strokeWidth="3" strokeDasharray="1.5 4" opacity=".55" />}
    {layers.restrictions && <text x={bounds.minX + 4} y={bounds.minY + 8} fontSize="4" fill="#8f5a45">restrições: não verificadas</text>}
    {layers.buildings && option.massing.buildings.map((building) => <rect key={building.id} x={building.x} y={building.y} width={building.width} height={building.depth} fill={building.phaseId === "PHASE-1" ? "#173d4f" : building.phaseId === "PHASE-2" ? "#b98a43" : "#71878b"} opacity=".86" />)}
    <defs><pattern id="land-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#5d7a68" strokeWidth="1" /></pattern></defs>
    <g transform={`translate(${bounds.maxX + 6} ${bounds.minY + 4})`}><path d="M0 8 L3 0 L6 8 Z" fill="#173d4f" /><text x="3" y="14" textAnchor="middle" fontSize="5" fill="#173d4f">N</text></g>
    <g transform={`translate(${bounds.minX + (bounds.maxX - bounds.minX) / 2} ${bounds.maxY})`}><circle r="3" fill="#b98a43" stroke="#fff" strokeWidth="1" /><path d="M0 8 V3" stroke="#b98a43" strokeWidth="1.5" /><text x="5" y="7" fontSize="4" fill="#5f7073">acesso</text></g>
    <text x={bounds.minX} y={bounds.maxY + 12} fontSize="4.5" fill="#5f7073">via adjacente · frente {number.format(width - padding * 2)}m</text>
  </svg>;
}

function OptionMetrics({ option }: { option: LandOption }) {
  const metrics = option.financialResult.metrics;
  const resilience = option.score.dimensions.find((dimension) => dimension.key === "RESILIENCE")?.score ?? 0;
  return <dl className="land-option-metrics"><div><dt>Unidades</dt><dd>{integer.format(option.areaSchedule.units)}</dd></div><div><dt>Área média</dt><dd>{number.format(option.areaSchedule.averageUnitArea)} m²</dd></div><div><dt>VGV</dt><dd>{money(metrics.vgv)}</dd></div><div><dt>Custo</dt><dd>{money(metrics.totalCost)}</dd></div><div><dt>Margem</dt><dd>{pct(Number(metrics.marginOnVgv) * 100)}</dd></div><div><dt>Equity</dt><dd>{money(metrics.equityCapitalRequired)}</dd></div><div><dt>Exposição</dt><dd>{money(metrics.maximumCashExposure)}</dd></div><div><dt>ROI</dt><dd>{metrics.roi === null ? "—" : pct(Number(metrics.roi) * 100)}</dd></div><div><dt>TIR</dt><dd>{metrics.annualIrr === null ? "—" : pct(Number(metrics.annualIrr) * 100)}</dd></div><div><dt>VPL</dt><dd>{money(metrics.npv)}</dd></div><div><dt>Score</dt><dd>{option.score.totalScore}</dd></div><div><dt>Resiliência</dt><dd>{number.format(resilience)}/100</dd></div><div><dt>Uso do CA</dt><dd>{pct(option.areaSchedule.potentialUtilization)}</dd></div></dl>;
}

function InvestorView({ land, current, proposed, onClose }: { land: LandWorkspaceView; current: LandOption; proposed: LandOption; onClose: () => void }) {
  const uplift = land.snapshot.upliftAnalysis;
  return <div className="investor-view">
    <header><div><span>REDE LAND · INVESTOR VIEW</span><h2>{land.snapshot.landAsset.name}</h2><p>Estudo preliminar de potencial construtivo · sujeito à validação técnica e aprovação dos órgãos competentes.</p></div><button className="button button-secondary" onClick={onClose}>Sair do Investor View</button></header>
    <section className="investor-hero"><div><span>LOCALIZAÇÃO</span><strong>{land.snapshot.landAsset.city}/SP</strong><p>{land.snapshot.landAsset.address}</p></div><div><span>LEGISLAÇÃO UTILIZADA</span><strong>LC 565/2023</strong><p>Setor SRM confirmado manualmente; cadastro ainda requer reconciliação.</p></div><div><span>CONFIANÇA REGULATÓRIA</span><strong>{land.snapshot.regulatoryConfidence.score}%</strong><p>{land.snapshot.regulatoryConfidence.label}</p></div><div><span>RECOMENDAÇÃO</span><strong>{proposed.warnings.some((item) => item.severity === "BLOCKER") ? "Revisar parâmetros" : "Avançar à validação"}</strong><p>Nunca representa aprovação municipal.</p></div></section>
    <section className="panel investor-uplift"><span className="eyebrow">POTENCIAL DA ALTERAÇÃO URBANÍSTICA</span><h3>Cenário atual × cenário proposto</h3><div className="investor-compare"><div><strong>ATUAL</strong><OptionMetrics option={current} /></div><div className="is-simulated"><strong>PROPOSTO · HIPÓTESE</strong><OptionMetrics option={proposed} /></div><div><strong>DIFERENÇA</strong><dl className="land-option-metrics"><div><dt>Área computável</dt><dd>+{integer.format(uplift.additionalComputableArea)} m²</dd></div><div><dt>Unidades</dt><dd>+{integer.format(uplift.additionalUnits)}</dd></div><div><dt>VGV</dt><dd>{money(uplift.additionalVGV)}</dd></div><div><dt>Custo</dt><dd>{money(Number(proposed.financialResult.metrics.totalCost) - Number(current.financialResult.metrics.totalCost))}</dd></div><div><dt>Margem</dt><dd>{signedPoints((Number(proposed.financialResult.metrics.marginOnVgv) - Number(current.financialResult.metrics.marginOnVgv)) * 100)}</dd></div><div><dt>Equity</dt><dd>{money(uplift.changeInEquity)}</dd></div><div><dt>ROI</dt><dd>{signedPoints((Number(proposed.financialResult.metrics.roi ?? 0) - Number(current.financialResult.metrics.roi ?? 0)) * 100)}</dd></div><div><dt>TIR</dt><dd>{signedPoints((Number(proposed.financialResult.metrics.annualIrr ?? 0) - Number(current.financialResult.metrics.annualIrr ?? 0)) * 100)}</dd></div><div><dt>VPL</dt><dd>{money(uplift.changeInNPV)}</dd></div><div><dt>Score</dt><dd>{uplift.changeInScore > 0 ? "+" : ""}{uplift.changeInScore}</dd></div></dl></div></div><p className="simulation-disclaimer">{simulatedDisclaimer}</p></section>
    <section className="panel"><MassingCanvas model={proposed.massing} comparison={current.massing} showComparison /></section>
  </div>;
}

export function LandIntelligenceView({ initialLand, onLandChange }: { initialLand: LandWorkspaceView; onLandChange?: (land: LandWorkspaceView) => void }) {
  const [land, setLand] = useState(initialLand);
  const [draft, setDraft] = useState<Controls>(() => initialControls(initialLand));
  const [applied, setApplied] = useState<Controls>(() => initialControls(initialLand));
  const [polygon, setPolygon] = useState<PolygonGeometry>(initialLand.snapshot.landAsset.polygon);
  const [appliedPolygon, setAppliedPolygon] = useState<PolygonGeometry>(initialLand.snapshot.landAsset.polygon);
  const [scenarioId, setScenarioId] = useState(initialLand.snapshot.selectedScenarioId);
  const [optionId, setOptionId] = useState(initialLand.snapshot.selectedOptionId);
  const [layers, setLayers] = useState({ context: true, site: true, envelope: true, buildings: true, permeable: true, circulation: true, restrictions: true });
  const [sortMetric, setSortMetric] = useState<"score" | "npv" | "exposure" | "units">("score");
  const [investorMode, setInvestorMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [geoJson, setGeoJson] = useState(() => JSON.stringify(polygonToGeoJSON(initialLand.snapshot.landAsset.polygon), null, 2));
  const draftKey = JSON.stringify([draft, polygon]);
  const appliedKey = JSON.stringify([applied, appliedPolygon]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setApplied(draft); setAppliedPolygon(polygon); }, 450);
    return () => window.clearTimeout(timer);
  }, [draft, polygon]);

  const preview = useMemo(() => {
    const next = createDemoLandSnapshot(land.snapshot.landAsset.organizationId, land.versionNumber, {
      permittedUses: applied.landUse === "MIXED_USE" ? ["Residencial plurifamiliar vertical", "Uso misto", "Comércio e serviços condicionados"] : ["Residencial plurifamiliar vertical"],
      maximumFAR: applied.maximumFAR, occupancyRate: applied.occupancyRate, permeabilityRate: applied.permeabilityRate, maximumHeight: applied.maximumHeight, maximumFloors: applied.maximumFloors,
      frontSetback: applied.frontSetback, rearSetback: applied.rearSetback, sideSetback: applied.sideSetback, betweenBuildings: applied.betweenBuildings, parkingRequirement: applied.parkingRequirement, residentialDensity: applied.residentialDensity,
    }, { targetUnits: applied.targetUnits, averageUnitArea: applied.averageUnitArea, numberOfTowers: applied.numberOfTowers, unitsPerFloor: applied.unitsPerFloor, floors: applied.floors, efficiency: applied.efficiency, parkingRatio: applied.parkingRatio, compactShare: applied.compactShare }, appliedPolygon);
    next.id = land.versionId;
    next.landStudyId = land.landStudyId;
    next.landAsset.id = land.snapshot.landAsset.id;
    next.scenarios.forEach((scenario) => { scenario.landAssetId = next.landAsset.id; });
    return next;
  }, [applied, appliedPolygon, land.landStudyId, land.snapshot.landAsset.id, land.snapshot.landAsset.organizationId, land.versionId, land.versionNumber]);

  const scenario = preview.scenarios.find((item) => item.id === scenarioId) ?? preview.scenarios[1];
  const scenarioOptions = preview.options.filter((option) => option.scenarioId === scenario.id);
  const selected = scenarioOptions.find((option) => option.id === optionId) ?? scenarioOptions[0];
  const current = preview.options.find((option) => option.scenarioId === preview.scenarios[0].id)!;
  const proposed = preview.options.find((option) => option.id === "land-option-a")!;
  const sortedOptions = [...preview.options.filter((option) => option.scenarioId === preview.scenarios[1].id)].sort((a, b) => sortMetric === "score" ? b.score.totalScore - a.score.totalScore : sortMetric === "npv" ? Number(b.financialResult.metrics.npv) - Number(a.financialResult.metrics.npv) : sortMetric === "exposure" ? Number(a.financialResult.metrics.maximumCashExposure) - Number(b.financialResult.metrics.maximumCashExposure) : b.areaSchedule.units - a.areaSchedule.units);
  const recalculating = draftKey !== appliedKey;

  function change<K extends keyof Controls>(key: K, value: Controls[K]) { setDraft((currentValue) => ({ ...currentValue, [key]: value })); }

  async function saveSnapshot() {
    setSaving(true); setMessage("");
    const input: UrbanScenarioUpdateInput = {
      landStudyId: land.landStudyId,
      expectedVersionNumber: land.versionNumber,
      justification: "Simulação paramétrica validada pelo usuário no REDE Zoning Lab.",
      polygon,
      parameters: { permittedUses: draft.landUse === "MIXED_USE" ? ["Residencial plurifamiliar vertical", "Uso misto", "Comércio e serviços condicionados"] : ["Residencial plurifamiliar vertical"], maximumFAR: draft.maximumFAR, occupancyRate: draft.occupancyRate, permeabilityRate: draft.permeabilityRate, maximumHeight: draft.maximumHeight, maximumFloors: draft.maximumFloors, frontSetback: draft.frontSetback, rearSetback: draft.rearSetback, sideSetback: draft.sideSetback, betweenBuildings: draft.betweenBuildings, parkingRequirement: draft.parkingRequirement, residentialDensity: draft.residentialDensity },
      product: { targetUnits: draft.targetUnits, averageUnitArea: draft.averageUnitArea, numberOfTowers: draft.numberOfTowers, unitsPerFloor: draft.unitsPerFloor, floors: draft.floors, efficiency: draft.efficiency, parkingRatio: draft.parkingRatio, compactShare: draft.compactShare },
    };
    const response = await saveUrbanScenarioAction(input);
    if (response.ok) { setLand(response.data); onLandChange?.(response.data); setMessage(`Snapshot Land v${response.data.versionNumber} criado com sucesso.`); } else setMessage(response.error);
    setSaving(false);
  }

  if (investorMode) return <InvestorView land={{ ...land, snapshot: preview }} current={current} proposed={proposed} onClose={() => setInvestorMode(false)} />;

  return <div className="land-view view-stack">
    <header className="land-title"><div><span className="eyebrow">REDE LAND INTELLIGENCE · {preview.version}</span><h2>Terreno & Potencial</h2><p>Do lote ao resultado econômico, com hipóteses urbanísticas sempre separadas da legislação vigente.</p></div><div><button className="button button-secondary" onClick={() => setInvestorMode(true)}><Eye size={16} /> Investor View</button><button className="button button-primary" disabled={saving || recalculating} onClick={saveSnapshot}><Save size={16} /> {saving ? "Salvando…" : `Criar snapshot v${land.versionNumber + 1}`}</button></div></header>
    {message && <div className="land-message"><Check size={16} />{message}</div>}
    <section className="land-address panel"><div><span className="eyebrow">LOCALIZAÇÃO</span><label>Digite o endereço do terreno<input value={preview.landAsset.address} readOnly /></label></div><button className="button button-secondary" onClick={() => setMessage("Coordenada localizada. Lote mantido como confirmação manual por ausência de API cadastral pública estruturada.")}><LocateFixed size={16} /> Localizar</button><div className="land-coordinate"><Map size={16} /><span>{preview.landAsset.latitude.toFixed(5)}, {preview.landAsset.longitude.toFixed(5)}</span><strong>POLÍGONO CONFIRMADO MANUALMENTE</strong></div></section>

    <section className="land-map-grid">
      <article className="panel land-map-panel"><div className="panel-heading"><div><span className="eyebrow">TERRENO · {integer.format(preview.landAsset.area)} M²</span><h2>Implantação paramétrica 2D</h2></div><Layers3 size={20} /></div><LandPlan polygon={preview.landAsset.polygon} envelope={selected.envelope.buildableGroundPolygon} option={selected} layers={layers} /><div className="land-layers">{Object.entries({ context: "Contexto", site: "Lote", envelope: "Envelope", buildings: "Torres", permeable: "Permeável", circulation: "Circulação", restrictions: "Restrições" }).map(([key, label]) => <button key={key} className={layers[key as keyof typeof layers] ? "is-active" : ""} onClick={() => setLayers((value) => ({ ...value, [key]: !value[key as keyof typeof layers] }))}>{label}</button>)}</div></article>
      <article className="panel land-site-data"><span className="eyebrow">LAND ASSET</span><h2>{preview.landAsset.name}</h2><dl><div><dt>Endereço</dt><dd>{preview.landAsset.address}</dd></div><div><dt>Área</dt><dd>{integer.format(preview.landAsset.area)} m²</dd></div><div><dt>Testada</dt><dd>{number.format(preview.landAsset.frontage)} m</dd></div><div><dt>Cadastro</dt><dd>{preview.landAsset.cadastralIdentifier}</dd></div><div><dt>Fonte</dt><dd>USER_INPUT · MANUAL</dd></div></dl><details className="geojson-editor"><summary><FileJson size={15} /> Importar/corrigir GeoJSON</summary><textarea value={geoJson} onChange={(event) => setGeoJson(event.target.value)} /><button className="button button-secondary" onClick={() => { try { const next = polygonFromGeoJSON(JSON.parse(geoJson)); setPolygon(next); setMessage("GeoJSON válido. A geometria será congelada no próximo snapshot."); } catch (error) { setMessage(error instanceof Error ? error.message : "GeoJSON inválido."); } }}>Validar e aplicar</button></details></article>
    </section>

    <section className="panel zoning-lab"><div className="panel-heading"><div><span className="eyebrow">REDE ZONING LAB</span><h2>Simulador de cenário urbanístico</h2></div><span className={recalculating ? "land-calculating" : "land-ready"}>{recalculating ? "RECALCULANDO…" : "ATUALIZADO"}</span></div><div className="urban-scenario-tabs">{preview.scenarios.map((item) => <button key={item.id} className={scenario.id === item.id ? "is-active" : ""} onClick={() => { setScenarioId(item.id); setOptionId(preview.options.find((option) => option.scenarioId === item.id)?.id ?? optionId); }}><span>{item.type === "CURRENT_LEGAL" ? "ZONEAMENTO ATUAL" : "ZONEAMENTO PROPOSTO"}</span><strong>{item.parameters.zoningCode.value}</strong><small>{item.isHypothetical ? "CENÁRIO URBANÍSTICO SIMULADO" : "REFERÊNCIA LEGAL VIGENTE"}</small></button>)}</div>{scenario.isHypothetical && <div className="simulation-disclaimer"><AlertTriangle size={18} /><span><strong>CENÁRIO URBANÍSTICO SIMULADO</strong>{simulatedDisclaimer}</span></div>}
      <div className="land-control-groups"><div><h3>Parâmetros urbanísticos</h3><RangeField label="CA máximo" value={draft.maximumFAR} min={0.5} max={10} step={0.1} unit="x" onChange={(value) => change("maximumFAR", value)} /><RangeField label="Taxa de ocupação" value={draft.occupancyRate} min={10} max={90} unit="%" onChange={(value) => change("occupancyRate", value)} /><RangeField label="Permeabilidade" value={draft.permeabilityRate} min={0} max={60} unit="%" onChange={(value) => change("permeabilityRate", value)} /><RangeField label="Gabarito" value={draft.maximumHeight} min={9} max={150} unit="m" onChange={(value) => change("maximumHeight", value)} /><RangeField label="Pavimentos máximos" value={draft.maximumFloors} min={3} max={50} unit="pav." onChange={(value) => change("maximumFloors", value)} /></div><div><h3>Produto-alvo</h3><RangeField label="Unidades" value={draft.targetUnits} min={200} max={2500} step={25} unit="un." onChange={(value) => change("targetUnits", value)} /><RangeField label="Área média" value={draft.averageUnitArea} min={25} max={90} unit="m²" onChange={(value) => change("averageUnitArea", value)} /><RangeField label="Torres" value={draft.numberOfTowers} min={1} max={24} unit="torres" onChange={(value) => change("numberOfTowers", value)} /><RangeField label="Pavimentos propostos" value={draft.floors} min={3} max={40} unit="pav." onChange={(value) => change("floors", value)} /><RangeField label="Unidades / pavimento" value={draft.unitsPerFloor} min={2} max={16} unit="un." onChange={(value) => change("unitsPerFloor", value)} /><RangeField label="Eficiência" value={draft.efficiency} min={55} max={88} unit="%" onChange={(value) => change("efficiency", value)} /></div><details className="land-advanced-controls"><summary>Controles avançados · uso, recuos, densidade, vagas e mix</summary><div className="land-advanced-grid"><div><h3>Uso, implantação e densidade</h3><label className="land-select-field">Uso urbanístico proposto<select value={draft.landUse} onChange={(event) => change("landUse", event.target.value as Controls["landUse"])}><option value="RESIDENTIAL_MULTIFAMILY">Residencial plurifamiliar</option><option value="MIXED_USE">Uso misto + comércio condicionado</option></select></label><RangeField label="Recuo frontal" value={draft.frontSetback} min={0} max={30} step={0.5} unit="m" onChange={(value) => change("frontSetback", value)} /><RangeField label="Recuo de fundos" value={draft.rearSetback} min={0} max={25} step={0.5} unit="m" onChange={(value) => change("rearSetback", value)} /><RangeField label="Recuo lateral" value={draft.sideSetback} min={0} max={20} step={0.5} unit="m" onChange={(value) => change("sideSetback", value)} /><RangeField label="Entre edifícios" value={draft.betweenBuildings} min={0} max={30} step={0.5} unit="m" onChange={(value) => change("betweenBuildings", value)} /><RangeField label="Densidade-alvo" value={draft.residentialDensity} min={100} max={2000} step={10} unit="un./ha" onChange={(value) => change("residentialDensity", value)} /></div><div><h3>Vagas e mix de unidades</h3><RangeField label="Regra urbanística de vagas" value={draft.parkingRequirement} min={0} max={2} step={0.05} unit="vaga/un." onChange={(value) => change("parkingRequirement", value)} /><RangeField label="Vagas do produto" value={draft.parkingRatio} min={0} max={2} step={0.05} unit="vaga/un." onChange={(value) => change("parkingRatio", value)} /><RangeField label="Participação de compactos" value={draft.compactShare} min={0} max={100} step={5} unit="%" onChange={(value) => change("compactShare", value)} /><p className="land-control-note">O saldo do mix é alocado à tipologia família; áreas e preços permanecem derivados da área média informada.</p></div></div></details></div>
    </section>

    <section className="land-kpis"><article><span>ZONEAMENTO</span><strong>{scenario.parameters.zoningCode.value}</strong><small>{scenario.parameters.zoningName.value}</small></article><article><span>CONFIANÇA REGULATÓRIA</span><strong>{preview.regulatoryConfidence.score}%</strong><small>{preview.regulatoryConfidence.label}</small></article><article><span>POTENCIAL COMPUTÁVEL</span><strong>{integer.format(selected.envelope.maximumComputableArea)} m²</strong><small>CA utilizado {number.format(selected.areaSchedule.farUtilization)}x</small></article><article><span>UNIDADES POTENCIAIS</span><strong>{integer.format(selected.areaSchedule.units)}</strong><small>{number.format(selected.areaSchedule.densityUnitsPerHectare)} un./ha</small></article></section>

    <section className="land-visual-grid"><article className="panel"><div className="panel-heading"><div><span className="eyebrow">MASSA 3D · GEOMETRIA CALCULADA</span><h2>{selected.name}</h2></div><Maximize2 size={18} /></div><MassingCanvas model={selected.massing} comparison={current.massing} showComparison={scenario.isHypothetical} /><div className="phase-legend">{selected.masterplan.phases.map((phase, index) => <span key={phase.id}><i className={`phase-color-${index + 1}`} />{phase.name} · {phase.units} un.</span>)}</div></article><article className="panel area-schedule"><span className="eyebrow">QUADRO DE ÁREAS</span><h2>Legal × proposta</h2><dl>{[["Área do terreno", selected.areaSchedule.landArea], ["Projeção", selected.areaSchedule.footprintArea], ["Computável", selected.areaSchedule.computableArea], ["Não computável", selected.areaSchedule.nonComputableArea], ["Construída total", selected.areaSchedule.totalBuiltArea], ["Privativa", selected.areaSchedule.privateArea], ["Garagem", selected.areaSchedule.garageArea], ["Lazer", selected.areaSchedule.amenityArea]].map(([label, value]) => <div key={label as string}><dt>{label as string}</dt><dd>{integer.format(value as number)} m²</dd></div>)}</dl><div className="potential-usage"><span>Utilização do potencial</span><strong>{pct(selected.areaSchedule.potentialUtilization)}</strong><i><b style={{ width: `${Math.min(100, selected.areaSchedule.potentialUtilization)}%` }} /></i></div></article></section>

    <section className="panel alternatives-panel"><div className="panel-heading"><div><span className="eyebrow">ALTERNATIVAS · ENGINE + SCORE</span><h2>Comparador econômico</h2></div><label>Ordenar por <select value={sortMetric} onChange={(event) => setSortMetric(event.target.value as typeof sortMetric)}><option value="score">Score</option><option value="npv">VPL</option><option value="exposure">Menor exposição</option><option value="units">Unidades</option></select><ChevronDown size={14} /></label></div><div className="land-option-cards">{sortedOptions.map((option) => <button key={option.id} className={selected.id === option.id ? "is-active" : ""} onClick={() => { setScenarioId(option.scenarioId); setOptionId(option.id); }}><header><span>#{option.rank} {option.paretoEfficient && "· PARETO"}</span><strong>{option.name}</strong></header><OptionMetrics option={option} /><footer>{option.warnings.some((warning) => warning.severity === "BLOCKER") ? <><AlertTriangle size={14} /> REQUER AJUSTE</> : <><Check size={14} /> SEM VIOLAÇÃO MODELADA</>}</footer></button>)}</div><div className="deterministic-assistant"><Sparkles size={20} /><div><strong>Assistente determinístico de produto</strong><p>{sortedOptions[0].areaSchedule.units > sortedOptions.at(-1)!.areaSchedule.units ? `A alternativa ${sortedOptions[0].name} lidera em ${sortMetric === "score" ? "retorno ajustado ao risco" : sortMetric === "npv" ? "VPL" : sortMetric === "exposure" ? "menor exposição" : "unidades"}; a opção de unidades maiores reduz densidade e altera capital e absorção.` : "As alternativas não apresentam diferença material de unidades."}</p></div></div></section>

    <section className="land-analysis-grid"><article className="panel"><span className="eyebrow">REVERSE ZONING SOLVER</span><h2>Requisitos urbanísticos estimados</h2><p>Para {integer.format(draft.targetUnits)} unidades de {number.format(draft.averageUnitArea)} m²:</p><dl className="solver-grid"><div><dt>CA necessário</dt><dd>{number.format(preview.reverseZoning.requiredFAR)}x</dd></div><div><dt>TO aproximada</dt><dd>{pct(preview.reverseZoning.requiredOccupancyRate)}</dd></div><div><dt>Gabarito</dt><dd>{number.format(preview.reverseZoning.requiredHeight)}m</dd></div><div><dt>Pavimentos</dt><dd>{preview.reverseZoning.requiredFloors}</dd></div><div><dt>Densidade</dt><dd>{integer.format(preview.reverseZoning.requiredDensity)} un./ha</dd></div><div><dt>Área computável</dt><dd>{integer.format(preview.reverseZoning.requiredComputableArea)} m²</dd></div></dl><p className="simulation-disclaimer">REQUISITOS URBANÍSTICOS ESTIMADOS PARA O PROGRAMA. Não indicam possibilidade ou garantia de aprovação.</p></article><article className="panel"><span className="eyebrow">GAP ANALYSIS</span><h2>Vigente × necessário</h2><div className="gap-list">{preview.gapAnalysis.items.map((item) => <div key={item.key}><span>{item.label}</span><strong>{item.current === null ? "Não verificado" : `${number.format(Number(item.current))}${item.unit}`}</strong><ArrowRight size={14} /><strong>{number.format(Number(item.required))}{item.unit}</strong><em className={`gap-${item.status.toLowerCase()}`}>{item.status === "MEETS" ? "ATENDE" : item.status === "NOT_VERIFIED" ? "VERIFICAR" : `GAP ${item.gap! > 0 ? "+" : ""}${number.format(item.gap!)}`}</em></div>)}</div></article></section>

    <section className="panel uplift-panel"><div><span className="eyebrow">UPLIFT DE POTENCIAL DO CENÁRIO URBANÍSTICO</span><h2>Impacto calculado, não valorização garantida</h2></div><div className="uplift-metrics"><div><span>Área computável</span><strong>+{integer.format(preview.upliftAnalysis.additionalComputableArea)} m²</strong></div><div><span>Unidades</span><strong>+{integer.format(preview.upliftAnalysis.additionalUnits)}</strong></div><div><span>VGV</span><strong>{money(preview.upliftAnalysis.additionalVGV)}</strong></div><div><span>Lucro</span><strong>{money(preview.upliftAnalysis.changeInProfit)}</strong></div><div><span>VPL</span><strong>{money(preview.upliftAnalysis.changeInNPV)}</strong></div><div><span>Score</span><strong>{preview.upliftAnalysis.changeInScore > 0 ? "+" : ""}{preview.upliftAnalysis.changeInScore}</strong></div></div></section>

    <section className="land-source-note"><LockKeyhole size={20} /><div><strong>Fonte oficial + confirmação manual</strong><p>LC 565/2023 e portal oficial de Barueri sustentam a referência normativa. A associação cadastral, o polígono e parâmetros ausentes permanecem MANUAL/não verificados até certidão, IPTU, matrícula e levantamentos.</p></div><a href="https://portal.barueri.sp.gov.br/secretarias/secretaria-planejamento-urbanismo/mapa-zoneamento" target="_blank" rel="noreferrer">Ver fonte oficial <ArrowRight size={14} /></a></section>
  </div>;
}
