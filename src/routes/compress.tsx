import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { CompressTool } from "@/components/pdf-clarity/tools/CompressTool";

export const Route = createFileRoute("/compress")({
  head: () => toolHead("compress"),
  component: CompressTool,
});
