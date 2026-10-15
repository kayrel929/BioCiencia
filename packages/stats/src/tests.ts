import { pchisqUpper, pfUpper, pnorm, pnormUpper, ptTwoSided, ptukey, qnorm, qt } from "./dist.ts";

/**
 * Pruebas estadísticas habituales en agronomía y biología. Cada función devuelve números
 * (no texto) para poder verificarlos contra SciPy; la interpretación en español está en report.ts.
 */

export const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
export const mean = (x: number[]) => sum(x) / x.length;
export function variance(x: number[]): number {
  const m = mean(x);
  return sum(x.map((v) => (v - m) ** 2)) / (x.length - 1);
}
export const sd = (x: number[]) => Math.sqrt(variance(x));

/** Cuantil con el método 7 (el de R y Excel: PERCENTIL.INC). */
export function quantile(x: number[], p: number): number {
  const s = [...x].sort((a, b) => a - b);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  return s[lo]! + (h - lo) * ((s[Math.min(lo + 1, s.length - 1)] ?? s[lo]!) - s[lo]!);
}

export interface Describe {
  n: number;
  mean: number;
  sd: number;
  se: number;
  cv: number; // %
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  ci95: [number, number];
}

export function describe(x: number[]): Describe {
  const n = x.length;
  const m = mean(x);
  const s = n > 1 ? sd(x) : NaN;
  const se = s / Math.sqrt(n);
  const tcrit = n > 1 ? qt(0.975, n - 1) : NaN;
  return {
    n, mean: m, sd: s, se, cv: (s / m) * 100,
    min: Math.min(...x), q1: quantile(x, 0.25), median: quantile(x, 0.5), q3: quantile(x, 0.75), max: Math.max(...x),
    ci95: [m - tcrit * se, m + tcrit * se],
  };
}

// ---------------- Comparación de dos grupos ----------------

export interface TTest {
  t: number;
  df: number;
  p: number;
  meanDiff: number;
  ci95: [number, number];
}

/** t de Student para dos muestras independientes. Por defecto Welch (no supone varianzas iguales). */
export function tTestIndependent(a: number[], b: number[], equalVar = false): TTest {
  const na = a.length;
  const nb = b.length;
  const va = variance(a);
  const vb = variance(b);
  const diff = mean(a) - mean(b);
  let se: number;
  let df: number;
  if (equalVar) {
    df = na + nb - 2;
    const sp = ((na - 1) * va + (nb - 1) * vb) / df;
    se = Math.sqrt(sp * (1 / na + 1 / nb));
  } else {
    se = Math.sqrt(va / na + vb / nb);
    df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  }
  const t = diff / se;
  const tc = qt(0.975, df);
  return { t, df, p: ptTwoSided(t, df), meanDiff: diff, ci95: [diff - tc * se, diff + tc * se] };
}

/** t pareada (mismas unidades medidas dos veces). */
export function tTestPaired(a: number[], b: number[]): TTest {
  if (a.length !== b.length) throw new Error("Las dos columnas deben tener el mismo número de datos (pareados).");
  const d = a.map((v, i) => v - b[i]!);
  const n = d.length;
  const se = sd(d) / Math.sqrt(n);
  const t = mean(d) / se;
  const tc = qt(0.975, n - 1);
  return { t, df: n - 1, p: ptTwoSided(t, n - 1), meanDiff: mean(d), ci95: [mean(d) - tc * se, mean(d) + tc * se] };
}

// ---------------- ANOVA ----------------

export interface AnovaRow {
  source: string;
  df: number;
  ss: number;
  ms: number;
  f: number | null;
  p: number | null;
}

export interface AnovaResult {
  table: AnovaRow[];
  /** Cuadrado medio y gl del error (para Tukey) */
  mse: number;
  dfError: number;
  /** Residuos (para comprobar normalidad) */
  residuals: number[];
  cv: number; // coeficiente de variación del experimento, %
  grandMean: number;
}

function groupBy(y: number[], g: string[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  y.forEach((v, i) => {
    const k = g[i]!;
    m.set(k, [...(m.get(k) ?? []), v]);
  });
  return m;
}

/** ANOVA de una vía (diseño completamente al azar, DCA). Acepta grupos desiguales. */
export function anovaOneWay(y: number[], g: string[]): AnovaResult {
  const groups = groupBy(y, g);
  const gm = mean(y);
  let ssb = 0;
  let ssw = 0;
  const residuals: number[] = [];
  const gmeans = new Map<string, number>();
  for (const [k, v] of groups) gmeans.set(k, mean(v));
  y.forEach((v, i) => residuals.push(v - gmeans.get(g[i]!)!));
  for (const [k, v] of groups) {
    ssb += v.length * (gmeans.get(k)! - gm) ** 2;
    ssw += sum(v.map((x) => (x - gmeans.get(k)!) ** 2));
  }
  const dfb = groups.size - 1;
  const dfw = y.length - groups.size;
  const msb = ssb / dfb;
  const msw = ssw / dfw;
  const f = msb / msw;
  return {
    table: [
      { source: "Tratamientos", df: dfb, ss: ssb, ms: msb, f, p: pfUpper(f, dfb, dfw) },
      { source: "Error", df: dfw, ss: ssw, ms: msw, f: null, p: null },
      { source: "Total", df: y.length - 1, ss: ssb + ssw, ms: NaN, f: null, p: null },
    ],
    mse: msw, dfError: dfw, residuals, cv: (Math.sqrt(msw) / gm) * 100, grandMean: gm,
  };
}

/** ANOVA de bloques completos al azar (DBCA): tratamiento + bloque, una observación por celda. */
export function anovaRcbd(y: number[], trt: string[], block: string[]): AnovaResult {
  const t = [...new Set(trt)];
  const b = [...new Set(block)];
  const cell = new Map<string, number>();
  y.forEach((v, i) => {
    const k = `${trt[i]}\u0000${block[i]}`;
    if (cell.has(k)) throw new Error(`El tratamiento «${trt[i]}» aparece dos veces en el bloque «${block[i]}». En DBCA debe haber una observación por tratamiento y bloque.`);
    cell.set(k, v);
  });
  if (cell.size !== t.length * b.length) throw new Error(`Faltan datos: se esperaban ${t.length * b.length} observaciones (${t.length} tratamientos × ${b.length} bloques) y hay ${cell.size}. El DBCA necesita el diseño completo.`);
  const gm = mean(y);
  const tm = new Map(t.map((k) => [k, mean(y.filter((_, i) => trt[i] === k))]));
  const bm = new Map(b.map((k) => [k, mean(y.filter((_, i) => block[i] === k))]));
  const sst = b.length * sum(t.map((k) => (tm.get(k)! - gm) ** 2));
  const ssb = t.length * sum(b.map((k) => (bm.get(k)! - gm) ** 2));
  const sstotal = sum(y.map((v) => (v - gm) ** 2));
  const sse = sstotal - sst - ssb;
  const dft = t.length - 1;
  const dfb = b.length - 1;
  const dfe = dft * dfb;
  const mse = sse / dfe;
  const residuals = y.map((v, i) => v - tm.get(trt[i]!)! - bm.get(block[i]!)! + gm);
  return {
    table: [
      { source: "Tratamientos", df: dft, ss: sst, ms: sst / dft, f: sst / dft / mse, p: pfUpper(sst / dft / mse, dft, dfe) },
      { source: "Bloques", df: dfb, ss: ssb, ms: ssb / dfb, f: ssb / dfb / mse, p: pfUpper(ssb / dfb / mse, dfb, dfe) },
      { source: "Error", df: dfe, ss: sse, ms: mse, f: null, p: null },
      { source: "Total", df: y.length - 1, ss: sstotal, ms: NaN, f: null, p: null },
    ],
    mse, dfError: dfe, residuals, cv: (Math.sqrt(mse) / gm) * 100, grandMean: gm,
  };
}

/** Factorial A × B en DCA, balanceado (mismo número de repeticiones en cada combinación). */
export function anovaFactorial(y: number[], a: string[], b: string[], nameA = "Factor A", nameB = "Factor B"): AnovaResult {
  const la = [...new Set(a)];
  const lb = [...new Set(b)];
  const cells = new Map<string, number[]>();
  y.forEach((v, i) => {
    const k = `${a[i]}\u0000${b[i]}`;
    cells.set(k, [...(cells.get(k) ?? []), v]);
  });
  const r = cells.values().next().value?.length ?? 0;
  if (cells.size !== la.length * lb.length || [...cells.values()].some((c) => c.length !== r) || r < 2) {
    throw new Error("El factorial necesita todas las combinaciones A×B con el mismo número de repeticiones (al menos 2).");
  }
  const gm = mean(y);
  const am = new Map(la.map((k) => [k, mean(y.filter((_, i) => a[i] === k))]));
  const bm = new Map(lb.map((k) => [k, mean(y.filter((_, i) => b[i] === k))]));
  const ssa = lb.length * r * sum(la.map((k) => (am.get(k)! - gm) ** 2));
  const ssb = la.length * r * sum(lb.map((k) => (bm.get(k)! - gm) ** 2));
  let sscells = 0;
  let sse = 0;
  const residuals: number[] = [];
  for (const [k, v] of cells) {
    const cm = mean(v);
    sscells += v.length * (cm - gm) ** 2;
    sse += sum(v.map((x) => (x - cm) ** 2));
  }
  y.forEach((v, i) => residuals.push(v - mean(cells.get(`${a[i]}\u0000${b[i]}`)!)));
  const ssab = sscells - ssa - ssb;
  const dfa = la.length - 1;
  const dfb = lb.length - 1;
  const dfab = dfa * dfb;
  const dfe = la.length * lb.length * (r - 1);
  const mse = sse / dfe;
  const row = (source: string, ss: number, df: number): AnovaRow => ({ source, df, ss, ms: ss / df, f: ss / df / mse, p: pfUpper(ss / df / mse, df, dfe) });
  return {
    table: [
      row(nameA, ssa, dfa),
      row(nameB, ssb, dfb),
      row(`${nameA} × ${nameB}`, ssab, dfab),
      { source: "Error", df: dfe, ss: sse, ms: mse, f: null, p: null },
      { source: "Total", df: y.length - 1, ss: sum(y.map((v) => (v - gm) ** 2)), ms: NaN, f: null, p: null },
    ],
    mse, dfError: dfe, residuals, cv: (Math.sqrt(mse) / gm) * 100, grandMean: gm,
  };
}

// ---------------- Tukey HSD y letras ----------------

export interface TukeyPair {
  a: string;
  b: string;
  diff: number;
  p: number;
  ci95: [number, number];
}

export interface TukeyResult {
  groups: { name: string; n: number; mean: number; letters: string }[];
  pairs: TukeyPair[];
}

/** Tukey HSD (Tukey-Kramer si los grupos son desiguales) con el CME y gl del error del ANOVA. */
export function tukeyHsd(y: number[], g: string[], mse: number, dfError: number, alpha = 0.05): TukeyResult {
  const groups = groupBy(y, g);
  const names = [...groups.keys()];
  const k = names.length;
  const stats = names.map((n) => ({ name: n, n: groups.get(n)!.length, mean: mean(groups.get(n)!) }));
  const qcrit = qtukey(1 - alpha, k, dfError);
  const pairs: TukeyPair[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const A = stats[i]!;
      const B = stats[j]!;
      const se = Math.sqrt((mse / 2) * (1 / A.n + 1 / B.n));
      const diff = A.mean - B.mean;
      const q = Math.abs(diff) / se;
      pairs.push({ a: A.name, b: B.name, diff, p: 1 - ptukey(q, k, dfError), ci95: [diff - qcrit * se, diff + qcrit * se] });
    }
  }
  const letters = compactLetters(stats.map((s) => ({ name: s.name, mean: s.mean })), pairs.filter((p) => p.p < alpha).map((p) => [p.a, p.b] as [string, string]));
  return { groups: stats.map((s) => ({ ...s, letters: letters.get(s.name)! })).sort((x, y2) => y2.mean - x.mean), pairs };
}

/** Cuantil del rango studentizado (bisección sobre ptukey). */
export function qtukey(p: number, k: number, df: number): number {
  let lo = 0;
  let hi = 50;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (ptukey(mid, k, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-9) break;
  }
  return (lo + hi) / 2;
}

/**
 * Letras de agrupación (algoritmo «insertar y absorber», Piepho 2004): medias que comparten
 * una letra no difieren significativamente. La «a» se asigna a la media mayor.
 */
export function compactLetters(items: { name: string; mean: number }[], different: [string, string][]): Map<string, string> {
  const order = [...items].sort((a, b) => b.mean - a.mean).map((x) => x.name);
  let cols: Set<string>[] = [new Set(order)];
  for (const [x, y] of different) {
    const next: Set<string>[] = [];
    for (const c of cols) {
      if (c.has(x) && c.has(y)) {
        const c1 = new Set(c);
        c1.delete(x);
        const c2 = new Set(c);
        c2.delete(y);
        next.push(c1, c2);
      } else next.push(c);
    }
    // absorber: quitar columnas contenidas en otra
    cols = next.filter((c, i) => !next.some((d, j) => j !== i && [...c].every((v) => d.has(v)) && (d.size > c.size || j < i)));
  }
  cols.sort((c1, c2) => Math.min(...[...c1].map((n) => order.indexOf(n))) - Math.min(...[...c2].map((n) => order.indexOf(n))));
  const out = new Map(order.map((n) => [n, ""]));
  cols.forEach((c, i) => {
    const letter = String.fromCharCode(97 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");
    for (const n of order) if (c.has(n)) out.set(n, out.get(n)! + letter);
  });
  return out;
}

// ---------------- Supuestos ----------------

/** Levene centrado en la mediana (Brown-Forsythe), el mismo de SciPy por defecto. */
export function levene(y: number[], g: string[]): { f: number; df1: number; df2: number; p: number } {
  const groups = groupBy(y, g);
  const z: number[] = [];
  const zg: string[] = [];
  for (const [k, v] of groups) {
    const med = quantile(v, 0.5);
    for (const x of v) {
      z.push(Math.abs(x - med));
      zg.push(k);
    }
  }
  const a = anovaOneWay(z, zg);
  const row = a.table[0]!;
  return { f: row.f!, df1: row.df, df2: a.dfError, p: row.p! };
}

/** Shapiro-Wilk (algoritmo AS R94 de Royston, el de R y SciPy). 3 ≤ n ≤ 5000. */
export function shapiroWilk(xIn: number[]): { w: number; p: number } {
  const x = [...xIn].sort((a, b) => a - b);
  const n = x.length;
  if (n < 3) throw new Error("Shapiro-Wilk necesita al menos 3 datos.");
  if (n > 5000) throw new Error("Shapiro-Wilk admite hasta 5000 datos.");
  const range = x[n - 1]! - x[0]!;
  if (range < 1e-19) throw new Error("Todos los datos son iguales: no se puede evaluar la normalidad.");
  const nn2 = Math.floor(n / 2);
  const a = new Array<number>(nn2 + 1).fill(0);
  const poly = (c: number[], v: number) => c.reduceRight((acc, ci) => acc * v + ci, 0);
  const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
  const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
  if (n === 3) a[1] = Math.SQRT1_2;
  else {
    const an25 = n + 0.25;
    const m: number[] = [0];
    let summ2 = 0;
    for (let i = 1; i <= nn2; i++) {
      m[i] = qnorm((i - 0.375) / an25);
      summ2 += m[i]! ** 2;
    }
    summ2 *= 2;
    const ssumm2 = Math.sqrt(summ2);
    const rsn = 1 / Math.sqrt(n);
    const a1 = poly(c1, rsn) - m[1]! / ssumm2;
    let i1: number;
    let fac: number;
    if (n > 5) {
      i1 = 3;
      const a2 = -m[2]! / ssumm2 + poly(c2, rsn);
      fac = Math.sqrt((summ2 - 2 * m[1]! ** 2 - 2 * m[2]! ** 2) / (1 - 2 * a1 ** 2 - 2 * a2 ** 2));
      a[2] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * m[1]! ** 2) / (1 - 2 * a1 ** 2));
    }
    a[1] = a1;
    for (let i = i1; i <= nn2; i++) a[i] = -m[i]! / fac;
  }
  const xm = mean(x);
  const ssq = sum(x.map((v) => (v - xm) ** 2));
  let b = 0;
  for (let i = 1; i <= nn2; i++) b += a[i]! * (x[n - i]! - x[i - 1]!);
  const w = Math.min((b * b) / ssq, 1);
  if (n === 3) {
    const p = Math.max(0, (6 / Math.PI) * (Math.asin(Math.sqrt(w)) - Math.PI / 3));
    return { w, p: Math.min(p, 1) };
  }
  let y = Math.log(1 - w);
  const xx = Math.log(n);
  let mu: number;
  let s: number;
  if (n <= 11) {
    const gamma = poly([-2.273, 0.459], n);
    if (y >= gamma) return { w, p: 1e-99 };
    y = -Math.log(gamma - y);
    mu = poly([0.544, -0.39978, 0.025054, -6.714e-4], n);
    s = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], n));
  } else {
    mu = poly([-1.5861, -0.31082, -0.083751, 0.0038915], xx);
    s = Math.exp(poly([-0.4803, -0.082676, 0.0030302], xx));
  }
  return { w, p: pnormUpper((y - mu) / s) };
}

// ---------------- No paramétricas ----------------

/** Rangos promedio (empates reciben el rango medio). */
export function ranks(x: number[]): number[] {
  const idx = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(x.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]![1]] = avg;
    i = j + 1;
  }
  return r;
}

/** Kruskal-Wallis con corrección por empates (χ², gl = k − 1). */
export function kruskalWallis(y: number[], g: string[]): { h: number; df: number; p: number } {
  const r = ranks(y);
  const n = y.length;
  const groups = groupBy(r, g);
  let h = 0;
  for (const v of groups.values()) h += sum(v) ** 2 / v.length;
  h = (12 / (n * (n + 1))) * h - 3 * (n + 1);
  const counts = new Map<number, number>();
  for (const v of y) counts.set(v, (counts.get(v) ?? 0) + 1);
  const ties = sum([...counts.values()].map((t) => t ** 3 - t));
  const corr = 1 - ties / (n ** 3 - n);
  h /= corr;
  const df = groups.size - 1;
  return { h, df, p: pchisqUpper(h, df) };
}

// ---------------- Relación entre variables ----------------

export function pearson(x: number[], y: number[]): { r: number; t: number; df: number; p: number } {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  x.forEach((v, i) => {
    sxy += (v - mx) * (y[i]! - my);
    sxx += (v - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  });
  const r = sxy / Math.sqrt(sxx * syy);
  const df = x.length - 2;
  const t = (r * Math.sqrt(df)) / Math.sqrt(Math.max(1e-300, 1 - r * r));
  return { r, t, df, p: Math.abs(r) >= 1 ? 0 : ptTwoSided(t, df) };
}

export function spearman(x: number[], y: number[]): { rho: number; p: number } {
  const r = pearson(ranks(x), ranks(y));
  return { rho: r.r, p: r.p };
}

export interface Regression {
  intercept: number;
  slope: number;
  r2: number;
  seSlope: number;
  seIntercept: number;
  t: number;
  df: number;
  p: number;
  slopeCi95: [number, number];
}

/** Regresión lineal simple y = a + b·x por mínimos cuadrados. */
export function linearRegression(x: number[], y: number[]): Regression {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  x.forEach((v, i) => {
    sxy += (v - mx) * (y[i]! - my);
    sxx += (v - mx) ** 2;
  });
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const sse = sum(y.map((v, i) => (v - intercept - slope * x[i]!) ** 2));
  const sst = sum(y.map((v) => (v - my) ** 2));
  const df = n - 2;
  const s2 = sse / df;
  const seSlope = Math.sqrt(s2 / sxx);
  const seIntercept = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  const t = slope / seSlope;
  const tc = qt(0.975, df);
  return { intercept, slope, r2: 1 - sse / sst, seSlope, seIntercept, t, df, p: ptTwoSided(t, df), slopeCi95: [slope - tc * seSlope, slope + tc * seSlope] };
}

/** χ² de independencia en una tabla de contingencia (sin corrección de Yates). */
export function chiSquare(table: number[][]): { chi2: number; df: number; p: number; expected: number[][]; lowExpected: number } {
  const rows = table.map((r) => sum(r));
  const cols = table[0]!.map((_, j) => sum(table.map((r) => r[j]!)));
  const n = sum(rows);
  const expected = table.map((_, i) => cols.map((c) => (rows[i]! * c) / n));
  let chi2 = 0;
  let low = 0;
  table.forEach((r, i) =>
    r.forEach((o, j) => {
      const e = expected[i]![j]!;
      chi2 += (o - e) ** 2 / e;
      if (e < 5) low++;
    }),
  );
  const df = (table.length - 1) * (table[0]!.length - 1);
  return { chi2, df, p: pchisqUpper(chi2, df), expected, lowExpected: low };
}

export { pnorm };
