import { zipSync } from "fflate";

const DEFAULT_BASE = "document";
const MAX = 120;

/**
 * Sanitize a filename for safe download.
 * - Strips path separators and control chars
 * - Transliterates accents, allows letters, digits, dash, underscore, dot
 * - Caps length and ensures the given extension
 */
export function sanitizeFilename(name: string | undefined | null, ext = "pdf"): string {
  const suffix = `.${ext}`;
  const fallback = `${DEFAULT_BASE}${suffix}`;
  if (!name) return fallback;
  let base = name.trim();
  const segments = base.split(/[\\/]+/).filter(Boolean);
  base = segments.length ? segments[segments.length - 1] : "";
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[\x00-\x1f\x7f]/g, "");
  base = base.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  base = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  base = base.replace(/^[._]+/, "");
  if (base.toLowerCase().endsWith(suffix)) base = base.slice(0, -suffix.length);
  base = base.replace(/_{2,}/g, "_").replace(/[._-]+$/, "");
  if (base.length > MAX) base = base.slice(0, MAX).replace(/[._-]+$/, "");
  if (!base) return fallback;
  return `${base}${suffix}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download can start
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadPdf(bytes: Uint8Array, name: string): void {
  downloadBlob(
    new Blob([bytes as BlobPart], { type: "application/pdf" }),
    sanitizeFilename(name, "pdf"),
  );
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Build a zip in memory. Entry names are sanitized and de-duplicated. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const used = new Set<string>();
  const files: Record<string, Uint8Array> = {};
  for (const e of entries) {
    const dot = e.name.lastIndexOf(".");
    const ext = dot > 0 ? e.name.slice(dot + 1) : "bin";
    let name = sanitizeFilename(dot > 0 ? e.name.slice(0, dot) : e.name, ext);
    for (let n = 2; used.has(name); n++) {
      name = sanitizeFilename(`${e.name.slice(0, dot > 0 ? dot : undefined)}_${n}`, ext);
    }
    used.add(name);
    // PDFs and images are already compressed; storing them avoids wasted CPU.
    files[name] = e.data;
  }
  return zipSync(files, { level: 0 });
}

export function downloadZip(entries: ZipEntry[], name: string): void {
  downloadBlob(
    new Blob([buildZip(entries) as BlobPart], { type: "application/zip" }),
    sanitizeFilename(name, "zip"),
  );
}
