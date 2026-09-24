import { createFileRoute } from "@tanstack/react-router";
import { toolHead } from "@/lib/pdf/seo";
import { OcrTool } from "@/components/pdf-clarity/tools/OcrTool";

export const Route = createFileRoute("/ocr")({
  head: () => toolHead("ocr"),
  component: OcrTool,
});
