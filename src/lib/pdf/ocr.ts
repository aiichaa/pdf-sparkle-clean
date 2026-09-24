// OCR text layer: put recognised words on the page as INVISIBLE text (render
// mode 3), exactly over the scanned glyphs, so the PDF becomes searchable and
// selectable while looking the same. Pure: no DOM, unit-tested. Recognition
// itself happens in ocr-browser.ts (tesseract.js).
//
// The SAME document is kept (forms, bookmarks, metadata).
//
// Text is written with a "glyphless" font, like Tesseract's own PDF renderer:
// Identity-H with every code = the character's UTF-16 code unit, an identity
// ToUnicode map, and empty glyphs, all 0.5 em wide. There is no shaping and no
// glyph lookup, so extraction gives back exactly what was recognised, in any script
// (Arabic included). Right-to-left words are written in visual order.
import {
  PDFDocument,
  PDFString,
  PDFName,
  PDFNumber,
  type PDFPage,
  type PDFRef,
  PDFOperator,
  PDFOperatorNames as Ops,
  PDFHexString,
} from "@cantoo/pdf-lib";
import { loadPdf, visualSize, visualToUser } from "./ops";

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

/** Font ascender (em): turns "baseline − line top" into a font size. Matches the font. */
const ASCENT = 0.72;
/** Every glyph of the glyphless font is this wide (em). */
const ADVANCE = 0.5;

// 624-byte TrueType font with two empty glyphs (advance 500/1000, ascent 720,
// descent −210), generated with fontTools. See CLAUDE.md → OCR.
const GLYPHLESS_TTF =
  "AAEAAAAKAIAAAwAgT1MvMkS6Q1YAAAEoAAAAYGNtYXAADABzAAABkAAAADRnbHlmAAAAAAAAAcwAAAABaGVhZCzMcvwAAACsAAAANmhoZWEC0gEkAAAA5AAAACRobXR4AfQAAAAAAYgAAAAGbG9jYQAAAAAAAAHEAAAABm1heHAAAwACAAABCAAAACBuYW1lGZ8ZNAAAAdAAAABycG9zdG1nc80AAAJEAAAALAABAAAAAQAAqtQTHl8PPPUAAwPoAAAAAObbGQ4AAAAA5tsZDgAAAAAAAAAAAAAAAwACAAAAAAAAAAEAAALQ/y4AAAH0AAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAEAAAACAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwH0AZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAPz8/PwAAACAAIALQ/y4AAALQANIAAAAAAAAAAAAAAAAAAAAgAAAB9AAAAAAAAAAAAAIAAAADAAAAFAADAAEAAAAUAAQAIAAAAAQABAABAAAAIP//AAAAIP///+EAAQAAAAAAAAAAAAAAAAAAAAAAAAAEADYAAQAAAAAAAQANAAAAAQAAAAAAAgAHAA0AAwABBAkAAQAaABQAAwABBAkAAgAOAC5HbHlwaExlc3NGb250UmVndWxhcgBHAGwAeQBwAGgATABlAHMAcwBGAG8AbgB0AFIAZQBnAHUAbABhAHIAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAECBWJsYW5r";

const IDENTITY_CMAP = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0000> <FFFF> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;

/** Register the glyphless Type0 font once per document. */
function glyphlessFont(doc: PDFDocument): PDFRef {
  const ctx = doc.context;
  const ttf = Uint8Array.from(atob(GLYPHLESS_TTF), (c) => c.charCodeAt(0));
  const fontFile = ctx.register(ctx.flateStream(ttf, { Length1: ttf.length }));
  // Every CID → glyph 1 (the blank glyph).
  const map = new Uint8Array(65536 * 2);
  for (let i = 1; i < map.length; i += 2) map[i] = 1;
  const cidToGid = ctx.register(ctx.flateStream(map));
  const descriptor = ctx.register(
    ctx.obj({
      Type: "FontDescriptor",
      FontName: "GlyphLessFont",
      Flags: 5,
      FontBBox: [0, -210, 500, 720],
      ItalicAngle: 0,
      Ascent: 720,
      Descent: -210,
      CapHeight: 720,
      StemV: 80,
      FontFile2: fontFile,
    }),
  );
  const cidFont = ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "CIDFontType2",
      BaseFont: "GlyphLessFont",
      CIDSystemInfo: ctx.obj({
        Registry: PDFString.of("Adobe"),
        Ordering: PDFString.of("Identity"),
        Supplement: 0,
      }),
      FontDescriptor: descriptor,
      DW: ADVANCE * 1000,
      CIDToGIDMap: cidToGid,
    }),
  );
  const toUnicode = ctx.register(ctx.flateStream(IDENTITY_CMAP));
  return ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "Type0",
      BaseFont: "GlyphLessFont",
      Encoding: "Identity-H",
      DescendantFonts: [cidFont],
      ToUnicode: toUnicode,
    }),
  );
}

/** UTF-16BE hex; characters outside the BMP (emoji…) are dropped. */
function utf16Hex(text: string): { hex: string; units: number } {
  let hex = "";
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff || cp < 0x20) continue;
    hex += cp.toString(16).padStart(4, "0");
    units++;
  }
  return { hex, units };
}

// Strong right-to-left letters: Hebrew, Arabic (+ supplements, presentation forms).
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;
export const isRtlWord = (text: string) => RTL.test(text);

/** A line is right-to-left when most of its letters are Hebrew/Arabic. */
export function isRtlLine(words: { text: string }[]): boolean {
  let rtl = 0;
  let other = 0;
  for (const ch of words.map((w) => w.text).join("")) {
    if (RTL.test(ch)) rtl++;
    else if (/\p{L}/u.test(ch)) other++;
  }
  return rtl > other;
}

// Runs that stay left-to-right inside an RTL word: digits (Western and Arabic-Indic)
// and Latin, with the punctuation numbers use.
const LTR_RUN =
  /[0-9A-Za-z\u0660-\u0669\u06f0-\u06f9.,:%+/-]+|[^0-9A-Za-z\u0660-\u0669\u06f0-\u06f9.,:%+/-]+/g;
const LTR_START = /^[0-9A-Za-z\u0660-\u0669\u06f0-\u06f9]/;

/**
 * Visual (left-to-right drawing) order of an RTL word, the convention every PDF
 * text extractor expects (Word, browsers… write Arabic this way): run order is
 * reversed, and so are the characters inside RTL runs, while numbers stay as-is.
 */
export function visualOrder(word: string): string {
  if (!isRtlWord(word)) return word;
  return (word.match(LTR_RUN) ?? [])
    .reverse()
    .map((r) => (LTR_START.test(r) ? r : [...r].reverse().join("")))
    .join("");
}

const op = (name: string, ...args: (number | PDFName | PDFHexString)[]) =>
  PDFOperator.of(
    name as Ops,
    args.map((a) => (typeof a === "number" ? PDFNumber.of(round(a)) : a)),
  );
const round = (n: number) => Math.round(n * 1000) / 1000;

const HAS_TEXT = /[\p{L}\p{N}]/u;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Punctuation that is normal in text; other lone symbols ("|", "~~~") are usually specks. */
const TYPOGRAPHIC = /^[«»“”„‘’"'()[\]{}.,;:!?¿¡…—–\-/%&*+=#@€$£،؛؟]+$/u;
const LATIN = /[A-Za-z\u00c0-\u024f]/;

/**
 * Which recognised words go into the layer. Specks and rules come out as
 * low-confidence "words", but so do real words next to punctuation, so the line
 * decides: in a confident line (median ≥ 60) nearly everything stays; in a doubtful
 * one only confident words do. Words whose script doesn't match their line (a
 * Latin misreading inside Arabic text, a speck read as an Arabic letter in English)
 * and lone letters need high confidence; a lone letter much smaller than the line's
 * words is a speck.
 */
export function keepWords<
  W extends { text: string; confidence: number; bbox?: { y0: number; y1: number } },
>(words: W[]): W[] {
  const real = words.filter((w) => w.text.trim());
  if (real.length === 1 && [...real[0].text.trim()].length === 1) {
    return real[0].confidence >= 90 ? real : [];
  }
  const confident = median(real.map((w) => w.confidence)) >= 60;
  const rtlLine = isRtlLine(real);
  const tall = median(
    real.filter((w) => w.bbox && [...w.text.trim()].length > 1).map((w) => w.bbox!.y1 - w.bbox!.y0),
  );
  return real.filter((w) => {
    const t = w.text.trim();
    if (!HAS_TEXT.test(t)) {
      return w.confidence >= (confident && TYPOGRAPHIC.test(t) ? 50 : 85);
    }
    const foreign = rtlLine ? LATIN.test(t) && !isRtlWord(t) : isRtlWord(t);
    if ([...t].length === 1 && w.bbox && tall > 0 && w.bbox.y1 - w.bbox.y0 < tall / 2) {
      return false; // a dot-sized "letter": a speck
    }
    if (foreign || [...t].length === 1) return w.confidence >= 80;
    return w.confidence >= (confident ? 20 : 75);
  });
}

export const countWords = (p: OcrPage) => p.lines.reduce((n, l) => n + l.words.length, 0);

/**
 * One text object per line: every word of a line shares the font size and the
 * baseline (so text extraction keeps lines and reading order), follows the line's
 * skew, and is stretched horizontally to cover its word on the scan.
 */
function textLayerOps(page: PDFPage, fontName: PDFName, ocr: OcrPage) {
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
    // Right-to-left line (mostly Arabic/Hebrew words): word gaps sit on the left.
    const rtlLine = isRtlLine(line.words);
    line.words.forEach((w, i) => {
      const word = w.text.trim();
      const glyphs = utf16Hex(word).units;
      const width = (w.x1 - w.x0) * sx;
      if (!glyphs || width <= 0) return;
      const stretch = (100 * width) / (glyphs * ADVANCE * size);
      // A real space after each word (in the gap) so copied text keeps its spaces.
      // In an RTL line "after" is on the left: draw the space just before the word.
      const spaced = i < line.words.length - 1;
      const visual = visualOrder(word);
      const shown = spaced ? (rtlLine ? ` ${visual}` : `${visual} `) : visual;
      const lead = spaced && rtlLine ? (ADVANCE * size * stretch) / 100 : 0;
      const [px, py] = visualToUser(w.x0 * sx - lead, H - baseAt(w.x0) * sy, box, rotation);
      ops.push(
        op(Ops.SetTextHorizontalScaling, stretch),
        op(Ops.SetTextMatrix, dir[0], dir[1], up[0], up[1], px, py),
        op(Ops.ShowText, PDFHexString.of(utf16Hex(shown).hex)),
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
  let font: PDFRef | undefined;
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
    font ??= glyphlessFont(doc);
    const fontName = page.node.newFontDictionary("OCR", font);
    page.pushOperators(...textLayerOps(page, fontName, ocr));
    words += n;
  }
  return { bytes: await doc.save({ useObjectStreams: true }), words };
}
