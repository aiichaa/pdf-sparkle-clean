import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { readFiles, type LoadedFile } from "@/lib/pdf/files";
import { MAX_PAGES } from "@/lib/pdf/limits";

export interface PdfItem extends LoadedFile {
  doc: PDFDocumentProxy;
  pages: number;
}

// pdf.js 6: documents are torn down through their loading task.
const closeDoc = (doc: PDFDocumentProxy) => void doc.loadingTask.destroy();

function describeOpenError(name: string, e: unknown): string {
  const n = (e as { name?: string })?.name;
  if (n === "PasswordException")
    return `${name} is password-protected. Unlocking PDFs isn't supported yet.`;
  return `${name} couldn't be opened. It may be damaged or not a real PDF.`;
}

export function reportRejections(rejected: string[]) {
  if (!rejected.length) return;
  toast.error(rejected.length === 1 ? rejected[0] : `${rejected.length} files were skipped`, {
    description: rejected.length > 1 ? rejected.slice(0, 4).join("\n") : undefined,
  });
}

export function toolErrorMessage(e: unknown): string {
  // Matched by name so this module doesn't pull pdf-lib into the initial bundle.
  if ((e as Error)?.name === "PdfToolError") return (e as Error).message;
  console.error("[PDF Clarity]", e);
  return "Something went wrong while processing the file.";
}

/** PDF files opened with pdf.js (for thumbnails / page counts). */
export function usePdfFiles({ multiple }: { multiple: boolean }) {
  const [items, setItems] = useState<PdfItem[]>([]);
  const [loading, setLoading] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Free pdf.js workers/memory when the tool unmounts.
  useEffect(() => () => itemsRef.current.forEach((i) => closeDoc(i.doc)), []);

  const add = useCallback(
    async (files: File[]) => {
      setLoading(true);
      try {
        const current = multiple ? itemsRef.current : [];
        const { accepted, rejected } = await readFiles(files, ["pdf"], {
          alreadyLoadedBytes: current.reduce((s, i) => s + i.size, 0),
          alreadyLoadedCount: current.length,
        });
        const { openDocument } = await import("@/lib/pdf/render");
        const opened: PdfItem[] = [];
        for (const f of accepted) {
          try {
            const doc = await openDocument(f.bytes);
            if (doc.numPages > MAX_PAGES) {
              closeDoc(doc);
              rejected.push(`${f.name} has ${doc.numPages} pages; the limit is ${MAX_PAGES}`);
              continue;
            }
            opened.push({ ...f, doc, pages: doc.numPages });
          } catch (e) {
            rejected.push(describeOpenError(f.name, e));
          }
        }
        reportRejections(rejected);
        if (!opened.length) return;
        if (multiple) setItems((prev) => [...prev, ...opened]);
        else {
          itemsRef.current.forEach((i) => closeDoc(i.doc));
          setItems(opened.slice(0, 1));
        }
      } finally {
        setLoading(false);
      }
    },
    [multiple],
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const gone = prev.find((i) => i.id === id);
      if (gone) closeDoc(gone.doc);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    itemsRef.current.forEach((i) => closeDoc(i.doc));
    setItems([]);
  }, []);

  return { items, setItems, add, remove, clear, loading };
}

/** Raster images (validated by magic bytes). */
export function useImageFiles() {
  const [items, setItems] = useState<LoadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const add = useCallback(async (files: File[]) => {
    setLoading(true);
    try {
      const { accepted, rejected } = await readFiles(files, ["png", "jpeg", "webp", "gif", "bmp"], {
        alreadyLoadedBytes: itemsRef.current.reduce((s, i) => s + i.size, 0),
        alreadyLoadedCount: itemsRef.current.length,
      });
      reportRejections(rejected);
      if (accepted.length) setItems((prev) => [...prev, ...accepted]);
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(
    (id: string) => setItems((prev) => prev.filter((i) => i.id !== id)),
    [],
  );
  const clear = useCallback(() => setItems([]), []);
  return { items, setItems, add, remove, clear, loading };
}
