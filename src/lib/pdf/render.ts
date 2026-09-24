// PDF rendering with Mozilla pdf.js — browser only (canvas + web worker).
// Import this module dynamically from components so SSR never loads pdf.js.
//
// Hardening: pages are only ever painted to <canvas>. We never build a text or
// annotation layer, never run embedded JavaScript (the scripting sandbox isn't
// shipped) and XFA forms are off. Worker, WASM decoders and fonts come from our own
// origin (see scripts/copy-pdfjs-assets.mjs).
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { MAX_CANVAS_PIXELS } from "./limits";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

export async function openDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    // pdf.js transfers (detaches) the buffer to its worker — give it a copy.
    data: bytes.slice(),
    wasmUrl: "/pdfjs/wasm/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    iccUrl: "/pdfjs/iccs/",
    enableXfa: false,
    useSystemFonts: false,
    disableAutoFetch: true,
    stopAtErrors: false,
  });
  return task.promise;
}

/** Keep a render inside the canvas pixel budget by lowering the scale if needed. */
function safeScale(page: PDFPageProxy, scale: number, rotation: number): number {
  const vp = page.getViewport({ scale: 1, rotation });
  const maxScale = Math.sqrt(MAX_CANVAS_PIXELS / (vp.width * vp.height));
  return Math.min(scale, maxScale);
}

/**
 * Paint a page into `canvas` at `cssWidth` CSS pixels wide (sharp on HiDPI).
 * `extraRotation` is added to the page's own /Rotate.
 */
export async function renderThumbnail(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  extraRotation = 0,
): Promise<void> {
  const page = await doc.getPage(pageNumber);
  const rotation = (page.rotate + extraRotation) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = safeScale(page, (cssWidth / base.width) * dpr, rotation);
  const viewport = page.getViewport({ scale, rotation });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.round((viewport.height / viewport.width) * cssWidth)}px`;
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
}

export type ImageFormat = "png" | "jpeg";

/** Render one page to an image blob at the given DPI. */
export async function renderPageToImage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  dpi: number,
  format: ImageFormat,
  quality = 0.9,
): Promise<Blob> {
  const page = await doc.getPage(pageNumber);
  const scale = safeScale(page, dpi / 72, page.rotate);
  const viewport = page.getViewport({ scale, rotation: page.rotate });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  if (format === "jpeg") {
    // JPEG has no transparency: paint white first so empty areas aren't black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format === "png" ? "image/png" : "image/jpeg", quality),
  );
  canvas.width = canvas.height = 0; // free the backing store early
  if (!blob) throw new Error("Could not encode the image");
  return blob;
}
