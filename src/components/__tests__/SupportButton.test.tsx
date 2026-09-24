import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SupportButton, SUPPORT_URL } from "../SupportButton";

describe("SupportButton", () => {
  it("links to the Ko-fi page safely", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <SupportButton />
      </TooltipProvider>,
    );
    expect(SUPPORT_URL).toBe("https://ko-fi.com/aiichaa");
    expect(html).toContain(`href="${SUPPORT_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("aria-label=");
    expect(html).toContain("print:hidden");
  });
});
