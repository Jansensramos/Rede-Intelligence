import { createHash } from "node:crypto";
import { validateDocumentUpload } from "./upload-validation";

export interface MalwareScannerProvider {
  readonly name?: string;
  scan(input: { bytes: Uint8Array; fileName: string; checksum: string }): Promise<{ clean: boolean; reason?: string }>;
}

export class NoopDevelopmentScanner implements MalwareScannerProvider {
  readonly name = "NOOP_DEVELOPMENT_ONLY";
  async scan() { return { clean: true, reason: "Scanner não configurado; boundary de integração ativa." }; }
}

export class UnavailableProductionScanner implements MalwareScannerProvider {
  readonly name = "UNAVAILABLE_FAIL_CLOSED";
  async scan() { return { clean: false, reason: "Scanner antimalware de produção indisponível." }; }
}

export function createMalwareScanner(environment = process.env.NODE_ENV, provider = process.env.MALWARE_SCANNER_PROVIDER): MalwareScannerProvider {
  if (environment === "production") {
    if (provider === "noop" || !provider) throw new Error("NoopScanner é proibido em produção.");
    return new UnavailableProductionScanner();
  }
  return new NoopDevelopmentScanner();
}

export async function inspectUpload(input: { bytes: Uint8Array; fileName: string; mimeType?: string; scanner?: MalwareScannerProvider }) {
  if (input.mimeType !== undefined) validateDocumentUpload({ fileName: input.fileName, mimeType: input.mimeType, bytes: input.bytes });
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const result = await (input.scanner ?? createMalwareScanner()).scan({ bytes: input.bytes, fileName: input.fileName, checksum });
  if (!result.clean) throw new Error("Arquivo rejeitado pela política de segurança.");
  return { checksum, scanner: result.reason ?? "verificado" };
}
