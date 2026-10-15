/**
 * Tablas de datos pegadas desde Excel o leídas de CSV. Se reconoce el separador
 * (tabulador, punto y coma o coma) y la coma decimal habitual en Ecuador y Latinoamérica.
 */

export interface Column {
  name: string;
  kind: "number" | "text";
  /** Valores como texto original (vacío = dato faltante) */
  raw: string[];
  /** Valores numéricos (NaN si falta o no es número) */
  num: number[];
}

export interface Table {
  columns: Column[];
  rows: number;
  delimiter: string;
  decimalComma: boolean;
  warnings: string[];
}

function splitLine(line: string, d: string): string[] {
  if (d === "\t") return line.split("\t");
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseTable(text: string): Table {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("Pegue al menos una fila de encabezados y una fila de datos.");
  const head = lines[0]!;
  const delimiter = head.includes("\t") ? "\t" : head.includes(";") ? ";" : ",";
  const header = splitLine(head, delimiter).map((h, i) => h.trim() || `Columna ${i + 1}`);
  const body = lines.slice(1).map((l) => splitLine(l, delimiter).map((c) => c.trim()));
  const warnings: string[] = [];
  const bad = body.filter((r) => r.length !== header.length).length;
  if (bad) warnings.push(`${bad} fila(s) tienen un número de columnas distinto al encabezado; las celdas faltantes se tratan como vacías.`);
  // Coma decimal: con separador «;» o tabulador y valores tipo 12,5
  const decimalComma = delimiter !== "," && body.some((r) => r.some((c) => /^-?\d+,\d+$/.test(c)));
  const toNum = (s: string): number => {
    if (s === "" || /^(na|n\/a|nd|-|\.)$/i.test(s)) return NaN;
    let t = s.replace(/\s/g, "");
    if (decimalComma) t = t.replace(/\./g, "").replace(",", ".");
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN;
  };
  const columns: Column[] = header.map((name, j) => {
    const raw = body.map((r) => r[j] ?? "");
    const num = raw.map(toNum);
    const filled = raw.filter((v) => v !== "").length;
    const numeric = num.filter((v) => !Number.isNaN(v)).length;
    return { name, kind: filled > 0 && numeric === filled ? "number" : "text", raw, num };
  });
  return { columns, rows: body.length, delimiter, decimalComma, warnings };
}

/** Filas donde todas las columnas pedidas tienen dato (se descartan las incompletas). */
export function completeRows(t: Table, cols: string[]): { index: number[]; dropped: number } {
  const cs = cols.map((c) => t.columns.find((x) => x.name === c)).filter((c): c is Column => !!c);
  const index: number[] = [];
  for (let i = 0; i < t.rows; i++) {
    if (cs.every((c) => (c.kind === "number" ? !Number.isNaN(c.num[i]!) : c.raw[i] !== ""))) index.push(i);
  }
  return { index, dropped: t.rows - index.length };
}

/** p con formato científico habitual: «p < 0,001», «p = 0,016». */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return p < 0.001 ? "< 0,001" : p.toFixed(3).replace(".", ",");
}

export function fmt(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  const d = a !== 0 && a < 0.01 ? 4 : digits;
  return x.toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export function stars(p: number): string {
  return p < 0.001 ? "***" : p < 0.01 ? "**" : p < 0.05 ? "*" : "ns";
}
