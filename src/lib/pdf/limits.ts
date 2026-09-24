// Guardrails. Everything runs in the visitor's browser tab, so these keep memory
// use sane and stop hostile files from freezing the page.
export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
export const MAX_TOTAL_BYTES = 300 * 1024 * 1024; // 300 MB per job
export const MAX_FILES = 50;
export const MAX_PAGES = 2000; // pages per document we agree to process
export const MAX_RENDER_PAGES = 300; // pages per PDF → images run
export const MAX_CANVAS_PIXELS = 36_000_000; // ~6000×6000, below browser canvas limits

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export const MAX_FILE_LABEL = formatBytes(MAX_FILE_BYTES);
export const MAX_TOTAL_LABEL = formatBytes(MAX_TOTAL_BYTES);
