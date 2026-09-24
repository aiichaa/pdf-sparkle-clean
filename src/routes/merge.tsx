import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { MergeTool } from "@/components/pdf-clarity/tools/MergeTool";

export const Route = createFileRoute("/merge")({
  head: () => toolHead("merge"),
  component: MergeTool,
});
