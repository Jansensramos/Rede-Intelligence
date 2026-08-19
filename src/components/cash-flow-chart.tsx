import type { CashFlowMonth } from "@/domain/financial/types";

const WIDTH = 840;
const HEIGHT = 260;
const PAD_X = 24;
const PAD_Y = 24;

function compactCurrency(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${value < 0 ? "−" : ""}R$ ${(absolute / 1_000_000).toFixed(1)} mi`;
  if (absolute >= 1_000) return `${value < 0 ? "−" : ""}R$ ${(absolute / 1_000).toFixed(0)} mil`;
  return `R$ ${absolute.toFixed(0)}`;
}

export function CashFlowChart({ rows }: { rows: CashFlowMonth[] }) {
  const project = rows.map((row) => Number(row.cumulativeProjectCash));
  const equity = rows.map((row) => Number(row.cumulativeEquityCash));
  const values = [...project, ...equity, 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const x = (index: number) => PAD_X + (index / Math.max(1, rows.length - 1)) * (WIDTH - PAD_X * 2);
  const y = (value: number) => PAD_Y + ((max - value) / range) * (HEIGHT - PAD_Y * 2);
  const path = (series: number[]) => series.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const gridValues = Array.from({ length: 5 }, (_, index) => max - (range * index) / 4);
  const markerIndexes = Array.from(new Set([0, Math.floor((rows.length - 1) / 3), Math.floor(((rows.length - 1) * 2) / 3), rows.length - 1]));

  return (
    <div className="cash-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Curvas mensais de caixa do projeto e do equity">
        <defs>
          <linearGradient id="projectArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b98a43" stopOpacity=".22" />
            <stop offset="1" stopColor="#b98a43" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridValues.map((value) => (
          <g key={value}>
            <line x1={PAD_X} x2={WIDTH - PAD_X} y1={y(value)} y2={y(value)} className="chart-grid" />
            <text x={PAD_X} y={y(value) - 7} className="chart-label">{compactCurrency(value)}</text>
          </g>
        ))}
        <line x1={PAD_X} x2={WIDTH - PAD_X} y1={y(0)} y2={y(0)} className="chart-zero" />
        <path d={`${path(project)} L${x(project.length - 1)},${y(min)} L${x(0)},${y(min)} Z`} fill="url(#projectArea)" />
        <path d={path(project)} className="chart-line chart-line-project" />
        <path d={path(equity)} className="chart-line chart-line-equity" />
        {markerIndexes.map((index) => (
          <text key={index} x={x(index)} y={HEIGHT - 2} textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"} className="chart-month">
            M{rows[index]?.month ?? index}
          </text>
        ))}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-project" /> Projeto antes do funding</span>
        <span><i className="legend-equity" /> Capital próprio</span>
      </div>
    </div>
  );
}
