# PDF Clarity

A free, private PDF toolbox. Merge, split, organize, convert, number and watermark PDFs. Everything runs in your browser, and your files are never uploaded.

Live: <https://pdf.aiichaa.com>

## Tools

| Tool | What it does |
|---|---|
| **Merge PDF** | Combine several PDFs in the order you choose (drag and drop to reorder) |
| **Split PDF** | By page ranges (`1-3, 5, 8-`), one PDF per page, or pick pages by clicking them; several outputs are downloaded as a zip |
| **Organize pages** | Reorder, rotate or delete pages, with page thumbnails |
| **Images to PDF** | JPG, PNG, WebP, GIF or BMP → one PDF. A4, Letter or fit-to-image, with orientation and margins. Phone photos come out upright (EXIF orientation is applied) |
| **PDF to images** | Every page, or chosen pages, as PNG or JPG at 72, 150 or 300 dpi (zip for several pages) |
| **Add page numbers** | Six positions, `1` / `1 / N` / `Page 1 of N`, start number, size, and an option to skip the cover. Stays upright on rotated pages |
| **Add watermark** | Diagonal or horizontal text, colour, size and opacity, with a live preview |
| **Protect PDF** | Open password with **AES-256** (PDF 2.0 standard security: `/V 5 /R 6`, AESV3), plus optional restrictions (printing, copying, editing). The owner password is random and never shown |
| **Unlock PDF** | Remove the password from a PDF you can open, or lift "restrictions only" protection. Forms, bookmarks and metadata are kept; the password hashes are stripped from the output |

Other features: light / dark theme, responsive layout, keyboard-accessible drag and drop, and a floating “Support on Ko-fi” button (a plain link to [ko-fi.com/aiichaa](https://ko-fi.com/aiichaa); no third-party script).

## Privacy & Security

- **Local-only processing.** Files are read with `File.arrayBuffer()`, edited with pdf-lib and rendered with pdf.js, all inside the browser tab. There is no upload endpoint, and the app ships zero server functions.
- **Nothing is stored.** No database, no logs of files. Only the theme choice is kept in `localStorage`.
- **Files are checked by content.** Types are detected from magic bytes, never from the file name or MIME type, so a renamed HTML file is rejected.
- **Hostile PDFs are handled safely.**
  - pdf.js 6 paints pages to `<canvas>` only. There is no text or annotation layer, and XFA is off.
  - The JavaScript sandbox (`quickjs`) isn't shipped, so scripts inside PDFs never run.
  - Every output is a new document containing only the copied pages. That drops document-level JavaScript (`/OpenAction`), embedded files and other catalog baggage from the inputs.
- **Limits:**
  - 100 MB per file, 300 MB and 50 files per job;
  - 2,000 pages per document, 300 pages per PDF → images run;
  - canvas size is capped to prevent memory exhaustion.
- **Password-protected PDFs** are detected by the other tools, which point you to Unlock PDF. Unlock never guesses passwords. Its output is scrubbed of the encryption dictionary (the `/O /U /OE /UE` password hashes) and of the stale cross-reference stream, so the original password can't be attacked offline from the unlocked file.
- **Nothing loads from a CDN.** The pdf.js worker, WASM decoders (JPX, JBIG2, ICC), standard fonts and CMaps are served from our own origin (`/pdfjs/…`, copied at build time), so the strict CSP holds (`connect-src 'self'`).
- **Sanitized download filenames** (path traversal, control characters, accents).

## Develop

```bash
bun install
bun run dev        # copies pdf.js assets to public/pdfjs, then starts Vite
bunx vitest run    # unit tests (pdf-lib operations run in Node)
bun run build      # → .output/
```

## Deployment

Same model as JSON Clarity and MD Clarity: a Docker container bound to loopback, behind host nginx that terminates TLS and sets the security headers.

```bash
docker compose up -d --build
```

Defaults: container `pdfclarity-frontend` on `127.0.0.1:3150` (override with `APP_NAME` / `APP_PORT`). The compose file hardens the container: read-only filesystem, all capabilities dropped, `no-new-privileges`, and memory/pids limits. The runtime is Node 24 LTS as a non-root user.

### Security headers (nginx)

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
```

- `'wasm-unsafe-eval'` is needed for pdf.js's WebAssembly image decoders.
- `worker-src 'self'` covers the pdf.js worker.
- `img-src` doesn't need `blob:`, because every preview is drawn on `<canvas>`.
- Files never reach nginx, since they're read locally, so no upload size setting is needed.

## Roadmap

- **Phase 2:** ~~Protect / Unlock~~ (done), Compress (lossless clean-up plus image re-encoding), Fill forms, Sign (visual signature).
- **Not planned:** Office ↔ PDF conversion. It needs a server, which would break the “never uploaded” promise.

## Dependencies

- React 19, TanStack Start / Router, Tailwind CSS v4, shadcn primitives, `lucide-react`, `sonner`
- [`@cantoo/pdf-lib`](https://github.com/cantoo-scribe/pdf-lib) (MIT): a maintained fork of pdf-lib, used for editing
- [`pdfjs-dist`](https://github.com/mozilla/pdf.js) (Apache-2.0): Mozilla pdf.js, used for rendering
- [`@dnd-kit`](https://dndkit.com) (MIT): accessible drag and drop
- [`fflate`](https://github.com/101arrowz/fflate) (MIT): zip output

## License

MIT
