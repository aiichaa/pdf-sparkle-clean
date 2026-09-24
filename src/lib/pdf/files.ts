import {
  MAX_FILE_BYTES,
  MAX_FILE_LABEL,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  MAX_TOTAL_LABEL,
} from "./limits";

export type SniffedType = "pdf" | "png" | "jpeg" | "webp" | "gif" | "bmp" | "unknown";

/**
 * Identify a file by its magic bytes, never by its name or the browser-supplied MIME
 * type (both are attacker-controlled).
 */
export function sniff(bytes: Uint8Array): SniffedType {
  const b = bytes;
  const at = (i: number, ...sig: number[]) => sig.every((v, k) => b[i + k] === v);
  // PDF: "%PDF-" within the first 1 KB (some generators prepend junk)
  const head = Math.min(b.length - 5, 1024);
  for (let i = 0; i <= head; i++) {
    if (at(i, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "pdf";
  }
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (at(0, 0x42, 0x4d)) return "bmp";
  return "unknown";
}

export class FileRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileRejectedError";
  }
}

export interface LoadedFile {
  id: string;
  name: string;
  size: number;
  type: SniffedType;
  bytes: Uint8Array;
}

let counter = 0;
export const newId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Read files, enforce size / count limits and check their real type.
 * Returns the accepted files plus human-readable reasons for any rejected ones.
 */
export async function readFiles(
  files: File[],
  accept: SniffedType[],
  { alreadyLoadedBytes = 0, alreadyLoadedCount = 0 } = {},
): Promise<{ accepted: LoadedFile[]; rejected: string[] }> {
  const accepted: LoadedFile[] = [];
  const rejected: string[] = [];
  let total = alreadyLoadedBytes;
  for (const file of files) {
    if (alreadyLoadedCount + accepted.length >= MAX_FILES) {
      rejected.push(`${file.name}: at most ${MAX_FILES} files at a time`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      rejected.push(`${file.name}: larger than ${MAX_FILE_LABEL}`);
      continue;
    }
    if (total + file.size > MAX_TOTAL_BYTES) {
      rejected.push(`${file.name}: all files together would exceed ${MAX_TOTAL_LABEL}`);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniff(bytes);
    if (!accept.includes(type)) {
      rejected.push(`${file.name}: not a supported file (${describe(accept)})`);
      continue;
    }
    total += file.size;
    accepted.push({ id: newId(), name: file.name, size: file.size, type, bytes });
  }
  return { accepted, rejected };
}

function describe(accept: SniffedType[]): string {
  if (accept.length === 1 && accept[0] === "pdf") return "PDF only";
  return accept.map((t) => t.toUpperCase()).join(", ");
}

/** "Report Q3.final.pdf" → "Report Q3.final" */
export function baseName(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "");
}
