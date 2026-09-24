import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutGrid, Moon, Sun } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SupportButton } from "@/components/SupportButton";
import { useTheme } from "@/hooks/use-theme";

export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const isHome = useRouterState({ select: (s) => s.location.pathname === "/" });

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
            <Link
              to="/"
              className="flex min-w-0 items-center gap-3"
              aria-label="PDF Clarity — all tools"
            >
              <div
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-[10px] font-bold text-primary-foreground"
              >
                PDF
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-tight sm:text-lg">
                  PDF Clarity
                </p>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  Secure, fast, no-ads PDF toolbox.
                </p>
              </div>
            </Link>
            <div className="ml-auto flex items-center gap-1">
              {!isHome ? (
                <Button asChild size="sm" variant="ghost" className="gap-1.5">
                  <Link to="/">
                    <LayoutGrid className="h-4 w-4" aria-hidden />
                    <span className="hidden sm:inline">All tools</span>
                  </Link>
                </Button>
              ) : null}
              <Button
                onClick={toggle}
                size="sm"
                variant="ghost"
                aria-label="Toggle theme"
                className="gap-1.5"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" aria-hidden />
                ) : (
                  <Moon className="h-4 w-4" aria-hidden />
                )}
                <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3 pl-16 text-xs text-muted-foreground sm:px-6 sm:pl-16 2xl:pl-6">
            <span>PDF Clarity — your files never leave your browser.</span>
            <span>No tracking. No storage. No uploads.</span>
          </div>
        </footer>

        <SupportButton />
        <Toaster position="bottom-right" theme={theme} />
      </div>
    </TooltipProvider>
  );
}
