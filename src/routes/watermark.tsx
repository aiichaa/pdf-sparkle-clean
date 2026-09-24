import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { WatermarkTool } from "@/components/pdf-clarity/tools/WatermarkTool";

export const Route = createFileRoute("/watermark")({
  head: () => toolHead("watermark"),
  component: WatermarkTool,
});
