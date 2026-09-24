// PDF compression, entirely local.
//
// Keeps the SAME document (forms, bookmarks, metadata) and works in two layers:
//   1. lossless: drop objects nothing references any more, Flate-compress streams
//      that are stored uncompressed, pack objects into object streams;
//   2. lossy (optional): downscale / re-encode large images as JPEG.
// Image re-encoding needs a browser canvas, so it is injected (`ImageEncoder`),
// which keeps this module testable in Node.
//
// Images we can't re-encode faithfully are left untouched: CMYK / Lab / Indexed /
// DeviceN colour, /Decode arrays, colour-key masks, stencil masks, JPEG 2000,
// JBIG2, multi-filter chains, 16-bit samples, PNG predictors other than 10–15.
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFObject,
} from "@cantoo/pdf-lib";
import { unzlibSync, zlibSync } from "fflate";
import { loadPdf } from "./ops";

export type CompressionLevel = "lossless" | "recommended" | "strong";

export const LEVELS: Record<
  Exclude<CompressionLevel, "lossless">,
  { maxSide: number; quality: number }
> = {
  // Long side caps: ~240 dpi / ~170 dpi on an A4 page, plenty for screens and print.
  recommended: { maxSide: 2000, quality: 0.75 },
  strong: { maxSide: 1400, quality: 0.6 },
};

/** Only images at least this big are worth re-encoding. */
const MIN_IMAGE_BYTES = 30 * 1024;
/** Decoding more than this would use too much memory in a tab. */
const MAX_IMAGE_PIXELS = 40_000_000;
/** Keep the new image only if it saves at least this much. */
const MIN_SAVING = 0.1;

export type ImageInput =
  | { kind: "jpeg"; bytes: Uint8Array; width: number; height: number }
  | { kind: "pixels"; pixels: Uint8Array; channels: 1 | 3; width: number; height: number };

export interface EncodedImage {
  bytes: Uint8Array; // baseline JPEG
  width: number;
  height: number;
}

/** Decode + downscale + JPEG-encode. Returns null if it couldn't. */
export type ImageEncoder = (
  img: ImageInput,
  opts: { maxSide: number; quality: number },
) => Promise<EncodedImage | null>;

export interface CompressReport {
  before: number;
  after: number;
  imagesFound: number;
  imagesRecompressed: number;
  objectsRemoved: number;
  streamsCompressed: number;
}

const N = (s: string) => PDFName.of(s);
const nameOf = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText() : undefined);
const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);

// ── Lossless: garbage collection ─────────────────────────────────────────────

/** Delete every indirect object not reachable from the trailer (Root / Info). */
export function removeUnreferenced(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  const push = (o: PDFObject | undefined) => o && stack.push(o);
  push(ctx.trailerInfo.Root);
  push(ctx.trailerInfo.Info);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      const key = o.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      push(ctx.lookup(o));
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) push(v);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) push(o.get(i));
    } else if (o instanceof PDFStream) {
      push(o.dict);
    }
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) {
      ctx.delete(ref);
      removed++;
    }
  }
  return removed;
}

// ── Lossless: compress raw streams ───────────────────────────────────────────

export function deflateUncompressedStreams(doc: PDFDocument): number {
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.has(N("Filter"))) continue;
    const type = nameOf(d.get(N("Type")));
    // XMP metadata is conventionally left readable; xref/object streams are
    // rebuilt by the writer.
    if (type === "Metadata" || type === "XRef" || type === "ObjStm") continue;
    const raw = obj.getContents();
    if (raw.length < 256) continue;
    const packed = zlibSync(raw, { level: 9 });
    if (packed.length >= raw.length * 0.9) continue;
    obj.updateContents(packed);
    d.set(N("Filter"), N("FlateDecode"));
    d.delete(N("DecodeParms"));
    n++;
  }
  return n;
}

// ── Lossy: images ────────────────────────────────────────────────────────────

/** Undo PNG row predictors (DecodeParms /Predictor 10–15). */
export function unpredictPng(data: Uint8Array, columns: number, colors: number): Uint8Array {
  const bpp = colors; // 8 bits per component
  const rowLen = columns * colors;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const x = data[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = r > 0 ? out[dst - rowLen + i] : 0;
      const c = r > 0 && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
      let v: number;
      switch (type) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`Unknown PNG filter ${type}`);
      }
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}

/** Channel count for colour spaces we can faithfully turn into sRGB/grey JPEG. */
function simpleChannels(
  cs: PDFObject | undefined,
  lookup: (o: PDFObject) => PDFObject | undefined,
): 1 | 3 | null {
  const n = nameOf(cs);
  if (n === "DeviceRGB" || n === "CalRGB") return 3;
  if (n === "DeviceGray" || n === "CalGray") return 1;
  const arr = cs instanceof PDFRef ? lookup(cs) : cs;
  if (arr instanceof PDFArray && arr.size() >= 2) {
    const family = nameOf(arr.get(0));
    if (family === "CalRGB") return 3;
    if (family === "CalGray") return 1;
    if (family === "ICCBased") {
      const profile = lookup(arr.get(1));
      const channels = profile instanceof PDFStream ? num(profile.dict.get(N("N"))) : undefined;
      if (channels === 3) return 3;
      if (channels === 1) return 1;
    }
  }
  return null; // CMYK, Lab, Indexed, Separation, DeviceN…
}

interface Candidate {
  stream: PDFRawStream;
  input: ImageInput;
}

function imageCandidate(
  stream: PDFRawStream,
  lookup: (o: PDFObject) => PDFObject | undefined,
): Candidate | null {
  const d = stream.dict;
  if (nameOf(d.get(N("Subtype"))) !== "Image") return null;
  if (d.get(N("ImageMask"))?.toString() === "true") return null;
  if (d.has(N("Decode")) || d.has(N("Mask")) || d.has(N("SMaskInData"))) return null;
  if (stream.getContentsSize() < MIN_IMAGE_BYTES) return null;
  const width = num(d.get(N("Width")));
  const height = num(d.get(N("Height")));
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) return null;
  const channels = simpleChannels(d.get(N("ColorSpace")), lookup);
  if (!channels) return null;
  let filter = d.get(N("Filter"));
  if (filter instanceof PDFArray) {
    if (filter.size() !== 1) return null;
    filter = filter.get(0);
  }
  const f = nameOf(filter);
  if (f === "DCTDecode") {
    return { stream, input: { kind: "jpeg", bytes: stream.getContents(), width, height } };
  }
  if (f === "FlateDecode" && num(d.get(N("BitsPerComponent"))) === 8) {
    let parms = d.get(N("DecodeParms"));
    if (parms instanceof PDFArray) parms = parms.get(0);
    if (parms instanceof PDFRef) parms = lookup(parms);
    const predictor = parms instanceof PDFDict ? (num(parms.get(N("Predictor"))) ?? 1) : 1;
    if (predictor !== 1 && (predictor < 10 || predictor > 15)) return null;
    let pixels: Uint8Array;
    try {
      pixels = unzlibSync(stream.getContents());
      if (predictor >= 10) pixels = unpredictPng(pixels, width, channels);
    } catch {
      return null;
    }
    if (pixels.length < width * height * channels) return null;
    return { stream, input: { kind: "pixels", pixels, channels, width, height } };
  }
  return null; // JPX, JBIG2, CCITT, LZW, RunLength…
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function compressPdf(
  bytes: Uint8Array,
  level: CompressionLevel,
  encode: ImageEncoder | null,
  { name, onProgress }: { name?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ bytes: Uint8Array; report: CompressReport }> {
  const doc = await loadPdf(bytes, name);
  const ctx = doc.context;
  const lookup = (o: PDFObject) => (o instanceof PDFRef ? ctx.lookup(o) : o);

  // Collect first, so progress is meaningful.
  const candidates: Candidate[] = [];
  let imagesFound = 0;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || nameOf(obj.dict.get(N("Subtype"))) !== "Image") continue;
    imagesFound++;
    if (level === "lossless" || !encode) continue;
    const c = imageCandidate(obj, lookup);
    if (c) candidates.push(c);
  }

  let imagesRecompressed = 0;
  if (level !== "lossless" && encode) {
    const opts = LEVELS[level];
    for (let i = 0; i < candidates.length; i++) {
      const { stream, input } = candidates[i];
      const out = await encode(input, opts).catch(() => null);
      if (out && out.bytes.length < stream.getContentsSize() * (1 - MIN_SAVING)) {
        const d = stream.dict;
        stream.updateContents(out.bytes);
        d.set(N("Filter"), N("DCTDecode"));
        d.delete(N("DecodeParms"));
        d.set(N("Width"), PDFNumber.of(out.width));
        d.set(N("Height"), PDFNumber.of(out.height));
        d.set(N("BitsPerComponent"), PDFNumber.of(8));
        // Canvas JPEGs are always 3-channel sRGB.
        d.set(N("ColorSpace"), N("DeviceRGB"));
        imagesRecompressed++;
      }
      onProgress?.(i + 1, candidates.length);
    }
  }

  const objectsRemoved = removeUnreferenced(doc);
  const streamsCompressed = deflateUncompressedStreams(doc);
  const out = await doc.save({ useObjectStreams: true });
  return {
    bytes: out,
    report: {
      before: bytes.length,
      after: out.length,
      imagesFound,
      imagesRecompressed,
      objectsRemoved,
      streamsCompressed,
    },
  };
}
