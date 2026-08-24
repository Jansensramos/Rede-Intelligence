// Catálogo padronizado de tipologias imobiliárias (plano 9J, seção AA).

export interface TypologyBand {
  code: string;
  label: string;
  minAreaM2: number;
  maxAreaM2: number;
  bedrooms: number;
  suites: number;
  defaultParkingSpaces: number;
}

export const TYPOLOGY_CATALOG: readonly TypologyBand[] = [
  { code: "STUDIO", label: "Studio", minAreaM2: 20, maxAreaM2: 32, bedrooms: 0, suites: 0, defaultParkingSpaces: 0 },
  { code: "1_DORMITORY", label: "1 Dormitório", minAreaM2: 33, maxAreaM2: 42, bedrooms: 1, suites: 0, defaultParkingSpaces: 1 },
  { code: "2_DORMITORIES_COMPACT", label: "2 Dormitórios Compacto", minAreaM2: 43, maxAreaM2: 52, bedrooms: 2, suites: 0, defaultParkingSpaces: 1 },
  { code: "2_DORMITORIES_SUITE", label: "2 Dormitórios com Suíte", minAreaM2: 53, maxAreaM2: 65, bedrooms: 2, suites: 1, defaultParkingSpaces: 2 },
  { code: "3_DORMITORIES_SUITE", label: "3 Dormitórios com Suíte", minAreaM2: 66, maxAreaM2: 85, bedrooms: 3, suites: 1, defaultParkingSpaces: 2 },
  { code: "3_DORMITORIES_PLENUS", label: "3 Dormitórios Plenus", minAreaM2: 86, maxAreaM2: 120, bedrooms: 3, suites: 2, defaultParkingSpaces: 2 },
  { code: "4_PLUS_DORMITORIES", label: "4+ Dormitórios", minAreaM2: 121, maxAreaM2: 260, bedrooms: 4, suites: 3, defaultParkingSpaces: 3 },
] as const;

export function findTypologyByCode(code: string): TypologyBand {
  const found = TYPOLOGY_CATALOG.find((band) => band.code === code);
  if (!found) throw new Error(`Tipologia "${code}" não está no catálogo padronizado.`);
  return found;
}

export function selectTypologyForArea(areaM2: number): TypologyBand {
  const found = TYPOLOGY_CATALOG.find((band) => areaM2 >= band.minAreaM2 && areaM2 <= band.maxAreaM2);
  return found ?? TYPOLOGY_CATALOG[TYPOLOGY_CATALOG.length - 1];
}

export function typologyMidpointAreaM2(band: TypologyBand): number {
  return (band.minAreaM2 + band.maxAreaM2) / 2;
}
