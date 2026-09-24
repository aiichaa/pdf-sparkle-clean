import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { cn } from "@/lib/utils";

export interface Box {
  id: string;
  /** [x1, y1, x2, y2] in PDF user space */
  rect: [number, number, number, number];
  label: string;
}

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  boxes: Box[];
  activeId: string | null;
  onPick: (id: string) => void;
}

/**
 * A page rendered to canvas with clickable outlines over its form fields.
 * pdf.js maps PDF coordinates to the viewport, so outlines follow /Rotate.
 */
export function FormPage({ doc, pageNumber, width, boxes, activeId, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [placed, setPlaced] = useState<
    { id: string; label: string; left: number; top: number; w: number; h: number }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { renderThumbnail } = await import("@/lib/pdf/render");
      await renderThumbnail(doc, pageNumber, canvasRef.current!, width);
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1, rotation: page.rotate });
      const vp = page.getViewport({ scale: width / base.width, rotation: page.rotate });
      if (cancelled) return;
      setSize({ w: vp.width, h: vp.height });
      setPlaced(
        boxes.map((b) => {
          const [ax, ay] = vp.convertToViewportPoint(b.rect[0], b.rect[1]) as [number, number];
          const [bx, by] = vp.convertToViewportPoint(b.rect[2], b.rect[3]) as [number, number];
          return {
            id: b.id,
            label: b.label,
            left: Math.min(ax, bx),
            top: Math.min(ay, by),
            w: Math.abs(bx - ax),
            h: Math.abs(by - ay),
          };
        }),
      );
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, width, boxes]);

  return (
    <div
      className="relative inline-block"
      style={size ? { width: size.w, height: size.h } : { width, minHeight: width * 1.3 }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className="block rounded-sm bg-white shadow-sm ring-1 ring-black/10"
      />
      {!size ? <div className="absolute inset-0 animate-pulse rounded-sm bg-muted" /> : null}
      {placed.map((p, i) => (
        <button
          key={`${p.id}-${i}`}
          type="button"
          tabIndex={-1}
          title={p.label}
          aria-label={`Go to field: ${p.label}`}
          onClick={() => onPick(p.id)}
          className={cn(
            "absolute rounded-[2px] border transition-colors",
            p.id === activeId
              ? "border-primary bg-primary/25 ring-2 ring-primary"
              : "border-sky-500/70 bg-sky-400/15 hover:bg-sky-400/30",
          )}
          style={{ left: p.left, top: p.top, width: Math.max(p.w, 6), height: Math.max(p.h, 6) }}
        />
      ))}
    </div>
  );
}
