import { useState } from "react";
import { toast } from "sonner";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { downloadPdf } from "@/lib/pdf/download";
import type { NumberFormat, NumberPosition } from "@/lib/pdf/ops";
import { cn } from "@/lib/utils";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { PageThumb } from "../Thumbnails";
import { Field, Segmented, inputClass } from "../controls";
import { toolErrorMessage, usePdfFiles } from "../use-files";

const POSITIONS: { value: NumberPosition; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top centre" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom centre" },
  { value: "bottom-right", label: "Bottom right" },
];
const SIZES = { small: 9, medium: 11, large: 14 } as const;

// Same labels as ops.formatPageNumber, duplicated to keep pdf-lib out of the page bundle.
function label(n: number, total: number, f: NumberFormat) {
  return f === "n-of-total"
    ? `${n} / ${total}`
    : f === "page-n-of-total"
      ? `Page ${n} of ${total}`
      : `${n}`;
}

export function PageNumbersTool() {
  const tool = getTool("page-numbers");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [position, setPosition] = useState<NumberPosition>("bottom-center");
  const [format, setFormat] = useState<NumberFormat>("n-of-total");
  const [startAt, setStartAt] = useState(1);
  const [size, setSize] = useState<keyof typeof SIZES>("medium");
  const [skipFirst, setSkipFirst] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const { addPageNumbers } = await import("@/lib/pdf/ops");
      const out = await addPageNumbers(
        item.bytes,
        { position, format, startAt, fontSize: SIZES[size], skipFirst, margin: 24 },
        item.name,
      );
      downloadPdf(out, `${baseName(item.name)}_numbered`);
      toast.success("Page numbers added");
    } catch (e) {
      toast.error(toolErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!item) {
    return (
      <ToolFrame tool={tool}>
        <FileDrop accept="pdf" onFiles={add} disabled={loading} />
      </ToolFrame>
    );
  }

  const numbered = skipFirst ? item.pages - 1 : item.pages;
  const last = startAt + numbered - 1;
  const [vert, horiz] = position.split("-");

  return (
    <ToolFrame
      tool={tool}
      onReset={clear}
      options={
        <>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Position
            </legend>
            <div
              role="radiogroup"
              aria-label="Position"
              className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1"
            >
              {POSITIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={position === p.value}
                  aria-label={p.label}
                  title={p.label}
                  onClick={() => setPosition(p.value)}
                  className={cn(
                    "flex h-8 items-center rounded px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    p.value.endsWith("left")
                      ? "justify-start"
                      : p.value.endsWith("right")
                        ? "justify-end"
                        : "justify-center",
                    p.value.startsWith("top") ? "items-start pt-1" : "items-end pb-1",
                    position === p.value ? "bg-background shadow-sm" : "hover:bg-background/50",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-4 rounded-full",
                      position === p.value ? "bg-primary" : "bg-muted-foreground/40",
                    )}
                  />
                </button>
              ))}
            </div>
          </fieldset>
          <Segmented
            label="Format"
            value={format}
            onChange={setFormat}
            options={[
              { value: "n", label: "1" },
              { value: "n-of-total", label: "1 / N" },
              { value: "page-n-of-total", label: "Page 1 of N" },
            ]}
          />
          <Segmented
            label="Text size"
            value={size}
            onChange={setSize}
            options={[
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" },
            ]}
          />
          <Field label="First number">
            <input
              type="number"
              min={0}
              max={99999}
              className={inputClass}
              value={startAt}
              onChange={(e) =>
                setStartAt(Math.max(0, Math.min(99999, Math.floor(Number(e.target.value) || 0))))
              }
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={skipFirst}
              onChange={(e) => setSkipFirst(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Don't number the first page (cover)
          </label>
        </>
      }
      action={{
        onClick: run,
        busy,
        busyLabel: "Numbering…",
        hint: `Numbers ${numbered} page${numbered === 1 ? "" : "s"}.`,
      }}
    >
      <p className="mb-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{item.name}</span> · {item.pages} page
        {item.pages === 1 ? "" : "s"} · preview
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: item.pages }, (_, i) => {
          const show = !(skipFirst && i === 0);
          const n = startAt + (skipFirst ? i - 1 : i);
          return (
            <div key={i} className="rounded-lg border border-border bg-card p-2">
              <div className="relative">
                <PageThumb doc={item.doc} pageNumber={i + 1} width={140} className="p-1" />
                {show ? (
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute whitespace-nowrap rounded bg-primary/15 px-1 font-sans leading-tight text-foreground",
                      size === "small"
                        ? "text-[8px]"
                        : size === "medium"
                          ? "text-[9px]"
                          : "text-[11px]",
                      vert === "top" ? "top-3" : "bottom-3",
                      horiz === "left"
                        ? "left-3"
                        : horiz === "right"
                          ? "right-3"
                          : "left-1/2 -translate-x-1/2",
                    )}
                  >
                    {label(n, last, format)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 px-1 text-[11px] text-muted-foreground">Page {i + 1}</p>
            </div>
          );
        })}
      </div>
    </ToolFrame>
  );
}
