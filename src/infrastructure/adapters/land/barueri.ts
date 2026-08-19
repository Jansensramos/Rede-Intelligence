import type { UrbanConfidence, UrbanParameters, UrbanSource } from "@/domain/land";
import type { AdapterResult, MunicipalityAdapter, ParcelLookupInput } from "./contracts";

const accessedAt = "2026-08-17T12:00:00.000Z";

export const BARUERI_SOURCES: UrbanSource[] = [
  {
    id: "BARUERI_LC565_2023",
    type: "OFFICIAL_LAW",
    authority: "Prefeitura Municipal de Barueri",
    title: "Lei Complementar nº 565, de 11 de dezembro de 2023",
    url: "https://portal.barueri.sp.gov.br/arquivos/sites/spcu/2024/Lei_Complementar_565_2023_juridico.pdf",
    legislation: "LC 565/2023",
    effectiveDate: "2023-12-11",
    accessedAt,
    version: "2023-12-11",
    confidence: "CONFIRMED",
    notes: "Fonte oficial. A associação do setor ao lote deve ser confirmada no mapa/certidão municipal.",
  },
  {
    id: "BARUERI_ZONING_MAP",
    type: "OFFICIAL_MAP",
    authority: "Secretaria de Planejamento e Urbanismo de Barueri",
    title: "Lei de Parcelamento, Uso e Ocupação do Solo — mapa e legislação",
    url: "https://portal.barueri.sp.gov.br/secretarias/secretaria-planejamento-urbanismo/mapa-zoneamento",
    legislation: "LC 565/2023",
    effectiveDate: "2023-12-11",
    accessedAt,
    version: "consulta 2026-08-17",
    confidence: "HIGH",
    notes: "O portal não expõe API pública estruturada de parcelamento nesta integração.",
  },
  {
    id: "BARUERI_MANUAL_PARCEL",
    type: "USER_INPUT",
    authority: "Usuário responsável pelo estudo",
    title: "Confirmação manual de lote e setor",
    url: null,
    legislation: null,
    effectiveDate: null,
    accessedAt,
    version: "1",
    confidence: "MANUAL",
    notes: "Deve ser reconciliada com matrícula, IPTU, planta aprovada ou certidão de uso do solo.",
  },
  {
    id: "LAND_DERIVED",
    type: "DERIVED",
    authority: "REDE Land Engine",
    title: "Parâmetro derivado deterministicamente",
    url: null,
    legislation: null,
    effectiveDate: null,
    accessedAt,
    version: "REDE_LAND_V1.0.0",
    confidence: "MEDIUM",
  },
];

function sourced<T>(value: T, sourceId = "BARUERI_LC565_2023", confidence: UrbanConfidence = "CONFIRMED", notes?: string) {
  return { value, sourceId, confidence, notes };
}

export function barueriSrmParameters(): UrbanParameters {
  return {
    zoningCode: sourced("SRM"),
    zoningName: sourced("Setor de Uso Predominantemente Residencial de Média Densidade"),
    permittedUses: sourced(["Residencial unifamiliar", "Residencial plurifamiliar vertical", "Uso misto", "Comércio e serviços condicionados"]),
    conditionalUses: sourced(["Comércio local quando previsto no loteamento", "Empreendimento sujeito a análise de impacto quando aplicável"]),
    prohibitedUses: sourced([], "BARUERI_MANUAL_PARCEL", "MANUAL", "A lista exaustiva deve ser confirmada para o setor cadastral do lote."),
    minimumLotArea: sourced(1000),
    minimumFrontage: sourced(20),
    basicFAR: sourced(4),
    maximumFAR: sourced(5),
    occupancyRate: sourced(50),
    permeabilityRate: sourced(null, "BARUERI_MANUAL_PARCEL", "MANUAL", "Não consolidada pelo adapter; exige validação técnica."),
    maximumHeight: sourced(null, "BARUERI_MANUAL_PARCEL", "MANUAL", "A LC 565/2023 expressa recuos em função da altura, mas o adapter não confirmou gabarito absoluto."),
    maximumFloors: sourced(null, "BARUERI_MANUAL_PARCEL", "MANUAL", "Mínimo de cinco pavimentos para residencial plurifamiliar; máximo não confirmado."),
    setbacks: sourced({ front: 15, rear: 5, side: 3, betweenBuildings: 4 }, "BARUERI_LC565_2023", "HIGH", "Mínimos do art. 41; fórmulas h/6, h/8 e h/10 podem exigir valores maiores conforme a altura."),
    parkingRequirement: sourced(null, "BARUERI_MANUAL_PARCEL", "MANUAL", "Regra deve ser confirmada conforme uso, área e anexos aplicáveis."),
    bicycleRequirement: sourced(null, "BARUERI_MANUAL_PARCEL", "MANUAL"),
    residentialDensity: sourced(null, "BARUERI_MANUAL_PARCEL", "MANUAL"),
    commercialAllowance: sourced(true),
    mixedUseAllowance: sourced(true),
    nonComputableAreaRate: sourced(15, "LAND_DERIVED", "MEDIUM", "Hipótese técnica de estudo, não parâmetro legal."),
    customParameters: {
      minimumResidentialFloors: sourced(5),
      setbackFormulaFront: sourced("max(h/6, 15m)"),
      setbackFormulaSide: sourced("max(h/8, 3m)"),
      setbackFormulaRear: sourced("max(h/10, 5m)"),
      setbackFormulaBetweenBuildings: sourced("max(h/6, 4m)"),
    },
  };
}

export class BarueriMunicipalityAdapter implements MunicipalityAdapter {
  readonly municipalityCode = "3505708";
  readonly municipalityName = "Barueri/SP";

  async identifyParcel(input: ParcelLookupInput): Promise<AdapterResult<never>> {
    void input;
    return {
      status: "MANUAL_REQUIRED",
      data: null,
      sourceIds: ["BARUERI_ZONING_MAP", "BARUERI_MANUAL_PARCEL"],
      warnings: ["Não foi identificada API pública estruturada de parcela. Confirme ou importe o polígono e o cadastro municipal."],
    };
  }

  async getZoning(input: ParcelLookupInput & { confirmedZoningCode?: string }) {
    if (input.confirmedZoningCode?.toUpperCase() === "SRM") {
      return { status: "PARTIAL" as const, data: { zoningCode: "SRM", zoningName: "Setor de Uso Predominantemente Residencial de Média Densidade" }, sourceIds: ["BARUERI_LC565_2023", "BARUERI_MANUAL_PARCEL"], warnings: ["O código SRM foi confirmado manualmente; reconcilie-o com mapa ou certidão municipal do lote."] };
    }
    return { status: "MANUAL_REQUIRED" as const, data: null, sourceIds: ["BARUERI_ZONING_MAP"], warnings: ["Informe o setor constante do mapa ou da certidão municipal."] };
  }

  async getUrbanParameters(zoningCode: string) {
    if (zoningCode.toUpperCase() !== "SRM") return { status: "MANUAL_REQUIRED" as const, data: null, sourceIds: ["BARUERI_LC565_2023"], warnings: [`O adapter v1 ainda não normaliza o setor ${zoningCode}. Use preenchimento manual com provenance.`] };
    return { status: "PARTIAL" as const, data: barueriSrmParameters(), sourceIds: ["BARUERI_LC565_2023"], warnings: ["Gabarito, permeabilidade, vagas e associação cadastral permanecem pendentes de confirmação."] };
  }

  async getRestrictions(input: ParcelLookupInput) {
    void input;
    return { status: "MANUAL_REQUIRED" as const, data: [], sourceIds: ["BARUERI_MANUAL_PARCEL"], warnings: ["Restrições ambientais, viárias, registrais e de infraestrutura não foram verificadas automaticamente."] };
  }

  async getSourceMetadata() {
    return BARUERI_SOURCES;
  }
}
