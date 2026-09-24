import { Coffee } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const SUPPORT_URL = "https://ko-fi.com/aiichaa";

/**
 * Floating "Support on Ko-fi" button, bottom-left (toasts live bottom-right).
 * A plain outbound link with a bundled icon — no third-party widget script, so the
 * CSP stays untouched. Sits below the fullscreen overlay (z-50) and never prints.
 */
export function SupportButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Support these free tools on Ko-fi"
          className="fixed bottom-3 left-3 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#FF5E5B] text-white shadow-lg ring-1 ring-black/10 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background print:hidden"
        >
          <Coffee className="h-5 w-5" aria-hidden />
        </a>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        Enjoying this free tool? Support me on Ko-fi ☕
      </TooltipContent>
    </Tooltip>
  );
}
