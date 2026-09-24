// Copies the pdf.js runtime assets (image decoders, standard fonts, CMaps, ICC
// profiles) from node_modules into public/pdfjs/ so they are served from our own
// origin. Nothing is loaded from a CDN, so CSP `connect-src 'self'` keeps holding.
//
// The scripting sandbox (quickjs) is deliberately NOT copied: we never execute
// JavaScript embedded in PDFs.
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
