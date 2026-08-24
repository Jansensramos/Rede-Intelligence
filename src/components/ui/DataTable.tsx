/**
 * Tabela padronizada, v1 (Fase 9K.0, plano §Z "Tabelas" e §3 "Design System base").
 *
 * Hoje: zero elementos `<table>` no projeto — cada view desenha sua própria grade CSS, sem
 * ocultação de coluna, sem coluna fixa, sem scroll horizontal controlado (plano §A.8).
 *
 * Esta v1 cobre: prioridade de coluna (essencial sempre visível; padrão e opcional podem ser
 * ocultadas), contêiner com `overflow-x` próprio (a página nunca rola na horizontal) e primeira
 * coluna fixa. Detalhamento lateral ao clicar na linha (nível 3 do plano §F) depende de rota real
 * e fica para a 9K.1 — aqui o clique de linha só dispara `onRowClick`, se informado.
 */
"use client";

import { useMemo, useState, type ReactNode } from "react";

export type ColumnPriority = "essential" | "default" | "optional";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  priority: ColumnPriority;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, emptyMessage = "Nenhum registro encontrado." }: DataTableProps<T>) {
  const [hiddenOptional, setHiddenOptional] = useState(true);
  const visibleColumns = useMemo(
    () => (hiddenOptional ? columns.filter((column) => column.priority !== "optional") : columns),
    [columns, hiddenOptional],
  );
  const hasOptionalColumns = columns.some((column) => column.priority === "optional");

  if (rows.length === 0) {
    return <p className="ds-data-table-empty">{emptyMessage}</p>;
  }

  return (
    <div className="ds-data-table-wrap">
      {hasOptionalColumns && (
        <button type="button" className="ds-data-table-toggle" onClick={() => setHiddenOptional((value) => !value)}>
          {hiddenOptional ? "Mostrar todas as colunas" : "Mostrar só colunas essenciais"}
        </button>
      )}
      <div className="ds-data-table-scroll">
        <table className="ds-data-table">
          <thead>
            <tr>
              {visibleColumns.map((column, index) => (
                <th key={column.key} className={index === 0 ? "ds-data-table-sticky" : undefined} style={{ textAlign: column.align ?? (index === 0 ? "left" : "right") }}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className={onRowClick ? "ds-data-table-clickable" : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {visibleColumns.map((column, index) => (
                  <td key={column.key} className={index === 0 ? "ds-data-table-sticky" : undefined} style={{ textAlign: column.align ?? (index === 0 ? "left" : "right") }}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
