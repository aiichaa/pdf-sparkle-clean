// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, concatTransformationMatrix, degrees } from "@cantoo/pdf-lib";
import { addTextLayer, type OcrPage } from "../ocr";

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
        { text: "日本", x0: 600, y0: 400, x1: 680, y1: 440 }, // not WinAnsi → "?"
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
      expect(plain, `rotation ${rot}`).toMatch(/^Total: 1 234,50 € \?\?$/m);
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

  it("skips pages without words and leaves them untouched", async () => {
    const src = await blank();
    const { bytes, words } = await addTextLayer(src, [{ ...ocrPage(), lines: [] }]);
    expect(words).toBe(0);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
