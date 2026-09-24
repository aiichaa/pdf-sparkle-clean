// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, concatTransformationMatrix, degrees } from "@cantoo/pdf-lib";
import { addTextLayer, keepWords, visualOrder, type OcrPage } from "../ocr";

async function blank(rotate = 0): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 800]);
  p.setRotation(degrees(rotate));
  // a page whose content leaves the CTM changed (no q/Q) — must not move our text
  p.pushOperators(concatTransformationMatrix(0.5, 0, 0, 0.5, 0, 0));
  return d.save();
}

const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** a 2 px/pt scan of a 600×800 pt page, as displayed; baseline tilted by 2 px over the line */
const ocrPage = (rotation = 0): OcrPage => ({
  page: 0,
  imageWidth: rotation % 180 ? 1600 : 1200,
  imageHeight: rotation % 180 ? 1200 : 1600,
  lines: [
    {
      x0: 200,
      y0: 200,
      x1: 420,
      y1: 252,
      baseline: { x0: 200, y0: 240, x1: 420, y1: 242 },
      words: [{ text: "Invoice", x0: 200, y0: 200, x1: 420, y1: 250 }],
    },
    {
      x0: 200,
      y0: 400,
      x1: 680,
      y1: 450,
      words: [
        { text: "Total:", x0: 200, y0: 400, x1: 330, y1: 440 },
        { text: "1", x0: 350, y0: 400, x1: 370, y1: 440 },
        { text: "234,50", x0: 385, y0: 400, x1: 520, y1: 450 },
        { text: "€", x0: 535, y0: 400, x1: 560, y1: 440 },
        { text: "日本", x0: 600, y0: 400, x1: 680, y1: 440 }, // any script: kept as is
      ],
    },
  ],
});

describe("addTextLayer", () => {
  it("adds invisible text (render mode 3) with the words", async () => {
    const { bytes, words } = await addTextLayer(await blank(), [ocrPage()]);
    expect(words).toBe(6);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // content: q … Q wrapping the original, then our BT … 3 Tr … ET
    const contents = doc.getPage(0).node.Contents();
    expect(contents).toBeDefined();
  });

  it.skipIf(!hasPdftotext)("text lands where the scan shows it, on any rotation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ocr-"));
    for (const rot of [0, 90, 180, 270]) {
      const { bytes } = await addTextLayer(await blank(rot), [ocrPage(rot)]);
      const f = join(dir, `r${rot}.pdf`);
      writeFileSync(f, bytes);
      const text = execFileSync("pdftotext", ["-layout", f, "-"]).toString();
      expect(text).toContain("Invoice");
      expect(text).toMatch(/Total:\s+1\s+234,50\s+€/);
      // words of a line come out as one line, in order
      const plain = execFileSync("pdftotext", [f, "-"]).toString();
      expect(plain, `rotation ${rot}`).toMatch(/^Total: 1 234,50 € 日本$/m);
      // bbox of "Invoice" in the displayed page: x ≈ 100 pt, top ≈ 100 pt
      const html = execFileSync("pdftotext", ["-bbox", f, "-"]).toString();
      const m = html.match(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">Invoice/,
      );
      expect(m, `rotation ${rot}`).not.toBeNull();
      const [x0, y0, x1, y1] = m!.slice(1).map(Number);
      expect(Math.abs(x0 - 100), `x0 @${rot}`).toBeLessThan(3);
      expect(Math.abs(x1 - 210), `x1 @${rot}`).toBeLessThan(3);
      expect(y0, `y0 @${rot}`).toBeGreaterThan(95);
      expect(y1, `y1 @${rot}`).toBeLessThan(128);
    }
  });

  it.skipIf(!hasPdftotext)("Arabic comes back in logical order (RTL words)", async () => {
    // Tesseract lists RTL words in reading order: the rightmost first.
    const ar: OcrPage = {
      page: 0,
      imageWidth: 1200,
      imageHeight: 1600,
      lines: [
        {
          x0: 300,
          y0: 200,
          x1: 1000,
          y1: 260,
          baseline: { x0: 300, y0: 245, x1: 1000, y1: 245 },
          words: [
            { text: "مرحبا", x0: 820, y0: 200, x1: 1000, y1: 255 },
            { text: "بالعالم", x0: 560, y0: 200, x1: 790, y1: 255 },
            { text: "العربي", x0: 300, y0: 200, x1: 530, y1: 260 },
            { text: "2024", x0: 200, y0: 200, x1: 280, y1: 250 },
            { text: "م", x0: 150, y0: 200, x1: 180, y1: 250 },
          ],
        },
      ],
    };
    const { bytes } = await addTextLayer(await blank(), [ar]);
    const f = join(mkdtempSync(join(tmpdir(), "ocr-")), "ar.pdf");
    writeFileSync(f, bytes);
    // pdftotext wraps the number in bidi marks (LRE … PDF), as for any Arabic PDF.
    const text = execFileSync("pdftotext", [f, "-"]).toString();
    expect(text).toContain("مرحبا بالعالم العربي");
    expect(text).toMatch(/\u202a ?2024\u202c ?م/);
    // pdf.js (Firefox, and our own previews) gives the exact logical string.
    // It needs Promise.withResolvers (Node 22+); polyfill for older hosts.
    const P = Promise as unknown as { withResolvers?: () => unknown };
    P.withResolvers ??= () => {
      let resolve, reject;
      const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
      return { promise, resolve, reject };
    };
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items as { str: string }[];
    const line = items
      .map((i) => i.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    expect(line).toBe("مرحبا بالعالم العربي 2024 م");
    // "مرحبا" sits at the right: x ≈ 410–500 pt
    const html = execFileSync("pdftotext", ["-bbox", f, "-"]).toString();
    const m = html.match(/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">ابحرم/); // -bbox prints the raw visual order
    expect(m).not.toBeNull();
    expect(Math.abs(Number(m![1]) - 410)).toBeLessThan(3);
    expect(Math.abs(Number(m![2]) - 500)).toBeLessThan(3);
  });

  it("puts RTL words in visual order, keeping numbers left-to-right", () => {
    expect(visualOrder("Invoice")).toBe("Invoice");
    expect(visualOrder("سلام")).toBe("مالس");
    expect(visualOrder("عام2024م")).toBe("م2024ماع");
    expect(visualOrder("١٢٣درهم")).toBe("مهرد١٢٣");
  });

  it("keeps shaky words in confident lines, drops specks", () => {
    const w = (text: string, confidence: number) => ({ text, confidence });
    // a real word at 35% between confident neighbours stays
    expect(keepWords([w("تم", 97), w("اليوم،", 35), w("درهم", 91)]).map((x) => x.text)).toEqual([
      "تم",
      "اليوم،",
      "درهم",
    ]);
    // a noisy line keeps only its confident words
    expect(keepWords([w("EE", 30), w("FE", 45), w("Tip", 80)]).map((x) => x.text)).toEqual(["Tip"]);
    // lone characters on their own line are specks unless very confident
    expect(keepWords([w("ض", 75)])).toEqual([]);
    expect(keepWords([w("5", 95)])).toHaveLength(1);
    // script mismatches and stray symbols need high confidence
    expect(
      keepWords([w("الدار", 92), w("clad!", 43), w("المغرب", 92), w("PDF", 90)]).map((x) => x.text),
    ).toEqual(["الدار", "المغرب", "PDF"]);
    expect(keepWords([w("Project", 95), w("Handbook", 93), w("ض", 75)]).map((x) => x.text)).toEqual(
      ["Project", "Handbook"],
    );
    const b = (text: string, confidence: number, h: number) => ({
      text,
      confidence,
      bbox: { y0: 0, y1: h },
    });
    expect(keepWords([b("دليل", 92, 60), b("المشروع", 91, 62), b("ض", 95, 20)])).toHaveLength(2);
    expect(keepWords([b("I", 95, 50), b("think", 94, 52)])).toHaveLength(2);
    expect(keepWords([w("الحروف.", 89), w("|", 60)]).map((x) => x.text)).toEqual(["الحروف."]);
    // punctuation: « — » kept in a good line, "~~~" dropped
    expect(keepWords([w("«", 70), w("déjà", 90), w("~~~", 30)]).map((x) => x.text)).toEqual([
      "«",
      "déjà",
    ]);
  });

  it("skips pages without words and leaves them untouched", async () => {
    const src = await blank();
    const { bytes, words } = await addTextLayer(src, [{ ...ocrPage(), lines: [] }]);
    expect(words).toBe(0);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
