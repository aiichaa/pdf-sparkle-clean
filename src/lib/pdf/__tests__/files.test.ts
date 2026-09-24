import { describe, it, expect } from "vitest";
import { sniff, baseName } from "../files";
import { sanitizeFilename, buildZip } from "../download";
import { toWinAnsi } from "../winansi";
import { formatBytes } from "../limits";
import { unzipSync } from "fflate";
import { jpegOrientation } from "../images";
import { PNG_40x20, JPEG_30x60, JPEG_EXIF_6 } from "./fixtures";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("sniff", () => {
  it("detects types by magic bytes, not names", () => {
    expect(sniff(bytes("%PDF-1.7\n..."))).toBe("pdf");
    expect(sniff(bytes("\n\n  %PDF-1.4"))).toBe("pdf");
    expect(sniff(PNG_40x20)).toBe("png");
    expect(sniff(JPEG_30x60)).toBe("jpeg");
    expect(sniff(bytes("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniff(bytes("<html><script>"))).toBe("unknown");
  });
});

describe("sanitizeFilename", () => {
  it("strips traversal and unsafe characters", () => {
    expect(sanitizeFilename("../../etc/passwd", "pdf")).toBe("passwd.pdf");
    expect(sanitizeFilename("Rapport d'été <final>.pdf", "pdf")).toBe("Rapport_d_ete_final.pdf");
    expect(sanitizeFilename("", "zip")).toBe("document.zip");
  });
});

describe("buildZip", () => {
  it("stores entries with safe, unique names", () => {
    const zip = buildZip([
      { name: "../a.pdf", data: bytes("one") },
      { name: "a.pdf", data: bytes("two") },
    ]);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["a.pdf", "a_2.pdf"]);
    expect(new TextDecoder().decode(files["a_2.pdf"])).toBe("two");
  });
});

describe("helpers", () => {
  it("maps text to WinAnsi", () => {
    expect(toWinAnsi("CONFIDENTIEL — été")).toEqual({
      text: "CONFIDENTIEL — été",
      replaced: false,
    });
    expect(toWinAnsi("秘密 draft")).toEqual({ text: "?? draft", replaced: true });
  });

  it("formats sizes and names", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB");
    expect(baseName("Report Q3.final.pdf")).toBe("Report Q3.final");
  });
});

describe("jpegOrientation", () => {
  it("reads the EXIF orientation of phone-style photos", () => {
    expect(jpegOrientation(JPEG_EXIF_6)).toBe(6);
    expect(jpegOrientation(JPEG_30x60)).toBe(1);
    expect(jpegOrientation(PNG_40x20)).toBe(1);
  });
});
