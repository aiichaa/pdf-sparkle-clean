import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { UnlockTool } from "@/components/pdf-clarity/tools/UnlockTool";

export const Route = createFileRoute("/unlock")({
  head: () => toolHead("unlock"),
  component: UnlockTool,
});
