// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFNumber, PDFArray } from "@cantoo/pdf-lib";
import { zlibSync } from "fflate";
import { compressPdf, unpredictPng, type ImageEncoder, type ImageInput } from "../compress";
import { JPEG_30x60 } from "./fixtures";

const N = (s: string) => PDFName.of(s);

/** Deterministic noise (doesn't compress), so streams stay above the size threshold. */
function noise(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed * 2654435761 || 1;
  for (let i = 0; i < n; i++) {
    // xorshift32: good enough that zlib can't shrink it
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

interface Built {
  bytes: Uint8Array;
}

/** A 1-page PDF with a zoo of images, an orphan object, a raw stream and a form field. */
async function buildZoo(): Promise<Built> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const ctx = doc.context;
  const img = (name: string, dict: Record<string, unknown>, data: Uint8Array) => {
    const ref = ctx.register(
      ctx.stream(data, { Type: "XObject", Subtype: "Image", BitsPerComponent: 8, ...dict }),
    );
    page.node.setXObject(N(name), ref);
    return ref;
  };
  // 1. RGB JPEG (the encoder is faked, so the bytes only need to be big)
  img(
    "Jpeg",
    { Width: 3000, Height: 2000, ColorSpace: "DeviceRGB", Filter: "DCTDecode" },
    noise(60_000, 1),
  );
  // 2. Flate RGB pixels, no predictor
  img(
    "Flat",
    { Width: 200, Height: 150, ColorSpace: "DeviceRGB", Filter: "FlateDecode" },
    zlibSync(noise(200 * 150 * 3, 2)),
  );
  // 3. Flate grey pixels with PNG predictor 15 (all rows filter type 0)
  const rows: number[] = [];
  const grey = noise(180 * 180, 3);
  for (let r = 0; r < 180; r++) rows.push(0, ...grey.subarray(r * 180, r * 180 + 180));
  const png = img(
    "Pred",
    { Width: 180, Height: 180, ColorSpace: "DeviceGray", Filter: "FlateDecode" },
    zlibSync(Uint8Array.from(rows)),
  );
  (ctx.lookup(png) as PDFRawStream).dict.set(
    N("DecodeParms"),
    ctx.obj({ Predictor: 15, Columns: 180, Colors: 1 }),
  );
  // 4. CMYK JPEG → must be skipped
  img(
    "Cmyk",
    { Width: 900, Height: 600, ColorSpace: "DeviceCMYK", Filter: "DCTDecode" },
    noise(50_000, 4),
  );
  // 5. JPEG with a /Decode array (inverted) → must be skipped
  img(
    "Inv",
    {
      Width: 900,
      Height: 600,
      ColorSpace: "DeviceRGB",
      Filter: "DCTDecode",
      Decode: [1, 0, 1, 0, 1, 0],
    },
    noise(50_000, 5),
  );
  // 6. an orphan: registered, never referenced
  ctx.register(ctx.stream(noise(40_000, 6), {}));
  // 7. a large uncompressed stream that is referenced (from the catalog)
  const text = new TextEncoder().encode("hello world ".repeat(5000));
  doc.catalog.set(N("PieceInfo"), ctx.register(PDFRawStream.of(ctx.obj({}) as PDFDict, text)));
  // 8. a form field that must survive
  const f = doc.getForm().createTextField("name");
  f.setText("Aicha");
  f.addToPage(page, { x: 50, y: 50 });
  doc.setTitle("Zoo");
  return { bytes: await doc.save({ useObjectStreams: false }) };
}

/** Fake encoder: records inputs, returns a tiny real JPEG at half size. */
function fakeEncoder(): { encode: ImageEncoder; seen: ImageInput[] } {
  const seen: ImageInput[] = [];
  return {
    seen,
    encode: async (img, { maxSide }) => {
      seen.push(img);
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      return {
        bytes: JPEG_30x60,
        width: Math.round(img.width * s),
        height: Math.round(img.height * s),
      };
    },
  };
}

const images = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  const res = doc.getPage(0).node.Resources()!;
  const xo = res.lookup(N("XObject"), PDFDict);
  const get = (n: string) => xo.lookup(N(n)) as PDFRawStream;
  return { doc, get };
};

describe("compressPdf", () => {
  it("re-encodes only safe images, and updates their dictionaries", async () => {
    const { bytes } = await buildZoo();
    const { encode, seen } = fakeEncoder();
    const { bytes: out, report } = await compressPdf(bytes, "strong", encode);
    expect(seen.map((s) => s.kind).sort()).toEqual(["jpeg", "pixels", "pixels"]);
    const pred = seen.find((s) => s.kind === "pixels" && s.channels === 1)!;
    expect(pred.kind === "pixels" && pred.pixels.length).toBe(180 * 180);
    expect(report.imagesFound).toBe(5);
    expect(report.imagesRecompressed).toBe(3);

    const { get } = await images(out);
    const jpeg = get("Jpeg").dict;
    expect(jpeg.get(N("Filter"))?.toString()).toBe("/DCTDecode");
    expect((jpeg.get(N("Width")) as PDFNumber).asNumber()).toBe(1400);
    expect((jpeg.get(N("Height")) as PDFNumber).asNumber()).toBe(933);
    const flat = get("Flat").dict;
    expect(flat.get(N("Filter"))?.toString()).toBe("/DCTDecode");
    expect(flat.get(N("ColorSpace"))?.toString()).toBe("/DeviceRGB");
    expect(get("Pred").dict.has(N("DecodeParms"))).toBe(false);
    // untouched
    expect(get("Cmyk").dict.get(N("ColorSpace"))?.toString()).toBe("/DeviceCMYK");
    expect(get("Cmyk").getContentsSize()).toBe(50_000);
    expect(get("Inv").dict.get(N("Decode"))).toBeInstanceOf(PDFArray);
  });

  it("is lossless when asked: removes orphans, compresses raw streams, keeps images", async () => {
    const { bytes } = await buildZoo();
    const { encode, seen } = fakeEncoder();
    const { bytes: out, report } = await compressPdf(bytes, "lossless", encode);
    expect(seen).toHaveLength(0);
    expect(report.imagesRecompressed).toBe(0);
    expect(report.objectsRemoved).toBeGreaterThanOrEqual(1);
    expect(report.streamsCompressed).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeLessThan(bytes.length - 40_000); // the orphan alone was 40 KB
    const { get } = await images(out);
    expect(get("Jpeg").getContentsSize()).toBe(60_000);
  });

  it("keeps forms, title and pages", async () => {
    const { bytes } = await buildZoo();
    const { bytes: out } = await compressPdf(bytes, "recommended", fakeEncoder().encode);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Zoo");
    expect(doc.getForm().getTextField("name").getText()).toBe("Aicha");
  });

  it("keeps the original image when re-encoding doesn't help", async () => {
    const { bytes } = await buildZoo();
    const bigger: ImageEncoder = async (img) => ({
      bytes: noise(90_000, 9),
      width: img.width,
      height: img.height,
    });
    const { report } = await compressPdf(bytes, "strong", bigger);
    expect(report.imagesRecompressed).toBe(0);
  });

  it("survives an encoder that fails", async () => {
    const { bytes } = await buildZoo();
    const broken: ImageEncoder = async () => {
      throw new Error("canvas exploded");
    };
    const { report } = await compressPdf(bytes, "strong", broken);
    expect(report.imagesRecompressed).toBe(0);
  });
});

describe("unpredictPng", () => {
  it("undoes Sub, Up, Average and Paeth filters", () => {
    // 2×2 RGB image, rows filtered with types 1 (Sub) and 2 (Up).
    const row0 = [10, 20, 30, 15, 25, 35];
    const row1 = [11, 21, 31, 16, 26, 36];
    const sub = [1, 10, 20, 30, 5, 5, 5];
    const up = [2, 1, 1, 1, 1, 1, 1];
    expect([...unpredictPng(Uint8Array.from([...sub, ...up]), 2, 3)]).toEqual([...row0, ...row1]);
    // Average: out = x + floor((a + b) / 2); Paeth picks the closest of a, b, c.
    const avg = [3, 10, 20, 30, 10, 15, 20];
    expect([...unpredictPng(Uint8Array.from(avg), 2, 3)]).toEqual([10, 20, 30, 15, 25, 35]);
    const paeth = [4, 10, 20, 30, 5, 5, 5];
    expect([...unpredictPng(Uint8Array.from(paeth), 2, 3)]).toEqual([10, 20, 30, 15, 25, 35]);
  });
});
