import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { ImagesToPdfTool } from "@/components/pdf-clarity/tools/ImagesToPdfTool";

export const Route = createFileRoute("/images-to-pdf")({
  head: () => toolHead("images-to-pdf"),
  component: ImagesToPdfTool,
});
