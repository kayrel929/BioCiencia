/**
 * Firmas Ed25519 con la Web Crypto API nativa (Node 22, WebView2/Chromium, Firefox, Safari).
 * No se usa ninguna librería externa de criptografía.
 */

/** Llaves Ed25519 de un investigador, en hexadecimal: pública (raw, 32 bytes) y privada (PKCS#8). */
export interface KeyPair {
  publicKey: string;
  secretKey: string;
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function fromHex(h: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]*$/i.test(h) || h.length % 2) throw new Error("hexadecimal inválido");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const ALG = { name: "Ed25519" } as const;
const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("Este navegador no ofrece criptografía segura (Web Crypto). Use una versión actual.");
  return s;
};

export async function generateKeyPair(): Promise<KeyPair> {
  const k = (await subtle().generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle().exportKey("raw", k.publicKey));
  const sec = new Uint8Array(await subtle().exportKey("pkcs8", k.privateKey));
  return { publicKey: toHex(pub), secretKey: toHex(sec) };
}

/** JSON canónico: claves ordenadas, sin espacios. La firma depende solo del contenido. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

const enc = new TextEncoder();
const signKeys = new Map<string, Promise<CryptoKey>>();
const verifyKeys = new Map<string, Promise<CryptoKey>>();

function signingKey(secretHex: string): Promise<CryptoKey> {
  let k = signKeys.get(secretHex);
  if (!k) {
    k = subtle().importKey("pkcs8", fromHex(secretHex), ALG, false, ["sign"]);
    signKeys.set(secretHex, k);
  }
  return k;
}

function verifyingKey(publicHex: string): Promise<CryptoKey> {
  let k = verifyKeys.get(publicHex);
  if (!k) {
    k = subtle().importKey("raw", fromHex(publicHex), ALG, false, ["verify"]);
    k.catch(() => verifyKeys.delete(publicHex));
    verifyKeys.set(publicHex, k);
  }
  return k;
}

export async function signText(text: string, secretKeyHex: string): Promise<string> {
  const sig = await subtle().sign(ALG, await signingKey(secretKeyHex), enc.encode(text));
  return toHex(new Uint8Array(sig));
}

export async function verifyText(text: string, sigHex: string, publicKeyHex: string): Promise<boolean> {
  try {
    return await subtle().verify(ALG, await verifyingKey(publicKeyHex), fromHex(sigHex), enc.encode(text));
  } catch {
    return false;
  }
}

/** Comprueba que una llave privada corresponde a la pública (al restaurar o importar). */
export async function keyPairMatches(k: KeyPair): Promise<boolean> {
  try {
    const sig = await signText("biociencia-check", k.secretKey);
    return await verifyText("biociencia-check", sig, k.publicKey);
  } catch {
    return false;
  }
}
