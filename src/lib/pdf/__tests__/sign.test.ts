// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict, degrees } from "@cantoo/pdf-lib";
import { placementToUser, signPdf } from "../sign";
import { PNG_40x20 } from "./fixtures";

const box = { x: 0, y: 0, width: 200, height: 300 };
// A 40×20 signature with its top-left 10pt from the left and 30pt from the top.
const p = { left: 10, top: 30, width: 40, height: 20 };

describe("placementToUser", () => {
  it("unrotated: flips top-left to bottom-left", () => {
    expect(placementToUser(p, box, 0)).toEqual({
      x: 10,
      y: 300 - 30 - 20,
      width: 40,
      height: 20,
      rotate: 0,
    });
  });
  it("90°: the page is displayed 300 wide × 200 tall", () => {
    // visual bottom-left = (10, 200 - 30 - 20 = 150) → user (200 - 150, 10)
    expect(placementToUser(p, box, 90)).toEqual({
      x: 50,
      y: 10,
      width: 40,
      height: 20,
      rotate: 90,
    });
  });
  it("180° and 270°", () => {
    expect(placementToUser(p, box, 180)).toEqual({
      x: 190,
      y: 50,
      width: 40,
      height: 20,
      rotate: 180,
    });
    // visual H = 200 → vy = 150 → user (150, 300 - 10)
    expect(placementToUser(p, box, 270)).toEqual({
      x: 150,
      y: 290,
      width: 40,
      height: 20,
      rotate: 270,
    });
  });
  it("respects a crop box offset", () => {
    expect(placementToUser(p, { x: 20, y: 40, width: 200, height: 300 }, 0)).toMatchObject({
      x: 30,
      y: 290,
    });
  });
});

async function twoPages(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage([200, 300]);
  d.addPage([200, 300]).setRotation(degrees(90));
  const f = d.getForm().createTextField("name");
  f.addToPage(d.getPage(0), { x: 10, y: 10, width: 100, height: 20 });
  d.setTitle("Contract");
  return d.save();
}

const xobjects = (doc: PDFDocument, i: number) => {
  const res = doc.getPage(i).node.Resources();
  const xo = res?.lookup(PDFName.of("XObject"));
  if (!(xo instanceof PDFDict)) return 0;
  // distinct image objects (pdf-lib names every draw separately; form widgets can
  // add Form XObjects)
  const refs = xo
    .keys()
    .filter((k) => {
      const o = xo.lookup(k) as unknown as { dict?: PDFDict };
      return o.dict?.get(PDFName.of("Subtype"))?.toString() === "/Image";
    })
    .map((k) => xo.get(k)!.toString());
  return new Set(refs).size;
};

describe("signPdf", () => {
  it("stamps the signature on the chosen pages and keeps the document", async () => {
    const out = await signPdf(await twoPages(), PNG_40x20, [
      { id: "a", page: 0, ...p },
      { id: "b", page: 1, ...p },
      { id: "c", page: 1, left: 100, top: 100, width: 40, height: 20 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(xobjects(doc, 0)).toBe(1);
    expect(xobjects(doc, 1)).toBe(1); // same image, drawn twice
    expect(doc.getForm().getFields()).toHaveLength(1);
    expect(doc.getTitle()).toBe("Contract");
  });

  it("needs at least one placement and ignores pages that don't exist", async () => {
    await expect(signPdf(await twoPages(), PNG_40x20, [])).rejects.toMatchObject({ code: "empty" });
    const out = await signPdf(await twoPages(), PNG_40x20, [{ id: "x", page: 9, ...p }]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });
});
