# CLAUDE.md — PDF Clarity

## Project

PDF Clarity (repo: `pdf-sparkle-clean`) is a **client-side** PDF toolbox (iLovePDF-style) built with TanStack Start + React 19 + Vite. All PDF work happens in the browser. There is no backend API. The user-facing language is English.

It is the third sibling of `json-sparkle-clean` (JSON Clarity) and `md-sparkle-clean` (MD Clarity), and shares their stack, look, Docker setup and security model.

Deployment: Docker behind host nginx at https://pdf.aiichaa.com (nginx → `127.0.0.1:3150`).

## Commands

```sh
bun install
bun run dev              # copies pdf.js assets, then Vite dev server
bun run build            # copies pdf.js assets, then vite build → .output/
bun run lint
bunx vitest run          # ops.test.ts runs in the node environment
docker compose up -d --build   # 127.0.0.1:3150 → 3000
```

Bun is not installed on the host. Run it through Docker:
`docker run --rm --user $(id -u):$(id -g) -v "$PWD":/app -w /app -e HOME=/tmp oven/bun:1-alpine bun <cmd>`

## Architecture

- **Routes** (`src/routes/`): `/` shows the tool grid; `/merge`, `/split`, `/organize`, `/images-to-pdf`, `/pdf-to-images`, `/page-numbers` and `/watermark` are the tools. Each route sets its own `<head>` via `lib/pdf/seo.ts`. `__root.tsx` wraps every route in `AppShell` (header, footer, theme, Ko-fi button, toaster).
- **Tool catalogue** `src/lib/pdf/tools.ts`: the single source for titles, descriptions and button labels.
- **Lib** `src/lib/pdf/`:
  - `ops.ts`: **pure** pdf-lib operations (merge, split, organize, imagesToPdf, addPageNumbers, addWatermark), unit-tested. Every op builds a **new** document and `copyPages` into it, which strips document-level JS, `/OpenAction` and attachments. `visualToUser()` maps "as displayed" coordinates onto pages with `/Rotate`, so stamped text stays upright.
  - `render.ts`: pdf.js (browser only; always `import()` it dynamically). Canvas rendering only. `openDocument` passes `bytes.slice()`, because pdf.js detaches the buffer it's given.
  - `files.ts`: magic-byte sniffing plus size and count limits. `limits.ts`: all guardrails. `ranges.ts`: `1-3, 5, 8-` parser. `images.ts`: EXIF orientation and re-encode to PNG/JPEG. `winansi.ts`: text mapping for the standard fonts. `download.ts`: filename sanitizing and zip (fflate).
- **Components** `src/components/pdf-clarity/`:
  - `ToolFrame`: the tool header, plus a sidebar with options and the primary action.
  - `FileDrop`, `Thumbnails` (`PageThumb`, `ImageThumb`: lazy canvas rendering), `SortableGrid` (dnd-kit with readable announcements), `controls` (`Segmented`, `Field`).
  - `use-files.ts`: loads PDFs and opens them in pdf.js. Clean up with `doc.loadingTask.destroy()` (pdf.js 6 has no `doc.destroy()`).
  - `tools/*Tool.tsx`: one component per tool.
- **pdf.js assets**: `scripts/copy-pdfjs-assets.mjs` copies the wasm decoders, standard_fonts, cmaps and iccs into `public/pdfjs/` (git-ignored) before dev and build. The quickjs scripting sandbox is deliberately not copied.

## Points d'attention

- **No uploads, no backend, no `createServerFn`.** CSP `connect-src 'self'`. Never add a server-side conversion path: that would break the product promise.
- **Keep pdf-lib and pdf.js out of the initial bundle.** Tools `import("@/lib/pdf/ops")` or `import("@/lib/pdf/render")` inside handlers. Use `import type` for their types. `use-files.ts` matches `PdfToolError` by `name`, so it doesn't pull pdf-lib in.
- **Previews use `<canvas>`, never `<img src="blob:">`.** That keeps CSP `img-src 'self' data:`.
- **Never build a pdf.js text or annotation layer, and never enable scripting or XFA.**
- **Standard fonts are WinAnsi.** Map user text with `toWinAnsi` and tell the user about replaced characters (see the Watermark tool).
- **Limits** live in `lib/pdf/limits.ts`. Relax them only deliberately.
- **Ko-fi button** (`src/components/SupportButton.tsx`) is a plain link. Don't swap it for a widget script.
- **Supply chain:** `bunfig.toml` sets `minimumReleaseAge`. `bun audit` should report 0 vulnerabilities.

## Style

Tailwind v4 + shadcn primitives (`button`, `tooltip`, `sonner`), lucide icons, light/dark via class, responsive. On phones the options panel comes before the page grid (`order-first`).
