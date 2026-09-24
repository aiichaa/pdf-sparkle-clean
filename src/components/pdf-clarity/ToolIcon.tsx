import {
  FileImage,
  Hash,
  Images,
  LayoutGrid,
  Lock,
  LockOpen,
  Merge,
  Shrink,
  Split,
  Stamp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolSlug } from "@/lib/pdf/tools";

const ICONS: Record<ToolSlug, { icon: LucideIcon; tint: string }> = {
  merge: { icon: Merge, tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  split: { icon: Split, tint: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  organize: { icon: LayoutGrid, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  "images-to-pdf": {
    icon: Images,
    tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  "pdf-to-images": { icon: FileImage, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  "page-numbers": { icon: Hash, tint: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  watermark: { icon: Stamp, tint: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
  compress: { icon: Shrink, tint: "bg-lime-500/10 text-lime-700 dark:text-lime-400" },
  protect: { icon: Lock, tint: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  unlock: { icon: LockOpen, tint: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
};

export function ToolIcon({ slug, className }: { slug: ToolSlug; className?: string }) {
  const { icon: Icon, tint } = ICONS[slug];
  return (
    <div
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-lg", tint, className)}
    >
      <Icon className="h-1/2 w-1/2" />
    </div>
  );
}
