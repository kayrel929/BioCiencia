/**
 * Seguridad sin dependencias (WebCrypto, disponible en navegadores modernos, Tauri y Node 20+).
 *
 *  - Copias de seguridad cifradas con contraseña: PBKDF2-SHA-256 (600 000 iteraciones, recomendación
 *    OWASP 2023) para derivar la llave y AES-256-GCM para cifrar y detectar cualquier alteración.
 *    La contraseña nunca se guarda: si se olvida, la copia no se puede abrir.
 *  - `redact`: quita datos sensibles de mensajes que se guardan en registros o se muestran en errores.
 */

export const ENCRYPTED_FORMAT = "biociencia-cifrada-1";
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 10;

export interface EncryptedFile {
  format: typeof ENCRYPTED_FORMAT;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  cipher: "AES-256-GCM";
  salt: string;
  iv: string;
  data: string;
  createdAt: string;
}

const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (/^(.)\1*$/.test(pw)) return "La contraseña no puede ser un solo carácter repetido.";
  return null;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptText(plain: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<EncryptedFile> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return { format: ENCRYPTED_FORMAT, kdf: "PBKDF2-SHA256", iterations, cipher: "AES-256-GCM", salt: b64(salt), iv: b64(iv), data: b64(data), createdAt: new Date().toISOString() };
}

export function isEncryptedFile(x: unknown): x is EncryptedFile {
  return !!x && typeof x === "object" && (x as EncryptedFile).format === ENCRYPTED_FORMAT;
}

export async function decryptText(file: EncryptedFile, password: string): Promise<string> {
  if (!isEncryptedFile(file) || file.kdf !== "PBKDF2-SHA256" || file.cipher !== "AES-256-GCM") throw new Error("Formato de archivo cifrado desconocido.");
  // Límites para que un archivo manipulado no bloquee la app con millones de iteraciones
  if (!Number.isInteger(file.iterations) || file.iterations < 100_000 || file.iterations > 10_000_000) throw new Error("El archivo cifrado tiene parámetros no válidos.");
  const key = await deriveKey(password, unb64(file.salt), file.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(file.iv) as BufferSource }, key, unb64(file.data) as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Contraseña incorrecta o archivo dañado.");
  }
}

// ---------------- Limpieza de registros ----------------

/**
 * Quita de un texto lo que no debe quedar en registros ni en mensajes de error:
 * correos, parámetros de URL sensibles, llaves y tokens largos, rutas de usuario de Windows.
 */
export function redact(text: string): string {
  return (
    text
      // Parámetros de consulta sensibles (?email=…, &api_key=…, &token=…)
      .replace(/([?&](?:e-?mail|mailto|api[_-]?key|key|token|access_token|password|pass|secret)=)[^&\s#"']*/gi, "$1[oculto]")
      // token=…, password: … fuera de una URL
      .replace(/(\b(?:token|access_token|api[_-]?key|password|passwd|secret|contraseña)\s*[=:]\s*)[^\s&,;"']+/giu, "$1[oculto]")
      // Encabezados de autorización
      .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;"']+/gi, "$1[oculto]")
      // Correos electrónicos
      .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, "[correo]")
      // Llaves y tokens (base64/hex largos, sin espacios)
      .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "[llave]")
      // Nombre de usuario en rutas de Windows y Unix
      .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/g, "$1[usuario]")
      .replace(/(\/(?:home|Users)\/)[^/\s]+/g, "$1[usuario]")
  );
}
