import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small icon button inside a draggable tile (doesn't start a drag). */
export function TileButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <TileButton
      label={label}
      onClick={onClick}
      className="absolute right-1 top-1 z-10 hover:text-destructive"
    >
      <X className="h-3.5 w-3.5" aria-hidden />
    </TileButton>
  );
}

export function OrderBadge({ n }: { n: number }) {
  return (
    <span className="absolute left-1 top-1 z-10 rounded bg-foreground/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-background">
      {n}
    </span>
  );
}

export function TileCaption({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="mt-2 min-w-0 px-0.5">
      <p className="truncate text-xs font-medium" title={title}>
        {title}
      </p>
      {meta ? <p className="text-[11px] text-muted-foreground">{meta}</p> : null}
    </div>
  );
}
