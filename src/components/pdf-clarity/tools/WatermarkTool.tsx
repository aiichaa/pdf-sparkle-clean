import { useState } from "react";
import { toast } from "sonner";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { downloadPdf } from "@/lib/pdf/download";
import { toWinAnsi } from "@/lib/pdf/winansi";
import type { WatermarkOptions } from "@/lib/pdf/ops";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { PageThumb } from "../Thumbnails";
import { Field, Segmented, inputClass } from "../controls";
import { toolErrorMessage, usePdfFiles } from "../use-files";

const SIZES = { small: 40, medium: 64, large: 96 } as const;
const PREVIEW_COLORS: Record<WatermarkOptions["color"], string> = {
  gray: "rgb(115,115,115)",
  red: "rgb(204,26,26)",
  blue: "rgb(26,77,204)",
};

export function WatermarkTool() {
  const tool = getTool("watermark");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [text, setText] = useState("CONFIDENTIAL");
  const [layout, setLayout] = useState<WatermarkOptions["layout"]>("diagonal");
  const [color, setColor] = useState<WatermarkOptions["color"]>("gray");
  const [size, setSize] = useState<keyof typeof SIZES>("medium");
  const [opacity, setOpacity] = useState(25);
  const [busy, setBusy] = useState(false);

  const { replaced } = toWinAnsi(text);
  const empty = text.trim() === "";

  const run = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const { addWatermark } = await import("@/lib/pdf/ops");
      const res = await addWatermark(
        item.bytes,
        { text, layout, color, fontSize: SIZES[size], opacity: opacity / 100 },
        item.name,
      );
      downloadPdf(res.bytes, `${baseName(item.name)}_watermarked`);
      toast.success("Watermark added");
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

  return (
    <ToolFrame
      tool={tool}
      onReset={clear}
      options={
        <>
          <Field
            label="Text"
            hint={
              replaced ? (
                <span className="text-amber-600 dark:text-amber-400">
                  Some characters can't be drawn by the PDF's standard font and will show as “?”.
                  Latin letters, accents and common symbols work.
                </span>
              ) : undefined
            }
          >
            <input
              className={inputClass}
              value={text}
              maxLength={60}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <Segmented
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: "diagonal", label: "Diagonal" },
              { value: "horizontal", label: "Horizontal" },
            ]}
          />
          <Segmented
            label="Colour"
            value={color}
            onChange={setColor}
            options={[
              { value: "gray", label: "Grey" },
              { value: "red", label: "Red" },
              { value: "blue", label: "Blue" },
            ]}
          />
          <Segmented
            label="Size"
            value={size}
            onChange={setSize}
            options={[
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" },
            ]}
          />
          <Field label={`Opacity · ${opacity}%`}>
            <input
              type="range"
              min={10}
              max={80}
              step={5}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </Field>
        </>
      }
      action={{
        onClick: run,
        disabled: empty,
        busy,
        busyLabel: "Stamping…",
        hint: `Stamps all ${item.pages} page${item.pages === 1 ? "" : "s"}.`,
      }}
    >
      <p className="mb-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{item.name}</span> · {item.pages} page
        {item.pages === 1 ? "" : "s"} · preview
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: item.pages }, (_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-2">
            <div className="relative overflow-hidden">
              <PageThumb doc={item.doc} pageNumber={i + 1} width={140} className="p-1" />
              {!empty ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-1/2 whitespace-nowrap font-sans font-bold"
                  style={{
                    transform: `translate(-50%, -50%) rotate(${layout === "diagonal" ? -45 : 0}deg)`,
                    color: PREVIEW_COLORS[color],
                    opacity: opacity / 100,
                    fontSize: `${Math.max(7, Math.min(SIZES[size] / 4.5, 180 / Math.max(text.length, 1)))}px`,
                  }}
                >
                  {toWinAnsi(text).text}
                </span>
              ) : null}
            </div>
            <p className="mt-1 px-1 text-[11px] text-muted-foreground">Page {i + 1}</p>
          </div>
        ))}
      </div>
    </ToolFrame>
  );
}
