import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * ZIP mínimo (sem dependência externa) suficiente para ler/escrever um XLSX real
 * (OOXML = ZIP de partes XML). Suporta apenas STORE (0) e DEFLATE (8), que é
 * exatamente o que Excel/LibreOffice produzem. Não é um leitor de ZIP genérico
 * de propósito geral — não interpreta multi-volume, criptografia ou ZIP64.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  name: string;
  data: Buffer;
}

export function createZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // method = deflate
    localHeader.writeUInt16LE(0, 10); // time
    localHeader.writeUInt16LE(0, 12); // date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralDirectoryOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

export interface ZipReadOptions {
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
}

export function readZip(buffer: Buffer, limits: ZipReadOptions): Map<string, Buffer> {
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdIndex = buffer.lastIndexOf(eocdSignature);
  if (eocdIndex === -1) throw new Error("Arquivo não é um ZIP/XLSX válido (EOCD ausente).");
  const entryCount = buffer.readUInt16LE(eocdIndex + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdIndex + 16);

  const result = new Map<string, Buffer>();
  let cursor = centralDirectoryOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < entryCount; i += 1) {
    const signature = buffer.readUInt32LE(cursor);
    if (signature !== 0x02014b50) throw new Error("Central directory corrompida.");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if (uncompressedSize > limits.maxEntryUncompressedBytes) throw new Error(`Entrada "${name}" excede o limite por arquivo (possível zip bomb).`);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) throw new Error("Conteúdo descomprimido total excede o limite permitido (possível zip bomb).");

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressedData) : method === 8 ? inflateRawSync(compressedData) : (() => { throw new Error(`Método de compressão ${method} não suportado.`); })();
    result.set(name, data);

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return result;
}
