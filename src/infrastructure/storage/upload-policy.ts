import { createHash } from "node:crypto";

export interface MalwareScanner {
  scan(input: { bytes: Uint8Array; fileName: string; checksum: string }): Promise<{ clean: boolean; reason?: string }>;
}

export const malwareScanner: MalwareScanner = {
  async scan() { return { clean: true, reason: "Scanner não configurado; boundary de integração ativa." }; },
};

export async function inspectUpload(input: { bytes: Uint8Array; fileName: string; scanner?: MalwareScanner }) {
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const result = await (input.scanner ?? malwareScanner).scan({ ...input, checksum });
  if (!result.clean) throw new Error("Arquivo rejeitado pela política de segurança.");
  return { checksum, scanner: result.reason ?? "verificado" };
}
