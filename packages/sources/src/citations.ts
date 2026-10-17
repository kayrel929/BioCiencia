import { normalizeDoi, normalizePmid, type AuthorRef, type CitationHistory, type Work } from "@biociencia/core";
import { crossrefByDois } from "./crossref.ts";
import { EUROPEPMC_BASE } from "./europepmc.ts";
import { getText, parseJson, stripTags } from "./http.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * Red de citas («bola de nieve»): qué artículos cita una publicación (referencias) y cuáles la citan.
 * Fuentes gratuitas, verificadas el 2026-10-15 desde el navegador del usuario:
 *  - Europe PMC: /{fuente}/{id}/references y /citations, para artículos con PMID (con metadatos completos).
 *  - OpenCitations (índice abierto de citas, CC0): /index/v2/references|citations/doi:…, para cualquier DOI;
 *    devuelve solo identificadores, que se completan con Crossref.
 * No se inventa nada: si una fuente no tiene datos, se informa.
 */
export const OPENCITATIONS_BASE = "https://api.opencitations.net/index/v2";

export type CitationDirection = "references" | "citations";

export interface CitationResult {
  direction: CitationDirection;
  works: Work[];
  /** Total que informa la fuente (puede ser mayor que lo traído) */
  total: number;
  via: "europepmc" | "opencitations";
  /** Identificadores encontrados que no se pudieron completar (sin DOI o no están en Crossref) */
  unresolved: string[];
  url: string;
  /** Aviso cuando solo se pudo completar una parte */
  warning?: string | null;
}

/** «Deslandes L» o «Feng DX» → «Deslandes, D X» (apellido, iniciales) para que el formato de cita lo entienda. */
export function epmcAuthor(s: string): string {
  const t = s.trim();
  const m = t.match(/^(.+?)\s+([A-Z]{1,4})$/u);
  return m ? `${m[1]}, ${m[2]!.split("").join(" ")}` : t;
}

export function parseEuropePmcCitationItem(r: any, fetchedAt: string): Work {
  const authors: AuthorRef[] = String(r.authorString ?? "")
    .replace(/\.$/, "")
    .split(/,\s*/)
    .map((a) => a.trim())
    .filter((a) => a && a.toLowerCase() !== "et al")
    .map((a) => ({ name: epmcAuthor(a) }));
  const isMed = r.source === "MED";
  return {
    title: stripTags(r.title).replace(/\.$/, "") || "(sin título)",
    authors,
    year: r.pubYear ? Number(r.pubYear) : null,
    venue: r.journalAbbreviation ?? null,
    volume: r.volume ?? null,
    issue: r.issue ?? null,
    pages: r.pageInfo ?? null,
    doi: normalizeDoi(r.doi ?? null),
    pmid: isMed ? normalizePmid(String(r.id ?? "")) : null,
    citedByCount: typeof r.citedByCount === "number" ? r.citedByCount : null,
    landingUrl: r.id && r.source ? `https://europepmc.org/article/${r.source}/${r.id}` : null,
    source: "europepmc",
    fetchedAt,
  };
}

export function buildEpmcCitationUrl(pmid: string, direction: CitationDirection, page = 1, pageSize = 25): string {
  const qs = new URLSearchParams({ format: "json", pageSize: String(pageSize), page: String(page) });
  return `${EUROPEPMC_BASE}/MED/${encodeURIComponent(pmid)}/${direction}?${qs}`;
}

/** Cada fila de OpenCitations trae «citing» y «cited» como listas de identificadores separados por espacios. */
export function parseOpenCitations(body: unknown, direction: CitationDirection): { doi: string | null; pmid: string | null }[] {
  if (!Array.isArray(body)) return [];
  const field = direction === "citations" ? "citing" : "cited";
  const seen = new Set<string>();
  const out: { doi: string | null; pmid: string | null }[] = [];
  for (const row of body) {
    const ids = String(row?.[field] ?? "").split(/\s+/);
    const doi = normalizeDoi(ids.find((t) => t.startsWith("doi:"))?.slice(4) ?? null);
    const pmid = normalizePmid(ids.find((t) => t.startsWith("pmid:"))?.slice(5) ?? null);
    const key = doi ?? (pmid ? `pmid:${pmid}` : null);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ doi, pmid });
  }
  return out;
}

export class CitationClient {
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { now?: () => Date; timeoutMs?: number; email?: () => string | null; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  private at() {
    return (this.opts.now?.() ?? new Date()).toISOString();
  }

  /** Elige la mejor fuente: Europe PMC si hay PMID y tiene datos; si no, OpenCitations por DOI. */
  async network(work: Pick<Work, "doi" | "pmid">, direction: CitationDirection, limit = 50): Promise<CitationResult> {
    const pmid = normalizePmid(work.pmid ?? null);
    const doi = normalizeDoi(work.doi ?? null);
    if (pmid) {
      const r = await this.europePmc(pmid, direction, limit);
      if (r.works.length || !doi) return r;
    }
    if (doi) return this.openCitations(doi, direction, limit);
    throw new Error("Esta publicación no tiene DOI ni PMID: no se puede buscar su red de citas.");
  }

  async europePmc(pmid: string, direction: CitationDirection, limit = 50): Promise<CitationResult> {
    const url = buildEpmcCitationUrl(pmid, direction, 1, Math.min(Math.max(limit, 1), 1000));
    const body = parseJson("europepmc", (await getText(this.http, "europepmc", url, this.opts.timeoutMs)).text);
    const list = direction === "references" ? body?.referenceList?.reference : body?.citationList?.citation;
    const at = this.at();
    // Algunas referencias no son artículos indexados (libros, tesis): se conservan si tienen título
    const works = (list ?? []).filter((r: any) => r?.title).map((r: any) => parseEuropePmcCitationItem(r, at));
    return { direction, works, total: Number(body?.hitCount ?? works.length), via: "europepmc", unresolved: [], url };
  }

  async openCitations(doi: string, direction: CitationDirection, limit = 50): Promise<CitationResult> {
    const url = `${OPENCITATIONS_BASE}/${direction}/doi:${doi}`;
    const res = await getText(this.http, "opencitations", url, this.opts.timeoutMs ?? 20_000);
    const ids = res.status === 404 ? [] : parseOpenCitations(parseJson("opencitations", res.text), direction);
    const wanted = ids.slice(0, limit);
    const dois = wanted.map((x) => x.doi).filter((d): d is string => !!d);
    const cr = dois.length ? await crossrefByDois(this.http, dois, this.at(), { timeoutMs: this.opts.timeoutMs, email: this.opts.email?.() ?? null, sleep: this.opts.sleep }) : { works: [], failed: [], error: null };
    const found = cr.works;
    const got = new Set(found.map((w) => w.doi));
    // Mantener el orden de OpenCitations y añadir el PMID que esta trae
    const byDoi = new Map(found.map((w) => [w.doi, w]));
    const works: Work[] = [];
    for (const x of wanted) {
      const w = x.doi ? byDoi.get(x.doi) : undefined;
      if (w) works.push({ ...w, pmid: w.pmid ?? x.pmid });
    }
    const unresolved = wanted.filter((x) => !x.doi || !got.has(x.doi)).map((x) => (x.doi ? `doi:${x.doi}` : `pmid:${x.pmid}`));
    return { direction, works, total: ids.length, via: "opencitations", unresolved, url, warning: cr.error ? `Crossref no completó ${cr.failed.length} registros: ${cr.error}` : null };
  }

  /**
   * Historial de citas para los indicadores del perfil: total y citas por año.
   * Con DOI: OpenCitations (año de la publicación que cita, campo «creation»). Solo con PMID: Europe PMC (pubYear).
   */
  async citationHistory(work: Pick<Work, "doi" | "pmid">): Promise<CitationHistory & { via: "opencitations" | "europepmc" }> {
    const doi = normalizeDoi(work.doi ?? null);
    if (doi) {
      const res = await getText(this.http, "opencitations", `${OPENCITATIONS_BASE}/citations/doi:${doi}`, this.opts.timeoutMs ?? 20_000);
      const rows: any[] = res.status === 404 ? [] : parseJson("opencitations", res.text) ?? [];
      return { via: "opencitations", ...historyFrom(Array.isArray(rows) ? rows.map((r) => String(r?.creation ?? "").slice(0, 4)) : []) };
    }
    const pmid = normalizePmid(work.pmid ?? null);
    if (!pmid) throw new Error("Esta publicación no tiene DOI ni PMID: no se pueden contar sus citas.");
    const url = buildEpmcCitationUrl(pmid, "citations", 1, 1000);
    const body = parseJson("europepmc", (await getText(this.http, "europepmc", url, this.opts.timeoutMs)).text);
    const list: any[] = body?.citationList?.citation ?? [];
    const h = historyFrom(list.map((c) => String(c?.pubYear ?? "")));
    // Europe PMC informa el total aunque la lista venga recortada
    return { via: "europepmc", total: Math.max(Number(body?.hitCount ?? 0), h.total), byYear: h.byYear };
  }
}

/** Cuenta citas por año a partir de los años (texto) de cada cita; los años no válidos solo suman al total. */
export function historyFrom(years: string[]): CitationHistory {
  const byYear: Record<string, number> = {};
  for (const y of years) if (/^(19|20)\d{2}$/.test(y)) byYear[y] = (byYear[y] ?? 0) + 1;
  return { total: years.length, byYear };
}
