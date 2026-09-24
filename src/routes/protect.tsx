import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { ProtectTool } from "@/components/pdf-clarity/tools/ProtectTool";

export const Route = createFileRoute("/protect")({
  head: () => toolHead("protect"),
  component: ProtectTool,
});
