// Single source of truth for the tool catalogue (home grid, routes, page titles).
export type ToolSlug =
  | "merge"
  | "split"
  | "organize"
  | "images-to-pdf"
  | "pdf-to-images"
  | "page-numbers"
  | "watermark"
  | "protect"
  | "unlock";

export interface ToolInfo {
  slug: ToolSlug;
  title: string;
  description: string;
  /** Short verb for the primary button */
  action: string;
}

export const TOOLS: ToolInfo[] = [
  {
    slug: "merge",
    title: "Merge PDF",
    description: "Combine several PDFs into one, in the order you choose.",
    action: "Merge PDFs",
  },
  {
    slug: "split",
    title: "Split PDF",
    description: "Extract page ranges or split every page into its own PDF.",
    action: "Split PDF",
  },
  {
    slug: "organize",
    title: "Organize pages",
    description: "Reorder, rotate or delete pages with drag and drop.",
    action: "Save PDF",
  },
  {
    slug: "images-to-pdf",
    title: "Images to PDF",
    description: "Turn JPG, PNG or WebP images into a single PDF.",
    action: "Create PDF",
  },
  {
    slug: "pdf-to-images",
    title: "PDF to images",
    description: "Export every page as a high-quality PNG or JPG.",
    action: "Convert to images",
  },
  {
    slug: "page-numbers",
    title: "Add page numbers",
    description: "Number your pages, with the position and style you want.",
    action: "Add page numbers",
  },
  {
    slug: "watermark",
    title: "Add watermark",
    description: "Stamp text like CONFIDENTIAL or DRAFT across every page.",
    action: "Add watermark",
  },
  {
    slug: "protect",
    title: "Protect PDF",
    description: "Add a password with AES-256 encryption, and optional restrictions.",
    action: "Protect PDF",
  },
  {
    slug: "unlock",
    title: "Unlock PDF",
    description: "Remove the password from a PDF you can open.",
    action: "Unlock PDF",
  },
];

export function getTool(slug: ToolSlug): ToolInfo {
  const t = TOOLS.find((x) => x.slug === slug);
  if (!t) throw new Error(`Unknown tool ${slug}`);
  return t;
}
