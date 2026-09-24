import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { downloadPdf } from "@/lib/pdf/download";
import type { PageSpec } from "@/lib/pdf/ops";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { SortableGrid } from "../SortableGrid";
import { PageThumb } from "../Thumbnails";
import { OrderBadge, TileButton } from "../tiles";
import { toolErrorMessage, usePdfFiles } from "../use-files";

interface PageItem extends PageSpec {
  id: string;
}

const turn = (r: number, by: number) => ((((r + by) % 360) + 360) % 360) as PageSpec["rotate"];

export function OrganizeTool() {
  const tool = getTool("organize");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [pages, setPages] = useState<PageItem[]>([]);
  const [busy, setBusy] = useState(false);

  const initial = () =>
    item
      ? Array.from({ length: item.pages }, (_, i): PageItem => ({
          id: `${item.id}-${i}`,
          index: i,
          rotate: 0,
        }))
      : [];

  // New document → fresh page list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPages(initial()), [item?.id]);

  const update = (id: string, fn: (p: PageItem) => PageItem) =>
    setPages((ps) => ps.map((p) => (p.id === id ? fn(p) : p)));
  const changed =
    pages.length !== (item?.pages ?? 0) || pages.some((p, i) => p.index !== i || p.rotate !== 0);

  const run = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const { organizePdf } = await import("@/lib/pdf/ops");
      const out = await organizePdf(
        item.bytes,
        pages.map(({ index, rotate }) => ({ index, rotate })),
        item.name,
      );
      downloadPdf(out, `${baseName(item.name)}_organized`);
      toast.success(`Saved ${pages.length} page${pages.length === 1 ? "" : "s"}`);
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
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            All pages
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                setPages((ps) => ps.map((p) => ({ ...p, rotate: turn(p.rotate, -90) })))
              }
            >
              <RotateCcw className="h-4 w-4" aria-hidden /> Rotate left
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                setPages((ps) => ps.map((p) => ({ ...p, rotate: turn(p.rotate, 90) })))
              }
            >
              <RotateCw className="h-4 w-4" aria-hidden /> Rotate right
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="w-full gap-1.5"
            disabled={!changed}
            onClick={() => setPages(initial())}
          >
            <Undo2 className="h-4 w-4" aria-hidden /> Undo all changes
          </Button>
        </div>
      }
      action={{
        onClick: run,
        disabled: !pages.length || !changed,
        busy,
        busyLabel: "Saving…",
        hint: !pages.length
          ? "A PDF needs at least one page."
          : changed
            ? `${pages.length} of ${item.pages} pages kept.`
            : "Drag pages to reorder, or rotate and delete them.",
      }}
    >
      <p className="mb-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{item.name}</span> · {item.pages} page
        {item.pages === 1 ? "" : "s"}
      </p>
      <SortableGrid
        items={pages}
        onReorder={setPages}
        label={(p, idx) =>
          `Position ${idx + 1}: page ${p.index + 1}${p.rotate ? `, rotated ${p.rotate}°` : ""}`
        }
        renderItem={(p, idx) => (
          <div className="relative">
            <OrderBadge n={idx + 1} />
            <PageThumb
              doc={item.doc}
              pageNumber={p.index + 1}
              rotation={p.rotate}
              width={140}
              className="p-1"
            />
            <div className="mt-1 flex items-center justify-between gap-1 px-0.5">
              <span className="text-[11px] text-muted-foreground">Page {p.index + 1}</span>
              <div className="flex gap-1">
                <TileButton
                  label={`Rotate page ${p.index + 1} left`}
                  onClick={() => update(p.id, (x) => ({ ...x, rotate: turn(x.rotate, -90) }))}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                </TileButton>
                <TileButton
                  label={`Rotate page ${p.index + 1} right`}
                  onClick={() => update(p.id, (x) => ({ ...x, rotate: turn(x.rotate, 90) }))}
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden />
                </TileButton>
                <TileButton
                  label={`Delete page ${p.index + 1}`}
                  onClick={() => setPages((ps) => ps.filter((x) => x.id !== p.id))}
                  className="hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </TileButton>
              </div>
            </div>
          </div>
        )}
      />
    </ToolFrame>
  );
}
