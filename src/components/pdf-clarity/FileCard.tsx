import type { ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PageThumb } from "./Thumbnails";

export function FileCard({
  doc,
  name,
  meta,
  badge,
}: {
  doc?: PDFDocumentProxy;
  name: string;
  meta: string;
  badge?: ReactNode;
}) {
  return (
    <div className="flex max-w-md items-center gap-4 rounded-lg border border-border bg-card p-4">
      {doc ? (
        <PageThumb
          doc={doc}
          pageNumber={1}
          width={90}
          className="shrink-0 rounded-md bg-muted/40 p-1"
        />
      ) : null}
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium" title={name}>
          {name}
        </p>
        <p className="text-sm text-muted-foreground">{meta}</p>
        {badge}
      </div>
    </div>
  );
}
