"use client";

import { useEffect } from "react";

const replacements: Array<[RegExp, string]> = [
  [/OPERAÇÃO HUMANA\s*[·•-]\s*10C\.1/gi, ""],
  [/ENGINE\s*v?1\.0/gi, ""],
  [/\s*\((?:Fase|Phase)\s+\d+[A-Z](?:\.\d+[A-Z]?)?\)/gi, ""],
  [/\s*\(\d+[A-Z](?:\.\d+[A-Z]?)?\)/g, ""],
  [/\b(?:Fase|Phase)\s+\d+[A-Z](?:\.\d+[A-Z]?)?\b/gi, ""],
  [/\b\d{1,2}[A-Z](?:\.\d+[A-Z]?)?\b/g, ""],
  [/\bleitura direta da\s+\d+[A-Z](?:\.\d+[A-Z]?)?\b/gi, "integrado ao Financeiro"],

  [/\bLearning Loop\b/gi, "Aprendizado com Resultados"],
  [/\bDecision Engine\b/gi, "Recomendação Estruturada"],
  [/\bRed Team 2\.0\b/gi, "Revisão Crítica"],
  [/\bRed Team\b/gi, "Revisão Crítica"],
  [/\bAutopilot\b/gi, "Recomendações Assistidas"],
  [/\bInvestment Committee\b/gi, "Análise Multidisciplinar"],
  [/\bTool Layer\b/gi, "Camada de Evidências"],
  [/\bContext Engine\b/gi, "Contexto de Análise"],
  [/\bAI Gateway\b/gi, "Conexão de Inteligência"],
  [/\bProvider de IA\b/gi, "Provedor de inteligência"],
  [/\bProvider comercial\b/gi, "Provedor comercial"],
  [/\bprovider\b/gi, "provedor"],
  [/\bData Room\b/gi, "Sala de Documentos"],
  [/\bDesign Intelligence\b/gi, "Inteligência de Projetos"],
  [/\bMarket Intelligence\b/gi, "Inteligência de Mercado"],
  [/\bProduct Intelligence\b/gi, "Inteligência de Produto"],
  [/\bScore\b/g, "Índice"],
  [/\bBenchmark(?:s)?\b/gi, "Comparativos"],
  [/\bReady\b/g, "Pronto"],
  [/\bWaiting Data\b/gi, "Aguardando dados"],
  [/\bExternal Dependency\b/gi, "Dependência externa"],
];

function cleanText(value: string) {
  let next = value;
  for (const [pattern, replacement] of replacements) next = next.replace(pattern, replacement);
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:])/g, "$1")
    .replace(/\s+·\s*$/g, "")
    .trimEnd();
}

function sanitize(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || ["SCRIPT", "STYLE", "CODE", "PRE"].includes(parent.tagName)) continue;
    const value = node.nodeValue ?? "";
    const next = cleanText(value);
    if (next !== value) node.nodeValue = next;
  }
}

export function UserFacingTextSanitizer() {
  useEffect(() => {
    sanitize(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) {
          const node = mutation.target as Text;
          const value = node.nodeValue ?? "";
          const next = cleanText(value);
          if (next !== value) node.nodeValue = next;
          continue;
        }
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) sanitize(node as Element);
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node as Text;
            const value = text.nodeValue ?? "";
            const next = cleanText(value);
            if (next !== value) text.nodeValue = next;
          }
        });
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
