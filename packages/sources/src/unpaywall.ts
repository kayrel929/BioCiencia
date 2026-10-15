import { normalizeDoi } from "@biociencia/core";
import { getText, parseJson, SourceError } from "./http.ts";
import type { HttpGet } from "./openalex.ts";

/**
 * Unpaywall (https://unpaywall.org/products/api) — gratuito; exige un correo de contacto.
 * Dado un DOI, indica si existe una copia LEGAL y gratuita (revista abierta, repositorio
 * institucional, PubMed Central, preprint del autor). Verificado el 2026-10-15.
 */
export const UNPAYWALL_BASE = "https://api.unpaywall.org/v2";

export interface OaLocation {
  url: string;
  pdfUrl: string | null;
  hostType: "publisher" | "repository" | string;
  version: string | null; // publishedVersion, acceptedVersion, submittedVersion
  license: string | null;
  repository: string | null;
}

export interface OaInfo {
  doi: string;
  found: boolean;
  isOa: boolean;
  /** gold, green, hybrid, bronze, diamond, closed */
  status: string | null;
  best: OaLocation | null;
  locations: OaLocation[];
  journal: string | null;
  title: string | null;
}

export const OA_STATUS_LABEL: Record<string, string> = {
  gold: "Revista de acceso abierto",
  diamond: "Acceso abierto sin costo para autores",
  hybrid: "Acceso abierto en revista de suscripción",
  bronze: "Gratis en el sitio de la editorial",
  green: "Copia en repositorio",
  closed: "Sin copia legal gratuita conocida",
};

export const VERSION_LABEL: Record<string, string> = {
  publishedVersion: "versión publicada",
  acceptedVersion: "manuscrito aceptado",
  submittedVersion: "preprint (versión enviada)",
};

function loc(l: any): OaLocation {
  return {
    url: l.url_for_pdf ?? l.url ?? l.url_for_landing_page,
    pdfUrl: l.url_for_pdf ?? null,
    hostType: l.host_type ?? "unknown",
    version: l.version ?? null,
    license: l.license ?? null,
    repository: l.repository_institution ?? null,
  };
}

export function parseUnpaywall(body: any, doi: string): OaInfo {
  const locations: OaLocation[] = (body?.oa_locations ?? []).map(loc).filter((l: OaLocation) => !!l.url);
  return {
    doi,
    found: true,
    isOa: !!body?.is_oa,
    status: body?.oa_status ?? null,
    best: body?.best_oa_location ? loc(body.best_oa_location) : null,
    locations,
    journal: body?.journal_name ?? null,
    title: body?.title ?? null,
  };
}

export class UnpaywallClient {
  private cache = new Map<string, OaInfo>();
  constructor(
    private readonly http: HttpGet,
    private readonly opts: { email: () => string | null; timeoutMs?: number },
  ) {}

  async lookup(doiInput: string): Promise<OaInfo> {
    const doi = normalizeDoi(doiInput);
    if (!doi) throw new SourceError("unpaywall", "El DOI no tiene un formato válido.", null);
    const email = this.opts.email();
    if (!email) throw new SourceError("unpaywall", "Para buscar copias legales gratuitas, Unpaywall pide un correo de contacto. Configúrelo en Configuración → Fuentes científicas.", null);
    const hit = this.cache.get(doi);
    if (hit) return hit;
    const url = `${UNPAYWALL_BASE}/${encodeURIComponent(doi).replace(/%2F/gi, "/")}?email=${encodeURIComponent(email)}`;
    const res = await getText(this.http, "unpaywall", url, this.opts.timeoutMs ?? 15_000);
    const info: OaInfo =
      res.status === 404
        ? { doi, found: false, isOa: false, status: null, best: null, locations: [], journal: null, title: null }
        : parseUnpaywall(parseJson("unpaywall", res.text), doi);
    this.cache.set(doi, info);
    return info;
  }
}
