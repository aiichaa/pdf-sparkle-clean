import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { PageNumbersTool } from "@/components/pdf-clarity/tools/PageNumbersTool";

export const Route = createFileRoute("/page-numbers")({
  head: () => toolHead("page-numbers"),
  component: PageNumbersTool,
});
