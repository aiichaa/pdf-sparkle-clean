// Copies the pdf.js runtime assets (image decoders, standard fonts, CMaps, ICC
// profiles) from node_modules into public/pdfjs/ so they are served from our own
// origin. Nothing is loaded from a CDN, so CSP `connect-src 'self'` keeps holding.
//
// The scripting sandbox (quickjs) is deliberately NOT copied: we never execute
// JavaScript embedded in PDFs.
//
// It also copies the OCR runtime (tesseract.js worker, the LSTM-only WASM cores and
// the language models) into public/tesseract/.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = join("node_modules", "pdfjs-dist");
const dest = join("public", "pdfjs");

rmSync(dest, { recursive: true, force: true });
mkdirSync(join(dest, "wasm"), { recursive: true });

for (const f of readdirSync(join(src, "wasm"))) {
  if (f.endsWith(".wasm") && !f.startsWith("quickjs")) {
    cpSync(join(src, "wasm", f), join(dest, "wasm", f));
  }
}
for (const dir of ["standard_fonts", "cmaps", "iccs"]) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
console.log(`pdf.js assets copied to ${dest}`);

// ── tesseract.js (OCR) ──
const ocr = join("public", "tesseract");
rmSync(ocr, { recursive: true, force: true });
mkdirSync(join(ocr, "core"), { recursive: true });
mkdirSync(join(ocr, "lang"), { recursive: true });
cpSync(join("node_modules", "tesseract.js", "dist", "worker.min.js"), join(ocr, "worker.min.js"));
// We always run OEM LSTM_ONLY, so only the *-lstm cores are ever requested.
for (const f of readdirSync(join("node_modules", "tesseract.js-core"))) {
  if (/^tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(f)) {
    cpSync(join("node_modules", "tesseract.js-core", f), join(ocr, "core", f));
  }
}
for (const lang of ["eng", "fra", "spa", "deu", "ara"]) {
  const file = `${lang}.traineddata.gz`;
  cpSync(
    join("node_modules", "@tesseract.js-data", lang, "4.0.0_best_int", file),
    join(ocr, "lang", file),
  );
}
console.log(`tesseract.js assets copied to ${ocr}`);
