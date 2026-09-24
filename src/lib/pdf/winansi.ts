// The standard PDF fonts (Helvetica…) are WinAnsi-encoded: Latin-1 plus the CP1252
// extras. pdf-lib throws on anything else, so user text is mapped first.
const WINANSI_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split("").map((c) => c.codePointAt(0)!),
);

export function isWinAnsiChar(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(cp);
}

/** Replace characters the standard fonts can't draw with "?". */
export function toWinAnsi(s: string): { text: string; replaced: boolean } {
  let text = "";
  let replaced = false;
  for (const ch of s.replace(/[\r\n\t]+/g, " ")) {
    if (isWinAnsiChar(ch)) text += ch;
    else {
      text += "?";
      replaced = true;
    }
  }
  return { text, replaced };
}
