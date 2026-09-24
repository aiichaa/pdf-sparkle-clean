// Browser-only: make an RSA key pair with WebCrypto (native, fast) and hand it to
// node-forge as a forge key pair. The private key never leaves this tab except
// inside the password-protected .p12 the user downloads.
import forge from "node-forge";

export async function generateRsaKeyPair(bits = 2048): Promise<forge.pki.rsa.KeyPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: bits,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = "";
  for (const b of pkcs8) bin += String.fromCharCode(b);
  pkcs8.fill(0);
  const privateKey = forge.pki.privateKeyFromAsn1(
    forge.asn1.fromDer(bin),
  ) as forge.pki.rsa.PrivateKey;
  const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  return { privateKey, publicKey };
}
