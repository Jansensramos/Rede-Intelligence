"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import type { MassingModel, Point2D } from "@/domain/land";

const phaseColors = ["#b98a43", "#476b73", "#8b5e55", "#6f7d5b", "#735b7d"];

interface Camera { azimuth: number; elevation: number; zoom: number }

function colorWithAlpha(color: string, alpha: string) {
  return `${color}${alpha}`;
}

export default function LandMassingCanvas({ model, comparison, showComparison = false }: { model: MassingModel; comparison?: MassingModel; showComparison?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; azimuth: number; elevation: number } | null>(null);
  const [camera, setCamera] = useState<Camera>({ azimuth: -0.7, elevation: 0.62, zoom: 4.2 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = "#edf0e9";
    context.fillRect(0, 0, rect.width, rect.height);

    const allPoints = model.sitePolygon.coordinates;
    const center = allPoints.reduce((sum, point) => ({ x: sum.x + point.x / allPoints.length, y: sum.y + point.y / allPoints.length }), { x: 0, y: 0 });
    const project = (point: Point2D, z = 0) => {
      const x = point.x - center.x;
      const y = point.y - center.y;
      const cos = Math.cos(camera.azimuth);
      const sin = Math.sin(camera.azimuth);
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      return { x: rect.width / 2 + rx * camera.zoom, y: rect.height * 0.68 + ry * camera.zoom * Math.sin(camera.elevation) - z * camera.zoom * Math.cos(camera.elevation) };
    };
    const path = (points: { x: number; y: number }[]) => {
      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.closePath();
    };
    const site = model.sitePolygon.coordinates.map((point) => project(point));
    path(site);
    context.fillStyle = "#d8dfd4";
    context.fill();
    context.strokeStyle = "#153745";
    context.lineWidth = 1.5;
    context.stroke();
    if (model.envelopePolygon.coordinates.length) {
      path(model.envelopePolygon.coordinates.map((point) => project(point, 0.05)));
      context.fillStyle = "rgba(185,138,67,.09)";
      context.fill();
      context.strokeStyle = "rgba(185,138,67,.7)";
      context.setLineDash([6, 4]);
      context.stroke();
      context.setLineDash([]);
    }

    const drawBuildings = (source: MassingModel, ghost: boolean) => {
      const ordered = [...source.buildings].sort((a, b) => (a.x + a.y) - (b.x + b.y));
      ordered.forEach((building) => {
        const phaseNumber = Math.max(0, Number(building.phaseId.split("-").at(-1)) - 1);
        const baseColor = phaseColors[phaseNumber % phaseColors.length];
        const height = building.floors * building.floorHeight;
        const corners = [
          { x: building.x, y: building.y },
          { x: building.x + building.width, y: building.y },
          { x: building.x + building.width, y: building.y + building.depth },
          { x: building.x, y: building.y + building.depth },
        ];
        const bottom = corners.map((point) => project(point));
        const top = corners.map((point) => project(point, height));
        path([bottom[0], bottom[1], top[1], top[0]]);
        context.fillStyle = ghost ? "rgba(71,107,115,.08)" : colorWithAlpha(baseColor, "90");
        context.fill();
        path([bottom[1], bottom[2], top[2], top[1]]);
        context.fillStyle = ghost ? "rgba(71,107,115,.06)" : colorWithAlpha(baseColor, "70");
        context.fill();
        path(top);
        context.fillStyle = ghost ? "rgba(71,107,115,.12)" : colorWithAlpha(baseColor, "d8");
        context.fill();
        context.strokeStyle = ghost ? "rgba(71,107,115,.55)" : "rgba(16,47,60,.55)";
        context.lineWidth = ghost ? 1.2 : 0.8;
        context.stroke();
      });
    };
    if (showComparison && comparison) drawBuildings(comparison, true);
    drawBuildings(model, false);
    context.fillStyle = "#153745";
    context.font = "11px system-ui";
    context.fillText(`${model.buildings.filter((item) => item.kind === "TOWER").length} torres · ${model.totalFloors} pavimentos somados`, 16, 24);
    context.fillStyle = "#677679";
    context.fillText("Arraste para orbitar · roda do mouse para zoom", 16, 42);
  }, [camera, comparison, model, showComparison]);

  return (
    <div className="land-3d-shell">
      <canvas
        ref={canvasRef}
        aria-label={`Massa 3D paramétrica com ${model.buildings.length} volumes`}
        onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, azimuth: camera.azimuth, elevation: camera.elevation }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (!drag.current) return; setCamera((current) => ({ ...current, azimuth: drag.current!.azimuth + (event.clientX - drag.current!.x) / 180, elevation: Math.max(0.2, Math.min(1.15, drag.current!.elevation + (event.clientY - drag.current!.y) / 260)) })); }}
        onPointerUp={() => { drag.current = null; }}
        onWheel={(event) => { event.preventDefault(); setCamera((current) => ({ ...current, zoom: Math.max(1.6, Math.min(9, current.zoom - event.deltaY / 240)) })); }}
      />
      <div className="land-3d-controls">
        <button aria-label="Aproximar massa" onClick={() => setCamera((value) => ({ ...value, zoom: Math.min(9, value.zoom + 0.6) }))}><ZoomIn size={16} /></button>
        <button aria-label="Afastar massa" onClick={() => setCamera((value) => ({ ...value, zoom: Math.max(1.6, value.zoom - 0.6) }))}><ZoomOut size={16} /></button>
        <button aria-label="Restaurar câmera" onClick={() => setCamera({ azimuth: -0.7, elevation: 0.62, zoom: 4.2 })}><RotateCcw size={16} /></button>
      </div>
    </div>
  );
}
