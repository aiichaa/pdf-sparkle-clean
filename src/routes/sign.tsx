import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { SignTool } from "@/components/pdf-clarity/tools/SignTool";

export const Route = createFileRoute("/sign")({
  head: () => toolHead("sign"),
  component: SignTool,
});
