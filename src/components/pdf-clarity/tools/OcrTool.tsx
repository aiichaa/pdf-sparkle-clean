import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { formatBytes } from "@/lib/pdf/limits";
import { downloadBlob, downloadPdf, sanitizeFilename } from "@/lib/pdf/download";
import type { OcrLanguage, OcrProgress } from "@/lib/pdf/ocr-browser";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { FileCard } from "../FileCard";
import { toolErrorMessage, usePdfFiles } from "../use-files";

// Kept here (not imported from ocr-browser) so tesseract.js loads only on run.
const LANGUAGES: { id: OcrLanguage; label: string }[] = [
  { id: "eng", label: "English" },
  { id: "fra", label: "French" },
  { id: "spa", label: "Spanish" },
  { id: "deu", label: "German" },
  { id: "ara", label: "Arabic (العربية)" },
];

interface Summary {
  recognized: number;
  skipped: number;
  words: number;
  confidence: number;
  text: string;
}

export function OcrTool() {
  const tool = getTool("ocr");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [langs, setLangs] = useState<OcrLanguage[]>(["eng"]);
  const [skipText, setSkipText] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Leaving the page stops the OCR worker.
  useEffect(() => () => abort.current?.abort(), []);

  const reset = () => {
    abort.current?.abort();
    clear();
    setSummary(null);
    setProgress(null);
  };

  const toggle = (id: OcrLanguage) =>
    setLangs((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));

  const run = async () => {
    if (!item || !langs.length) return;
    setBusy(true);
    setSummary(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const [{ recognizeDocument }, { addTextLayer, countWords }] = await Promise.all([
        import("@/lib/pdf/ocr-browser"),
        import("@/lib/pdf/ocr"),
      ]);
      const res = await recognizeDocument(item.doc, langs, {
        skipTextPages: skipText,
        onProgress: setProgress,
        signal: ctrl.signal,
      });
      const words = res.pages.reduce((n, p) => n + countWords(p), 0);
      setSummary({
        recognized: res.pages.length,
        skipped: res.skipped.length,
        words,
        confidence: res.confidence,
        text: res.text,
      });
      if (!res.pages.length) {
        toast.info("Every page already has text — nothing to recognise.");
        return;
      }
      if (!words) {
        toast.warning("No text was found. Is the scan readable, and is the language right?");
        return;
      }
      const out = await addTextLayer(item.bytes, res.pages, item.name);
      downloadPdf(out.bytes, `${baseName(item.name)}_ocr`);
      toast.success("Your PDF is now searchable");
    } catch (e) {
      if ((e as Error)?.name === "OcrCancelled") toast("OCR cancelled");
      else toast.error(toolErrorMessage(e));
    } finally {
      abort.current = null;
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

  const pct = progress ? Math.round(progress.fraction * 100) : 0;
  const busyLabel = !progress
    ? "Preparing…"
    : progress.stage === "loading"
      ? "Loading OCR…"
      : `Page ${progress.page} of ${progress.total} · ${pct}%`;

  return (
    <ToolFrame
      tool={tool}
      onReset={reset}
      options={
        <>
          <fieldset className="space-y-2" disabled={busy}>
            <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Document language
            </legend>
            {LANGUAGES.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={langs.includes(l.id)}
                  onChange={() => toggle(l.id)}
                  className="h-4 w-4 accent-primary"
                />
                {l.label}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              {langs.length ? "Pick every language the document uses." : "Pick at least one."}
            </p>
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={skipText}
              disabled={busy}
              onChange={(e) => setSkipText(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              Skip pages that already have text
              <span className="block text-xs text-muted-foreground">
                Only scanned pages are recognised.
              </span>
            </span>
          </label>
          {busy ? (
            <div className="space-y-2">
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="OCR progress"
              >
                <div
                  className="h-full bg-primary transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="w-full gap-1.5"
                onClick={() => abort.current?.abort()}
              >
                <X className="h-4 w-4" aria-hidden /> Cancel
              </Button>
            </div>
          ) : null}
        </>
      }
      action={{
        onClick: run,
        disabled: !langs.length,
        busy,
        busyLabel,
      }}
    >
      <div className="space-y-4">
        <FileCard
          doc={item.doc}
          name={item.name}
          meta={`${item.pages} page${item.pages === 1 ? "" : "s"} · ${formatBytes(item.size)}`}
        />
        {summary ? (
          <div
            className="space-y-3 rounded-lg border border-border p-4 text-sm"
            data-testid="ocr-summary"
          >
            <p>
              <span className="font-medium">{summary.recognized}</span> page
              {summary.recognized === 1 ? "" : "s"} recognised
              {summary.skipped ? (
                <>
                  , <span className="font-medium">{summary.skipped}</span> already had text
                </>
              ) : null}
              {summary.recognized ? (
                <>
                  {" "}
                  · <span className="font-medium">{summary.words.toLocaleString("en")}</span> words
                  · {Math.round(summary.confidence)}% average confidence
                </>
              ) : null}
            </p>
            {summary.words ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() =>
                  downloadBlob(
                    new Blob([summary.text], { type: "text/plain;charset=utf-8" }),
                    sanitizeFilename(`${baseName(item.name)}_ocr`, "txt"),
                  )
                }
              >
                <FileText className="h-4 w-4" aria-hidden /> Download the text (.txt)
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          <p className="flex gap-2 font-medium text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> How this works
          </p>
          <p>
            Each scanned page is read by Tesseract, running on your device, and the words are added
            as an invisible layer over the image. The PDF looks exactly the same, but you can now
            search, select and copy its text.
          </p>
          <p>
            It takes a few seconds per page. The first run loads the OCR engine and language data
            (about 4 MB plus 1–3 MB per language) from this site. Accuracy depends on the scan:
            straight, sharp pages at 300 DPI work best. Arabic text is searchable and copies in the
            right order.
          </p>
        </div>
      </div>
    </ToolFrame>
  );
}
