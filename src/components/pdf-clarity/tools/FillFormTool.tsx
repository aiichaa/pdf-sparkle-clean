import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileWarning, Info, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { downloadPdf } from "@/lib/pdf/download";
import type { FieldValue, FormFieldInfo, FormInfo } from "@/lib/pdf/forms";
import { isWinAnsiChar } from "@/lib/pdf/winansi";
import { cn } from "@/lib/utils";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { FormPage, type Box } from "../FormPage";
import { inputClass } from "../controls";
import { toolErrorMessage, usePdfFiles } from "../use-files";

const EMPTY_BOXES: Box[] = [];
const fieldId = (name: string) => `field-${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
const unsupported = (s: string) => [...s.replace(/[\r\n\t]/g, "")].some((c) => !isWinAnsiChar(c));

export function FillFormTool() {
  const tool = getTool("fill-forms");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [info, setInfo] = useState<FormInfo | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [active, setActive] = useState<string | null>(null);
  const [flatten, setFlatten] = useState(false);
  const [busy, setBusy] = useState(false);

  const initial = useMemo(
    () => Object.fromEntries((info?.fields ?? []).map((f) => [f.name, f.value])),
    [info],
  );

  useEffect(() => {
    setInfo(null);
    setValues({});
    if (!item) return;
    let cancelled = false;
    import("@/lib/pdf/forms")
      .then(({ readForm }) => readForm(item.bytes, item.name))
      .then((fi) => {
        if (cancelled) return;
        setInfo(fi);
        setValues(Object.fromEntries(fi.fields.map((f) => [f.name, f.value])));
      })
      .catch((e) => !cancelled && toast.error(toolErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [item]);

  // Fields grouped by the page of their first widget.
  const byPage = useMemo(() => {
    const m = new Map<number, FormFieldInfo[]>();
    for (const f of info?.fields ?? []) {
      const p = f.widgets[0]?.page ?? -1;
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(f);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [info]);

  // Stable per form, so typing doesn't re-render the page canvases.
  const boxesByPage = useMemo(() => {
    const m = new Map<number, Box[]>();
    for (const f of info?.fields ?? [])
      for (const w of f.widgets) {
        if (!m.has(w.page)) m.set(w.page, []);
        m.get(w.page)!.push({ id: f.name, rect: w.rect, label: f.label });
      }
    return m;
  }, [info]);

  const set = (name: string, v: FieldValue) => setValues((prev) => ({ ...prev, [name]: v }));
  const changed = Object.keys(values).filter(
    (k) => JSON.stringify(values[k]) !== JSON.stringify(initial[k]),
  ).length;
  const missing = (info?.fields ?? []).filter(
    (f) =>
      f.required &&
      !f.readOnly &&
      (values[f.name] === "" ||
        values[f.name] === false ||
        (Array.isArray(values[f.name]) && !(values[f.name] as string[]).length)),
  );

  const pick = (name: string) => {
    setActive(name);
    const el = document.getElementById(fieldId(name));
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    (el as HTMLElement | null)?.focus({ preventScroll: true });
  };

  const run = async () => {
    if (!item || !info) return;
    setBusy(true);
    try {
      const { fillForm } = await import("@/lib/pdf/forms");
      const out = await fillForm(item.bytes, values, { flatten, name: item.name });
      downloadPdf(out.bytes, `${baseName(item.name)}_filled`);
      toast.success(flatten ? "Form filled and locked" : "Form filled");
      if (out.replacedChars)
        toast.warning("Some characters couldn't be written and were replaced with “?”.");
    } catch (e) {
      toast.error(toolErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    clear();
    setInfo(null);
    setValues({});
  };

  if (!item) {
    return (
      <ToolFrame tool={tool}>
        <FileDrop accept="pdf" onFiles={add} disabled={loading} />
      </ToolFrame>
    );
  }

  if (info && !info.fields.length) {
    return (
      <ToolFrame tool={tool} onReset={reset}>
        <div
          role="status"
          className="flex max-w-xl gap-3 rounded-lg border border-border bg-muted/40 p-5 text-sm"
        >
          <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">{item.name} has no fillable fields.</p>
            <p className="text-muted-foreground">
              {info.hasXfa
                ? "It's an XFA form (Adobe LiveCycle), which only Adobe Acrobat can fill."
                : "It may be a scanned or “flat” form. Those can't be filled in as fields."}
            </p>
          </div>
        </div>
      </ToolFrame>
    );
  }

  return (
    <ToolFrame
      tool={tool}
      onReset={reset}
      options={
        info ? (
          <>
            <p className="text-sm">
              <span className="font-medium">{info.fields.length}</span> field
              {info.fields.length === 1 ? "" : "s"} · <span className="font-medium">{changed}</span>{" "}
              changed
            </p>
            {missing.length ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Required and still empty: {missing.map((f) => f.label).join(", ")}
              </p>
            ) : null}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={flatten}
                onChange={(e) => setFlatten(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                Lock the answers{" "}
                <span className="text-muted-foreground">
                  (flatten — fields can't be edited afterwards)
                </span>
              </span>
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="w-full gap-1.5"
              disabled={!changed}
              onClick={() => setValues(initial)}
            >
              <Undo2 className="h-4 w-4" aria-hidden /> Undo my changes
            </Button>
            {info.hasXfa ? (
              <p className="flex gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                This PDF also contains an XFA form. We fill its standard fields and drop the XFA
                part, so every reader shows your answers.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Reading the form…</p>
        )
      }
      action={{
        onClick: run,
        disabled: !info,
        busy,
        busyLabel: "Saving…",
        hint: "Latin letters, accents and common symbols are supported. Arabic or Asian scripts can't be written with the PDF's standard font.",
      }}
    >
      <div className="space-y-8">
        {byPage.map(([pageIdx, fields]) => (
          <section key={pageIdx} className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
            <div className="md:sticky md:top-4 md:self-start">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {pageIdx >= 0 ? `Page ${pageIdx + 1}` : "Not placed on a page"}
              </p>
              {pageIdx >= 0 ? (
                <FormPage
                  doc={item.doc}
                  pageNumber={pageIdx + 1}
                  width={260}
                  activeId={active}
                  onPick={pick}
                  boxes={boxesByPage.get(pageIdx) ?? EMPTY_BOXES}
                />
              ) : null}
            </div>
            <div className="space-y-4">
              {fields.map((f) => (
                <FieldInput
                  key={f.name}
                  field={f}
                  value={values[f.name]}
                  onChange={(v) => set(f.name, v)}
                  onFocus={() => setActive(f.name)}
                  active={active === f.name}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </ToolFrame>
  );
}

function FieldInput({
  field: f,
  value,
  onChange,
  onFocus,
  active,
}: {
  field: FormFieldInfo;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  onFocus: () => void;
  active: boolean;
}) {
  const id = fieldId(f.name);
  const label = (
    <span className="text-sm font-medium">
      {f.label}
      {f.required ? <span className="text-destructive"> *</span> : null}
      {f.readOnly ? (
        <span className="ml-1 text-xs font-normal text-muted-foreground">(read-only)</span>
      ) : null}
    </span>
  );
  const wrap = cn(
    "rounded-md p-2 transition-colors",
    active && "bg-primary/5 ring-1 ring-primary/40",
  );

  if (f.kind === "checkbox") {
    return (
      <label className={cn(wrap, "flex items-center gap-2")}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          disabled={f.readOnly}
          onChange={(e) => onChange(e.target.checked)}
          onFocus={onFocus}
          className="h-4 w-4 accent-primary"
        />
        {label}
      </label>
    );
  }
  if (f.kind === "radio") {
    return (
      <fieldset className={wrap} onFocus={onFocus}>
        <legend className="mb-1.5">{label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {f.options!.map((o, i) => (
            <label key={o} className="flex items-center gap-1.5 text-sm">
              <input
                id={i === 0 ? id : undefined}
                type="radio"
                name={id}
                checked={value === o}
                disabled={f.readOnly}
                onChange={() => onChange(o)}
                className="h-4 w-4 accent-primary"
              />
              {o}
            </label>
          ))}
          {value ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => onChange("")}
            >
              Clear
            </button>
          ) : null}
        </div>
      </fieldset>
    );
  }
  if (f.kind === "dropdown" || (f.kind === "list" && !f.multiSelect)) {
    const v = Array.isArray(value) ? (value[0] ?? "") : (value as string);
    return (
      <label className={cn(wrap, "block space-y-1.5")}>
        {label}
        <select
          id={id}
          className={inputClass}
          value={v}
          disabled={f.readOnly}
          onFocus={onFocus}
          onChange={(e) =>
            onChange(f.kind === "list" ? (e.target.value ? [e.target.value] : []) : e.target.value)
          }
        >
          <option value="">—</option>
          {f.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (f.kind === "list") {
    const selected = new Set(value as string[]);
    return (
      <fieldset className={wrap} onFocus={onFocus}>
        <legend className="mb-1.5">{label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {f.options!.map((o, i) => (
            <label key={o} className="flex items-center gap-1.5 text-sm">
              <input
                id={i === 0 ? id : undefined}
                type="checkbox"
                checked={selected.has(o)}
                disabled={f.readOnly}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(o);
                  else next.delete(o);
                  onChange(f.options!.filter((x) => next.has(x)));
                }}
                className="h-4 w-4 accent-primary"
              />
              {o}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  // text
  const text = value as string;
  const common = {
    id,
    value: text,
    disabled: f.readOnly,
    maxLength: f.maxLength,
    onFocus,
    spellCheck: true,
  };
  return (
    <label className={cn(wrap, "block space-y-1.5")}>
      {label}
      {f.multiline ? (
        <textarea
          {...common}
          rows={4}
          className={cn(inputClass, "h-auto py-2")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          {...common}
          type="text"
          className={inputClass}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {f.maxLength ? (
        <span className="block text-right text-[11px] text-muted-foreground">
          {text.length} / {f.maxLength}
        </span>
      ) : null}
      {unsupported(text) ? (
        <span className="block text-xs text-amber-700 dark:text-amber-400">
          Some characters here can't be drawn with the form's standard font and will appear as “?”.
        </span>
      ) : null}
    </label>
  );
}
