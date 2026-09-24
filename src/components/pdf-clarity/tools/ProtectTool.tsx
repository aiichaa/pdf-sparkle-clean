import { useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { formatBytes } from "@/lib/pdf/limits";
import { downloadPdf } from "@/lib/pdf/download";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { FileCard } from "../FileCard";
import { PasswordField, passwordStrength } from "../PasswordField";
import { toolErrorMessage, usePdfFiles } from "../use-files";

const TONE = {
  weak: "text-amber-600 dark:text-amber-400",
  ok: "text-muted-foreground",
  strong: "text-emerald-600 dark:text-emerald-400",
};

export function ProtectTool() {
  const tool = getTool("protect");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [allowPrinting, setAllowPrinting] = useState(true);
  const [allowCopying, setAllowCopying] = useState(true);
  const [allowEditing, setAllowEditing] = useState(true);
  const [busy, setBusy] = useState(false);

  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length > 0 && confirm === password;

  const reset = () => {
    clear();
    setPassword("");
    setConfirm("");
  };

  const run = async () => {
    if (!item || !ready) return;
    setBusy(true);
    try {
      const { protectPdf } = await import("@/lib/pdf/ops");
      const out = await protectPdf(
        item.bytes,
        { password, allowPrinting, allowCopying, allowEditing },
        item.name,
      );
      downloadPdf(out, `${baseName(item.name)}_protected`);
      toast.success("PDF protected with AES-256");
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

  const Check = ({
    label,
    checked,
    onChange,
  }: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-primary"
      />
      {label}
    </label>
  );

  return (
    <ToolFrame
      tool={tool}
      onReset={reset}
      options={
        <>
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            autoFocus
            hint={
              strength.label ? (
                <span className={TONE[strength.tone]}>{strength.label}</span>
              ) : (
                "Needed to open the PDF."
              )
            }
          />
          <PasswordField
            label="Repeat password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            invalid={mismatch}
            onEnter={run}
            hint={
              mismatch ? (
                <span className="text-destructive">The passwords don't match.</span>
              ) : undefined
            }
          />
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              After opening, allow
            </legend>
            <Check label="Printing" checked={allowPrinting} onChange={setAllowPrinting} />
            <Check
              label="Copying text and images"
              checked={allowCopying}
              onChange={setAllowCopying}
            />
            <Check
              label="Editing and annotations"
              checked={allowEditing}
              onChange={setAllowEditing}
            />
            <p className="text-xs text-muted-foreground">
              Restrictions are respected by most PDF readers, but only the password truly protects
              the content.
            </p>
          </fieldset>
          <p className="flex gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Keep the password safe: a forgotten password can't be recovered — not by us, not by
            anyone.
          </p>
        </>
      }
      action={{
        onClick: run,
        disabled: !ready,
        busy,
        busyLabel: "Encrypting…",
        hint: "AES-256 encryption, done on your device.",
      }}
    >
      <FileCard
        doc={item.doc}
        name={item.name}
        meta={`${item.pages} page${item.pages === 1 ? "" : "s"} · ${formatBytes(item.size)}`}
      />
    </ToolFrame>
  );
}
