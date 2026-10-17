import { normalizeDoi, normalizeOrcid, normalizePmid, normalizeTitle, type Work } from "@biociencia/core";
import { CROSSREF_BASE, CROSSREF_SELECT, parseCrossrefWork } from "./crossref.ts";
import { getText, parseJson, SourceError, stripTags } from "./http.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * ORCID público (https://pub.orcid.org/v3.0) — gratuito, sin clave; permite llamadas
 * desde el navegador (verificado el 2026-10-15). Solo se leen datos que el investigador
 * marcó como públicos en su ORCID.
 */
export const ORCID_BASE = "https://pub.orcid.org/v3.0";

const TYPE_MAP: Record<string, string> = {
  "journal-article": "article",
  "review": "review",
  "preprint": "preprint",
  "book-chapter": "book-chapter",
  "book": "book",
  "dissertation-thesis": "dissertation",
  "dissertation": "dissertation",
  "data-set": "dataset",
  "conference-paper": "article",
  "report": "other",
};

export interface OrcidPerson {
  orcid: string;
  name: string;
  otherNames: string[];
}

export interface OrcidWork extends Work {
  /** Identificador del trabajo dentro del registro ORCID */
  putCode: string;
}

export function parseOrcidPerson(body: any, orcid: string): OrcidPerson {
  const n = body?.name ?? {};
  const name = n["credit-name"]?.value ?? [n["given-names"]?.value, n["family-name"]?.value].filter(Boolean).join(" ");
  return { orcid, name: name || orcid, otherNames: (body?.["other-names"]?.["other-name"] ?? []).map((o: any) => o.content).filter(Boolean) };
}

export interface OrcidEmployment {
  organization: string | null;
  department: string | null;
  role: string | null;
  startYear: number | null;
  /** Sin fecha de fin: es el empleo actual */
  current: boolean;
}

/** Empleos públicos del registro ORCID (institución, cargo, departamento). */
export function parseOrcidEmployments(body: any): OrcidEmployment[] {
  const out: OrcidEmployment[] = [];
  for (const g of body?.["affiliation-group"] ?? []) {
    const summaries: any[] = g?.summaries ?? (g?.["employment-summary"] ? [{ "employment-summary": g["employment-summary"] }] : []);
    for (const s of summaries) {
      const e = s?.["employment-summary"] ?? s;
      if (!e) continue;
      const organization = e.organization?.name ?? null;
      const role = e["role-title"] ?? null;
      if (!organization && !role) continue;
      const year = e["start-date"]?.year?.value;
      out.push({
        organization,
        department: e["department-name"] ?? null,
        role,
        startYear: year ? Number(year) : null,
        current: !e["end-date"]?.year?.value,
      });
    }
  }
  return out;
}

/** El empleo actual (o, si ninguno sigue abierto, el más reciente). */
export function currentEmployment(list: OrcidEmployment[]): OrcidEmployment | null {
  if (!list.length) return null;
  const current = list.filter((e) => e.current);
  return [...(current.length ? current : list)].sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0))[0] ?? null;
}

export interface OrcidExternalIds {
  /** «Scopus Author ID», si la persona lo enlazó en su registro público */
  scopusAuthorId: string | null;
}

/**
 * Identificadores externos que la persona enlazó (p. ej., su «Scopus Author ID»).
 * ORCID no guarda números de citas: solo la identidad y los enlaces a otras bases.
 */
export function parseOrcidExternalIds(body: any): OrcidExternalIds {
  const list: any[] = body?.["external-identifiers"] ?? body?.["external-identifier"] ?? [];
  let scopusAuthorId: string | null = null;
  for (const e of Array.isArray(list) ? list : []) {
    const type = String(e?.["external-identifier-type"] ?? "").toLowerCase();
    const raw = e?.["external-identifier-id"];
    const value = typeof raw === "string" ? raw : (raw?.value ?? null);
    if (value && /scopus/.test(type)) scopusAuthorId = String(value).trim();
  }
  return { scopusAuthorId };
}

/** Un «grupo» de ORCID es un trabajo; puede tener varias versiones (de distintas fuentes). Se usa la preferida. */
export function parseOrcidWorks(body: any, ownerName: string, orcid: string, fetchedAt: string): OrcidWork[] {
  const out: OrcidWork[] = [];
  for (const g of body?.group ?? []) {
    const summaries: any[] = g["work-summary"] ?? [];
    if (!summaries.length) continue;
    const s = [...summaries].sort((a, b) => Number(b["display-index"] ?? 0) - Number(a["display-index"] ?? 0))[0];
    const ids: any[] = [...(g["external-ids"]?.["external-id"] ?? []), ...(s["external-ids"]?.["external-id"] ?? [])];
    const id = (type: string) => {
      const x = ids.find((i) => i["external-id-type"] === type && i["external-id-relationship"] !== "part-of");
      return x ? x["external-id-normalized"]?.value ?? x["external-id-value"] : null;
    };
    const year = s["publication-date"]?.year?.value;
    out.push({
      putCode: String(s["put-code"]),
      title: stripTags(s.title?.title?.value) || "(sin título)",
      // ORCID no trae los coautores en el resumen: se completa con Crossref si hay DOI
      authors: [{ name: ownerName, orcid }],
      year: year ? Number(year) : null,
      venue: s["journal-title"]?.value ?? null,
      doi: normalizeDoi(id("doi")),
      pmid: normalizePmid(id("pmid")),
      type: TYPE_MAP[s.type] ?? (s.type ? "other" : null),
      landingUrl: s.url?.value ?? null,
      source: "orcid",
      fetchedAt,
    });
  }
  return out;
}

/**
 * Una misma publicación puede figurar varias veces en ORCID con DOI distintos (p. ej. cuando la
 * revista cambió de prefijo DOI). Se une por título y año: queda la primera y se informa cuántas se unieron.
 */
export function collapseSameWork<T extends Work>(works: T[]): { works: T[]; collapsed: { kept: T; dropped: T[] }[] } {
  const by = new Map<string, { kept: T; dropped: T[] }>();
  const order: string[] = [];
  for (const w of works) {
    const key = `${normalizeTitle(w.title)}|${w.year ?? ""}`;
    const e = by.get(key);
    if (e) e.dropped.push(w);
    else {
      by.set(key, { kept: w, dropped: [] });
      order.push(key);
    }
  }
  const groups = order.map((k) => by.get(k)!);
  return { works: groups.map((g) => g.kept), collapsed: groups.filter((g) => g.dropped.length) };
}

export class OrcidClient {
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { mailto?: () => string | null; now?: () => Date; timeoutMs?: number } = {},
  ) {}

  private async get(path: string): Promise<{ status: number; body: any }> {
    const r = await getText(this.http, "orcid", `${ORCID_BASE}${path}`, this.opts.timeoutMs ?? 20_000);
    return { status: r.status, body: parseJson("orcid", r.text) };
  }

  async person(orcidInput: string): Promise<OrcidPerson> {
    const orcid = normalizeOrcid(orcidInput);
    if (!orcid) throw new SourceError("orcid", "El ORCID no es válido (revise los 16 dígitos).", null);
    const r = await this.get(`/${orcid}/personal-details`);
    if (r.status === 404) throw new SourceError("orcid", `No existe un registro ORCID público con el número ${orcid}.`, 404);
    return parseOrcidPerson(r.body, orcid);
  }

  async works(orcidInput: string, ownerName: string): Promise<OrcidWork[]> {
    const orcid = normalizeOrcid(orcidInput);
    if (!orcid) throw new SourceError("orcid", "El ORCID no es válido (revise los 16 dígitos).", null);
    const r = await this.get(`/${orcid}/works`);
    if (r.status === 404) throw new SourceError("orcid", `No existe un registro ORCID público con el número ${orcid}.`, 404);
    return parseOrcidWorks(r.body, ownerName, orcid, (this.opts.now?.() ?? new Date()).toISOString());
  }

  /** Empleos que el investigador marcó como públicos (para rellenar la firma de las solicitudes). */
  async employments(orcidInput: string): Promise<OrcidEmployment[]> {
    const orcid = normalizeOrcid(orcidInput);
    if (!orcid) throw new SourceError("orcid", "El ORCID no es válido (revise los 16 dígitos).", null);
    const r = await this.get(`/${orcid}/employments`);
    if (r.status === 404) throw new SourceError("orcid", `No existe un registro ORCID público con el número ${orcid}.`, 404);
    return parseOrcidEmployments(r.body);
  }

  /** Identificadores externos públicos del registro (p. ej. el «Scopus Author ID»). */
  async externalIdentifiers(orcidInput: string): Promise<OrcidExternalIds> {
    const orcid = normalizeOrcid(orcidInput);
    if (!orcid) throw new SourceError("orcid", "El ORCID no es válido (revise los 16 dígitos).", null);
    const r = await this.get(`/${orcid}/external-identifiers`);
    if (r.status === 404) throw new SourceError("orcid", `No existe un registro ORCID público con el número ${orcid}.`, 404);
    return parseOrcidExternalIds(r.body);
  }

  /**
   * Completa autores, resumen, revista y citas con Crossref (gratis), de 20 en 20 DOI.
   * Si Crossref falla, se devuelven los datos de ORCID sin completar y el error.
   */
  async enrichWithCrossref(works: OrcidWork[]): Promise<{ works: OrcidWork[]; enriched: number; error: string | null }> {
    const withDoi = works.filter((w) => w.doi);
    const byDoi = new Map<string, Work>();
    let error: string | null = null;
    for (let i = 0; i < withDoi.length; i += 20) {
      const chunk = withDoi.slice(i, i + 20);
      const qs = new URLSearchParams({ filter: chunk.map((w) => `doi:${w.doi}`).join(","), rows: "20", select: CROSSREF_SELECT });
      const mail = this.opts.mailto?.();
      if (mail) qs.set("mailto", mail);
      try {
        const r = await getText(this.http, "crossref", `${CROSSREF_BASE}/works?${qs}`, this.opts.timeoutMs ?? 20_000);
        const at = (this.opts.now?.() ?? new Date()).toISOString();
        for (const it of parseJson("crossref", r.text)?.message?.items ?? []) {
          const w = parseCrossrefWork(it, at);
          if (w.doi) byDoi.set(w.doi, w);
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    let enriched = 0;
    const out = works.map((w) => {
      const c = w.doi ? byDoi.get(w.doi) : undefined;
      if (!c) return w;
      enriched++;
      // Los datos que el investigador registró en ORCID mandan; Crossref aporta lo que falta
      return {
        ...w,
        authors: c.authors.length ? c.authors : w.authors,
        venue: w.venue ?? c.venue ?? null,
        year: w.year ?? c.year ?? null,
        abstract: c.abstract ?? null,
        keywords: c.keywords ?? [],
        citedByCount: c.citedByCount ?? null,
        landingUrl: w.landingUrl ?? c.landingUrl ?? null,
      };
    });
    return { works: out, enriched, error };
  }
}
