// Browser implementation of the image encoder used by compress.ts (canvas-based).
import type { EncodedImage, ImageEncoder, ImageInput } from "./compress";

function toImageData(img: Extract<ImageInput, { kind: "pixels" }>): ImageData {
  const { width: w, height: h, channels, pixels } = img;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += channels) {
    const o = i * 4;
    if (channels === 3) {
      rgba[o] = pixels[j];
      rgba[o + 1] = pixels[j + 1];
      rgba[o + 2] = pixels[j + 2];
    } else {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[j];
    }
    rgba[o + 3] = 255;
  }
  return new ImageData(rgba, w, h);
}

export const browserImageEncoder: ImageEncoder = async (
  img,
  { maxSide, quality },
): Promise<EncodedImage | null> => {
  const { width: w, height: h } = img;
  // PDF viewers ignore EXIF orientation and embedded JPEG colour profiles, so we
  // must too — otherwise the re-encoded image would rotate or shift colours.
  const source =
    img.kind === "jpeg"
      ? await createImageBitmap(new Blob([img.bytes as BlobPart], { type: "image/jpeg" }), {
          imageOrientation: "none",
          colorSpaceConversion: "none",
        })
      : await createImageBitmap(toImageData(img));
  try {
    if (source.width !== w || source.height !== h) return null; // dictionary lies about the size
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, tw, th);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    canvas.width = canvas.height = 0;
    if (!blob) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: tw, height: th };
  } finally {
    source.close();
  }
};
