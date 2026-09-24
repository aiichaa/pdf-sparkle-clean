import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { DigitalSignTool } from "@/components/pdf-clarity/tools/DigitalSignTool";

export const Route = createFileRoute("/digital-sign")({
  head: () => toolHead("digital-sign"),
  component: DigitalSignTool,
});
