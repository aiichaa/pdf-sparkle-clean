import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { TOOLS } from "@/lib/pdf/tools";
import { ToolIcon } from "./ToolIcon";

export function ToolGrid() {
  return (
    <div className="flex flex-col gap-8 py-2 sm:py-6">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">
          Every PDF tool you need, private by design
        </h1>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          Merge, split, convert and edit PDFs right in your browser. Free, no sign-up, no ads.
        </p>
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Your files never leave your device
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map((t) => (
          <li key={t.slug}>
            <Link
              to={`/${t.slug}`}
              className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ToolIcon slug={t.slug} className="h-11 w-11" />
              <div>
                <h2 className="font-semibold tracking-tight">{t.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
