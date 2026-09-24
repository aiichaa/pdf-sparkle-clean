import { useState } from "react";
import { toast } from "sonner";
import { Lock, LockOpen, ShieldAlert } from "lucide-react";
import { getTool } from "@/lib/pdf/tools";
import { baseName, readFiles, type LoadedFile } from "@/lib/pdf/files";
import { formatBytes } from "@/lib/pdf/limits";
import { downloadPdf } from "@/lib/pdf/download";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { PasswordField } from "../PasswordField";
import { reportRejections, toolErrorMessage } from "../use-files";
import { FileCard } from "../FileCard";

type Kind = "restrictions" | "open";

export function UnlockTool() {
  const tool = getTool("unlock");
  // Encrypted PDFs can't be previewed by pdf.js without the password, so this tool
  // keeps raw bytes and asks pdf-lib what kind of protection the file has.
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setKind(null);
    setPassword("");
    setWrong(false);
  };

  const onFiles = async (files: File[]) => {
    setLoading(true);
    try {
      const { accepted, rejected } = await readFiles(files.slice(0, 1), ["pdf"]);
      reportRejections(rejected);
      const f = accepted[0];
      if (!f) return;
      const { encryptionKind } = await import("@/lib/pdf/ops");
      const k = await encryptionKind(f.bytes, f.name);
      if (k === "none") {
        toast.message(`${f.name} isn't password-protected — nothing to unlock.`);
        return;
      }
      setFile(f);
      setKind(k);
    } catch (e) {
      toast.error(toolErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const run = async () => {
    if (!file || !kind) return;
    if (kind === "open" && !password) return;
    setBusy(true);
    setWrong(false);
    try {
      const { unlockPdf } = await import("@/lib/pdf/ops");
      const out = await unlockPdf(file.bytes, kind === "open" ? password : "", file.name);
      downloadPdf(out, `${baseName(file.name)}_unlocked`);
      toast.success("Password removed");
    } catch (e) {
      if ((e as { code?: string })?.code === "wrong-password") setWrong(true);
      else toast.error(toolErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!file || !kind) {
    return (
      <ToolFrame tool={tool}>
        <FileDrop accept="pdf" onFiles={onFiles} disabled={loading} />
      </ToolFrame>
    );
  }

  const badge =
    kind === "open" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Lock className="h-3 w-3" aria-hidden /> Needs a password to open
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400">
        <LockOpen className="h-3 w-3" aria-hidden /> Opens freely, but printing/copying is
        restricted
      </span>
    );

  return (
    <ToolFrame
      tool={tool}
      onReset={reset}
      options={
        kind === "open" ? (
          <PasswordField
            label="Password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              setWrong(false);
            }}
            autoComplete="off"
            autoFocus
            invalid={wrong}
            onEnter={run}
            hint={
              wrong ? (
                <span className="text-destructive">That password isn't correct.</span>
              ) : (
                "The password you use to open this PDF."
              )
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            This PDF has no open password, only restrictions. Unlocking removes them so you can
            print, copy and edit it.
          </p>
        )
      }
      action={{
        onClick: run,
        disabled: kind === "open" && !password,
        busy,
        busyLabel: "Unlocking…",
        hint: (
          <span className="flex gap-1.5">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Only unlock files you own or are allowed to change. This tool can't guess passwords.
          </span>
        ),
      }}
    >
      <FileCard name={file.name} meta={formatBytes(file.size)} badge={badge} />
    </ToolFrame>
  );
}
