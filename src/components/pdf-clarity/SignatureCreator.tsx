import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { readFiles } from "@/lib/pdf/files";
import {
  SIGNATURE_FONTS,
  loadSignatureFonts,
  renderTypedSignature,
  signatureFromImage,
  trimToSignature,
  type Signature,
  type SignatureFontId,
} from "@/lib/pdf/signature-browser";
import { Segmented, inputClass } from "./controls";
import { FileDrop } from "./FileDrop";
import { reportRejections } from "./use-files";

const INKS = { black: "#111827", blue: "#1d4ed8" } as const;
type Ink = keyof typeof INKS;
type Mode = "draw" | "type" | "upload";

export function SignatureCreator({ onDone }: { onDone: (s: Signature) => void }) {
  const [mode, setMode] = useState<Mode>("draw");
  const [ink, setInk] = useState<Ink>("black");
  return (
    <div className="max-w-2xl space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5">
      <div>
        <h2 className="font-semibold">Create your signature</h2>
        <p className="text-sm text-muted-foreground">
          It stays on this device and is forgotten when you leave the page.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Segmented
            label="How"
            value={mode}
            onChange={setMode}
            options={[
              { value: "draw", label: "Draw" },
              { value: "type", label: "Type" },
              { value: "upload", label: "Upload" },
            ]}
          />
        </div>
        {mode !== "upload" ? (
          <div className="w-40">
            <Segmented
              label="Ink"
              value={ink}
              onChange={setInk}
              options={[
                { value: "black", label: "Black" },
                { value: "blue", label: "Blue" },
              ]}
            />
          </div>
        ) : null}
      </div>
      {mode === "draw" ? <DrawPad color={INKS[ink]} onDone={onDone} /> : null}
      {mode === "type" ? <TypePad color={INKS[ink]} onDone={onDone} /> : null}
      {mode === "upload" ? <UploadPad onDone={onDone} /> : null}
    </div>
  );
}

function DrawPad({ color, onDone }: { color: string; onDone: (s: Signature) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef<{ x: number; y: number }[] | null>(null);
  const [empty, setEmpty] = useState(true);

  const setup = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setEmpty(true);
  }, []);

  useEffect(() => {
    setup();
  }, [setup]);

  const point = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    drawing.current = [point(e)];
  };
  const onMove = (e: React.PointerEvent) => {
    const pts = drawing.current;
    if (!pts) return;
    const p = point(e);
    pts.push(p);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.strokeStyle = color;
    // pressure-ish width: pens report pressure, mice report 0.5
    ctx.lineWidth = 1.6 + (e.pressure || 0.5) * 2.2;
    const n = pts.length;
    if (n < 3) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      setEmpty(false);
      return;
    }
    // quadratic curve through the midpoints = smooth strokes
    const [a, b, c] = [pts[n - 3], pts[n - 2], pts[n - 1]];
    ctx.beginPath();
    ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
    ctx.stroke();
    setEmpty(false);
  };
  const onUp = () => {
    drawing.current = null;
  };

  const use = async () => {
    const sig = await trimToSignature(canvasRef.current!);
    if (sig) onDone(sig);
    else toast.message("Draw your signature first");
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label="Signature pad: draw with your mouse, finger or pen"
          role="img"
          className="h-48 w-full touch-none rounded-md border border-dashed border-border bg-white"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 bottom-12 border-b border-dashed border-slate-300"
        />
        {empty ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400"
          >
            Sign here
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={use} disabled={empty}>
          Use this signature
        </Button>
        <Button variant="ghost" className="gap-1.5" onClick={setup} disabled={empty}>
          <Eraser className="h-4 w-4" aria-hidden /> Clear
        </Button>
      </div>
    </div>
  );
}

function TypePad({ color, onDone }: { color: string; onDone: (s: Signature) => void }) {
  const [name, setName] = useState("");
  const [font, setFont] = useState<SignatureFontId>("dancing");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadSignatureFonts()
      .then(() => setReady(true))
      .catch(() => toast.error("Couldn't load the handwriting fonts"));
  }, []);
  const use = async () => {
    const sig = await renderTypedSignature(name.trim(), font, color);
    if (sig) onDone(sig);
  };
  return (
    <div className="space-y-3">
      <input
        className={inputClass}
        placeholder="Type your name"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        aria-label="Your name"
      />
      <div role="radiogroup" aria-label="Signature style" className="grid gap-2 sm:grid-cols-3">
        {SIGNATURE_FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={font === f.id}
            aria-label={f.label}
            onClick={() => setFont(f.id)}
            className={cn(
              "flex h-20 items-center justify-center overflow-hidden rounded-md border bg-white px-3 text-3xl transition",
              font === f.id
                ? "border-primary ring-2 ring-primary"
                : "border-border hover:border-primary/50",
            )}
            style={{ fontFamily: ready ? `"${f.family}"` : undefined, fontWeight: f.weight, color }}
          >
            <span className="truncate">{name.trim() || "Your name"}</span>
          </button>
        ))}
      </div>
      <Button onClick={use} disabled={!name.trim() || !ready}>
        Use this signature
      </Button>
    </div>
  );
}

function UploadPad({ onDone }: { onDone: (s: Signature) => void }) {
  const [removeBg, setRemoveBg] = useState(true);
  const onFiles = async (files: File[]) => {
    const { accepted, rejected } = await readFiles(files.slice(0, 1), ["png", "jpeg", "webp"]);
    reportRejections(rejected);
    if (!accepted[0]) return;
    const sig = await signatureFromImage(accepted[0].bytes, removeBg).catch(() => null);
    if (sig) onDone(sig);
    else toast.error("Couldn't find a signature in that image");
  };
  return (
    <div className="space-y-3">
      <FileDrop accept="images" compact onFiles={onFiles} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={removeBg}
          onChange={(e) => setRemoveBg(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Remove the white paper background
      </label>
      <p className="text-xs text-muted-foreground">
        Tip: sign on white paper with a dark pen and take a sharp, well-lit photo.
      </p>
    </div>
  );
}
