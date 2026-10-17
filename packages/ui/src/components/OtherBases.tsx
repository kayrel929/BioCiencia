import { useState } from "react";
import type { Work } from "@biociencia/core";
import { useApp } from "../context.tsx";

/** Enlace de búsqueda en Scopus (Scopus es de pago: se ve con acceso institucional o la clave gratuita del usuario). */
export function scopusSearchUrl(doi: string): string {
  return `https://www.scopus.com/results/results.uri?src=s&st1=${encodeURIComponent(doi)}`;
}

/**
 * «Citas en otras bases»: consulta, al pulsarlo, el mismo artículo por su DOI en dos bases abiertas
 * y gratuitas —OpenAlex y Semantic Scholar— y ofrece un enlace de búsqueda en Scopus.
 * Se consulta solo cuando el usuario lo pide: Semantic Scholar limita las consultas muy seguidas.
 */
export function OtherBases({ work }: { work: Work }) {
  const { openalex, semanticscholar } = useApp();
  const [busy, setBusy] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [res, setRes] = useState<{ openalex: number | null; s2: number | null; s2Url: string | null; influyentes: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const doi = work.doi;
  if (!doi) return null;

  /** Citas en Semantic Scholar: por el puente local si existe, y si no, directo desde el navegador. */
  async function s2(d: string): Promise<{ count: number | null; url: string | null; infl: number | null } | null> {
    let viaPuente = false;
    try {
      const r = await fetch(`/api/s2?doi=${encodeURIComponent(d)}`);
      if ((r.headers.get("content-type") ?? "").includes("application/json")) {
        viaPuente = true;
        const body = (await r.json()) as { paperId?: string; citationCount?: number; influentialCitationCount?: number; error?: string };
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(body.error ?? "Semantic Scholar no respondió ahora.");
        return body.paperId
          ? { count: body.citationCount ?? null, url: `https://www.semanticscholar.org/paper/${body.paperId}`, infl: body.influentialCitationCount ?? null }
          : null;
      }
    } catch (e) {
      if (viaPuente) throw e; // el puente existe y dio un error real: se muestra tal cual
      /* sin puente (versión de desarrollo o escritorio): se intenta directamente */
    }
    const p = await semanticscholar.byDoi(d);
    return p ? { count: p.citationCount, url: p.url, infl: p.influentialCitationCount } : null;
  }

  async function buscar() {
    setAbierto(true);
    setBusy(true);
    setErr(null);
    const out = { openalex: null as number | null, s2: null as number | null, s2Url: null as string | null, influyentes: null as number | null };
    try {
      const oa = await openalex.getByDoi(doi!);
      out.openalex = typeof oa?.citedByCount === "number" ? oa.citedByCount : null;
    } catch {
      /* Sin OpenAlex se sigue con la otra base */
    }
    try {
      const s = await s2(doi!);
      if (s) {
        out.s2 = s.count;
        out.s2Url = s.url;
        out.influyentes = s.infl;
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Semantic Scholar no respondió ahora.");
    }
    setRes(out);
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" className="bc-btn bc-btn-sm" disabled={busy} onClick={() => void buscar()}>
        {busy ? "Consultando otras bases…" : "Ver citas en otras bases"}
      </button>
      {abierto ? (
        <div className="bc-sub" style={{ fontSize: "0.8rem", marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {res ? (
            <>
              <span data-testid="other-bases">
                OpenAlex: <strong>{res.openalex ?? "—"}</strong> citas
                {" · "}
                Semantic Scholar: <strong>{res.s2 ?? "—"}</strong> citas
                {res.influyentes != null ? <> ({res.influyentes} influyentes)</> : null}
              </span>
              {res.s2Url ? <a className="bc-btn bc-btn-sm" href={res.s2Url} target="_blank" rel="noreferrer">Ver en Semantic Scholar</a> : null}
            </>
          ) : null}
          <a className="bc-btn bc-btn-sm" href={`https://openalex.org/works/doi:${encodeURIComponent(doi)}`} target="_blank" rel="noreferrer">Ver en OpenAlex</a>
          <a className="bc-btn bc-btn-sm" href={scopusSearchUrl(doi)} target="_blank" rel="noreferrer">Buscar en Scopus</a>
        </div>
      ) : null}
      {err ? <div className="bc-alert" role="status" style={{ marginTop: 6, fontSize: "0.8rem" }}>{err}</div> : null}
    </div>
  );
}
