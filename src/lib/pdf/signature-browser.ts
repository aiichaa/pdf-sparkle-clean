// Browser helpers to turn a drawn / typed / uploaded signature into a trimmed PNG.
// Everything stays in memory; nothing is stored (no localStorage) or sent anywhere.
import dancingUrl from "@fontsource/dancing-script/files/dancing-script-latin-600-normal.woff2?url";
import greatVibesUrl from "@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff2?url";
import caveatUrl from "@fontsource/caveat/files/caveat-latin-600-normal.woff2?url";

export interface Signature {
  png: Uint8Array;
  /** pixel size of the trimmed PNG */
  width: number;
  height: number;
  /** data: URL for on-screen previews (CSP img-src allows data:) */
  dataUrl: string;
}

export const SIGNATURE_FONTS = [
  {
    id: "dancing",
    label: "Dancing Script",
    family: "Clarity Sig Dancing",
    url: dancingUrl,
    weight: "600",
  },
  {
    id: "vibes",
    label: "Great Vibes",
    family: "Clarity Sig Vibes",
    url: greatVibesUrl,
    weight: "400",
  },
  { id: "caveat", label: "Caveat", family: "Clarity Sig Caveat", url: caveatUrl, weight: "600" },
] as const;

export type SignatureFontId = (typeof SIGNATURE_FONTS)[number]["id"];

const loaded = new Map<string, Promise<void>>();

/** Load the bundled handwriting fonts (same-origin woff2, CSP font-src 'self'). */
export function loadSignatureFonts(): Promise<void> {
  return Promise.all(
    SIGNATURE_FONTS.map((f) => {
      if (!loaded.has(f.family)) {
        const face = new FontFace(f.family, `url(${f.url})`, { weight: f.weight });
        loaded.set(
          f.family,
          face.load().then((ff) => {
            document.fonts.add(ff);
          }),
        );
      }
      return loaded.get(f.family)!;
    }),
  ).then(() => undefined);
}

/** Crop to the non-transparent pixels (+ padding) and export as PNG. */
export async function trimToSignature(
  source: HTMLCanvasElement,
  padding = 8,
): Promise<Signature | null> {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width: w, height: h } = source;
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // empty
  const x0 = Math.max(0, minX - padding);
  const y0 = Math.max(0, minY - padding);
  const tw = Math.min(w, maxX + padding + 1) - x0;
  const th = Math.min(h, maxY + padding + 1) - y0;
  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  out.getContext("2d")!.drawImage(source, x0, y0, tw, th, 0, 0, tw, th);
  const dataUrl = out.toDataURL("image/png");
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), width: tw, height: th, dataUrl };
}

/** Render a typed name in a handwriting font. */
export async function renderTypedSignature(
  text: string,
  fontId: SignatureFontId,
  color: string,
): Promise<Signature | null> {
  const font = SIGNATURE_FONTS.find((f) => f.id === fontId)!;
  await loadSignatureFonts();
  const size = 140;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${font.weight} ${size}px "${font.family}"`;
  const w = Math.ceil(ctx.measureText(text).width) + size;
  canvas.width = Math.min(Math.max(w, 200), 4000);
  canvas.height = Math.round(size * 1.8);
  const c = canvas.getContext("2d")!;
  c.font = `${font.weight} ${size}px "${font.family}"`;
  c.fillStyle = color;
  c.textBaseline = "alphabetic";
  c.fillText(text, size / 2, size * 1.25);
  return trimToSignature(canvas);
}

/**
 * Photo or scan of a signature on paper → transparent PNG. Near-white pixels
 * become transparent, with a soft ramp so edges stay smooth.
 */
export async function signatureFromImage(
  bytes: Uint8Array,
  removeBackground: boolean,
): Promise<Signature | null> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]), {
    imageOrientation: "from-image",
  });
  const scale = Math.min(1, 1600 / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  if (removeBackground) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const lo = 170,
        hi = 220;
      const keep = luma <= lo ? 1 : luma >= hi ? 0 : (hi - luma) / (hi - lo);
      d[i + 3] = Math.round(d[i + 3] * keep);
    }
    ctx.putImageData(img, 0, 0);
  }
  return trimToSignature(canvas);
}
