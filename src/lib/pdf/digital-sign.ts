// Certificate-based PDF signatures (PAdES-style adbe.pkcs7.detached, SHA-256),
// made entirely in the browser with the user's own .p12 / .pfx.
//
// Flow: add a signature field + /Sig dictionary with fixed-size placeholders, save
// INCREMENTALLY (earlier signatures stay valid), then hash the two byte ranges
// around /Contents, build a detached CMS SignedData with node-forge and write it
// into the placeholder. RSA keys only (node-forge has no ECDSA).
import forge from "node-forge";
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from "@cantoo/pdf-lib";
import { loadPdf, PdfToolError } from "./ops";

/** Reserved space for the CMS blob (DER bytes). Room for a signer + a short chain. */
const SIGNATURE_BYTES = 16384;
const BYTE_RANGE_PLACEHOLDER = "**********";

export interface CertificateInfo {
  subject: string;
  email?: string;
  organization?: string;
  issuer: string;
  notBefore: Date;
  notAfter: Date;
  selfSigned: boolean;
  serial: string;
}

export interface LoadedCertificate {
  info: CertificateInfo;
  key: forge.pki.rsa.PrivateKey;
  cert: forge.pki.Certificate;
  chain: forge.pki.Certificate[];
}

export interface SignOptions {
  reason?: string;
  location?: string;
  contactInfo?: string;
  /** injectable for tests */
  date?: Date;
}

const toBinary = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
const fromBinary = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function field(attrs: forge.pki.CertificateField[], short: string): string | undefined {
  const v = attrs.find((a) => a.shortName === short || a.name === short)?.value;
  return typeof v === "string" ? v : undefined;
}

/**
 * forge parses UTF8String names as raw UTF-8 bytes but re-encodes them when it
 * rebuilds a name (e.g. the signer's issuer in the CMS), which would corrupt
 * non-ASCII names like "Aïcha" and break the signature. Decode them once here.
 */
function normalizeNames(cert: forge.pki.Certificate): forge.pki.Certificate {
  for (const attr of [...cert.subject.attributes, ...cert.issuer.attributes]) {
    if ((attr.valueTagClass as number | undefined) === forge.asn1.Type.UTF8) {
      try {
        attr.value = forge.util.decodeUtf8(attr.value as string);
      } catch {
        // not valid UTF-8: leave the bytes as they are
      }
    }
  }
  return cert;
}

function describe(cert: forge.pki.Certificate): CertificateInfo {
  const subject =
    field(cert.subject.attributes, "CN") ?? field(cert.subject.attributes, "O") ?? "Unknown";
  const issuer =
    field(cert.issuer.attributes, "CN") ?? field(cert.issuer.attributes, "O") ?? "Unknown";
  return {
    subject,
    email: field(cert.subject.attributes, "E") ?? field(cert.subject.attributes, "emailAddress"),
    organization: field(cert.subject.attributes, "O"),
    issuer,
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    selfSigned: cert.isIssuer(cert),
    serial: cert.serialNumber,
  };
}

/** Open a PKCS#12 file. Throws PdfToolError("wrong-password" | "invalid" | "empty"). */
export function readP12(bytes: Uint8Array, password: string): LoadedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(toBinary(bytes)), false, password);
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (/mac could not be verified|invalid password|pkcs#12 mac/i.test(msg)) {
      throw new PdfToolError("wrong-password", "That password doesn't open this certificate.");
    }
    throw new PdfToolError("invalid", "This isn't a readable .p12 / .pfx certificate file.");
  }
  const bags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c)
    .map(normalizeNames);
  if (!bags.length) throw new PdfToolError("empty", "This certificate file has no private key.");
  const key = bags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) {
    // node-forge only decodes RSA keys; an EC key shows up as raw ASN.1.
    throw new PdfToolError(
      "invalid",
      "Only RSA certificates are supported for now (this one uses an elliptic-curve key).",
    );
  }
  const cert = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub?.n && pub.n.equals(key.n);
  });
  if (!cert)
    throw new PdfToolError(
      "invalid",
      "The certificate file doesn't contain the certificate for its key.",
    );
  return { info: describe(cert), key, cert, chain: certs.filter((c) => c !== cert) };
}

/** Friendly problems to show before signing (the user may still proceed). */
export function certificateWarnings(info: CertificateInfo, now = new Date()): string[] {
  const w: string[] = [];
  if (now < info.notBefore) w.push("This certificate isn't valid yet.");
  if (now > info.notAfter)
    w.push("This certificate has expired. Readers will show the signature as invalid.");
  if (info.selfSigned) {
    w.push(
      "Self-signed: readers will say the signer's identity is unknown until the recipient trusts it.",
    );
  }
  return w;
}

function pdfText(s: string) {
  return PDFHexString.fromText(s);
}

/** Step 1: add the signature field and placeholders, saved incrementally. */
async function withPlaceholder(
  bytes: Uint8Array,
  signer: string,
  opts: SignOptions,
  name?: string,
): Promise<Uint8Array> {
  await loadPdf(bytes, name); // friendly errors (encrypted, broken…)
  const doc = await PDFDocument.load(bytes, {
    forIncrementalUpdate: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  const ctx = doc.context;
  const date = opts.date ?? new Date();

  const byteRange = PDFArray.withContext(ctx);
  byteRange.push(PDFNumber.of(0));
  for (let i = 0; i < 3; i++) byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
  const sig = ctx.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "adbe.pkcs7.detached",
    ByteRange: byteRange,
    Contents: PDFHexString.of("0".repeat(SIGNATURE_BYTES * 2)),
    M: PDFString.fromDate(date),
    Name: pdfText(signer),
    Prop_Build: ctx.obj({ App: ctx.obj({ Name: PDFName.of("PDF_Clarity") }) }),
  });
  if (opts.reason) sig.set(PDFName.of("Reason"), pdfText(opts.reason));
  if (opts.location) sig.set(PDFName.of("Location"), pdfText(opts.location));
  if (opts.contactInfo) sig.set(PDFName.of("ContactInfo"), pdfText(opts.contactInfo));
  const sigRef = ctx.register(sig);

  const page = doc.getPage(0);
  const existing = doc
    .getForm()
    .getFields()
    .filter((f) => f.getName().startsWith("Signature")).length;
  const widget = ctx.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: [0, 0, 0, 0], // invisible signature; shown in the reader's signature panel
    V: sigRef,
    T: pdfText(`Signature${existing + 1}`),
    F: 132, // Print + Locked
    P: page.ref,
  });
  const widgetRef = ctx.register(widget);
  page.node.addAnnot(widgetRef);
  const acro = doc.catalog.getOrCreateAcroForm();
  acro.addField(widgetRef);
  acro.dict.set(PDFName.of("SigFlags"), PDFNumber.of(3)); // SignaturesExist | AppendOnly
  // Placeholders must stay as literal text in the file: no object streams.
  return doc.save({ useObjectStreams: false });
}

/** Step 2: fill in /ByteRange and /Contents. */
function embedSignature(pdf: Uint8Array, loaded: LoadedCertificate, date: Date): Uint8Array {
  const latin = new TextDecoder("latin1").decode(pdf);
  const holder = `<${"0".repeat(SIGNATURE_BYTES * 2)}>`;
  const contentsAt = latin.lastIndexOf(holder);
  const rangeHolder = `[ 0 /${BYTE_RANGE_PLACEHOLDER} /${BYTE_RANGE_PLACEHOLDER} /${BYTE_RANGE_PLACEHOLDER} ]`;
  const rangeAt = latin.lastIndexOf(rangeHolder);
  if (contentsAt < 0 || rangeAt < 0) throw new Error("Signature placeholder not found");

  const afterContents = contentsAt + holder.length;
  const range = [0, contentsAt, afterContents, pdf.length - afterContents];
  const rangeText = `[${range.join(" ")}]`.padEnd(rangeHolder.length, " ");
  if (rangeText.length > rangeHolder.length) throw new Error("ByteRange doesn't fit");
  const out = pdf.slice();
  out.set(new TextEncoder().encode(rangeText), rangeAt);

  const signed = new Uint8Array(range[1] + range[3]);
  signed.set(out.subarray(0, range[1]), 0);
  signed.set(out.subarray(range[2]), range[1]);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(toBinary(signed));
  p7.addCertificate(loaded.cert);
  for (const c of loaded.chain) p7.addCertificate(c);
  p7.addSigner({
    key: loaded.key,
    certificate: loaded.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: date as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const hex = forge.util.bytesToHex(der);
  if (hex.length > SIGNATURE_BYTES * 2) {
    throw new PdfToolError("invalid", "This certificate chain is too large to embed.");
  }
  out.set(new TextEncoder().encode(hex.padEnd(SIGNATURE_BYTES * 2, "0")), contentsAt + 1);
  return out;
}

export async function signWithCertificate(
  bytes: Uint8Array,
  loaded: LoadedCertificate,
  opts: SignOptions = {},
  name?: string,
): Promise<Uint8Array> {
  const date = opts.date ?? new Date();
  const withHolder = await withPlaceholder(bytes, loaded.info.subject, { ...opts, date }, name);
  return embedSignature(withHolder, loaded, date);
}

// ── Self-signed certificate (for people without one) ─────────────────────────

export interface SelfSignedRequest {
  name: string;
  email?: string;
  organization?: string;
  password: string;
  years?: number;
}

/**
 * Create a self-signed document-signing certificate and return it as a .p12.
 * The key pair must be generated by the caller (WebCrypto in the browser is fast;
 * see digital-sign-browser.ts) and passed as a forge RSA key pair.
 */
export function createSelfSignedP12(
  keys: forge.pki.rsa.KeyPair,
  req: SelfSignedRequest,
  now = new Date(),
): { p12: Uint8Array; loaded: LoadedCertificate } {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  // random positive serial
  cert.serialNumber = "01" + forge.util.bytesToHex(forge.random.getBytesSync(15));
  cert.validity.notBefore = new Date(now.getTime() - 60_000);
  cert.validity.notAfter = new Date(now);
  cert.validity.notAfter.setFullYear(now.getFullYear() + (req.years ?? 3));
  // UTF8String so names like "Aïcha" survive (forge defaults to PrintableString).
  const utf8 = (shortName: string, value: string): forge.pki.CertificateField => ({
    shortName,
    value, // forge encodes UTF8String values itself
    valueTagClass: forge.asn1.Type.UTF8 as unknown as forge.asn1.Class,
  });
  const attrs: forge.pki.CertificateField[] = [utf8("CN", req.name)];
  if (req.organization) attrs.push(utf8("O", req.organization));
  if (req.email) attrs.push({ name: "emailAddress", value: req.email });
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
    // emailProtection + Adobe "Authentic Documents" + Microsoft document signing
    {
      name: "extKeyUsage",
      emailProtection: true,
      "1.2.840.113583.1.1.5": true,
      "1.3.6.1.4.1.311.10.3.12": true,
    },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], req.password, {
    algorithm: "aes256",
    friendlyName: req.name,
  });
  const p12 = fromBinary(forge.asn1.toDer(asn1).getBytes());
  // Re-read from DER so names are decoded exactly as readP12 will decode them.
  const parsed = normalizeNames(forge.pki.certificateFromAsn1(forge.pki.certificateToAsn1(cert)));
  return {
    p12,
    loaded: { info: describe(parsed), key: keys.privateKey, cert: parsed, chain: [] },
  };
}
