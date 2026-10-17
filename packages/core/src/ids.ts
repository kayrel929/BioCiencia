import { sha256 } from "./sha256.ts";
/**
 * Identificadores únicos ordenables en el tiempo (ULID, 26 caracteres Crockford base32).
 * Se usan para registros, eventos y dispositivos.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function ulid(timeMs: number = Date.now()): string {
  if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error("ulid: tiempo inválido");
  let time = "";
  let t = Math.floor(timeMs);
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD.charAt((rnd[i] ?? 0) % 32);
  return time + rand;
}

export function ulidTime(id: string): number {
  let t = 0;
  for (const ch of id.slice(0, 10)) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) throw new Error("ulid inválido");
    t = t * 32 + v;
  }
  return t;
}

/**
 * Identificador ULID «ligado» a una llave: los 16 caracteres aleatorios se reemplazan por
 * los primeros 80 bits de SHA-256(etiqueta | llave | tiempo). Sigue siendo un ULID válido, pero
 * solo el dueño de esa llave puede reclamarlo (falsificarlo exigiría 2^80 intentos).
 */
export function boundUlid(label: string, keyHex: string, timeMs: number = Date.now()): string {
  const time = ulid(timeMs).slice(0, 10);
  return time + boundSuffix(label, keyHex, time);
}

export function isBoundUlid(id: string, label: string, keyHex: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id) && id.slice(10) === boundSuffix(label, keyHex, id.slice(0, 10));
}

function boundSuffix(label: string, keyHex: string, time: string): string {
  const h = sha256(`${label}|${keyHex.toLowerCase()}|${time}`);
  // 16 caracteres × 5 bits = 80 bits tomados del inicio del hash
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const byte of h) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 16) {
      out += CROCKFORD.charAt((acc >>> (bits - 5)) & 31);
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
    if (out.length === 16) break;
  }
  return out;
}
