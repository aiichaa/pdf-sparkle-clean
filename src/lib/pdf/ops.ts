// PDF editing with pdf-lib (@cantoo fork, maintained). Pure functions over bytes:
// no DOM, no network, unit-tested in Node.
//
// Every operation writes a *fresh* document and copies only the pages it needs.
// That drops document-level JavaScript (/OpenAction, /Names/JavaScript), embedded
// files and other catalog-level baggage from the inputs.
import {
  PDFDocument,
  EncryptedPDFError,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { MAX_PAGES } from "./limits";
import { toWinAnsi } from "./winansi";

export type PdfErrorCode = "encrypted" | "invalid" | "too-many-pages" | "empty";

export class PdfToolError extends Error {
  constructor(
    public code: PdfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfToolError";
  }
}

const PRODUCER = "PDF Clarity (pdf.aiichaa.com)";

export async function loadPdf(bytes: Uint8Array, name = "This file"): Promise<PDFDocument> {
  let doc: PDFDocument;
  let n: number;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    // Some broken files "load" but have no usable page tree; touching it throws.
    n = doc.getPageCount();
  } catch (e) {
    if (e instanceof EncryptedPDFError) {
      throw new PdfToolError(
        "encrypted",
        `${name} is password-protected. Unlocking PDFs isn't supported yet.`,
      );
    }
    throw new PdfToolError(
      "invalid",
      `${name} couldn't be read. It may be damaged or not a real PDF.`,
    );
  }
  if (n === 0) throw new PdfToolError("empty", `${name} has no pages.`);
  if (n > MAX_PAGES) {
    throw new PdfToolError("too-many-pages", `${name} has ${n} pages; the limit is ${MAX_PAGES}.`);
  }
  return doc;
}

async function newDoc(title?: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  if (title) doc.setTitle(title);
  return doc;
}

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true });

async function copyInto(out: PDFDocument, src: PDFDocument, indices: number[]): Promise<PDFPage[]> {
  const pages = await out.copyPages(src, indices);
  for (const p of pages) out.addPage(p);
  return pages;
}

// ── Merge ────────────────────────────────────────────────────────────────────

export async function mergePdfs(
  inputs: { bytes: Uint8Array; name: string }[],
): Promise<Uint8Array> {
  if (inputs.length < 2) throw new PdfToolError("empty", "Add at least two PDFs to merge.");
  const out = await newDoc();
  let total = 0;
  for (const input of inputs) {
    const src = await loadPdf(input.bytes, input.name);
    total += src.getPageCount();
    if (total > MAX_PAGES) {
      throw new PdfToolError("too-many-pages", `The merged PDF would exceed ${MAX_PAGES} pages.`);
    }
    await copyInto(out, src, src.getPageIndices());
  }
  return save(out);
}

// ── Split / extract ──────────────────────────────────────────────────────────

/** One output PDF per group of 0-based page indices. */
export async function splitPdf(
  bytes: Uint8Array,
  groups: number[][],
  name?: string,
): Promise<Uint8Array[]> {
  const src = await loadPdf(bytes, name);
  const results: Uint8Array[] = [];
  for (const group of groups) {
    if (!group.length) continue;
    const out = await newDoc();
    await copyInto(out, src, group);
    results.push(await save(out));
  }
  if (!results.length) throw new PdfToolError("empty", "Nothing to extract.");
  return results;
}

// ── Organize (reorder / rotate / delete) ─────────────────────────────────────

export interface PageSpec {
  /** 0-based index in the source document */
  index: number;
  /** extra clockwise rotation to apply, in degrees */
  rotate: 0 | 90 | 180 | 270;
}

export async function organizePdf(
  bytes: Uint8Array,
  pages: PageSpec[],
  name?: string,
): Promise<Uint8Array> {
  if (!pages.length) throw new PdfToolError("empty", "A PDF needs at least one page.");
  const src = await loadPdf(bytes, name);
  const out = await newDoc();
  const copied = await copyInto(
    out,
    src,
    pages.map((p) => p.index),
  );
  copied.forEach((page, i) => {
    const current = page.getRotation().angle;
    page.setRotation(degrees((((current + pages[i].rotate) % 360) + 360) % 360));
  });
  return save(out);
}

// ── Images → PDF ─────────────────────────────────────────────────────────────

export type PageSizeOption = "fit" | "a4" | "letter";
export type OrientationOption = "auto" | "portrait" | "landscape";

export interface ImagesToPdfOptions {
  pageSize: PageSizeOption;
  orientation: OrientationOption;
  /** margin in points */
  margin: number;
}

const PAGE_SIZES: Record<Exclude<PageSizeOption, "fit">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};
const PX_TO_PT = 0.75; // treat image pixels as 96 dpi
const MAX_PAGE_PT = 14400; // PDF user-unit limit (200 in)

export async function imagesToPdf(
  images: { bytes: Uint8Array; type: "png" | "jpeg" }[],
  opts: ImagesToPdfOptions,
): Promise<Uint8Array> {
  if (!images.length) throw new PdfToolError("empty", "Add at least one image.");
  const out = await newDoc();
  for (const img of images) {
    const embedded =
      img.type === "png" ? await out.embedPng(img.bytes) : await out.embedJpg(img.bytes);
    const iw = embedded.width * PX_TO_PT;
    const ih = embedded.height * PX_TO_PT;
    const m = opts.margin;
    let pw: number;
    let ph: number;
    if (opts.pageSize === "fit") {
      const scale = Math.min(1, (MAX_PAGE_PT - 2 * m) / Math.max(iw, ih));
      pw = iw * scale + 2 * m;
      ph = ih * scale + 2 * m;
    } else {
      const [w, h] = PAGE_SIZES[opts.pageSize];
      const landscape =
        opts.orientation === "landscape" || (opts.orientation === "auto" && iw > ih);
      [pw, ph] = landscape ? [h, w] : [w, h];
    }
    // Fit inside the margins, never upscale beyond the image's natural size.
    const scale = Math.min(1, (pw - 2 * m) / iw, (ph - 2 * m) / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const page = out.addPage([pw, ph]);
    page.drawImage(embedded, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
  }
  return save(out);
}

// ── Geometry: draw upright text on rotated pages ─────────────────────────────

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Size of the page as the reader sees it (after /Rotate). */
export function visualSize(box: Box, rotation: number): { width: number; height: number } {
  return rotation % 180 === 0
    ? { width: box.width, height: box.height }
    : { width: box.height, height: box.width };
}

/**
 * Map a point in the *visual* page frame (origin bottom-left as displayed) to PDF
 * user space. /Rotate turns the page clockwise for display.
 */
export function visualToUser(vx: number, vy: number, box: Box, rotation: number): [number, number] {
  const { x: ox, y: oy, width: w, height: h } = box;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [ox + w - vy, oy + vx];
    case 180:
      return [ox + w - vx, oy + h - vy];
    case 270:
      return [ox + vy, oy + h - vx];
    default:
      return [ox + vx, oy + vy];
  }
}

function drawUprightText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  vx: number,
  vy: number,
  opts: { visualAngle?: number; color?: ReturnType<typeof rgb>; opacity?: number } = {},
) {
  const rotation = page.getRotation().angle;
  const [x, y] = visualToUser(vx, vy, page.getCropBox(), rotation);
  page.drawText(text, {
    x,
    y,
    size,
    font,
    color: opts.color ?? rgb(0, 0, 0),
    opacity: opts.opacity ?? 1,
    rotate: degrees((rotation + (opts.visualAngle ?? 0)) % 360),
  });
}

// ── Page numbers ─────────────────────────────────────────────────────────────

export type NumberPosition =
  "bottom-center" | "bottom-left" | "bottom-right" | "top-center" | "top-left" | "top-right";
export type NumberFormat = "n" | "n-of-total" | "page-n-of-total";

export interface PageNumberOptions {
  position: NumberPosition;
  format: NumberFormat;
  startAt: number;
  fontSize: number;
  /** leave the first page (cover) unnumbered */
  skipFirst: boolean;
  margin: number;
}

export function formatPageNumber(n: number, total: number, format: NumberFormat): string {
  if (format === "n-of-total") return `${n} / ${total}`;
  if (format === "page-n-of-total") return `Page ${n} of ${total}`;
  return `${n}`;
}

export async function addPageNumbers(
  bytes: Uint8Array,
  opts: PageNumberOptions,
  name?: string,
): Promise<Uint8Array> {
  const src = await loadPdf(bytes, name);
  const out = await newDoc();
  const pages = await copyInto(out, src, src.getPageIndices());
  const font = await out.embedFont(StandardFonts.Helvetica);
  const numbered = opts.skipFirst ? pages.length - 1 : pages.length;
  const last = opts.startAt + numbered - 1;
  pages.forEach((page, i) => {
    if (opts.skipFirst && i === 0) return;
    const n = opts.startAt + (opts.skipFirst ? i - 1 : i);
    const label = formatPageNumber(n, last, opts.format);
    const { width: W, height: H } = visualSize(page.getCropBox(), page.getRotation().angle);
    const tw = font.widthOfTextAtSize(label, opts.fontSize);
    const [vert, horiz] = opts.position.split("-") as [
      "top" | "bottom",
      "left" | "center" | "right",
    ];
    const vx =
      horiz === "left" ? opts.margin : horiz === "right" ? W - opts.margin - tw : (W - tw) / 2;
    const vy = vert === "bottom" ? opts.margin : H - opts.margin - opts.fontSize * 0.75;
    drawUprightText(page, label, font, opts.fontSize, vx, vy, { color: rgb(0.2, 0.2, 0.2) });
  });
  return save(out);
}

// ── Watermark ────────────────────────────────────────────────────────────────

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  /** 0–1 */
  opacity: number;
  /** "diagonal" rises at 45°, "horizontal" is flat */
  layout: "diagonal" | "horizontal";
  color: "gray" | "red" | "blue";
}

const WATERMARK_COLORS = {
  gray: rgb(0.45, 0.45, 0.45),
  red: rgb(0.8, 0.1, 0.1),
  blue: rgb(0.1, 0.3, 0.8),
};

export async function addWatermark(
  bytes: Uint8Array,
  opts: WatermarkOptions,
  name?: string,
): Promise<{ bytes: Uint8Array; replacedChars: boolean }> {
  const { text, replaced } = toWinAnsi(opts.text.trim());
  if (!text) throw new PdfToolError("empty", "Enter the watermark text.");
  const src = await loadPdf(bytes, name);
  const out = await newDoc();
  const pages = await copyInto(out, src, src.getPageIndices());
  const font = await out.embedFont(StandardFonts.HelveticaBold);
  const angle = opts.layout === "diagonal" ? 45 : 0;
  const rad = (angle * Math.PI) / 180;
  for (const page of pages) {
    const { width: W, height: H } = visualSize(page.getCropBox(), page.getRotation().angle);
    // Shrink long text so it fits across the page.
    const room = opts.layout === "diagonal" ? Math.hypot(W, H) * 0.8 : W * 0.9;
    const size = Math.min(
      opts.fontSize,
      (opts.fontSize * room) / font.widthOfTextAtSize(text, opts.fontSize),
    );
    const tw = font.widthOfTextAtSize(text, size);
    const cap = size * 0.7;
    // Centre the text: step back half its length along the baseline, and down half
    // its cap height perpendicular to it.
    const vx = W / 2 - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * cap) / 2;
    const vy = H / 2 - (Math.sin(rad) * tw) / 2 - (Math.cos(rad) * cap) / 2;
    drawUprightText(page, text, font, size, vx, vy, {
      visualAngle: angle,
      color: WATERMARK_COLORS[opts.color],
      opacity: opts.opacity,
    });
  }
  return { bytes: await save(out), replacedChars: replaced };
}

export async function getPageCount(bytes: Uint8Array, name?: string): Promise<number> {
  return (await loadPdf(bytes, name)).getPageCount();
}
