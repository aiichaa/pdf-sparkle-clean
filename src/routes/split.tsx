import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { SplitTool } from "@/components/pdf-clarity/tools/SplitTool";

export const Route = createFileRoute("/split")({
  head: () => toolHead("split"),
  component: SplitTool,
});
