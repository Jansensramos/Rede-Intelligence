"use server";

import { requireAuthContext } from "@/application/auth/session";
import {
  calibrateDesignSheet,
  createAndCalculateAlternative,
  createDesignPackage,
  createDesignRevision,
  createManualDesignFinding,
  uploadAndProcessDesignFile,
} from "@/application/design/design-service";
import { generateDesignReviewReport } from "@/application/design/design-report-service";
import { createFindingFromClash } from "@/application/design/bim-service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "A operação não pôde ser concluída.";

export async function createDesignPackageAction(input: Parameters<typeof createDesignPackage>[1]): Promise<ActionResult<Awaited<ReturnType<typeof createDesignPackage>>>> {
  const context = await requireAuthContext();
  try { return { ok: true, data: await createDesignPackage(context, input) }; }
  catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function createDesignRevisionAction(input: Parameters<typeof createDesignRevision>[1]): Promise<ActionResult<Awaited<ReturnType<typeof createDesignRevision>>>> {
  const context = await requireAuthContext();
  try { return { ok: true, data: await createDesignRevision(context, input) }; }
  catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function uploadDesignFileAction(formData: FormData): Promise<ActionResult<Awaited<ReturnType<typeof uploadAndProcessDesignFile>>>> {
  const context = await requireAuthContext();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Selecione um arquivo válido." };
  try {
    return { ok: true, data: await uploadAndProcessDesignFile(context, { packageId: String(formData.get("packageId") ?? ""), revisionId: String(formData.get("revisionId") ?? ""), discipline: String(formData.get("discipline") ?? "OTHER"), revision: String(formData.get("revision") ?? "01"), file }, { deferProcessing: true }) };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function calibrateDesignSheetAction(input: Parameters<typeof calibrateDesignSheet>[1]): Promise<ActionResult<Awaited<ReturnType<typeof calibrateDesignSheet>>>> {
  const context = await requireAuthContext();
  try { return { ok: true, data: await calibrateDesignSheet(context, input) }; }
  catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function createManualDesignFindingAction(input: Parameters<typeof createManualDesignFinding>[1]): Promise<ActionResult<Awaited<ReturnType<typeof createManualDesignFinding>>>> {
  const context = await requireAuthContext();
  try { return { ok: true, data: await createManualDesignFinding(context, input) }; }
  catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function createDesignAlternativeAction(input: Parameters<typeof createAndCalculateAlternative>[1]): Promise<ActionResult<Awaited<ReturnType<typeof createAndCalculateAlternative>>>> {
  const context = await requireAuthContext();
  try { return { ok: true, data: await createAndCalculateAlternative(context, input) }; }
  catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function generateDesignReviewReportAction(packageId: string) {
  const context = await requireAuthContext();
  try {
    const result = await generateDesignReviewReport(context, packageId);
    return { ok: true as const, data: { ...result, content: undefined, contentBase64: Buffer.from(result.content).toString("base64") } };
  } catch (error) { return { ok: false as const, error: errorMessage(error) }; }
}

export async function createFindingFromClashAction(clashId: string): Promise<ActionResult<string>> {
  const context = await requireAuthContext();
  try { return { ok: true, data: await createFindingFromClash(context, clashId) }; }
  catch (error) { return { ok: false, error: errorMessage(error) }; }
}
