// Browser-only OCR with tesseract.js (Tesseract 5 compiled to WASM), run in a web
// worker. Worker, cores and language models are served from our own origin
// (public/tesseract, copied by scripts/copy-pdfjs-assets.mjs): nothing is fetched
// from a CDN and no image leaves the device. Models aren't cached in IndexedDB
// (cacheMethod "none"); the browser's HTTP cache keeps them.
import Tesseract from "tesseract.js/dist/tesseract.esm.min.js";
import type { PDFDocumentProxy } from "./render";
import { pageHasText, renderPageToCanvas } from "./render";
import { keepWords, type OcrLine, type OcrPage } from "./ocr";

export type OcrLanguage = "eng" | "fra" | "spa" | "deu" | "ara";

/** 300 DPI is Tesseract's sweet spot for body text. */
const OCR_DPI = 300;

export interface OcrProgress {
  /** 1-based page being processed */
  page: number;
  /** pages that will be processed */
  total: number;
  /** 0..1 for the whole job */
  fraction: number;
  stage: "loading" | "recognizing" | "skipped";
}

export interface OcrResult {
  pages: OcrPage[];
  skipped: number[];
  text: string;
  /** mean word confidence, 0–100 */
  confidence: number;
}

interface TWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
interface TLine {
  words: TWord[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
  baseline?: { x0: number; y0: number; x1: number; y1: number; has_baseline?: boolean };
}
interface TBlock {
  paragraphs: { lines: TLine[] }[];
}

function linesFromBlocks(blocks: TBlock[] | null): { lines: OcrLine[]; conf: number[] } {
  const lines: OcrLine[] = [];
  const conf: number[] = [];
  for (const b of blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        const words = keepWords(l.words);
        if (!words.length) continue;
        conf.push(...words.map((w) => w.confidence));
        lines.push({
          ...l.bbox,
          baseline: l.baseline && l.baseline.has_baseline !== false ? l.baseline : undefined,
          words: words.map((w) => ({ text: w.text, ...w.bbox })),
        });
      }
    }
  }
  return { lines, conf };
}

export class OcrCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "OcrCancelled";
  }
}

/**
 * Recognise the pages of `doc`. Pages that already contain text are skipped when
 * `skipTextPages` is set. `signal` cancels (the worker is terminated at once).
 */
export async function recognizeDocument(
  doc: PDFDocumentProxy,
  languages: OcrLanguage[],
  opts: {
    skipTextPages: boolean;
    onProgress: (p: OcrProgress) => void;
    signal?: AbortSignal;
  },
): Promise<OcrResult> {
  const { onProgress, signal } = opts;
  const pageNumbers: number[] = [];
  const skipped: number[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (opts.skipTextPages && (await pageHasText(doc, n))) skipped.push(n - 1);
    else pageNumbers.push(n);
  }
  const total = pageNumbers.length;
  const result: OcrResult = { pages: [], skipped, text: "", confidence: 0 };
  if (!total) return result;

  // terminate() leaves a pending recognize() unsettled, so every await races the
  // abort signal.
  const aborted = new Promise<never>((_, reject) => {
    if (signal?.aborted) reject(new OcrCancelled());
    signal?.addEventListener("abort", () => reject(new OcrCancelled()), { once: true });
  });
  aborted.catch(() => {});
  const cancellable = <T>(p: Promise<T>) => Promise.race([p, aborted]);

  let current = 0;
  onProgress({ page: 1, total, fraction: 0, stage: "loading" });
  const workerPromise = Tesseract.createWorker(languages, Tesseract.OEM.LSTM_ONLY, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    gzip: true,
    cacheMethod: "none",
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text" && current > 0) {
        onProgress({
          page: current,
          total,
          fraction: (current - 1 + m.progress) / total,
          stage: "recognizing",
        });
      }
    },
  });
  // Whatever happens, the worker (and its WASM memory) goes away at the end.
  const done = () => void workerPromise.then((w) => w.terminate()).catch(() => {});
  const texts: string[] = [];
  const allConf: number[] = [];
  try {
    const worker = await cancellable(workerPromise);
    for (const [i, n] of pageNumbers.entries()) {
      current = i + 1;
      onProgress({ page: current, total, fraction: i / total, stage: "recognizing" });
      const canvas = await cancellable(renderPageToCanvas(doc, n, OCR_DPI, true));
      const { data } = await cancellable(
        worker.recognize(canvas, {}, { blocks: true, text: true }),
      );
      const { lines, conf } = linesFromBlocks(data.blocks as unknown as TBlock[] | null);
      result.pages.push({
        page: n - 1,
        imageWidth: canvas.width,
        imageHeight: canvas.height,
        lines,
      });
      texts.push(`--- Page ${n} ---\n${(data.text ?? "").trim()}`);
      allConf.push(...conf);
      canvas.width = canvas.height = 0; // free the backing store early
    }
  } finally {
    done();
  }
  result.text = texts.join("\n\n") + "\n";
  result.confidence = allConf.length ? allConf.reduce((a, b) => a + b, 0) / allConf.length : 0;
  return result;
}
