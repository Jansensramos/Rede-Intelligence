"use client";

import React, { useState, useCallback } from "react";
import { BudgetSummary } from "@/domain/budget/budget-engine";

interface BudgetLineItem {
  id: string;
  phase: string;
  category: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
}

interface BudgetEditorProps {
  budgetId: string;
  projectName?: string;
  lineItems: BudgetLineItem[];
  totalBudget: number;
  summary?: BudgetSummary;
  onUpdateItem?: (itemId: string, updates: any) => Promise<void>;
  onDeleteItem?: (itemId: string) => Promise<void>;
  readOnly?: boolean;
}

interface EditingState {
  [key: string]: Partial<BudgetLineItem>;
}

export function BudgetEditor({
  budgetId,
  projectName = "Projeto",
  lineItems,
  totalBudget,
  summary,
  onUpdateItem,
  onDeleteItem,
  readOnly = false,
}: BudgetEditorProps) {
  const [editing, setEditing] = useState<EditingState>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (itemId: string, field: string, value: any) => {
    setEditing((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: field === "description" ? value : parseFloat(value) || 0,
      },
    }));
  };

  const handleSave = useCallback(
    async (itemId: string) => {
      try {
        setLoading(true);
        setError(null);
        const updates = editing[itemId];
        if (updates && onUpdateItem) {
          await onUpdateItem(itemId, updates);
          setEditing((prev) => {
            const newState = { ...prev };
            delete newState[itemId];
            return newState;
          });
        }
      } catch (err: any) {
        setError(err.message || "Erro ao salvar");
      } finally {
        setLoading(false);
      }
    },
    [editing, onUpdateItem]
  );

  const handleDelete = useCallback(
    async (itemId: string) => {
      if (!confirm("Tem certeza que deseja deletar esta linha?")) return;
      try {
        setLoading(true);
        setError(null);
        if (onDeleteItem) {
          await onDeleteItem(itemId);
        }
      } catch (err: any) {
        setError(err.message || "Erro ao deletar");
      } finally {
        setLoading(false);
      }
    },
    [onDeleteItem]
  );

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow">
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-4 rounded-t-lg">
          <h2 className="text-2xl font-bold">{projectName}</h2>
          <p className="text-slate-200 text-sm">Orçamento Detalhado</p>
        </div>

        {summary && (
          <div className="grid grid-cols-3 gap-4 px-6 py-4 bg-slate-50 border-b border-slate-200">
            <div>
              <p className="text-xs text-slate-600 font-semibold">TOTAL DE CUSTOS</p>
              <p className="text-2xl font-bold text-slate-800">
                {formatCurrency(summary.totalBudget)}
              </p>
            </div>
            {summary.vgv && (
              <>
                <div>
                  <p className="text-xs text-slate-600 font-semibold">MARGIN</p>
                  <p className="text-2xl font-bold text-green-600">
                    {formatCurrency(summary.margin || 0)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatPercent(summary.marginPercentage || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600 font-semibold">VGV</p>
                  <p className="text-2xl font-bold text-slate-800">
                    {formatCurrency(summary.vgv)}
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
            ⚠️ {error}
          </div>
        )}

        <div className="overflow-x-auto px-6 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-50">
                <th className="text-left py-3 font-semibold text-slate-700">Fase</th>
                <th className="text-left py-3 font-semibold text-slate-700">Categoria</th>
                <th className="text-left py-3 font-semibold text-slate-700">Descrição</th>
                <th className="text-right py-3 font-semibold text-slate-700">Qtd</th>
                <th className="text-center py-3 font-semibold text-slate-700">Unit</th>
                <th className="text-right py-3 font-semibold text-slate-700">Valor Unit</th>
                <th className="text-right py-3 font-semibold text-slate-700">Total</th>
                {!readOnly && (
                  <th className="text-center py-3 font-semibold text-slate-700">Ações</th>
                )}
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => {
                const isEditing = item.id in editing;
                const values = editing[item.id] || item;
                const calculatedTotal =
                  (values.quantity || 0) * (values.unitCost || 0);

                return (
                  <tr
                    key={item.id}
                    className="border-b border-slate-200 hover:bg-slate-50"
                  >
                    <td className="py-3 text-slate-600">{item.phase}</td>
                    <td className="py-3">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                        {item.category}
                      </span>
                    </td>
                    <td className="py-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={values.description || ""}
                          onChange={(e) =>
                            handleInputChange(item.id, "description", e.target.value)
                          }
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
                          disabled={loading || readOnly}
                        />
                      ) : (
                        <span className="text-slate-800">{item.description}</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          value={values.quantity || 0}
                          onChange={(e) =>
                            handleInputChange(item.id, "quantity", e.target.value)
                          }
                          className="w-20 px-2 py-1 border border-slate-300 rounded text-sm text-right"
                          disabled={loading || readOnly}
                        />
                      ) : (
                        <span className="text-slate-800">
                          {item.quantity.toLocaleString("pt-BR")}
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-center text-slate-600">{item.unit}</td>
                    <td className="py-3 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          value={values.unitCost || 0}
                          onChange={(e) =>
                            handleInputChange(item.id, "unitCost", e.target.value)
                          }
                          className="w-28 px-2 py-1 border border-slate-300 rounded text-sm text-right"
                          disabled={loading || readOnly}
                        />
                      ) : (
                        <span className="text-slate-800">
                          {formatCurrency(item.unitCost)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right font-semibold text-slate-800">
                      {formatCurrency(isEditing ? calculatedTotal : item.totalCost)}
                    </td>
                    {!readOnly && (
                      <td className="py-3 text-center">
                        {isEditing ? (
                          <div className="flex gap-2 justify-center">
                            <button
                              onClick={() => handleSave(item.id)}
                              disabled={loading}
                              className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() =>
                                setEditing((prev) => {
                                  const newState = { ...prev };
                                  delete newState[item.id];
                                  return newState;
                                })
                              }
                              disabled={loading}
                              className="px-2 py-1 bg-slate-400 text-white rounded text-xs hover:bg-slate-500 disabled:opacity-50"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2 justify-center">
                            <button
                              onClick={() =>
                                setEditing((prev) => ({
                                  ...prev,
                                  [item.id]: { ...item },
                                }))
                              }
                              className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(item.id)}
                              disabled={loading}
                              className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-50"
                            >
                              Del
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold border-t-2 border-slate-800">
                <td colSpan={6} className="py-3 px-0 text-right">
                  TOTAL:
                </td>
                <td className="py-3 text-right text-lg text-slate-800">
                  {formatCurrency(totalBudget)}
                </td>
                {!readOnly && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>

        {summary?.categoryTotals && (
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
            <h3 className="font-semibold text-slate-800 mb-3">
              Breakdown por Categoria
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {summary.categoryTotals.map((cat) => (
                <div
                  key={cat.category}
                  className="bg-white p-3 rounded border border-slate-200"
                >
                  <p className="text-xs text-slate-600 font-semibold">
                    {cat.category}
                  </p>
                  <p className="text-lg font-bold text-slate-800">
                    {formatCurrency(cat.totalCost)}
                  </p>
                  <p className="text-xs text-slate-500">{formatPercent(cat.percentage)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-slate-600 text-center">
        Edite valores para recalcular custos e impacto financeiro
      </div>
    </div>
  );
}