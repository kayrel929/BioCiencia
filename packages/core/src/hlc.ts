/**
 * Reloj lógico híbrido (HLC). Ordena cambios hechos en computadoras distintas
 * aunque sus relojes no estén sincronizados. Formato de texto ordenable:
 *   "<milisegundos 13 dígitos>-<contador 5 dígitos>-<deviceId>"
 */
export interface Hlc {
  ms: number;
  counter: number;
  node: string;
}

const MAX_DRIFT_MS = 5 * 60 * 1000; // se rechazan relojes adelantados más de 5 minutos

export function hlcNow(prev: Hlc | null, node: string, wallMs: number = Date.now()): Hlc {
  if (!prev || wallMs > prev.ms) return { ms: wallMs, counter: 0, node };
  return { ms: prev.ms, counter: prev.counter + 1, node };
}

/** Actualiza el reloj local al recibir un evento remoto. */
export function hlcReceive(local: Hlc, remote: Hlc, wallMs: number = Date.now()): Hlc {
  if (remote.ms - wallMs > MAX_DRIFT_MS) throw new Error("HLC: reloj remoto demasiado adelantado");
  const ms = Math.max(local.ms, remote.ms, wallMs);
  let counter = 0;
  if (ms === local.ms && ms === remote.ms) counter = Math.max(local.counter, remote.counter) + 1;
  else if (ms === local.ms) counter = local.counter + 1;
  else if (ms === remote.ms) counter = remote.counter + 1;
  return { ms, counter, node: local.node };
}

export function hlcToString(h: Hlc): string {
  return `${String(h.ms).padStart(13, "0")}-${String(h.counter).padStart(5, "0")}-${h.node}`;
}

export function hlcParse(s: string): Hlc {
  const m = s.match(/^(\d{13})-(\d{5})-(.+)$/);
  if (!m || !m[1] || !m[2] || !m[3]) throw new Error(`HLC inválido: ${s}`);
  return { ms: Number(m[1]), counter: Number(m[2]), node: m[3] };
}

/** Comparación total: primero tiempo, luego contador, luego dispositivo. */
export function hlcCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
