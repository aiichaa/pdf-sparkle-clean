export class RangeError_ extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RangeError";
  }
}

/**
 * Parse a page-range expression into groups of 0-based page indices.
 *
 *   "1-3, 5, 8-"  (10 pages) → [[0,1,2], [4], [7,8,9]]
 *   "-2"                     → [[0,1]]
 *   "4-2"                    → [[3,2,1]]   (reversed ranges are allowed)
 *
 * Each comma-separated part becomes one group (one output file when splitting).
 */
export function parseRanges(input: string, pageCount: number): number[][] {
  const parts = input
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) throw new RangeError_("Enter at least one page or range, e.g. 1-3, 5");
  return parts.map((part) => {
    const m = /^(\d*)\s*(?:[-–—]\s*(\d*))?$/.exec(part);
    if (!m || (m[1] === "" && (m[2] === undefined || m[2] === ""))) {
      throw new RangeError_(`“${part}” isn't a page or range`);
    }
    const isRange = part.includes("-") || part.includes("–") || part.includes("—");
    const start = m[1] === "" ? 1 : Number(m[1]);
    const end = isRange ? (m[2] === "" || m[2] === undefined ? pageCount : Number(m[2])) : start;
    for (const n of [start, end]) {
      if (n < 1 || n > pageCount) {
        throw new RangeError_(
          `Page ${n} doesn't exist — this document has ${pageCount} page${pageCount === 1 ? "" : "s"}`,
        );
      }
    }
    const step = start <= end ? 1 : -1;
    const group: number[] = [];
    for (let n = start; n !== end + step; n += step) group.push(n - 1);
    return group;
  });
}

/** [0,1,2,4,7,8,9] → "1-3, 5, 8-10" */
export function formatRanges(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(i === j ? `${sorted[i] + 1}` : `${sorted[i] + 1}-${sorted[j] + 1}`);
    i = j + 1;
  }
  return out.join(", ");
}
