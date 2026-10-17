/**
 * Revisión de literatura estructurada (sin IA): pregunta, conceptos con sinónimos, estrategia booleana
 * para cada base de datos, cribado y conteos para el diagrama de flujo PRISMA 2020.
 */

export interface Concept {
  /** Nombre del concepto (p. ej. «Población», «Patógeno») */
  name: string;
  /** Sinónimos o términos equivalentes, en inglés para las bases internacionales */
  terms: string[];
}

export interface ReviewQuestion {
  /** Pregunta en lenguaje natural */
  question: string;
  /** Esquema usado: PICO (intervención) o PEO (exposición), o libre */
  framework: "pico" | "peo" | "libre";
  concepts: Concept[];
}

export type ReviewEngine = "pubmed" | "europepmc" | "simple";

const clean = (t: string) => t.trim().replace(/["“”]/g, "").replace(/\s+/g, " ");

/** Términos válidos de un concepto (sin vacíos ni repetidos). */
export function conceptTerms(c: Concept): string[] {
  const seen = new Set<string>();
  return c.terms.map(clean).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

/**
 * Estrategia booleana: sinónimos con OR dentro de cada concepto y AND entre conceptos.
 *  - PubMed: título/resumen con [tiab]; un asterisco final se conserva como truncamiento.
 *  - Europe PMC: TITLE_ABS:"…" (verificado en la API real).
 *  - simple: para fuentes sin lógica booleana (Crossref, DOAJ): el primer término de cada concepto.
 */
export function buildStrategy(q: ReviewQuestion, engine: ReviewEngine): string {
  const groups = q.concepts.map(conceptTerms).filter((ts) => ts.length);
  if (!groups.length) return "";
  if (engine === "simple") return groups.map((ts) => ts[0]).join(" ");
  const term = (t: string) => {
    const trunc = t.endsWith("*");
    const base = trunc ? t.slice(0, -1) : t;
    if (engine === "pubmed") return trunc ? `${base}*[tiab]` : `"${base}"[tiab]`;
    return trunc ? `TITLE_ABS:${base}*` : `TITLE_ABS:"${base}"`;
  };
  return groups.map((ts) => (ts.length === 1 ? term(ts[0]!) : `(${ts.map(term).join(" OR ")})`)).join(" AND ");
}

export type Decision = "pending" | "include" | "exclude";

export const EXCLUSION_REASONS = [
  "No trata el tema",
  "Otra población, cultivo u organismo",
  "Otro tipo de estudio",
  "Otro resultado o variable",
  "Idioma",
  "Sin texto completo",
  "Otro",
] as const;

export interface SourceRun {
  source: string;
  label: string;
  /** Total que informó la base de datos */
  found: number;
  /** Registros traídos para el cribado */
  retrieved: number;
  query: string;
  error?: string | null;
  skipped?: string | null;
}

export interface PrismaCounts {
  identified: { source: string; label: string; found: number; retrieved: number }[];
  retrieved: number;
  duplicates: number;
  screened: number;
  excluded: number;
  excludedByReason: { reason: string; n: number }[];
  pending: number;
  included: number;
}

export function prismaCounts(runs: SourceRun[], records: { decision: Decision; reason?: string | null }[]): PrismaCounts {
  const ok = runs.filter((r) => !r.error && !r.skipped);
  const retrieved = ok.reduce((n, r) => n + r.retrieved, 0);
  const screened = records.length;
  const excluded = records.filter((r) => r.decision === "exclude");
  const byReason = new Map<string, number>();
  for (const r of excluded) byReason.set(r.reason || "Sin motivo", (byReason.get(r.reason || "Sin motivo") ?? 0) + 1);
  return {
    identified: ok.map((r) => ({ source: r.source, label: r.label, found: r.found, retrieved: r.retrieved })),
    retrieved,
    duplicates: Math.max(retrieved - screened, 0),
    screened,
    excluded: excluded.length,
    excludedByReason: [...byReason].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    pending: records.filter((r) => r.decision === "pending").length,
    included: records.filter((r) => r.decision === "include").length,
  };
}

/** Texto para la sección de métodos (estrategia reproducible). */
export function methodsText(q: ReviewQuestion, runs: SourceRun[], date: string, filters: { yearFrom?: number | null; yearTo?: number | null; extra?: string[] }): string {
  const lines: string[] = [];
  lines.push(`Pregunta: ${q.question || "(sin redactar)"}`);
  lines.push(`Fecha de búsqueda: ${date}.`);
  const years = filters.yearFrom || filters.yearTo ? `${filters.yearFrom ?? "…"}–${filters.yearTo ?? "…"}` : "sin límite";
  lines.push(`Años: ${years}.${filters.extra?.length ? ` Filtros: ${filters.extra.join("; ")}.` : ""}`);
  lines.push("Estrategias:");
  for (const r of runs) {
    const status = r.error ? `error: ${r.error}` : r.skipped ? `omitida: ${r.skipped}` : `${r.found.toLocaleString("es")} resultados; ${r.retrieved} recuperados para cribado`;
    lines.push(`- ${r.label}: ${r.query} (${status})`);
  }
  return lines.join("\n");
}
