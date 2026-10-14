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
