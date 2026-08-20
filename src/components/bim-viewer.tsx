"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Eye, EyeOff, Focus, Maximize2, Ruler, ScanLine, Scissors, Search, TriangleAlert } from "lucide-react";
import { createFindingFromClashAction } from "@/app/actions/design";
import type { BimGeometryArtifact } from "@/domain/design/bim-geometry";
import type { BimWorkspaceView } from "@/domain/design";

const statusLabels: Record<string, string> = { OPEN: "Aberto", UNDER_REVIEW: "Em análise", ACCEPTED: "Aceito", RESOLVED: "Resolvido", DISCARDED: "Descartado", PROCESSED: "Processado", PROCESSING: "Processando", UPLOADED: "Enviado", ERROR: "Erro" };
const typeLabels: Record<string, string> = { IFCWALL: "Parede", IFCCOLUMN: "Pilar", IFCBEAM: "Viga", IFCSLAB: "Laje", IFCDOOR: "Porta", IFCWINDOW: "Janela", IFCSTAIR: "Escada", IFCRAMP: "Rampa", IFCSPACE: "Espaço", IFCFOOTING: "Fundação", IFCFLOWSEGMENT: "Instalação", IFCEQUIPMENT: "Equipamento" };

export function BimViewer({ workspace: initialWorkspace }: { workspace: BimWorkspaceView | null }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ fit: () => void; isolate: (ids: number[]) => void; showAll: () => void; highlight: (ids: number[]) => void; setOpacity: (value: number) => void; setClip: (axis: "x" | "y" | "z" | null, position?: number) => void } | null>(null);
  const [artifact, setArtifact] = useState<BimGeometryArtifact | null>(null);
  const [selectedExpressId, setSelectedExpressId] = useState<number | null>(null);
  const [selectedExpressIds, setSelectedExpressIds] = useState<number[]>([]);
  const [filterType, setFilterType] = useState("");
  const [filterStorey, setFilterStorey] = useState("");
  const [search, setSearch] = useState("");
  const [measurement, setMeasurement] = useState<string>("");
  const [error, setError] = useState("");
  const [opacity, setOpacity] = useState(92);
  const [clipAxis, setClipAxis] = useState<"x" | "y" | "z" | null>(null);
  const [clipPosition, setClipPosition] = useState(50);
  const [liveWorkspace, setLiveWorkspace] = useState(initialWorkspace);
  const workspace = liveWorkspace;
  const liveModelId = liveWorkspace?.model.id;
  const liveModelStatus = liveWorkspace?.model.status;

  useEffect(() => { setLiveWorkspace(initialWorkspace); }, [initialWorkspace]);
  useEffect(() => {
    if (!liveModelId || !liveModelStatus || !["UPLOADED", "PROCESSING"].includes(liveModelStatus)) return;
    let active = true;
    const refresh = async () => {
      const response = await fetch(`/api/design/bim/${liveModelId}`, { cache: "no-store" });
      if (response.ok && active) setLiveWorkspace(await response.json() as BimWorkspaceView);
    };
    const interval = window.setInterval(() => { void refresh(); }, 2_000);
    void refresh();
    return () => { active = false; window.clearInterval(interval); };
  }, [liveModelId, liveModelStatus]);

  useEffect(() => {
    if (!liveWorkspace || liveWorkspace.model.status !== "PROCESSED") return;
    const controller = new AbortController();
    fetch(`/api/design/bim/${liveWorkspace.model.id}/geometry`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Geometria indisponível.");
      setArtifact(await response.json() as BimGeometryArtifact);
    }).catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Não foi possível carregar o modelo."); });
    return () => controller.abort();
  }, [liveWorkspace]);

  useEffect(() => {
    if (!artifact || !host.current) return;
    const container = host.current;
    let disposed = false; let animation = 0;
    const cleanups: Array<() => void> = [];
    void (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
      if (disposed) return;
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x111820);
      const camera = new THREE.PerspectiveCamera(48, container.clientWidth / Math.max(1, container.clientHeight), 0.01, 100000);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(container.clientWidth, container.clientHeight); renderer.localClippingEnabled = true; container.replaceChildren(renderer.domElement);
      const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x26313d, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 2.8); sun.position.set(20, 30, 15); scene.add(sun);
      const group = new THREE.Group(); scene.add(group); const meshes = new Map<number, InstanceType<typeof THREE.Mesh>[]>(); const clippingPlanes: InstanceType<typeof THREE.Plane>[] = [];
      for (const element of artifact.elements) {
        const items: InstanceType<typeof THREE.Mesh>[] = [];
        for (const chunk of element.chunks) {
          const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(chunk.positions, 3)); geometry.setAttribute("normal", new THREE.Float32BufferAttribute(chunk.normals, 3)); geometry.setIndex(chunk.indices); geometry.computeBoundingSphere();
          const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(chunk.color[0], chunk.color[1], chunk.color[2]), opacity: Math.max(0.2, chunk.color[3]), transparent: chunk.color[3] < 0.99, side: THREE.DoubleSide, clippingPlanes });
          const mesh = new THREE.Mesh(geometry, material); mesh.userData.expressId = element.expressId; group.add(mesh); items.push(mesh);
        }
        meshes.set(element.expressId, items);
      }
      const bounds = new THREE.Box3().setFromObject(group); const center = bounds.getCenter(new THREE.Vector3()); const size = bounds.getSize(new THREE.Vector3());
      const fit = () => { const distance = Math.max(size.x, size.y, size.z, 10) * 1.25; camera.position.set(center.x + distance, center.y + distance * .72, center.z + distance); controls.target.copy(center); controls.update(); };
      fit();
      let globalOpacity = .92;
      const showAll = () => meshes.forEach((items) => items.forEach((mesh) => { mesh.visible = true; (mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>).opacity = globalOpacity; }));
      const isolate = (ids: number[]) => meshes.forEach((items, id) => items.forEach((mesh) => { mesh.visible = ids.includes(id); }));
      const highlight = (ids: number[]) => meshes.forEach((items, id) => items.forEach((mesh) => { const material = mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>; material.emissive.set(ids.includes(id) ? 0xb98a43 : 0x000000); material.emissiveIntensity = ids.includes(id) ? .7 : 0; }));
      const setGlobalOpacity = (value: number) => { globalOpacity = value; meshes.forEach((items) => items.forEach((mesh) => { const material = mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>; material.opacity = value; material.transparent = value < .99; material.needsUpdate = true; })); };
      const setClip = (axis: "x" | "y" | "z" | null, position = .5) => { clippingPlanes.length = 0; if (axis) { const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2; const value = center.getComponent(axisIndex) + (position - .5) * size.getComponent(axisIndex); clippingPlanes.push(new THREE.Plane(new THREE.Vector3(axis === "x" ? -1 : 0, axis === "y" ? -1 : 0, axis === "z" ? -1 : 0), value)); } meshes.forEach((items) => items.forEach((mesh) => { (mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>).clippingPlanes = clippingPlanes; (mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>).needsUpdate = true; })); };
      sceneRef.current = { fit, isolate, showAll, highlight, setOpacity: setGlobalOpacity, setClip };
      const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let firstPoint: InstanceType<typeof THREE.Vector3> | null = null;
      const click = (event: MouseEvent) => { const rect = renderer.domElement.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(group.children, false)[0]; if (!hit) return; const expressId = Number(hit.object.userData.expressId); setSelectedExpressId(expressId); setSelectedExpressIds((current) => { const next = event.ctrlKey || event.metaKey ? (current.includes(expressId) ? current.filter((id) => id !== expressId) : [...current, expressId]) : [expressId]; highlight(next); return next; }); if (event.shiftKey) { if (!firstPoint) { firstPoint = hit.point.clone(); setMeasurement("Selecione o segundo ponto com Shift."); } else { setMeasurement(`${firstPoint.distanceTo(hit.point).toFixed(3)} m`); firstPoint = null; } } };
      renderer.domElement.addEventListener("click", click); cleanups.push(() => renderer.domElement.removeEventListener("click", click));
      const resize = () => { camera.aspect = container.clientWidth / Math.max(1, container.clientHeight); camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight); }; const observer = new ResizeObserver(resize); observer.observe(container); cleanups.push(() => observer.disconnect());
      const animate = () => { controls.update(); renderer.render(scene, camera); animation = requestAnimationFrame(animate); }; animate();
      cleanups.push(() => { cancelAnimationFrame(animation); controls.dispose(); group.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as InstanceType<typeof THREE.Material>).dispose(); } }); renderer.dispose(); sceneRef.current = null; });
    })();
    return () => { disposed = true; cleanups.forEach((cleanup) => cleanup()); };
  }, [artifact]);

  const types = useMemo(() => [...new Set(workspace?.elements.map((element) => element.type) ?? [])].sort(), [workspace]);
  const storeys = useMemo(() => [...new Set((workspace?.elements.map((element) => element.storey).filter(Boolean) ?? []) as string[])].sort(), [workspace]);
  const visibleElements = useMemo(() => (workspace?.elements ?? []).filter((element) => (!filterType || element.type === filterType) && (!filterStorey || element.storey === filterStorey) && (!search || `${element.name} ${element.guid} ${element.type}`.toLowerCase().includes(search.toLowerCase()))), [workspace, filterType, filterStorey, search]);
  const selected = workspace?.elements.find((element) => element.expressId === selectedExpressId);

  useEffect(() => { if (!sceneRef.current) return; const ids = visibleElements.map((element) => element.expressId); if (ids.length === (workspace?.elements.length ?? 0)) sceneRef.current.showAll(); else sceneRef.current.isolate(ids); }, [visibleElements, workspace]);

  if (!workspace) return <div className="bim-empty"><Box size={42} /><h3>Envie um arquivo IFC para visualizar o modelo BIM.</h3></div>;
  if (workspace.model.status === "PROCESSING" || workspace.model.status === "UPLOADED") return <div className="bim-empty"><ScanLine size={42} /><h3>Modelo BIM em processamento.</h3><p>O arquivo foi validado e a geometria está sendo indexada. Esta tela será atualizada automaticamente.</p></div>;
  if (workspace.model.status === "ERROR") return <div className="bim-empty"><TriangleAlert size={42} /><h3>Não foi possível processar este modelo.</h3></div>;

  return <div className="bim-workspace">
    <aside className="bim-tree"><header><strong>Estrutura do Modelo</strong><small>{workspace.model.elementCount} elementos</small></header><label><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar elemento" /></label><select value={filterStorey} onChange={(event) => setFilterStorey(event.target.value)}><option value="">Todos os pavimentos</option>{storeys.map((storey) => <option key={storey}>{storey}</option>)}</select><select value={filterType} onChange={(event) => setFilterType(event.target.value)}><option value="">Todos os tipos</option>{types.map((type) => <option key={type} value={type}>{typeLabels[type] ?? type}</option>)}</select><BimTreeElements elements={visibleElements.slice(0, 800)} selectedIds={selectedExpressIds} onSelect={(element) => { setSelectedExpressId(element.expressId); setSelectedExpressIds([element.expressId]); sceneRef.current?.isolate([element.expressId]); sceneRef.current?.highlight([element.expressId]); }} /></aside>
    <section className="bim-canvas-wrap"><div className="bim-toolbar"><button onClick={() => sceneRef.current?.fit()}><Maximize2 size={14} /> Ajustar modelo</button><button onClick={() => { sceneRef.current?.showAll(); sceneRef.current?.highlight([]); setSelectedExpressIds([]); }}><Eye size={14} /> Mostrar tudo</button><button disabled={!selectedExpressIds.length} onClick={() => sceneRef.current?.isolate(selectedExpressIds)}><Focus size={14} /> Isolar ({selectedExpressIds.length})</button><button onClick={() => { setClipAxis("y"); sceneRef.current?.setClip("y", clipPosition / 100); }}><Scissors size={14} /> Corte horizontal</button><button onClick={() => { setClipAxis("x"); sceneRef.current?.setClip("x", clipPosition / 100); }}><Scissors size={14} /> Corte vertical</button><button onClick={() => { setClipAxis(null); sceneRef.current?.setClip(null); }}><EyeOff size={14} /> Remover corte</button>{clipAxis && <label className="bim-opacity">Posição do corte <input aria-label="Posição do plano de corte" type="range" min="0" max="100" value={clipPosition} onChange={(event) => { const value = Number(event.target.value); setClipPosition(value); sceneRef.current?.setClip(clipAxis, value / 100); }} /></label>}<label className="bim-opacity">Transparência <input aria-label="Opacidade do modelo" type="range" min="15" max="100" value={opacity} onChange={(event) => { const value = Number(event.target.value); setOpacity(value); sceneRef.current?.setOpacity(value / 100); }} /></label><span><Ruler size={14} /> Shift + clique: {measurement || "medir distância"} · Ctrl + clique: seleção múltipla</span></div><div ref={host} className="bim-canvas" />{error && <div className="bim-error">{error}</div>}</section>
    <aside className="bim-properties"><header><strong>Propriedades</strong><small>{selected ? `#${selected.expressId}` : "Selecione um elemento"}</small></header>{selected && <><section><h4>Identificação</h4><dl><dt>Tipo</dt><dd>{typeLabels[selected.type] ?? selected.type}</dd><dt>Nome</dt><dd>{selected.name || "Não informado"}</dd><dt>Código</dt><dd>{selected.code || "Não informado"}</dd><dt>GUID</dt><dd>{selected.guid || "Não informado"}</dd><dt>Pavimento</dt><dd>{selected.storey || "Não determinado"}</dd></dl></section><section><h4>Geometria e quantidades</h4><PropertyRecord value={{ centro: selected.centroid, limites: selected.bounds, quantidades: selected.quantities }} /></section><section><h4>Propriedades IFC</h4><PropertyRecord value={selected.properties} /></section></>}
      {workspace.detectedUnits.length > 0 && <section><h4>Unidades detectadas ({workspace.detectedUnits.length})</h4><dl>{workspace.detectedUnits.slice(0, 40).map((unit) => <div key={unit.id}><dt>{unit.type}</dt><dd>{unit.floor || "Pavimento não determinado"} · {unit.privateArea?.toFixed(2) ?? "—"} m² · {unit.confidence}</dd></div>)}</dl></section>}
      {workspace.comparison && <BimRevisionComparison comparison={workspace.comparison} onFocus={(expressId) => { setSelectedExpressId(expressId); setSelectedExpressIds([expressId]); sceneRef.current?.isolate([expressId]); sceneRef.current?.highlight([expressId]); }} />}
      <section className="bim-clashes"><h4>Conflitos ({workspace.clashes.length})</h4>{workspace.clashes.slice(0, 100).map((clash) => <article key={clash.id}><button onClick={() => { const a = workspace.elements.find((element) => element.id === clash.elementAId); const b = workspace.elements.find((element) => element.id === clash.elementBId); const ids = [a?.expressId, b?.expressId].filter((id): id is number => id !== undefined); sceneRef.current?.isolate(ids); sceneRef.current?.highlight(ids); setSelectedExpressIds(ids); setSelectedExpressId(a?.expressId ?? null); }}><strong>{clash.type === "HARD" ? "Conflito rígido" : clash.type === "DUPLICATE" ? "Duplicidade" : "Afastamento"}</strong><small>{statusLabels[clash.status] ?? clash.status} · {clash.severity}</small></button>{!clash.findingId && <button className="bim-finding-action" onClick={async () => { const result = await createFindingFromClashAction(clash.id); if (!result.ok) setError(result.error); }}>Criar apontamento</button>}</article>)}</section>
    </aside>
  </div>;
}

function BimTreeElements({ elements, selectedIds, onSelect }: { elements: BimWorkspaceView["elements"]; selectedIds: number[]; onSelect: (element: BimWorkspaceView["elements"][number]) => void }) {
  const groups = new Map<string, Map<string, BimWorkspaceView["elements"]>>();
  for (const element of elements) {
    const building = element.tower || element.building || "Modelo";
    const storey = element.storey || "Sem pavimento";
    if (!groups.has(building)) groups.set(building, new Map());
    const storeys = groups.get(building)!;
    storeys.set(storey, [...(storeys.get(storey) ?? []), element]);
  }
  return <div>{[...groups].map(([building, storeys]) => <details key={building} open><summary>{building}</summary>{[...storeys].map(([storey, items]) => <details key={storey} open><summary>{storey} <small>{items.length}</small></summary>{items.map((element) => <button key={element.id} className={selectedIds.includes(element.expressId) ? "is-active" : ""} onClick={() => onSelect(element)}><Box size={12} /><span><strong>{element.name || typeLabels[element.type] || element.type}</strong><small>{element.space || `#${element.expressId}`}</small></span></button>)}</details>)}</details>)}</div>;
}

function BimRevisionComparison({ comparison, onFocus }: { comparison: NonNullable<BimWorkspaceView["comparison"]>; onFocus: (expressId: number) => void }) {
  const summary = comparison.summary && typeof comparison.summary === "object" ? comparison.summary as Record<string, unknown> : {};
  const changes = Array.isArray(comparison.changes) ? comparison.changes as Array<{ key?: string; kind?: string; ifcType?: string; toExpressId?: number | null }> : [];
  return <section className="bim-comparison"><h4>Comparação de revisões</h4><p>Adicionados: {String(summary.ADDED ?? 0)} · Removidos: {String(summary.REMOVED ?? 0)} · Modificados: {String(summary.MODIFIED ?? 0)}</p>{changes.filter((change) => change.kind !== "UNCHANGED").slice(0, 40).map((change, index) => <button key={`${change.key}-${index}`} disabled={!change.toExpressId} onClick={() => change.toExpressId && onFocus(change.toExpressId)}><strong>{change.kind === "ADDED" ? "Adicionado" : change.kind === "REMOVED" ? "Removido" : "Modificado"}</strong><small>{typeLabels[change.ifcType ?? ""] ?? change.ifcType ?? change.key}</small></button>)}</section>;
}

function PropertyRecord({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return <p>Não informado no IFC.</p>;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 80);
  return <dl>{entries.map(([key, item]) => <div key={key}><dt>{key}</dt><dd>{typeof item === "object" ? JSON.stringify(item) : String(item ?? "—")}</dd></div>)}</dl>;
}
