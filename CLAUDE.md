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

- **Routes** (`src/routes/`): `/` shows the tool grid; `/merge`, `/split`, `/organize`, `/images-to-pdf`, `/pdf-to-images`, `/page-numbers`, `/watermark`, `/compress`, `/fill-forms`, `/ocr`, `/sign`, `/digital-sign`, `/protect` and `/unlock` are the tools. `UnlockTool` doesn't use pdf.js, since encrypted files can't be previewed without the password. Each route sets its own `<head>` via `lib/pdf/seo.ts`. `__root.tsx` wraps every route in `AppShell` (header, footer, theme, Ko-fi button, toaster).
- **Tool catalogue** `src/lib/pdf/tools.ts`: the single source for titles, descriptions and button labels.
- **Lib** `src/lib/pdf/`:
  - `ops.ts`: **pure** pdf-lib operations (merge, split, organize, imagesToPdf, addPageNumbers, addWatermark, protectPdf, unlockPdf, encryptionKind), unit-tested.
    - **Protect/Unlock keep the same document** (forms, outlines, metadata) instead of copying pages. `protectPdf` uses the fork's default **AES-256** (`/V 5 /R 6`) with a random owner password. RC4 is never enabled.
    - `unlockPdf` must call `scrubDecrypted()`. After a decrypting load, pdf-lib keeps the encryption dict (password hashes) and the original xref stream as a `PDFInvalidObject` that still says `/Encrypt`, and it can lose the `/Info` pointer. Without the scrub, the output claims to be encrypted and leaks hashes. Every op builds a **new** document and `copyPages` into it, which strips document-level JS, `/OpenAction` and attachments. `visualToUser()` maps "as displayed" coordinates onto pages with `/Rotate`, so stamped text stays upright.
  - `render.ts`: pdf.js (browser only; always `import()` it dynamically). Canvas rendering only. `openDocument` passes `bytes.slice()`, because pdf.js detaches the buffer it's given.
  - `files.ts`: magic-byte sniffing plus size and count limits. `limits.ts`: all guardrails. `ranges.ts`: `1-3, 5, 8-` parser. `images.ts`: EXIF orientation and re-encode to PNG/JPEG. `winansi.ts`: text mapping for the standard fonts. `download.ts`: filename sanitizing and zip (fflate).
- **Compression** `src/lib/pdf/compress.ts` + `compress-browser.ts`:
  - `compressPdf(bytes, level, encoder)` edits the same document in place: it re-encodes image XObjects through an injected `ImageEncoder` (canvas in the browser, a fake in tests), then runs `removeUnreferenced` (a reachability sweep from Root/Info) and `deflateUncompressedStreams`.
  - An image is replaced only if the result is ≥10% smaller. After replacing, the dictionary is rewritten: `DCTDecode`, `DeviceRGB`, 8 bpc, new Width/Height, `DecodeParms` removed.
  - The candidate filter (`imageCandidate`) is the safety net. Keep it strict: RGB/Gray-family colour spaces only, no `/Decode`, `/Mask` or stencil masks, a single DCT or Flate (8 bpc, PNG predictors 10–15) filter, and at most 40 MP.
  - The browser encoder must keep `imageOrientation: "none"` and `colorSpaceConversion: "none"`.
- **Forms** `src/lib/pdf/forms.ts`:
  - `readForm` loads with `preserveXFA: true` (to detect XFA) and returns fields with their widget page and rect. `fillForm` loads normally, which strips XFA so every reader shows the AcroForm values. Read-only fields are never written.
  - `needsReadableSize()` sets multiline fields to 10pt when their DA size is auto (0) or baked above 24pt. Otherwise pdf-lib renders one giant word.
  - UI: `FormPage` draws a page plus field outlines using `viewport.convertToViewportPoint` (correct with `/Rotate`). The boxes are memoised per form so typing doesn't re-render the canvases.
- **Sign** `src/lib/pdf/sign.ts` (pure) + `signature-browser.ts`:
  - `Placement` is stored in **visual page points with a top-left origin**. `placementToUser()` converts it with `visualToUser` and draws with `rotate = page rotation`, so the signature is upright on rotated pages.
  - The signature is a trimmed transparent PNG, embedded once and drawn per placement.
  - Previews use `data:` URLs, which CSP `img-src` allows. The handwriting fonts load as same-origin woff2 through `FontFace`.
  - **Never persist the signature** (no localStorage).
- **Sign with certificate** `src/lib/pdf/digital-sign.ts` (pure, node-forge) + `digital-sign-browser.ts` (WebCrypto RSA key generation → forge keys):
  - Two steps: `withPlaceholder` adds an invisible `/FT /Sig` widget plus a `/Sig` dict with a `/ByteRange [0 /********** ×3]` and a zeroed 16 KB `/Contents`. It saves **incrementally** (`forIncrementalUpdate`, `useObjectStreams: false`, so the placeholders stay literal). `embedSignature` then patches the ByteRange in place, hashes the two ranges and writes a detached CMS SignedData (sha256; contentType, messageDigest and signingTime attributes).
  - RSA only: node-forge can't decode EC keys, and readP12 says so.
  - **UTF-8 names:** forge parses UTF8String values as raw bytes but re-encodes them when it rebuilds a name (the signer's issuerAndSerialNumber). `normalizeNames()` decodes them once. Without it, an accented CN (e.g. "Aïcha") gives an invalid signature. Tests check the issuer bytes.
  - Tests use OpenSSL-made `.p12` fixtures (`__tests__/p12-fixtures.ts`, password `test123`) and verify byte ranges, digest, RSA signature and issuer bytes independently. The e2e is checked with poppler `pdfsig`.
  - **Never persist the certificate, key or password.**
- **OCR** `src/lib/pdf/ocr.ts` (pure, `addTextLayer`) + `ocr-browser.ts` (tesseract.js):
  - Assets live in `public/tesseract/` (git-ignored, copied by `scripts/copy-pdfjs-assets.mjs`): `worker.min.js`, only the three `*-lstm.wasm.js` cores (we always use `OEM.LSTM_ONLY`) and `lang/<lang>.traineddata.gz` (4.0.0_best_int). Settings: `workerBlobURL: false`, `cacheMethod: "none"` (no IndexedDB) and `gzip: true`. It's imported from `tesseract.js/dist/tesseract.esm.min.js` (typed in `tesseract-esm.d.ts`). ESLint and Prettier ignore `public/tesseract`, because linting the 4 MB cores hangs.
  - Languages: `eng`, `fra`, `spa`, `deu`, `ara` (the list lives in `OcrTool.tsx`, the type in `ocr-browser.ts` and the copy list in the script; keep all three in sync).
  - Pages are rendered with `renderPageToCanvas` at 300 DPI (visual frame). Which words go into the layer is decided by `keepWords` (pure, tested), **per line**:
    - In a confident line (median ≥ 60), words ≥ 20 stay; in a doubtful line only words ≥ 75.
    - Lone symbols need ≥ 85, or ≥ 50 for normal punctuation in a confident line.
    - Script mismatches (a Latin misreading inside an Arabic line, an Arabic "letter" in an English line) and single letters need ≥ 80. A single letter under half the line's word height is a speck.
    - A line that is one lone character needs ≥ 90.
    - A flat per-word threshold dropped real words next to punctuation and kept specks.
  - Layer: the existing content is wrapped in `q … Q` (`wrapContentStreams`), then one `BT` per line in `3 Tr`. All words of a line share the size (ascender height / 0.72) and the baseline (tesseract's baseline segment, with skew). Each word is `Tz`-stretched to its box. Shared lines are what keep pdftotext reading order; per-word sizes scrambled it.
  - **Glyphless font** (like Tesseract's pdfrenderer): a Type0 / CIDFontType2 font, `Identity-H`, where code = UTF-16 unit, with an identity `ToUnicode` and `CIDToGIDMap` → a blank glyph. Every glyph is 0.5 em wide, ascent 0.72, descent −0.21. The 624-byte TTF is inlined as base64 in `ocr.ts`; it was generated with fontTools `FontBuilder` (glyphs `.notdef` + `blank`, both empty, advance 500/1000). With no shaping or glyph lookup, extraction is exact for any script. **Don't** switch to a real Arabic font through fontkit: Noto builds letters from shared skeletons plus dots, so the glyph→Unicode map is lossy (يـ came back as بـ, الله as اللة).
  - **RTL:** words with Hebrew/Arabic letters are written in **visual order** (`visualOrder`: reverse the runs, and the characters inside RTL runs; digits and Latin stay as they are). That's the convention Word and Chrome use, and the one pdf.js and pdftotext undo. Logical order with a mirrored text matrix worked in pdftotext but came out reversed in pdf.js. Word gaps get a real space: after the word in LTR lines, before it (on the left) in RTL lines (`isRtlLine`, by letter count). pdftotext wraps numbers inside Arabic in bidi marks (LRE…PDF), exactly as for Chrome-made Arabic PDFs; that's expected, and the tests keep the marks.
  - `worker.terminate()` leaves a pending `recognize()` unsettled, so every await in `recognizeDocument` races the abort signal (`cancellable`).
  - Unit tests check placement with poppler `pdftotext -bbox` on all four rotations, and check Arabic extraction with pdftotext and pdf.js (exact logical string). They are skipped in the bun container, which has no poppler; run them on the host with `node node_modules/vitest/vitest.mjs run`.
- **Rendering queue:** `renderThumbnail` serialises renders per canvas (a WeakMap chain). pdf.js throws if two `render()` calls hit the same canvas, which happened when a ResizeObserver re-rendered during the first paint. Keep all page painting going through it.
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
- **Network isolation.** `docker-compose.yml` gives the network a fixed bridge name (`br-<app>clarity`), which the host nftables table `inet clarity_isolation` (`/etc/nftables-clarity.nft`, loaded by `clarity-isolation.service`) matches. The container **cannot open any connection** (internet or other containers), and no other container can connect to it. Only the host (nginx via docker-proxy) reaches it. Keep the app self-contained: no outbound calls, and don't rename the network.

## Style

Tailwind v4 + shadcn primitives (`button`, `tooltip`, `sonner`), lucide icons, light/dark via class, responsive. On phones the options panel comes before the page grid (`order-first`).
