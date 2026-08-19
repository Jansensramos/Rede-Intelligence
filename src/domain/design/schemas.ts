import { z } from "zod";

export const createDesignPackageSchema = z.object({
  projectId: z.string().min(1),
  investmentCaseId: z.string().min(1).optional(),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(3000).default(""),
  template: z.enum(["RESIDENTIAL_VERTICAL", "RESIDENTIAL_HORIZONTAL", "MIXED_USE", "COMMERCIAL", "LOGISTICS", "INDUSTRIAL", "URBANIZATION", "CUSTOM"]).default("RESIDENTIAL_VERTICAL"),
  reviewMode: z.enum(["EXECUTIVE_REVIEW", "ARCHITECTURAL_REVIEW", "URBAN_REVIEW", "PRODUCT_REVIEW", "EFFICIENCY_REVIEW", "COST_REVIEW", "VALUE_ENGINEERING", "COMMERCIAL_REVIEW", "CONSTRUCTABILITY_REVIEW", "BIM_COORDINATION", "INVESTOR_REVIEW", "FULL_REVIEW"]).default("FULL_REVIEW"),
});

export const uploadDesignFileSchema = z.object({
  packageId: z.string().min(1),
  revisionId: z.string().min(1),
  discipline: z.enum(["ARCHITECTURE", "URBANISM", "STRUCTURAL", "FOUNDATION", "ELECTRICAL", "PLUMBING", "HVAC", "FIRE", "ACCESSIBILITY", "LANDSCAPE", "INTERIORS", "PARKING", "INFRASTRUCTURE", "DRAINAGE", "ROAD", "GEOTECHNICAL", "TOPOGRAPHY", "BIM", "COST", "SCHEDULE", "SPECIFICATION", "OTHER"]),
  revision: z.string().trim().min(1).max(30),
});

export const createDesignRevisionSchema = z.object({
  packageId: z.string().min(1),
  label: z.string().trim().min(3).max(120),
  description: z.string().trim().max(3000).default(""),
});

export const calibrateSheetSchema = z.object({
  sheetId: z.string().min(1),
  pixelDistance: z.number().positive(),
  realDistance: z.number().positive(),
  unit: z.enum(["mm", "cm", "m"]),
  pointA: z.object({ x: z.number(), y: z.number() }),
  pointB: z.object({ x: z.number(), y: z.number() }),
});

export const createFindingSchema = z.object({
  packageId: z.string().min(1),
  revisionId: z.string().min(1),
  fileId: z.string().optional(),
  sheetId: z.string().optional(),
  discipline: z.enum(["ARCHITECTURE", "URBANISM", "STRUCTURAL", "FOUNDATION", "ELECTRICAL", "PLUMBING", "HVAC", "FIRE", "ACCESSIBILITY", "LANDSCAPE", "INTERIORS", "PARKING", "INFRASTRUCTURE", "DRAINAGE", "ROAD", "GEOTECHNICAL", "TOPOGRAPHY", "BIM", "COST", "SCHEDULE", "SPECIFICATION", "OTHER"]),
  category: z.string().trim().min(1).max(80),
  type: z.enum(["ERROR", "INCONSISTENCY", "INEFFICIENCY", "CODE_CHECK", "URBAN_CONFLICT", "AREA_MISMATCH", "DESIGN_OPPORTUNITY", "COST_OPPORTUNITY", "PRODUCT_OPPORTUNITY", "CONSTRUCTABILITY", "COORDINATION", "MISSING_INFORMATION", "DOCUMENTATION", "VALUE_ENGINEERING", "COMMERCIAL_OPPORTUNITY", "OTHER"]),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(3).max(5000),
  recommendation: z.string().trim().min(3).max(5000),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).optional(),
});

export const createAlternativeSchema = z.object({
  packageId: z.string().min(1),
  revisionId: z.string().min(1),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(3000),
  changes: z.object({
    builtAreaM2: z.number().optional(),
    privateAreaM2: z.number().optional(),
    units: z.number().int().optional(),
    parkingSpaces: z.number().int().optional(),
    constructionMonths: z.number().int().optional(),
  }),
});
