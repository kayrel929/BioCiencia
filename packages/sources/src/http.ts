import type { SourceName, Work } from "@biociencia/core";
import type { HttpGet, SortOrder } from "./openalex.ts";

/** Nombre visible de cada fuente. */
export const SOURCE_LABELS: Record<string, string> = {
  openalex: "OpenAlex",
  crossref: "Crossref",
  pubmed: "PubMed",
  europepmc: "Europe PMC",
  doaj: "DOAJ",
  unpaywall: "Unpaywall",
  orcid: "ORCID",
};

/** Error de una fuente externa, con un mensaje claro en español. */
export class SourceError extends Error {
  constructor(
    readonly source: string,
    message: string,
    readonly status: number | null,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

/** Parámetros comunes a las fuentes gratuitas. */
export interface FreeSearchParams {
  text: string;
  filters?: { yearFrom?: number | null; yearTo?: number | null; openAccess?: boolean };
  sort?: SortOrder;
  page?: number;
  perPage?: number;
}

export interface FreeSearchResult {
  source: SourceName;
  works: Work[];
  total: number;
  url: string;
  /** Solo OpenAlex: costo de la consulta y saldo gratuito del día */
  costUsd?: number | null;
  remainingUsd?: number | null;
}

export interface FreeSource {
  readonly id: SourceName;
  search(p: FreeSearchParams): Promise<FreeSearchResult>;
}

/** GET con tiempo límite y errores traducidos. Devuelve status y texto (no lanza en 404). */
export async function getText(
  http: HttpGet,
  source: string,
  url: string,
  timeoutMs = 20_000,
  accept = "application/json",
): Promise<{ status: number; text: string; headers: { get(n: string): string | null } }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const label = SOURCE_LABELS[source] ?? source;
  let res;
  try {
    res = await http(url, { signal: ctrl.signal, headers: { Accept: accept } });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new SourceError(
      source,
      aborted ? `${label} no respondió a tiempo.` : `No se pudo conectar con ${label}. Revise su conexión a internet.`,
      null,
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (res.status === 404) return { status: 404, text, headers: res.headers };
  if (!res.ok) {
    if (res.status === 429) throw new SourceError(source, `${label} pidió esperar un momento (demasiadas consultas seguidas).`, 429, text.slice(0, 300));
    if (res.status === 400) throw new SourceError(source, `${label} rechazó la consulta.`, 400, text.slice(0, 4000));
    throw new SourceError(source, `${label} respondió con un error (${res.status}).`, res.status, text.slice(0, 300));
  }
  return { status: res.status, text, headers: res.headers };
}

export function parseJson(source: string, text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError(source, `${SOURCE_LABELS[source] ?? source} devolvió una respuesta que no se pudo leer.`, null, text.slice(0, 200));
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodifica entidades HTML/XML (&amp; &#xe9; &#233;). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Quita etiquetas (JATS, HTML) y deja texto limpio de una sola línea por párrafo. */
export function stripTags(s: string | null | undefined): string {
  if (!s) return "";
  return decodeEntities(
    s
      .replace(/<(jats:)?title>\s*Abstract\s*<\/(jats:)?title>/gi, "")
      .replace(/<\/(jats:)?p>\s*/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    // Algunas fuentes envían las etiquetas escapadas (&lt;i&gt;): se quitan solo las de formato conocidas
    .replace(/<\/?(i|b|em|strong|sup|sub|italic|bold|u|sc|span)\b[^>]*>/gi, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Códigos de idioma de 3 letras (PubMed, Europe PMC) a 2 letras. */
const LANG3: Record<string, string> = { eng: "en", spa: "es", por: "pt", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", chi: "zh", jpn: "ja" };
export function lang2(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.toLowerCase();
  return c.length === 2 ? c : LANG3[c] ?? null;
}

export function clampPerPage(n: number | undefined, max: number): number {
  return Math.min(Math.max(n ?? 20, 1), max);
}
