import type { ReactNode } from "react";
import { Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ToolInfo } from "@/lib/pdf/tools";
import { ToolIcon } from "./ToolIcon";

interface Props {
  tool: ToolInfo;
  /** Workspace once files are loaded; otherwise the drop zone */
  children: ReactNode;
  /** Options panel; when present, the layout gets a sidebar */
  options?: ReactNode;
  action?: {
    onClick: () => void;
    disabled?: boolean;
    busy?: boolean;
    busyLabel?: string;
    hint?: ReactNode;
  };
  onReset?: () => void;
}

export function ToolFrame({ tool, children, options, action, onReset }: Props) {
  const hasSidebar = options !== undefined || action !== undefined;
  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3">
        <ToolIcon slug={tool.slug} className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tool.title}</h1>
          <p className="text-sm text-muted-foreground">{tool.description}</p>
        </div>
        {onReset ? (
          <Button size="sm" variant="ghost" onClick={onReset} className="gap-1.5">
            <RotateCcw className="h-4 w-4" aria-hidden /> Start over
          </Button>
        ) : null}
      </div>

      {hasSidebar ? (
        <div className="grid flex-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section aria-label="Files" className="min-w-0">
            {children}
          </section>
          <aside className="order-first space-y-5 rounded-lg border border-border bg-card p-4 lg:order-none lg:sticky lg:top-4">
            {options}
            {action ? (
              <div className="space-y-2">
                <Button
                  onClick={action.onClick}
                  disabled={action.disabled || action.busy}
                  className="h-11 w-full gap-2 text-sm"
                >
                  {action.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {action.busy ? (action.busyLabel ?? "Working…") : tool.action}
                </Button>
                {action.hint ? (
                  <p className="text-xs text-muted-foreground">{action.hint}</p>
                ) : null}
              </div>
            ) : null}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Processed on your device. Your files are never uploaded.
            </p>
          </aside>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
