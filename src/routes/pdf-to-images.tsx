import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { PdfToImagesTool } from "@/components/pdf-clarity/tools/PdfToImagesTool";

export const Route = createFileRoute("/pdf-to-images")({
  head: () => toolHead("pdf-to-images"),
  component: PdfToImagesTool,
});
