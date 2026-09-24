import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { OrganizeTool } from "@/components/pdf-clarity/tools/OrganizeTool";

export const Route = createFileRoute("/organize")({
  head: () => toolHead("organize"),
  component: OrganizeTool,
});
