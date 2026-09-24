import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { FillFormTool } from "@/components/pdf-clarity/tools/FillFormTool";

export const Route = createFileRoute("/fill-forms")({
  head: () => toolHead("fill-forms"),
  component: FillFormTool,
});
