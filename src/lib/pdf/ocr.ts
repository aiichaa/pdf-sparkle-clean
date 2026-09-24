// OCR text layer: put recognised words on the page as INVISIBLE text (render
// mode 3), exactly over the scanned glyphs, so the PDF becomes searchable and
// selectable while looking the same. Pure: no DOM, unit-tested. Recognition
// itself happens in ocr-browser.ts (tesseract.js).
//
// The SAME document is kept (forms, bookmarks, metadata).
import {
  PDFName,
  PDFNumber,
  StandardFonts,
  type PDFFont,
  type PDFPage,
  PDFOperator,
  PDFOperatorNames as Ops,
  PDFHexString,
} from "@cantoo/pdf-lib";
import { loadPdf, visualSize, visualToUser } from "./ops";
import { toWinAnsi } from "./winansi";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A recognised word. Coordinates are IMAGE pixels, origin top-left (tesseract's). */
export interface OcrWord extends Box {
  text: string;
}

export interface OcrLine extends Box {
  /** Baseline as a segment (x0,y0)→(x1,y1), when tesseract found one. */
  baseline?: Box;
  words: OcrWord[];
}

export interface OcrPage {
  /** 0-based page index */
  page: number;
  /** Size of the rendered image the words were found in (the visual page). */
  imageWidth: number;
  imageHeight: number;
  lines: OcrLine[];
}

/** Helvetica's ascender height ≈ 0.72 em: turns "baseline − line top" into a font size. */
const ASCENT = 0.72;

const op = (name: string, ...args: (number | PDFName | PDFHexString)[]) =>
  PDFOperator.of(
    name as Ops,
    args.map((a) => (typeof a === "number" ? PDFNumber.of(round(a)) : a)),
  );
const round = (n: number) => Math.round(n * 1000) / 1000;

export const countWords = (p: OcrPage) => p.lines.reduce((n, l) => n + l.words.length, 0);

/**
 * One text object per line: every word of a line shares the font size and the
 * baseline (so text extraction keeps lines and reading order), follows the line's
 * skew, and is stretched horizontally to cover its word on the scan.
 */
function textLayerOps(page: PDFPage, font: PDFFont, fontName: PDFName, ocr: OcrPage) {
  const box = page.getCropBox();
  const rotation = page.getRotation().angle;
  const { width: W, height: H } = visualSize(box, rotation);
  const sx = W / ocr.imageWidth;
  const sy = H / ocr.imageHeight;
  // Images of the visual x axis and visual "up" axis in user space.
  const [ox, oy] = visualToUser(0, 0, box, rotation);
  const [ax, ay] = visualToUser(1, 0, box, rotation);
  const [bx, by] = visualToUser(0, 1, box, rotation);
  const ux = [ax - ox, ay - oy];
  const uy = [bx - ox, by - oy];

  const ops: PDFOperator[] = [op(Ops.BeginText), op(Ops.SetTextRenderingMode, 3)];
  for (const line of ocr.lines) {
    const bl = line.baseline && line.baseline.x1 !== line.baseline.x0 ? line.baseline : undefined;
    const slope = bl ? (bl.y1 - bl.y0) / (bl.x1 - bl.x0) : 0;
    const baseAt = (x: number) =>
      bl ? bl.y0 + slope * (x - bl.x0) : line.y1 - (line.y1 - line.y0) * 0.22;
    // Font size in points from the ascender part of the line (robust to descenders).
    const ascent = (baseAt(line.x0) - line.y0) * sy;
    const size = Math.max(1, ascent > 0 ? ascent / ASCENT : (line.y1 - line.y0) * sy * 0.8);
    // Skew: image y grows downwards, so the visual angle is the negated slope.
    const theta = -Math.atan((slope * sy) / sx);
    const [c, s] = [Math.cos(theta), Math.sin(theta)];
    const dir = [c * ux[0] + s * uy[0], c * ux[1] + s * uy[1]];
    const up = [-s * ux[0] + c * uy[0], -s * ux[1] + c * uy[1]];
    ops.push(op(Ops.SetFontAndSize, fontName, size));
    line.words.forEach((w, i) => {
      const { text } = toWinAnsi(w.text.trim());
      const width = (w.x1 - w.x0) * sx;
      if (!text || width <= 0) return;
      const [px, py] = visualToUser(w.x0 * sx, H - baseAt(w.x0) * sy, box, rotation);
      const natural = font.widthOfTextAtSize(text, size);
      ops.push(
        op(Ops.SetTextHorizontalScaling, natural > 0 ? (100 * width) / natural : 100),
        op(Ops.SetTextMatrix, dir[0], dir[1], up[0], up[1], px, py),
        // A real space after each word (in the gap) so copied text keeps its spaces.
        op(
          Ops.ShowText,
          font.encodeText(i < line.words.length - 1 ? `${text} ` : text) as PDFHexString,
        ),
      );
    });
  }
  ops.push(op(Ops.EndText));
  return ops;
}

/**
 * Add an invisible text layer to the given pages. Returns the new PDF and how many
 * words were written.
 */
export async function addTextLayer(
  bytes: Uint8Array,
  pages: OcrPage[],
  name?: string,
): Promise<{ bytes: Uint8Array; words: number }> {
  const doc = await loadPdf(bytes, name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let words = 0;
  const all = doc.getPages();
  for (const ocr of pages) {
    const page = all[ocr.page];
    const n = countWords(ocr);
    if (!page || !n || ocr.imageWidth <= 0 || ocr.imageHeight <= 0) continue;
    // Isolate the existing content (it may leave the CTM or text state changed),
    // then add ours after it.
    const ctx = doc.context;
    const start = ctx.register(ctx.stream("q"));
    const end = ctx.register(ctx.stream("Q"));
    page.node.wrapContentStreams(start, end);
    const fontName = page.node.newFontDictionary("OCR", font.ref);
    page.pushOperators(...textLayerOps(page, font, fontName, ocr));
    words += n;
  }
  return { bytes: await doc.save({ useObjectStreams: true }), words };
}
