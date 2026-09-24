// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, degrees } from "@cantoo/pdf-lib";
import {
  mergePdfs,
  splitPdf,
  organizePdf,
  imagesToPdf,
  addPageNumbers,
  addWatermark,
  loadPdf,
  visualToUser,
  visualSize,
  formatPageNumber,
  PdfToolError,
} from "../ops";
import { PNG_40x20, JPEG_30x60 } from "./fixtures";

/** A PDF whose pages have distinct widths, so we can tell them apart after edits. */
async function makePdf(pages: number, { withJs = false, rotate = 0 } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([200 + i, 300]);
    if (rotate) p.setRotation(degrees(rotate));
  }
  if (withJs) {
    // Document-level JavaScript that runs on open.
    const js = doc.context.obj({ Type: "Action", S: "JavaScript", JS: "app.alert(1)" });
    doc.catalog.set(PDFName.of("OpenAction"), doc.context.register(js));
  }
  return doc.save();
}

const widths = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));

describe("merge", () => {
  it("concatenates in the given order", async () => {
    const a = await makePdf(2);
    const b = await makePdf(3);
    const out = await mergePdfs([
      { bytes: b, name: "b.pdf" },
      { bytes: a, name: "a.pdf" },
    ]);
    expect(await widths(out)).toEqual([200, 201, 202, 200, 201]);
  });

  it("drops document-level JavaScript from inputs", async () => {
    const out = await mergePdfs([
      { bytes: await makePdf(1, { withJs: true }), name: "evil.pdf" },
      { bytes: await makePdf(1), name: "ok.pdf" },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.catalog.get(PDFName.of("OpenAction"))).toBeUndefined();
    expect(new TextDecoder("latin1").decode(out)).not.toContain("app.alert");
  });

  it("needs two files", async () => {
    await expect(mergePdfs([{ bytes: await makePdf(1), name: "a" }])).rejects.toThrow(PdfToolError);
  });
});

describe("split", () => {
  it("produces one PDF per group", async () => {
    const outs = await splitPdf(await makePdf(5), [[0, 1], [4], [3, 2]]);
    expect(outs).toHaveLength(3);
    expect(await widths(outs[0])).toEqual([200, 201]);
    expect(await widths(outs[1])).toEqual([204]);
    expect(await widths(outs[2])).toEqual([203, 202]);
  });
});

describe("organize", () => {
  it("reorders, rotates and deletes pages", async () => {
    const out = await organizePdf(await makePdf(4, { rotate: 90 }), [
      { index: 3, rotate: 0 },
      { index: 0, rotate: 90 },
      { index: 1, rotate: 270 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([203, 200, 201]);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 180, 0]);
  });
});

describe("imagesToPdf", () => {
  it("makes one page per image, sized to the image in fit mode", async () => {
    const out = await imagesToPdf(
      [
        { bytes: PNG_40x20, type: "png" },
        { bytes: JPEG_30x60, type: "jpeg" },
      ],
      { pageSize: "fit", orientation: "auto", margin: 0 },
    );
    const pages = (await PDFDocument.load(out)).getPages();
    expect(pages.map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [30, 15],
      [22.5, 45],
    ]);
  });

  it("uses A4 and picks landscape automatically for wide images", async () => {
    const out = await imagesToPdf([{ bytes: PNG_40x20, type: "png" }], {
      pageSize: "a4",
      orientation: "auto",
      margin: 20,
    });
    const [p] = (await PDFDocument.load(out)).getPages();
    expect(Math.round(p.getWidth())).toBe(842);
    expect(Math.round(p.getHeight())).toBe(595);
  });
});

describe("page numbers & watermark", () => {
  it("formats labels", () => {
    expect(formatPageNumber(3, 10, "n")).toBe("3");
    expect(formatPageNumber(3, 10, "n-of-total")).toBe("3 / 10");
    expect(formatPageNumber(3, 10, "page-n-of-total")).toBe("Page 3 of 10");
  });

  it("keeps every page and adds content", async () => {
    const src = await makePdf(3, { rotate: 90 });
    const out = await addPageNumbers(src, {
      position: "bottom-right",
      format: "n-of-total",
      startAt: 1,
      fontSize: 11,
      skipFirst: true,
      margin: 24,
    });
    const doc = await loadPdf(out);
    expect(doc.getPageCount()).toBe(3);
    expect(out.length).toBeGreaterThan(src.length);
  });

  it("reports characters the standard font can't draw", async () => {
    const res = await addWatermark(await makePdf(2), {
      text: "BROUILLON 秘",
      fontSize: 60,
      opacity: 0.2,
      layout: "diagonal",
      color: "red",
    });
    expect(res.replacedChars).toBe(true);
    expect((await loadPdf(res.bytes)).getPageCount()).toBe(2);
  });
});

describe("geometry for rotated pages", () => {
  const box = { x: 0, y: 0, width: 200, height: 300 };
  it("swaps the visual size for 90/270", () => {
    expect(visualSize(box, 0)).toEqual({ width: 200, height: 300 });
    expect(visualSize(box, 90)).toEqual({ width: 300, height: 200 });
  });
  it("maps the visual bottom-left corner to the right user-space corner", () => {
    expect(visualToUser(0, 0, box, 0)).toEqual([0, 0]);
    expect(visualToUser(0, 0, box, 90)).toEqual([200, 0]);
    expect(visualToUser(0, 0, box, 180)).toEqual([200, 300]);
    expect(visualToUser(0, 0, box, 270)).toEqual([0, 300]);
  });
});

describe("rejections", () => {
  it("explains password-protected files", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.encrypt({ userPassword: "secret", ownerPassword: "owner" });
    const bytes = await doc.save();
    await expect(loadPdf(bytes, "locked.pdf")).rejects.toMatchObject({ code: "encrypted" });
  });

  it("explains broken files", async () => {
    await expect(
      loadPdf(new TextEncoder().encode("%PDF-1.7 garbage"), "bad.pdf"),
    ).rejects.toMatchObject({
      code: "invalid",
    });
  });
});
