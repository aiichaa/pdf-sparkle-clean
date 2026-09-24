import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { newId } from "@/lib/pdf/files";
import type { Placement } from "@/lib/pdf/sign";
import type { Signature } from "@/lib/pdf/signature-browser";
import { cn } from "@/lib/utils";

interface Props {
  doc: PDFDocumentProxy;
  pages: number;
  page: number; // 0-based
  setPage: (p: number) => void;
  signature: Signature;
  placements: Placement[];
  setPlacements: (fn: (prev: Placement[]) => Placement[]) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
}

const MIN_W = 24; // pt

/**
 * One page at a time, rendered to canvas; click to place the signature, drag to
 * move, corner handle to resize (aspect kept), keyboard: arrows move, +/- resize,
 * Delete removes. Placements are stored in page points, so any zoom works.
 */
export function SignPlacer({
  doc,
  pages,
  page,
  setPage,
  signature,
  placements,
  setPlacements,
  selected,
  setSelected,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cssWidth, setCssWidth] = useState(600);
  const [pt, setPt] = useState<{ w: number; h: number } | null>(null); // visual page size in points
  const drag = useRef<{
    id: string;
    mode: "move" | "resize";
    sx: number;
    sy: number;
    orig: Placement;
  } | null>(null);
  const aspect = signature.height / signature.width;

  // Fit the page to the available width.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setCssWidth(Math.max(260, Math.min(760, Math.floor(e.contentRect.width)))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPt(null);
    (async () => {
      const { renderThumbnail } = await import("@/lib/pdf/render");
      await renderThumbnail(doc, page + 1, canvasRef.current!, cssWidth);
      const p = await doc.getPage(page + 1);
      const vp = p.getViewport({ scale: 1, rotation: p.rotate });
      if (!cancelled) setPt({ w: vp.width, h: vp.height });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc, page, cssWidth]);

  const scale = pt ? cssWidth / pt.w : 1; // css px per point
  const onPage = placements.filter((p) => p.page === page);

  const clamp = (p: Placement): Placement => {
    if (!pt) return p;
    const width = Math.min(Math.max(p.width, MIN_W), pt.w);
    const height = width * aspect;
    return {
      ...p,
      width,
      height,
      left: Math.min(Math.max(p.left, 0), pt.w - width),
      top: Math.min(Math.max(p.top, 0), pt.h - height),
    };
  };
  const update = (id: string, fn: (p: Placement) => Placement) =>
    setPlacements((prev) => prev.map((p) => (p.id === id ? clamp(fn(p)) : p)));

  const addAt = (e: React.PointerEvent) => {
    if (!pt || e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const width = Math.min(pt.w * 0.28, 220);
    const x = (e.clientX - r.left) / scale;
    const y = (e.clientY - r.top) / scale;
    const p = clamp({
      id: newId(),
      page,
      left: x - width / 2,
      top: y - (width * aspect) / 2,
      width,
      height: width * aspect,
    });
    setPlacements((prev) => [...prev, p]);
    setSelected(p.id);
  };

  const startDrag = (e: React.PointerEvent, p: Placement, mode: "move" | "resize") => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(p.id);
    drag.current = { id: p.id, mode, sx: e.clientX, sy: e.clientY, orig: p };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    update(d.id, () =>
      d.mode === "move"
        ? { ...d.orig, left: d.orig.left + dx, top: d.orig.top + dy }
        : { ...d.orig, width: d.orig.width + dx },
    );
  };
  const endDrag = () => {
    drag.current = null;
  };

  const onKey = (e: React.KeyboardEvent, p: Placement) => {
    const step = e.shiftKey ? 10 : 2;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      update(p.id, (x) => ({ ...x, left: x.left + dx, top: x.top + dy }));
    } else if (e.key === "+" || e.key === "=") {
      update(p.id, (x) => ({ ...x, width: x.width * 1.1 }));
    } else if (e.key === "-") {
      update(p.id, (x) => ({ ...x, width: x.width / 1.1 }));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setPlacements((prev) => prev.filter((x) => x.id !== p.id));
      setSelected(null);
    }
  };

  return (
    <div ref={wrapRef} className="w-full">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          Page {page + 1} of {pages}
          {onPage.length ? ` · ${onPage.length} signature${onPage.length === 1 ? "" : "s"}` : ""}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pages - 1}
          onClick={() => setPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <div
        className="relative mx-auto"
        style={{ width: cssWidth, height: pt ? pt.h * scale : cssWidth * 1.3 }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden
          className="block rounded-sm bg-white shadow ring-1 ring-black/10"
        />
        {!pt ? <div className="absolute inset-0 animate-pulse rounded-sm bg-muted" /> : null}
        {pt ? (
          <div
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={addAt}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label="Page — click to place your signature"
            role="application"
          >
            {onPage.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`Signature on page ${page + 1}. Arrow keys move, plus and minus resize, Delete removes.`}
                onPointerDown={(e) => startDrag(e, p, "move")}
                onFocus={() => setSelected(p.id)}
                onKeyDown={(e) => onKey(e, p)}
                className={cn(
                  "absolute cursor-move touch-none select-none rounded-sm focus-visible:outline-none",
                  selected === p.id
                    ? "ring-2 ring-primary ring-offset-1"
                    : "ring-1 ring-sky-500/40 hover:ring-sky-500",
                )}
                style={{
                  left: p.left * scale,
                  top: p.top * scale,
                  width: p.width * scale,
                  height: p.height * scale,
                }}
              >
                <img
                  src={signature.dataUrl}
                  alt=""
                  draggable={false}
                  className="pointer-events-none h-full w-full"
                />
                {selected === p.id ? (
                  <>
                    <button
                      type="button"
                      aria-label="Remove this signature"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlacements((prev) => prev.filter((x) => x.id !== p.id));
                        setSelected(null);
                      }}
                      className="absolute -right-3 -top-3 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-white shadow"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <span
                      aria-hidden
                      onPointerDown={(e) => startDrag(e, p, "resize")}
                      className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-primary shadow"
                    />
                  </>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
