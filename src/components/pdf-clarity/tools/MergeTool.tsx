import { useState } from "react";
import { toast } from "sonner";
import { getTool } from "@/lib/pdf/tools";
import { formatBytes } from "@/lib/pdf/limits";
import { downloadPdf } from "@/lib/pdf/download";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { SortableGrid } from "../SortableGrid";
import { PageThumb } from "../Thumbnails";
import { OrderBadge, RemoveButton, TileCaption } from "../tiles";
import { toolErrorMessage, usePdfFiles } from "../use-files";

export function MergeTool() {
  const tool = getTool("merge");
  const { items, setItems, add, remove, clear, loading } = usePdfFiles({ multiple: true });
  const [busy, setBusy] = useState(false);
  const totalPages = items.reduce((s, i) => s + i.pages, 0);

  const run = async () => {
    setBusy(true);
    try {
      const { mergePdfs } = await import("@/lib/pdf/ops");
      const out = await mergePdfs(items.map((i) => ({ bytes: i.bytes, name: i.name })));
      downloadPdf(out, "merged");
      toast.success(`Merged ${items.length} PDFs into one (${totalPages} pages)`);
    } catch (e) {
      toast.error(toolErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!items.length) {
    return (
      <ToolFrame tool={tool}>
        <FileDrop accept="pdf" multiple onFiles={add} disabled={loading} />
      </ToolFrame>
    );
  }

  return (
    <ToolFrame
      tool={tool}
      onReset={clear}
      action={{
        onClick: run,
        disabled: items.length < 2 || loading,
        busy,
        busyLabel: "Merging…",
        hint:
          items.length < 2
            ? "Add at least one more PDF."
            : `${items.length} files · ${totalPages} pages. Drag the cards to change the order.`,
      }}
    >
      <SortableGrid
        items={items}
        onReorder={setItems}
        label={(i, idx) => `${idx + 1}. ${i.name}, ${i.pages} pages`}
        renderItem={(item, idx) => (
          <div className="relative">
            <OrderBadge n={idx + 1} />
            <RemoveButton label={`Remove ${item.name}`} onClick={() => remove(item.id)} />
            <PageThumb
              doc={item.doc}
              pageNumber={1}
              width={150}
              className="rounded-md bg-muted/40 p-2"
            />
            <TileCaption
              title={item.name}
              meta={`${item.pages} page${item.pages === 1 ? "" : "s"} · ${formatBytes(item.size)}`}
            />
          </div>
        )}
        trailing={<FileDrop compact accept="pdf" multiple onFiles={add} disabled={loading} />}
      />
    </ToolFrame>
  );
}
