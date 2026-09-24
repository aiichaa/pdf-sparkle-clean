import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { downloadPdf, downloadZip } from "@/lib/pdf/download";
import { formatRanges, parseRanges } from "@/lib/pdf/ranges";
import { cn } from "@/lib/utils";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { PageThumb } from "../Thumbnails";
import { Field, Segmented, inputClass } from "../controls";
import { toolErrorMessage, usePdfFiles } from "../use-files";

type Mode = "ranges" | "every" | "select";

export function SplitTool() {
  const tool = getTool("split");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [mode, setMode] = useState<Mode>("ranges");
  const [rangeText, setRangeText] = useState("1-");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const { groups, error } = useMemo((): { groups: number[][]; error?: string } => {
    if (!item) return { groups: [] };
    if (mode === "every") return { groups: Array.from({ length: item.pages }, (_, i) => [i]) };
    if (mode === "select") {
      return selected.size
        ? { groups: [[...selected].sort((a, b) => a - b)] }
        : { groups: [], error: "Click pages to select them." };
    }
    try {
      return { groups: parseRanges(rangeText, item.pages) };
    } catch (e) {
      return { groups: [], error: (e as Error).message };
    }
  }, [item, mode, rangeText, selected]);

  // Which output file each page lands in (first match), for the badges.
  const pageToGroup = useMemo(() => {
    const m = new Map<number, number>();
    groups.forEach((g, gi) => g.forEach((p) => !m.has(p) && m.set(p, gi)));
    return m;
  }, [groups]);

  const reset = () => {
    clear();
    setSelected(new Set());
    setRangeText("1-");
  };

  const run = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const { splitPdf } = await import("@/lib/pdf/ops");
      const outs = await splitPdf(item.bytes, groups, item.name);
      const base = baseName(item.name);
      const names = groups.map((g) =>
        mode === "every"
          ? `${base}_page-${g[0] + 1}`
          : mode === "select"
            ? `${base}_selected`
            : `${base}_pages-${formatRanges(g)}`,
      );
      if (outs.length === 1) downloadPdf(outs[0], names[0]);
      else
        downloadZip(
          outs.map((data, i) => ({ name: `${names[i]}.pdf`, data })),
          `${base}_split`,
        );
      toast.success(
        outs.length === 1 ? "Your PDF is ready" : `${outs.length} PDFs downloaded as a zip`,
      );
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

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <ToolFrame
      tool={tool}
      onReset={reset}
      options={
        <>
          <Segmented
            label="Split mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "ranges", label: "Ranges" },
              { value: "every", label: "Every page" },
              { value: "select", label: "Pick pages" },
            ]}
          />
          {mode === "ranges" ? (
            <Field
              label="Page ranges"
              hint={
                error ? (
                  <span className="text-destructive">{error}</span>
                ) : (
                  "Each comma-separated part becomes its own PDF, e.g. 1-3, 5, 8-"
                )
              }
            >
              <input
                className={inputClass}
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                placeholder="1-3, 5, 8-"
                aria-invalid={!!error}
                spellCheck={false}
              />
            </Field>
          ) : null}
          {mode === "select" ? (
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() =>
                  setSelected(new Set(Array.from({ length: item.pages }, (_, i) => i)))
                }
              >
                Select all
              </button>
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          ) : null}
        </>
      }
      action={{
        onClick: run,
        disabled: !groups.length,
        busy,
        busyLabel: "Splitting…",
        hint: groups.length
          ? `Creates ${groups.length} PDF${groups.length === 1 ? "" : "s"}${groups.length > 1 ? " (downloaded as a zip)" : ""}.`
          : undefined,
      }}
    >
      <p className="mb-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{item.name}</span> · {item.pages} page
        {item.pages === 1 ? "" : "s"}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: item.pages }, (_, i) => {
          const group = pageToGroup.get(i);
          const included = group !== undefined;
          const content = (
            <>
              <PageThumb doc={item.doc} pageNumber={i + 1} width={140} className="p-1" />
              <div className="mt-1 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                <span>Page {i + 1}</span>
                {included && mode !== "select" ? (
                  <span className="font-mono">→ PDF {group + 1}</span>
                ) : null}
              </div>
            </>
          );
          const cls = cn(
            "relative rounded-lg border bg-card p-2 text-left transition",
            included ? "border-primary/60" : "border-border opacity-50",
          );
          return mode === "select" ? (
            <button
              key={i}
              type="button"
              role="checkbox"
              aria-checked={included}
              aria-label={`Page ${i + 1}`}
              onClick={() => toggle(i)}
              className={cn(
                cls,
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !included && "opacity-70 hover:opacity-100",
              )}
            >
              {included ? (
                <span className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" aria-hidden />
                </span>
              ) : null}
              {content}
            </button>
          ) : (
            <div key={i} className={cls}>
              {content}
            </div>
          );
        })}
      </div>
    </ToolFrame>
  );
}
