import type { DesignMetricInput, DesignReviewInput } from "./types";

function metric(name: string, value: number, unit: string, ref: string, label: string, origin: DesignMetricInput["origin"] = "USER_PROVIDED", confidence: DesignMetricInput["confidence"] = "HIGH"): DesignMetricInput {
  return { name, value, unit, origin, confidence, evidence: [{ ref, label, value: `${value} ${unit}`, origin, confidence, method: origin === "USER_PROVIDED" ? "DEMO_VERIFIED_INPUT" : "VECTOR_EXTRACTION" }] };
}

export function createDesignDemoReviewInput(revisionId = "demo-revision"): DesignReviewInput {
  return {
    revisionId,
    projectName: "Residencial Horizonte",
    reviewMode: "FULL_REVIEW",
    documents: [
      { id: "demo-arq", name: "ARQ-QUADRO-AREAS-R04.pdf", extension: "pdf", discipline: "ARCHITECTURE", pageCount: 12, scaleConfidence: "CONFIRMED", support: "SUPPORTED" },
      { id: "demo-est", name: "EST-CONCEPCAO-R04.pdf", extension: "pdf", discipline: "STRUCTURAL", pageCount: 4, scaleConfidence: "HIGH", support: "SUPPORTED" },
      { id: "demo-ifc", name: "COORDENADO-R04.ifc", extension: "ifc", discipline: "BIM", scaleConfidence: "HIGH", support: "PARTIAL" },
    ],
    metrics: [
      metric("DECLARED_TOTAL_AREA_M2", 18_240, "m2", "SHEET:ARQ-001:R04:AREA_TABLE", "Quadro de áreas · ARQ-001 Rev 04"),
      metric("GEOMETRY_TOTAL_AREA_M2", 18_890, "m2", "IFC:R04:GROSS_FLOOR_AREA", "IFC Rev 04 · gross floor area", "EXTRACTED", "MEDIUM"),
      metric("TOTAL_BUILT_AREA_M2", 18_890, "m2", "IFC:R04:GROSS_FLOOR_AREA", "IFC Rev 04 · gross floor area", "EXTRACTED", "MEDIUM"),
      metric("PRIVATE_AREA_M2", 13_751.92, "m2", "SHEET:ARQ-001:R04:PRIVATE", "Quadro de áreas privativas"),
      metric("CIRCULATION_AREA_M2", 2_455.7, "m2", "IFC:R04:SPACE:CIRCULATION", "Espaços IFC classificados como circulação", "EXTRACTED", "MEDIUM"),
      metric("CORE_AREA_M2", 1_511.2, "m2", "IFC:R04:CORE", "Core consolidado", "EXTRACTED", "MEDIUM"),
      metric("COMMON_AREA_M2", 1_171.18, "m2", "SHEET:ARQ-001:R04:COMMON", "Quadro de áreas comuns"),
      metric("PARKING_AREA_M2", 4_880, "m2", "SHEET:ARQ-SUBSOLO:R04", "Subsolos"),
      metric("PARKING_SPACES", 218, "spaces", "SHEET:ARQ-SUBSOLO:R04:COUNT", "Contagem validada de vagas"),
      metric("UNIT_COUNT", 306, "units", "SHEET:ARQ-TIPO:R04:UNIT_COUNT", "Contagem de unidades"),
      metric("FLOOR_AREA_RATIO", 3.62, "ratio", "SHEET:ARQ-IMPL:R04:CA", "CA indicado na implantação", "EXTRACTED", "MEDIUM"),
    ],
    brief: { targetUnits: 300, targetPrivateAreaM2: 13_900, targetBuiltAreaM2: 18_100, targetEfficiencyRate: 0.76, maximumCirculationRate: 0.11, maximumCoreRate: 0.07, targetParkingSpaces: 210 },
    urban: { scenarioType: "TARGET", maximumFloorAreaRatio: 3.5, confidence: "HIGH", sourceRef: "URBAN_SCENARIO:TARGET:CA" },
    economics: { engineBuiltAreaM2: 18_100, enginePrivateAreaM2: 13_900, engineUnits: 300, constructionCostPerM2: 3_250, averageRevenuePerPrivateM2: 8_900, engineEvidenceRef: "ENGINE:BASE:BUILT_AREA" },
    areaToleranceRate: 0.01,
    areaToleranceM2: 20,
  };
}
