import { createFileRoute } from "@tanstack/react-router";
import { ToolGrid } from "@/components/pdf-clarity/ToolGrid";

const TITLE = "PDF Clarity — free, private PDF tools";
const DESCRIPTION =
  "Merge, split, organize, convert, number and watermark PDFs in your browser. Your files are never uploaded. No ads, no sign-up.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: "/" },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "theme-color", content: "#0f172a" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: ToolGrid,
});
