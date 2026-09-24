import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { cn } from "@/lib/utils";

/** Run `cb` once the element scrolls near the viewport (thumbnails render lazily). */
function useVisible<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return { ref, visible };
}

interface PageThumbProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** extra clockwise rotation on top of the page's own */
  rotation?: number;
  width?: number;
  className?: string;
}

/** A PDF page painted to <canvas> by pdf.js — no text or annotation layer. */
export function PageThumb({
  doc,
  pageNumber,
  rotation = 0,
  width = 140,
  className,
}: PageThumbProps) {
  const { ref, visible } = useVisible<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"idle" | "done" | "error">("idle");

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let cancelled = false;
    import("@/lib/pdf/render")
      .then((r) => r.renderThumbnail(doc, pageNumber, canvasRef.current!, width, rotation))
      .then(() => !cancelled && setState("done"))
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [visible, doc, pageNumber, rotation, width]);

  return (
    <div
      ref={ref}
      className={cn("relative flex items-center justify-center overflow-hidden", className)}
      style={{ minHeight: state === "done" ? undefined : Math.round(width * 1.3) }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn(
          "rounded-sm bg-white shadow-sm ring-1 ring-black/10",
          state !== "done" && "hidden",
        )}
      />
      {state === "idle" ? (
        <div className="absolute inset-2 animate-pulse rounded-sm bg-muted" />
      ) : null}
      {state === "error" ? (
        <span className="px-2 text-center text-xs text-muted-foreground">Preview unavailable</span>
      ) : null}
    </div>
  );
}

interface ImageThumbProps {
  bytes: Uint8Array;
  width?: number;
  className?: string;
}

/**
 * An image drawn to <canvas> via createImageBitmap (EXIF orientation applied). Using
 * a canvas instead of <img src="blob:…"> keeps CSP img-src at 'self' data:.
 */
export function ImageThumb({ bytes, width = 140, className }: ImageThumbProps) {
  const { ref, visible } = useVisible<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"idle" | "done" | "error">("idle");

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let cancelled = false;
    createImageBitmap(new Blob([bytes as BlobPart]), { imageOrientation: "from-image" })
      .then((bmp) => {
        if (cancelled) return bmp.close();
        const c = canvasRef.current!;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scale = Math.min(1, (width * dpr) / bmp.width);
        c.width = Math.max(1, Math.round(bmp.width * scale));
        c.height = Math.max(1, Math.round(bmp.height * scale));
        c.style.width = `${Math.round(c.width / dpr)}px`;
        c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
        setState("done");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [visible, bytes, width]);

  return (
    <div
      ref={ref}
      className={cn("relative flex items-center justify-center overflow-hidden", className)}
      style={{ minHeight: state === "done" ? undefined : Math.round(width * 0.75) }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn(
          "max-w-full rounded-sm shadow-sm ring-1 ring-black/10",
          state !== "done" && "hidden",
        )}
      />
      {state === "idle" ? (
        <div className="absolute inset-2 animate-pulse rounded-sm bg-muted" />
      ) : null}
      {state === "error" ? (
        <span className="px-2 text-center text-xs text-muted-foreground">Preview unavailable</span>
      ) : null}
    </div>
  );
}
