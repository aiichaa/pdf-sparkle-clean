// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PDFDocument, EncryptedPDFError } from "@cantoo/pdf-lib";
import { protectPdf, unlockPdf, encryptionKind, PdfToolError } from "../ops";

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

async function formPdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const p = d.addPage([400, 300]);
  const f = d.getForm().createTextField("name");
  f.setText("Aicha");
  f.addToPage(p, { x: 50, y: 100 });
  d.setTitle("Contract");
  d.setAuthor("aiichaa");
  return d.save();
}

async function restrictedOnly(): Promise<Uint8Array> {
  const d = await PDFDocument.load(await formPdf());
  d.encrypt({
    userPassword: "",
    ownerPassword: "owner",
    permissions: { printing: false, copying: false },
  });
  return d.save();
}

const opts = { allowPrinting: true, allowCopying: false, allowEditing: false };

describe("protectPdf", () => {
  it("encrypts with AES-256 and needs the password to open", async () => {
    const out = await protectPdf(await formPdf(), { password: "s3cret!", ...opts });
    const s = latin1(out);
    expect(s).toMatch(/\/V 5/);
    expect(s).toMatch(/\/R 6/);
    expect(s).toContain("/AESV3");
    await expect(PDFDocument.load(out)).rejects.toBeInstanceOf(EncryptedPDFError);
    const reopened = await PDFDocument.load(out, { password: "s3cret!" });
    expect(
      reopened
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toEqual(["name"]);
  });

  it("uses a random owner password (differs between runs)", async () => {
    const src = await formPdf();
    const a = latin1(await protectPdf(src, { password: "x", ...opts }));
    const b = latin1(await protectPdf(src, { password: "x", ...opts }));
    const o = (s: string) => /\/O <([0-9a-f]+)>/i.exec(s)?.[1];
    expect(o(a)).toBeTruthy();
    expect(o(a)).not.toBe(o(b));
  });

  it("refuses an empty password and already-encrypted input", async () => {
    await expect(protectPdf(await formPdf(), { password: "", ...opts })).rejects.toMatchObject({
      code: "empty",
    });
    const locked = await protectPdf(await formPdf(), { password: "x", ...opts });
    await expect(protectPdf(locked, { password: "y", ...opts })).rejects.toMatchObject({
      code: "encrypted",
    });
  });
});

describe("unlockPdf", () => {
  it("round-trips: forms and title survive, nothing encrypted remains", async () => {
    const locked = await protectPdf(await formPdf(), { password: "open-me", ...opts });
    const out = await unlockPdf(locked, "open-me");
    const s = latin1(out);
    expect(s).not.toContain("/Encrypt");
    // no password hashes left behind (they'd allow offline cracking)
    expect(s).not.toContain("/Standard");
    expect(s).not.toMatch(/\/UE\s*</);
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getTextField("name").getText()).toBe("Aicha");
    expect(doc.getTitle()).toBe("Contract");
    expect(doc.getAuthor()).toBe("aiichaa");
  });

  it("names a wrong password", async () => {
    const locked = await protectPdf(await formPdf(), { password: "right", ...opts });
    await expect(unlockPdf(locked, "wrong")).rejects.toMatchObject({ code: "wrong-password" });
  });

  it("says when a file isn't protected", async () => {
    await expect(unlockPdf(await formPdf(), "")).rejects.toBeInstanceOf(PdfToolError);
    await expect(unlockPdf(await formPdf(), "")).rejects.toMatchObject({ code: "not-encrypted" });
  });

  it("lifts restrictions-only protection without a password", async () => {
    const r = await restrictedOnly();
    expect(await encryptionKind(r)).toBe("restrictions");
    const out = await unlockPdf(r, "");
    expect(latin1(out)).not.toContain("/Encrypt");
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it("classifies files", async () => {
    expect(await encryptionKind(await formPdf())).toBe("none");
    expect(
      await encryptionKind(await protectPdf(await formPdf(), { password: "p", ...opts })),
    ).toBe("open");
  });
});
