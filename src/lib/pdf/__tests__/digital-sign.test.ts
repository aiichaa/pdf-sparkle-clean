// @vitest-environment node
import { describe, it, expect } from "vitest";
import forge from "node-forge";
import { PDFDocument } from "@cantoo/pdf-lib";
import {
  readP12,
  signWithCertificate,
  certificateWarnings,
  createSelfSignedP12,
} from "../digital-sign";
import { RSA_MODERN_P12, RSA_LEGACY_P12, RSA_UTF8_P12, EC_P12 } from "./p12-fixtures";

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const bin = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

async function plainPdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage([300, 300]);
  d.setTitle("Contract");
  return d.save();
}

/** Independent verification: byte ranges, messageDigest and the RSA signature. */
function verify(pdf: Uint8Array, which = -1) {
  const s = latin1(pdf);
  const ranges = [...s.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].map(
    (m) => m.slice(1, 5).map(Number),
  );
  const r = ranges.at(which)!;
  const contents = s.slice(r[1] + 1, r[2] - 1).replace(/0+$/, "");
  const signed = new Uint8Array([...pdf.subarray(r[0], r[1]), ...pdf.subarray(r[2], r[2] + r[3])]);
  const der = forge.util.hexToBytes(contents.length % 2 ? contents + "0" : contents);
  // signerInfo.issuerAndSerialNumber.issuer must be byte-identical to the cert's issuer
  const kids = (o: forge.asn1.Asn1) => o.value as forge.asn1.Asn1[];
  const signedData = kids(kids(kids(forge.asn1.fromDer(der))[1])[0]);
  const certTbs = kids(kids(kids(signedData[3])[0])[0]);
  const signerIssuer = kids(kids(kids(signedData[4])[0])[1])[0];
  const issuerMatches =
    forge.asn1.toDer(signerIssuer).getBytes() === forge.asn1.toDer(certTbs[3]).getBytes();
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der)) as forge.pkcs7.PkcsSignedData & {
    rawCapture: { authenticatedAttributes: forge.asn1.Asn1[]; signature: string };
  };
  const attrs = p7.rawCapture.authenticatedAttributes;
  const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
  const mdAttr = attrs.find(
    (a) =>
      forge.asn1.derToOid((a.value as forge.asn1.Asn1[])[0].value as string) ===
      forge.pki.oids.messageDigest,
  )!;
  const claimed = ((mdAttr.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0]
    .value as string;
  const actual = forge.md.sha256.create().update(bin(signed)).digest().getBytes();
  const md = forge.md.sha256.create().update(forge.asn1.toDer(set).getBytes());
  const cert = p7.certificates[0];
  const sigOk = (cert.publicKey as forge.pki.rsa.PublicKey).verify(
    md.digest().getBytes(),
    p7.rawCapture.signature,
  );
  return {
    coversAll: r[0] === 0 && r[2] + r[3] === pdf.length,
    digestOk: claimed === actual,
    sigOk,
    issuerMatches,
    signer: cert.subject.getField("CN")?.value,
  };
}

describe("readP12", () => {
  it("opens modern and legacy RSA certificates", () => {
    for (const p of [RSA_MODERN_P12, RSA_LEGACY_P12]) {
      const c = readP12(p, "test123");
      expect(c.info).toMatchObject({
        subject: "Aicha Test",
        organization: "Clarity Test",
        email: "test@example.com",
        selfSigned: true,
      });
    }
  });
  it("names a wrong password and rejects EC keys clearly", () => {
    expect(() => readP12(RSA_MODERN_P12, "nope")).toThrowError(
      expect.objectContaining({ code: "wrong-password" }),
    );
    expect(() => readP12(EC_P12, "test123")).toThrow(/Only RSA/);
    expect(() => readP12(new Uint8Array([1, 2, 3]), "x")).toThrowError(
      expect.objectContaining({ code: "invalid" }),
    );
  });
  it("warns about expired and self-signed certificates", () => {
    const info = readP12(RSA_MODERN_P12, "test123").info;
    expect(certificateWarnings(info).join(" ")).toMatch(/Self-signed/);
    expect(certificateWarnings(info, new Date(2099, 0, 1)).join(" ")).toMatch(/expired/);
  });
});

describe("signWithCertificate", () => {
  it("produces a valid detached SHA-256 signature over the whole file", async () => {
    const cert = readP12(RSA_MODERN_P12, "test123");
    const out = await signWithCertificate(await plainPdf(), cert, {
      reason: "Approved",
      location: "Casablanca",
    });
    expect(verify(out)).toEqual({
      coversAll: true,
      digestOk: true,
      sigOk: true,
      issuerMatches: true,
      signer: "Aicha Test",
    });
    const s = latin1(out);
    expect(s).toContain("/SubFilter /adbe.pkcs7.detached");
    expect(s).toMatch(/\/SigFlags 3/);
    expect((await PDFDocument.load(out)).getTitle()).toBe("Contract");
  });

  it("keeps accented UTF-8 names intact (subject shown, issuer bytes preserved)", async () => {
    const cert = readP12(RSA_UTF8_P12, "test123");
    expect(cert.info).toMatchObject({ subject: "Aïcha Élève", organization: "Société Générale" });
    const out = await signWithCertificate(await plainPdf(), cert);
    expect(verify(out)).toMatchObject({ digestOk: true, sigOk: true, issuerMatches: true });
  });

  it("detects tampering", async () => {
    const out = await signWithCertificate(await plainPdf(), readP12(RSA_MODERN_P12, "test123"));
    const i = latin1(out).indexOf("/MediaBox");
    out[i + 12] = out[i + 12] === 0x33 ? 0x34 : 0x33; // change one digit of the page size
    expect(verify(out).digestOk).toBe(false);
  });

  it("keeps earlier signatures valid when signing again (incremental)", async () => {
    const once = await signWithCertificate(await plainPdf(), readP12(RSA_MODERN_P12, "test123"));
    const twice = await signWithCertificate(once, readP12(RSA_LEGACY_P12, "test123"));
    expect(twice.subarray(0, once.length)).toEqual(once); // appended, not rewritten
    expect(verify(twice, 0)).toMatchObject({ digestOk: true, sigOk: true, issuerMatches: true });
    expect(verify(twice, 1)).toMatchObject({ coversAll: true, digestOk: true, sigOk: true });
  });
});

describe("createSelfSignedP12", () => {
  it("makes a .p12 that opens with its password and signs validly", async () => {
    const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 }); // small key: test speed only
    const { p12, loaded: made } = createSelfSignedP12(keys, {
      name: "Aïcha Demo",
      email: "demo@example.com",
      password: "pw-123456",
    });
    expect(made.info.subject).toBe("Aïcha Demo");
    const loaded = readP12(p12, "pw-123456");
    expect(loaded.info).toMatchObject({ subject: "Aïcha Demo", selfSigned: true });
    // stored as UTF8String, so other tools read the accent too
    const cn = loaded.cert.subject.getField("CN");
    expect(cn.valueTagClass).toBe(forge.asn1.Type.UTF8);
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(loaded.cert)).getBytes();
    expect(der).toContain(forge.util.encodeUtf8("Aïcha Demo")); // proper UTF-8, once
    expect(loaded.info.notAfter.getFullYear() - new Date().getFullYear()).toBe(3);
    const out = await signWithCertificate(await plainPdf(), loaded);
    expect(verify(out)).toMatchObject({ digestOk: true, sigOk: true, issuerMatches: true });
  });
});
