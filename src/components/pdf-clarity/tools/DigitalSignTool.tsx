import { useRef, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, FileKey, Info, KeyRound, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTool } from "@/lib/pdf/tools";
import { baseName } from "@/lib/pdf/files";
import { formatBytes } from "@/lib/pdf/limits";
import { downloadBlob, downloadPdf, sanitizeFilename } from "@/lib/pdf/download";
import type { LoadedCertificate } from "@/lib/pdf/digital-sign";
import { ToolFrame } from "../ToolFrame";
import { FileDrop } from "../FileDrop";
import { FileCard } from "../FileCard";
import { Field, Segmented, inputClass } from "../controls";
import { PasswordField, passwordStrength } from "../PasswordField";
import { toolErrorMessage, usePdfFiles } from "../use-files";

const MAX_P12_BYTES = 1024 * 1024;
const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

type Mode = "open" | "create";

export function DigitalSignTool() {
  const tool = getTool("digital-sign");
  const { items, add, clear, loading } = usePdfFiles({ multiple: false });
  const item = items[0];
  const [mode, setMode] = useState<Mode>("open");
  const [cert, setCert] = useState<LoadedCertificate | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [contact, setContact] = useState("");

  const applyCertificate = async (c: LoadedCertificate) => {
    const { certificateWarnings } = await import("@/lib/pdf/digital-sign");
    setCert(c);
    setWarnings(certificateWarnings(c.info));
  };

  const reset = () => {
    clear();
    setCert(null);
    setWarnings([]);
    setReason("");
    setLocation("");
    setContact("");
  };

  const run = async () => {
    if (!item || !cert) return;
    setBusy(true);
    try {
      const { signWithCertificate } = await import("@/lib/pdf/digital-sign");
      const out = await signWithCertificate(
        item.bytes,
        cert,
        {
          reason: reason.trim() || undefined,
          location: location.trim() || undefined,
          contactInfo: contact.trim() || undefined,
        },
        item.name,
      );
      downloadPdf(out, `${baseName(item.name)}_signed`);
      toast.success("PDF digitally signed");
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
      onReset={reset}
      options={
        <>
          {cert ? (
            <CertificateCard
              cert={cert}
              warnings={warnings}
              onChange={() => {
                setCert(null);
                setWarnings([]);
              }}
            />
          ) : (
            <>
              <Segmented
                label="Certificate"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "open", label: "I have one" },
                  { value: "create", label: "Create one" },
                ]}
              />
              {mode === "open" ? (
                <OpenCertificate onLoaded={applyCertificate} />
              ) : (
                <CreateCertificate onCreated={applyCertificate} />
              )}
            </>
          )}
          <fieldset className="space-y-3">
            <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Details (optional)
            </legend>
            <Field label="Reason">
              <input
                className={inputClass}
                value={reason}
                maxLength={200}
                placeholder="I approve this document"
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Field label="Location">
              <input
                className={inputClass}
                value={location}
                maxLength={100}
                placeholder="Casablanca"
                onChange={(e) => setLocation(e.target.value)}
              />
            </Field>
            <Field label="Contact">
              <input
                className={inputClass}
                value={contact}
                maxLength={100}
                placeholder="Email or phone"
                onChange={(e) => setContact(e.target.value)}
              />
            </Field>
          </fieldset>
        </>
      }
      action={{
        onClick: run,
        disabled: !cert,
        busy,
        busyLabel: "Signing…",
      }}
    >
      <div className="space-y-4">
        <FileCard
          doc={item.doc}
          name={item.name}
          meta={`${item.pages} page${item.pages === 1 ? "" : "s"} · ${formatBytes(item.size)}`}
        />
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          <p className="flex gap-2 font-medium text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> How this works
          </p>
          <p>
            A digital signature seals the file with your certificate (SHA-256, PAdES-compatible).
            PDF readers show it in their signature panel and flag any change made afterwards. It is
            invisible on the page: use <span className="font-medium">Sign PDF</span> first if you
            also want a handwritten signature image.
          </p>
          <p>
            Earlier signatures stay valid: the new one is appended to the file. Certificates from a
            trusted provider show as “valid”; self-signed ones show “identity unknown” until the
            recipient chooses to trust them.
          </p>
        </div>
      </div>
    </ToolFrame>
  );
}

function CertificateCard({
  cert,
  warnings,
  onChange,
}: {
  cert: LoadedCertificate;
  warnings: string[];
  onChange: () => void;
}) {
  const { info } = cert;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Certificate
      </p>
      <div className="space-y-1 rounded-md border border-border p-3 text-sm">
        <p className="flex items-center gap-1.5 font-medium" data-testid="cert-subject">
          <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <span className="truncate">{info.subject}</span>
        </p>
        {info.organization ? (
          <p className="truncate text-muted-foreground">{info.organization}</p>
        ) : null}
        {info.email ? <p className="truncate text-muted-foreground">{info.email}</p> : null}
        <p className="text-xs text-muted-foreground">
          Issued by {info.selfSigned ? "itself (self-signed)" : info.issuer}
        </p>
        <p className="text-xs text-muted-foreground">
          Valid {dateFmt.format(info.notBefore)} → {dateFmt.format(info.notAfter)}
        </p>
      </div>
      {warnings.map((w) => (
        <p
          key={w}
          className="flex gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {w}
        </p>
      ))}
      <Button size="sm" variant="ghost" className="w-full" onClick={onChange}>
        Use another certificate
      </Button>
    </div>
  );
}

function OpenCertificate({ onLoaded }: { onLoaded: (c: LoadedCertificate) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_P12_BYTES) {
      toast.error("That file is too large to be a certificate.");
      return;
    }
    setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    setWrong(false);
  };

  const open = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const { readP12 } = await import("@/lib/pdf/digital-sign");
      onLoaded(readP12(file.bytes, password));
    } catch (e) {
      if ((e as { code?: string }).code === "wrong-password") setWrong(true);
      else toast.error(toolErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept=".p12,.pfx,application/x-pkcs12"
        className="sr-only"
        tabIndex={-1}
        aria-label="Certificate file"
        data-testid="p12-input"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1.5"
        onClick={() => input.current?.click()}
      >
        <FileKey className="h-4 w-4" aria-hidden />
        <span className="truncate">{file ? file.name : "Choose .p12 / .pfx file"}</span>
      </Button>
      {file ? (
        <>
          <PasswordField
            label="Certificate password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              setWrong(false);
            }}
            autoComplete="off"
            autoFocus
            invalid={wrong}
            onEnter={open}
            hint={
              wrong ? (
                <span className="text-destructive">
                  That password doesn't open this certificate.
                </span>
              ) : undefined
            }
          />
          <Button size="sm" className="w-full" onClick={open} disabled={busy}>
            {busy ? "Opening…" : "Open certificate"}
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Exported from your certificate provider, Windows, macOS Keychain or Firefox. RSA keys are
          supported.
        </p>
      )}
    </div>
  );
}

const TONE = {
  weak: "text-amber-600 dark:text-amber-400",
  ok: "text-muted-foreground",
  strong: "text-emerald-600 dark:text-emerald-400",
};

function CreateCertificate({ onCreated }: { onCreated: (c: LoadedCertificate) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = name.trim().length > 0 && password.length >= 8 && confirm === password;

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const [{ generateRsaKeyPair }, { createSelfSignedP12 }] = await Promise.all([
        import("@/lib/pdf/digital-sign-browser"),
        import("@/lib/pdf/digital-sign"),
      ]);
      const keys = await generateRsaKeyPair();
      const { p12, loaded } = createSelfSignedP12(keys, {
        name: name.trim(),
        email: email.trim() || undefined,
        organization: org.trim() || undefined,
        password,
      });
      downloadBlob(
        new Blob([p12 as BlobPart], { type: "application/x-pkcs12" }),
        sanitizeFilename(`${name.trim()}_certificate`, "p12"),
      );
      toast.success("Certificate created — keep the .p12 file to sign again later");
      onCreated(loaded);
    } catch (e) {
      toast.error(toolErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Field label="Your name">
        <input
          className={inputClass}
          value={name}
          maxLength={64}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Email (optional)">
        <input
          className={inputClass}
          type="email"
          value={email}
          maxLength={128}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Organization (optional)">
        <input
          className={inputClass}
          value={org}
          maxLength={64}
          autoComplete="organization"
          onChange={(e) => setOrg(e.target.value)}
        />
      </Field>
      <PasswordField
        label="Certificate password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={
          strength.label ? (
            <span className={TONE[strength.tone]}>{strength.label}</span>
          ) : (
            "Protects the .p12 file you'll download. At least 8 characters."
          )
        }
      />
      <PasswordField
        label="Repeat password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        invalid={mismatch}
        onEnter={create}
        hint={
          mismatch ? (
            <span className="text-destructive">The passwords don't match.</span>
          ) : undefined
        }
      />
      <Button size="sm" className="w-full gap-1.5" onClick={create} disabled={!ready || busy}>
        <KeyRound className="h-4 w-4" aria-hidden />
        {busy ? "Creating…" : "Create & download certificate"}
      </Button>
      <p className="text-xs text-muted-foreground">
        A self-signed RSA-2048 certificate, valid 3 years, made on your device. It proves the
        document wasn't changed, but not who you are to strangers.
      </p>
    </div>
  );
}
