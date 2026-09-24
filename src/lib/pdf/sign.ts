// Visual signatures: stamp a signature image onto pages. Pure: no DOM, unit-tested.
//
// This is NOT a certificate-based digital signature — it adds an image, like signing
// a printout. The SAME document is kept (forms, bookmarks, metadata).
import { degrees } from "@cantoo/pdf-lib";
import { loadPdf, PdfToolError, visualSize, visualToUser } from "./ops";

/**
 * Where a signature goes, in the page's VISUAL frame (as displayed, after /Rotate),
 * in PDF points with the origin at the TOP-LEFT (what the UI works with).
 */
export interface Placement {
  id: string;
  /** 0-based page index */
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert a visual top-left placement to pdf-lib drawImage arguments. */
export function placementToUser(
  p: Pick<Placement, "left" | "top" | "width" | "height">,
  box: Box,
  rotation: number,
): { x: number; y: number; width: number; height: number; rotate: number } {
  const { height: H } = visualSize(box, rotation);
  // bottom-left corner of the placement, visual frame, origin bottom-left
  const vx = p.left;
  const vy = H - p.top - p.height;
  const [x, y] = visualToUser(vx, vy, box, rotation);
  return { x, y, width: p.width, height: p.height, rotate: ((rotation % 360) + 360) % 360 };
}

export async function signPdf(
  bytes: Uint8Array,
  signaturePng: Uint8Array,
  placements: Placement[],
  name?: string,
): Promise<Uint8Array> {
  if (!placements.length) throw new PdfToolError("empty", "Place your signature on a page first.");
  const doc = await loadPdf(bytes, name);
  const image = await doc.embedPng(signaturePng);
  const count = doc.getPageCount();
  for (const p of placements) {
    if (p.page < 0 || p.page >= count) continue;
    const page = doc.getPage(p.page);
    const r = placementToUser(p, page.getCropBox(), page.getRotation().angle);
    page.drawImage(image, {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      rotate: degrees(r.rotate),
    });
  }
  return doc.save({ useObjectStreams: true });
}
