import { useRef, useState, type DragEvent } from "react";
import { FilePlus2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_LABEL } from "@/lib/pdf/limits";

export type AcceptKind = "pdf" | "images";

const ACCEPT_ATTR: Record<AcceptKind, string> = {
  pdf: ".pdf,application/pdf",
  images: "image/png,image/jpeg,image/webp,image/gif,image/bmp",
};

interface Props {
  accept: AcceptKind;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  /** Small inline variant used for "add more" */
  compact?: boolean;
  disabled?: boolean;
}

export function FileDrop({
  accept,
  multiple = false,
  onFiles,
  compact = false,
  disabled = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const noun = accept === "pdf" ? (multiple ? "PDF files" : "a PDF file") : "images";

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Choose ${noun}`}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "min-h-40 p-4" : "min-h-[46vh] p-8",
        over ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-muted/40",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {compact ? (
        <>
          <FilePlus2 className="h-6 w-6 text-muted-foreground" aria-hidden />
          <span className="text-xs font-medium text-muted-foreground">
            Add {accept === "pdf" ? "PDFs" : "images"}
          </span>
        </>
      ) : (
        <>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Upload className="h-6 w-6" aria-hidden />
          </div>
          <p className="mt-2 text-base font-semibold">Select {noun}</p>
          <p className="text-sm text-muted-foreground">or drop {multiple ? "them" : "it"} here</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Up to {MAX_FILE_LABEL} per file · processed in your browser, never uploaded
          </p>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR[accept]}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
