/**
 * Indicadores de citas al estilo de los perfiles académicos (definiciones públicas y estándar):
 *  - Índice h: el mayor h tal que h publicaciones tienen al menos h citas cada una (Hirsch, 2005).
 *  - Índice i10: número de publicaciones con al menos 10 citas.
 *  - «Desde AAAA»: las mismas medidas contando solo las citas recibidas desde ese año.
 * Se calculan sobre los datos de citas que BioCiencia pudo obtener de fuentes abiertas; no son los de Google Académico.
 */

export function hIndex(counts: number[]): number {
  const s = counts.filter((c) => Number.isFinite(c) && c > 0).sort((a, b) => b - a);
  let h = 0;
  while (h < s.length && s[h]! >= h + 1) h++;
  return h;
}

export const i10Index = (counts: number[]) => counts.filter((c) => c >= 10).length;

export interface CitationHistory {
  /** Citas totales que informa la fuente */
  total: number;
  /** Citas por año de la publicación que cita; las de año desconocido no entran aquí */
  byYear: Record<string, number>;
}

export interface ScholarMetrics {
  sinceYear: number;
  citations: { all: number; since: number };
  h: { all: number; since: number };
  i10: { all: number; since: number };
  /** Citas por año (todas las publicaciones), ordenado */
  perYear: { year: number; n: number }[];
  /** Publicaciones con datos de citas */
  works: number;
}

export function citationsSince(h: CitationHistory, year: number): number {
  return Object.entries(h.byYear).reduce((n, [y, c]) => (Number(y) >= year ? n + c : n), 0);
}

export function scholarMetrics(histories: CitationHistory[], sinceYear: number): ScholarMetrics {
  const all = histories.map((h) => h.total);
  const since = histories.map((h) => citationsSince(h, sinceYear));
  const years = new Map<number, number>();
  for (const h of histories) for (const [y, n] of Object.entries(h.byYear)) years.set(Number(y), (years.get(Number(y)) ?? 0) + n);
  return {
    sinceYear,
    citations: { all: all.reduce((a, b) => a + b, 0), since: since.reduce((a, b) => a + b, 0) },
    h: { all: hIndex(all), since: hIndex(since) },
    i10: { all: i10Index(all), since: i10Index(since) },
    perYear: [...years].map(([year, n]) => ({ year, n })).sort((a, b) => a.year - b.year),
    works: histories.length,
  };
}
