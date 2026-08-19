import { z } from "zod";

export const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const polygonSchema = z.object({ type: z.literal("Polygon"), coordinates: z.array(pointSchema).min(3).max(10_000) });

export const urbanScenarioUpdateSchema = z.object({
  landStudyId: z.string().min(1),
  expectedVersionNumber: z.number().int().positive(),
  justification: z.string().trim().min(8).max(500),
  polygon: polygonSchema.optional(),
  parameters: z.object({
    permittedUses: z.array(z.string().trim().min(1)).min(1).max(20).optional(),
    maximumFAR: z.number().min(0.01).max(20),
    occupancyRate: z.number().min(1).max(100),
    permeabilityRate: z.number().min(0).max(100),
    maximumHeight: z.number().min(3).max(300),
    maximumFloors: z.number().int().min(1).max(100),
    frontSetback: z.number().min(0).max(100),
    rearSetback: z.number().min(0).max(100),
    sideSetback: z.number().min(0).max(100),
    betweenBuildings: z.number().min(0).max(100),
    parkingRequirement: z.number().min(0).max(10),
    residentialDensity: z.number().min(0).max(10_000),
  }),
  product: z.object({
    targetUnits: z.number().int().min(1).max(100_000),
    averageUnitArea: z.number().min(15).max(500),
    numberOfTowers: z.number().int().min(1).max(500),
    unitsPerFloor: z.number().int().min(1).max(100),
    floors: z.number().int().min(1).max(100),
    efficiency: z.number().min(30).max(95),
    parkingRatio: z.number().min(0).max(10),
    compactShare: z.number().min(0).max(100).optional(),
  }),
});

export type UrbanScenarioUpdateInput = z.infer<typeof urbanScenarioUpdateSchema>;
