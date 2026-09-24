import { useState } from "react";
import { toast } from "sonner";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { formatBytes } from "@/lib/pdf/limits";
import { downloadPdf } from "@/lib/pdf/download";
import type { OrientationOption, PageSizeOption } from "@/lib/pdf/ops";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { SortableGrid } from "../SortableGrid";
import { ImageThumb } from "../Thumbnails";
import { Segmented } from "../controls";
import { OrderBadge, RemoveButton, TileCaption } from "../tiles";
import { toolErrorMessage, useImageFiles } from "../use-files";

const MARGINS = { none: 0, small: 18, large: 36 } as const;

export function ImagesToPdfTool() {
  const tool = getTool("images-to-pdf");
  const { items, setItems, add, remove, clear, loading } = useImageFiles();
  const [pageSize, setPageSize] = useState<PageSizeOption>("a4");
  const [orientation, setOrientation] = useState<OrientationOption>("auto");
  const [margin, setMargin] = useState<keyof typeof MARGINS>("small");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const [{ imagesToPdf }, { toEmbeddable }] = await Promise.all([
        import("@/lib/pdf/ops"),
        import("@/lib/pdf/images"),
      ]);
      const images = [];
      for (const i of items) images.push(await toEmbeddable(i.bytes, i.type));
      const out = await imagesToPdf(images, { pageSize, orientation, margin: MARGINS[margin] });
      downloadPdf(out, items.length === 1 ? baseName(items[0].name) : "images");
      toast.success(`Created a ${items.length}-page PDF`);
    } catch (e) {
      toast.error(toolErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!items.length) {
    return (
      <ToolFrame tool={tool}>
        <FileDrop accept="images" multiple onFiles={add} disabled={loading} />
      </ToolFrame>
    );
  }

  return (
    <ToolFrame
      tool={tool}
      onReset={clear}
      options={
        <>
          <Segmented
            label="Page size"
            value={pageSize}
            onChange={setPageSize}
            options={[
              { value: "a4", label: "A4" },
              { value: "letter", label: "Letter" },
              { value: "fit", label: "Fit image" },
            ]}
          />
          <Segmented
            label="Orientation"
            value={orientation}
            onChange={setOrientation}
            disabled={pageSize === "fit"}
            options={[
              { value: "auto", label: "Auto" },
              { value: "portrait", label: "Portrait" },
              { value: "landscape", label: "Landscape" },
            ]}
          />
          <Segmented
            label="Margin"
            value={margin}
            onChange={setMargin}
            options={[
              { value: "none", label: "None" },
              { value: "small", label: "Small" },
              { value: "large", label: "Large" },
            ]}
          />
        </>
      }
      action={{
        onClick: run,
        disabled: loading,
        busy,
        busyLabel: "Creating PDF…",
        hint: `${items.length} image${items.length === 1 ? "" : "s"}, one per page. Drag to reorder.`,
      }}
    >
      <SortableGrid
        items={items}
        onReorder={setItems}
        label={(i, idx) => `${idx + 1}. ${i.name}`}
        renderItem={(item, idx) => (
          <div className="relative">
            <OrderBadge n={idx + 1} />
            <RemoveButton label={`Remove ${item.name}`} onClick={() => remove(item.id)} />
            <ImageThumb
              bytes={item.bytes}
              width={150}
              className="min-h-28 rounded-md bg-muted/40 p-2"
            />
            <TileCaption
              title={item.name}
              meta={`${item.type.toUpperCase()} · ${formatBytes(item.size)}`}
            />
          </div>
        )}
        trailing={<FileDrop compact accept="images" multiple onFiles={add} disabled={loading} />}
      />
    </ToolFrame>
  );
}
