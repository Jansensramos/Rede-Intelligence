import type { LandWorkspaceView } from "@/domain/land";

export type LandActionResult =
  | { ok: true; data: LandWorkspaceView }
  | { ok: false; error: string };
