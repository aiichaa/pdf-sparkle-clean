import { useState } from "react";
import { toast } from "sonner";
import { Copy, Info, PenLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { downloadPdf } from "@/lib/pdf/download";
import type { Placement } from "@/lib/pdf/sign";
import type { Signature } from "@/lib/pdf/signature-browser";
import { newId } from "@/lib/pdf/files";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { SignatureCreator } from "../SignatureCreator";
import { SignPlacer } from "../SignPlacer";
import { toolErrorMessage, usePdfFiles } from "../use-files";

export function SignTool() {
  const tool = getTool("sign");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [signature, setSignature] = useState<Signature | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    clear();
    setSignature(null);
    setPlacements([]);
    setPage(0);
    setSelected(null);
  };

  const sel = placements.find((p) => p.id === selected) ?? null;

  const everyPage = () => {
    if (!sel || !item) return;
    const copies: Placement[] = [];
    for (let i = 0; i < item.pages; i++) {
      if (placements.some((p) => p.page === i && p.left === sel.left && p.top === sel.top))
        continue;
      copies.push({ ...sel, id: newId(), page: i });
    }
    setPlacements((prev) => [...prev, ...copies]);
    toast.success(`Added to ${copies.length} more page${copies.length === 1 ? "" : "s"}`);
  };

  const run = async () => {
    if (!item || !signature) return;
    setBusy(true);
    try {
      const { signPdf } = await import("@/lib/pdf/sign");
      const out = await signPdf(item.bytes, signature.png, placements, item.name);
      downloadPdf(out, `${baseName(item.name)}_signed`);
      toast.success("PDF signed");
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

  if (!signature) {
    return (
      <ToolFrame tool={tool} onReset={reset}>
        <SignatureCreator
          onDone={(s) => {
            setSignature(s);
            setPlacements([]);
          }}
        />
      </ToolFrame>
    );
  }

  const pagesWith = [...new Set(placements.map((p) => p.page + 1))].sort((a, b) => a - b);

  return (
    <ToolFrame
      tool={tool}
      onReset={reset}
      options={
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your signature
            </p>
            <div className="flex h-20 items-center justify-center rounded-md border border-border bg-white p-2">
              <img src={signature.dataUrl} alt="Your signature" className="max-h-full max-w-full" />
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="w-full gap-1.5"
              onClick={() => setSignature(null)}
            >
              <PenLine className="h-4 w-4" aria-hidden /> Change signature
            </Button>
          </div>
          <div className="space-y-2 text-sm">
            <p>
              {placements.length ? (
                <>
                  <span className="font-medium">{placements.length}</span> placed · page
                  {pagesWith.length > 1 ? "s" : ""} {pagesWith.join(", ")}
                </>
              ) : (
                <span className="text-muted-foreground">
                  Click on the page where you want to sign.
                </span>
              )}
            </p>
            {sel && item.pages > 1 ? (
              <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={everyPage}>
                <Copy className="h-4 w-4" aria-hidden /> Same place on every page
              </Button>
            ) : null}
            {placements.length ? (
              <Button
                size="sm"
                variant="ghost"
                className="w-full gap-1.5"
                onClick={() => {
                  setPlacements([]);
                  setSelected(null);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Remove all
              </Button>
            ) : null}
          </div>
          <p className="flex gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            This adds an image of your signature (a visual signature). It is not a certificate-based
            digital signature.
          </p>
        </>
      }
      action={{ onClick: run, disabled: !placements.length, busy, busyLabel: "Signing…" }}
    >
      <SignPlacer
        doc={item.doc}
        pages={item.pages}
        page={page}
        setPage={(p) => {
          setPage(p);
          setSelected(null);
        }}
        signature={signature}
        placements={placements}
        setPlacements={setPlacements}
        selected={selected}
        setSelected={setSelected}
      />
    </ToolFrame>
  );
}
