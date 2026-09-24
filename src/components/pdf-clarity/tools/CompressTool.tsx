import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { formatBytes } from "@/lib/pdf/limits";
import { downloadPdf } from "@/lib/pdf/download";
import type { CompressionLevel, CompressReport } from "@/lib/pdf/compress";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { FileCard } from "../FileCard";
import { Segmented } from "../controls";
import { toolErrorMessage, usePdfFiles } from "../use-files";

const LEVEL_HELP: Record<CompressionLevel, string> = {
  recommended: "Good quality, much smaller. Large images are resized to about 240 dpi on A4.",
  strong: "Smallest file. Images are resized to about 170 dpi — fine for screens and emails.",
  lossless: "No quality change at all. Only removes leftover data, so savings are usually small.",
};

export function CompressTool() {
  const tool = getTool("compress");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [level, setLevel] = useState<CompressionLevel>("recommended");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ bytes: Uint8Array; report: CompressReport } | null>(null);

  const reset = () => {
    clear();
    setResult(null);
  };

  const run = async () => {
    if (!item) return;
    setBusy(true);
    setResult(null);
    setProgress(null);
    try {
      const [{ compressPdf }, { browserImageEncoder }] = await Promise.all([
        import("@/lib/pdf/compress"),
        import("@/lib/pdf/compress-browser"),
      ]);
      const res = await compressPdf(item.bytes, level, browserImageEncoder, {
        name: item.name,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult(res);
      if (res.report.after < res.report.before) {
        downloadPdf(res.bytes, `${baseName(item.name)}_compressed`);
        toast.success(`Saved ${Math.round((1 - res.report.after / res.report.before) * 100)}%`);
      }
    } catch (e) {
      toast.error(toolErrorMessage(e));
    } finally {
      setBusy(false);
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

  const r = result?.report;
  const smaller = r ? r.after < r.before : false;
  const saved = r ? Math.round((1 - r.after / r.before) * 100) : 0;

  return (
    <ToolFrame
      tool={tool}
      onReset={reset}
      options={
        <>
          <Segmented
            label="Compression"
            value={level}
            onChange={(v) => {
              setLevel(v);
              setResult(null);
            }}
            options={[
              { value: "recommended", label: "Recommended" },
              { value: "strong", label: "Strong" },
              { value: "lossless", label: "Lossless" },
            ]}
          />
          <p className="text-xs text-muted-foreground">{LEVEL_HELP[level]}</p>
        </>
      }
      action={{
        onClick: run,
        busy,
        busyLabel: progress
          ? `Optimizing images ${progress.done} / ${progress.total}…`
          : "Compressing…",
        hint: "Text, links, forms and bookmarks are kept. Only images change in quality.",
      }}
    >
      <div className="space-y-4">
        <FileCard
          doc={item.doc}
          name={item.name}
          meta={`${item.pages} page${item.pages === 1 ? "" : "s"} · ${formatBytes(item.size)}`}
        />
        {r ? (
          smaller ? (
            <div
              role="status"
              className="max-w-md space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4"
            >
              <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" aria-hidden />
                {saved}% smaller
              </p>
              <div className="flex items-baseline gap-2 text-sm">
                <span className="text-muted-foreground line-through">{formatBytes(r.before)}</span>
                <span aria-hidden>→</span>
                <span className="text-lg font-semibold">{formatBytes(r.after)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.max(3, 100 - saved)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {r.imagesRecompressed} of {r.imagesFound} image{r.imagesFound === 1 ? "" : "s"}{" "}
                optimized
                {r.objectsRemoved
                  ? ` · ${r.objectsRemoved} unused object${r.objectsRemoved === 1 ? "" : "s"} removed`
                  : ""}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => downloadPdf(result!.bytes, `${baseName(item.name)}_compressed`)}
              >
                <Download className="h-4 w-4" aria-hidden /> Download again
              </Button>
            </div>
          ) : (
            <div
              role="status"
              className="flex max-w-md gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <p>
                This PDF is already well optimized — we couldn't make it smaller
                {level !== "strong" ? ". Try “Strong” if it has photos or scans." : "."} Nothing was
                downloaded.
              </p>
            </div>
          )
        ) : null}
      </div>
    </ToolFrame>
  );
}
