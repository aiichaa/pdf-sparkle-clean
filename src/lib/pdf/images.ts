import type { SniffedType } from "./files";

/**
 * EXIF orientation (1–8) of a JPEG, or 1 when absent. Phone cameras store the
 * rotation here instead of rotating pixels; PDF engines ignore it, so photos would
 * come out sideways unless we re-encode them upright.
 */
export function jpegOrientation(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xda || marker === 0xd9) return 1; // start of scan / end: no EXIF
    // APP1 "Exif\0\0"
    if (
      marker === 0xe1 &&
      b[i + 4] === 0x45 &&
      b[i + 5] === 0x78 &&
      b[i + 6] === 0x69 &&
      b[i + 7] === 0x66
    ) {
      const t = i + 10; // TIFF header
      const little = b[t] === 0x49;
      const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) =>
        little
          ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
          : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      const ifd = t + u32(t + 4);
      const count = u16(ifd);
      for (let k = 0; k < count; k++) {
        const entry = ifd + 2 + k * 12;
        if (entry + 12 > b.length) return 1;
        if (u16(entry) === 0x0112) {
          const v = u16(entry + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/**
 * Bring any accepted image to bytes pdf-lib can embed (PNG or JPEG), upright.
 * PNG and upright JPEG pass through untouched (no quality loss); WebP/GIF/BMP and
 * rotated JPEGs are re-encoded through a canvas. Browser only.
 */
export async function toEmbeddable(
  bytes: Uint8Array,
  type: SniffedType,
): Promise<{ bytes: Uint8Array; type: "png" | "jpeg" }> {
  if (type === "png") return { bytes, type: "png" };
  if (type === "jpeg" && jpegOrientation(bytes) === 1) return { bytes, type: "jpeg" };
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), {
    imageOrientation: "from-image",
  });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const asJpeg = type === "jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, asJpeg ? "image/jpeg" : "image/png", 0.92),
  );
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("Could not convert the image");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: asJpeg ? "jpeg" : "png" };
}
