import { useMemo, useState } from "react";
import { toast } from "sonner";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { MAX_RENDER_PAGES } from "@/lib/pdf/limits";
import { downloadBlob, downloadZip, sanitizeFilename } from "@/lib/pdf/download";
import { parseRanges } from "@/lib/pdf/ranges";
import { cn } from "@/lib/utils";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { PageThumb } from "../Thumbnails";
import { Field, Segmented, inputClass } from "../controls";
import { toolErrorMessage, usePdfFiles } from "../use-files";

type Format = "png" | "jpeg";

export function PdfToImagesTool() {
  const tool = getTool("pdf-to-images");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [format, setFormat] = useState<Format>("png");
  const [dpi, setDpi] = useState(150);
  const [which, setWhich] = useState<"all" | "range">("all");
  const [rangeText, setRangeText] = useState("1");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const { pages, error } = useMemo((): { pages: number[]; error?: string } => {
    if (!item) return { pages: [] };
    if (which === "all") return { pages: Array.from({ length: item.pages }, (_, i) => i) };
    try {
      return {
        pages: [...new Set(parseRanges(rangeText, item.pages).flat())].sort((a, b) => a - b),
      };
    } catch (e) {
      return { pages: [], error: (e as Error).message };
    }
  }, [item, which, rangeText]);

  const tooMany = pages.length > MAX_RENDER_PAGES;

  const run = async () => {
    if (!item) return;
    setProgress({ done: 0, total: pages.length });
    try {
      const { renderPageToImage } = await import("@/lib/pdf/render");
      const ext = format === "png" ? "png" : "jpg";
      const base = baseName(item.name);
      const pad = String(item.pages).length;
      const entries: { name: string; data: Uint8Array }[] = [];
      let single: Blob | null = null;
      for (let k = 0; k < pages.length; k++) {
        const blob = await renderPageToImage(item.doc, pages[k] + 1, dpi, format, 0.9);
        if (pages.length === 1) single = blob;
        else
          entries.push({
            name: `${base}_page-${String(pages[k] + 1).padStart(pad, "0")}.${ext}`,
            data: new Uint8Array(await blob.arrayBuffer()),
          });
        setProgress({ done: k + 1, total: pages.length });
      }
      if (single) downloadBlob(single, sanitizeFilename(`${base}_page-${pages[0] + 1}`, ext));
      else downloadZip(entries, `${base}_images`);
      toast.success(
        pages.length === 1 ? "Image downloaded" : `${pages.length} images downloaded as a zip`,
      );
    } catch (e) {
      toast.error(toolErrorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  if (!item) {
    return (
      <ToolFrame tool={tool}>
        <FileDrop accept="pdf" onFiles={add} disabled={loading} />
      </ToolFrame>
    );
  }

  const selected = new Set(pages);
  return (
    <ToolFrame
      tool={tool}
      onReset={clear}
      options={
        <>
          <Segmented
            label="Format"
            value={format}
            onChange={setFormat}
            options={[
              { value: "png", label: "PNG" },
              { value: "jpeg", label: "JPG" },
            ]}
          />
          <Segmented
            label="Resolution"
            value={dpi}
            onChange={setDpi}
            options={[
              { value: 72, label: "Low · 72 dpi" },
              { value: 150, label: "Normal · 150" },
              { value: 300, label: "High · 300" },
            ]}
          />
          <Segmented
            label="Pages"
            value={which}
            onChange={setWhich}
            options={[
              { value: "all", label: "All pages" },
              { value: "range", label: "Some pages" },
            ]}
          />
          {which === "range" ? (
            <Field
              label="Which pages"
              hint={error ? <span className="text-destructive">{error}</span> : "e.g. 1-3, 7"}
            >
              <input
                className={inputClass}
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                spellCheck={false}
                aria-invalid={!!error}
              />
            </Field>
          ) : null}
        </>
      }
      action={{
        onClick: run,
        disabled: !pages.length || tooMany,
        busy: progress !== null,
        busyLabel: progress ? `Rendering ${progress.done} / ${progress.total}…` : undefined,
        hint: tooMany
          ? `At most ${MAX_RENDER_PAGES} pages per run. Pick fewer pages.`
          : pages.length
            ? `${pages.length} image${pages.length === 1 ? "" : "s"}${pages.length > 1 ? ", downloaded as a zip" : ""}.`
            : undefined,
      }}
    >
      <p className="mb-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{item.name}</span> · {item.pages} page
        {item.pages === 1 ? "" : "s"}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: item.pages }, (_, i) => (
          <div
            key={i}
            className={cn(
              "rounded-lg border bg-card p-2",
              selected.has(i) ? "border-primary/60" : "border-border opacity-50",
            )}
          >
            <PageThumb doc={item.doc} pageNumber={i + 1} width={140} className="p-1" />
            <p className="mt-1 px-1 text-[11px] text-muted-foreground">Page {i + 1}</p>
          </div>
        ))}
      </div>
    </ToolFrame>
  );
}
