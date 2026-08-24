// Checklist de transparência da decisão (plano 9J, seção AJ) — toda recomendação responde
// obrigatoriamente às 10 perguntas, visível na interface e para a REDE AI.

export interface ExplainabilityInput {
  demandRationale: string;
  areaRationale: string;
  priceRationale: string;
  mixRationale: string;
  competitorsUsed: { name: string; similarityScore: number }[];
  marketAreaLabel: string;
  dataAsOfDate: string;
  sourcesUsed: string[];
  sampleSize: number;
  confidenceLevel: string;
  sensitivityNote: string;
}

export interface ExplainabilityAnswer {
  question: string;
  answer: string;
}

export function buildExplainability(input: ExplainabilityInput): ExplainabilityAnswer[] {
  return [
    { question: "Por que este produto?", answer: input.demandRationale },
    { question: "Por que esta metragem?", answer: input.areaRationale },
    { question: "Por que este preço?", answer: input.priceRationale },
    { question: "Por que este mix?", answer: input.mixRationale },
    {
      question: "Quais concorrentes foram usados?",
      answer: input.competitorsUsed.length > 0
        ? input.competitorsUsed.map((competitor) => `${competitor.name} (similaridade ${(competitor.similarityScore * 100).toFixed(0)}%)`).join("; ")
        : "Nenhum concorrente elegível foi identificado na área de influência.",
    },
    { question: "Qual a área geográfica considerada?", answer: input.marketAreaLabel },
    { question: "Qual a data-base dos dados?", answer: input.dataAsOfDate },
    { question: "Quais as fontes dos dados?", answer: input.sourcesUsed.length > 0 ? input.sourcesUsed.join(", ") : "Nenhuma fonte externa registrada." },
    { question: "Qual o tamanho da amostra?", answer: `${input.sampleSize} observação(ões) comparável(is).` },
    { question: "Qual o nível de confiança e o que pode mudar o cenário?", answer: `${input.confidenceLevel}. ${input.sensitivityNote}` },
  ];
}
