import { Inflate } from 'fflate';

import { ConsumptionParseError } from './parse-errors';

/**
 * Minimal ZIP reader for untrusted .xlsx input. Only the central directory is trusted for
 * locating entries; every entry is inflated through a streaming decoder that stops as soon as
 * the shared decompression budget is exceeded, whatever sizes the archive declares.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const MAX_ENTRIES = 10_000;
const INFLATE_CHUNK = 16 * 1024;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Tracks decompressed bytes across all entries read from one archive. */
export interface DecompressionBudget {
  remaining: number;
}

function malformed(): ConsumptionParseError {
  return new ConsumptionParseError('MALFORMED_XLSX');
}

export function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Lists archive entries from the central directory. Rejects encrypted, ZIP64 and inconsistent
 * archives, and archives whose declared uncompressed total already exceeds the limit.
 */
export function readZipDirectory(bytes: Uint8Array, maxUncompressedTotal: number): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, bytes.length - EOCD_MIN_LENGTH - MAX_COMMENT_LENGTH);
  let eocd = -1;
  for (let i = bytes.length - EOCD_MIN_LENGTH; i >= minEocd; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw malformed();
  }

  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff || entryCount > MAX_ENTRIES) {
    throw malformed();
  }
  if (directoryOffset + directorySize > eocd) {
    throw malformed();
  }

  const decoder = new TextDecoder('utf-8');
  const entries = new Map<string, ZipEntry>();
  let declaredTotal = 0;
  let offset = directoryOffset;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw malformed();
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > eocd || (flags & 0x1) !== 0) {
      throw malformed();
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw malformed();
    }
    const name = decoder.decode(bytes.subarray(offset + 46, nameEnd));
    declaredTotal += uncompressedSize;
    if (declaredTotal > maxUncompressedTotal) {
      throw new ConsumptionParseError('DECOMPRESSED_TOO_LARGE');
    }
    if (entries.has(name)) {
      throw malformed();
    }
    entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function entryDataRange(bytes: Uint8Array, entry: ZipEntry): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localHeaderOffset;
  if (header + 30 > bytes.length || view.getUint32(header, true) !== LOCAL_SIGNATURE) {
    throw malformed();
  }
  const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) {
    throw malformed();
  }
  return [start, end];
}

/** Returns the uncompressed content of one entry, charging it to the shared budget. */
export function extractZipEntry(bytes: Uint8Array, entry: ZipEntry, budget: DecompressionBudget): Uint8Array {
  const [start, end] = entryDataRange(bytes, entry);

  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw malformed();
    }
    if (entry.compressedSize > budget.remaining) {
      throw new ConsumptionParseError('DECOMPRESSED_TOO_LARGE');
    }
    budget.remaining -= entry.compressedSize;
    return bytes.slice(start, end);
  }
  if (entry.method !== 8) {
    throw malformed();
  }

  const chunks: Uint8Array[] = [];
  let produced = 0;
  let finished = false;
  const inflater = new Inflate((chunk, final) => {
    produced += chunk.length;
    if (produced > budget.remaining) {
      throw new ConsumptionParseError('DECOMPRESSED_TOO_LARGE');
    }
    if (produced > entry.uncompressedSize) {
      throw malformed();
    }
    chunks.push(chunk);
    finished = final;
  });

  try {
    for (let position = start; position < end; position += INFLATE_CHUNK) {
      const stop = Math.min(position + INFLATE_CHUNK, end);
      inflater.push(bytes.subarray(position, stop), stop === end);
    }
    if (start === end) {
      inflater.push(new Uint8Array(0), true);
    }
  } catch (error) {
    if (error instanceof ConsumptionParseError) {
      throw error;
    }
    throw malformed();
  }

  if (!finished || produced !== entry.uncompressedSize) {
    throw malformed();
  }
  budget.remaining -= produced;

  const output = new Uint8Array(produced);
  let writeAt = 0;
  for (const chunk of chunks) {
    output.set(chunk, writeAt);
    writeAt += chunk.length;
  }
  return output;
}
