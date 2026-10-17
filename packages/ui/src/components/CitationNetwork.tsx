import { useEffect, useState } from "react";
import type { Work } from "@biociencia/core";
import type { CitationDirection, CitationResult } from "@biociencia/sources";
import { useApp } from "../context.tsx";
import { Dialog } from "./Pending.tsx";
import { ExportButton } from "./RefsIO.tsx";
import { formatAuthors } from "./WorkItem.tsx";

/**
 * Red de citas («bola de nieve»): qué cita una publicación y quién la cita.
 * Se puede seguir el rastro varios niveles y guardar lo encontrado en la biblioteca.
 */
export function CitationNetworkButton({ work }: { work: Work }) {
  const [open, setOpen] = useState(false);
  if (!work.doi && !work.pmid) return null;
  return (
    <>
      <button className="bc-btn bc-btn-sm" onClick={() => setOpen(true)} title="Ver qué cita y quién cita esta publicación">
        Red de citas
      </button>
      {open ? <CitationNetworkDialog start={work} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const VIA: Record<CitationResult["via"], string> = {
  europepmc: "Europe PMC",
  opencitations: "OpenCitations (índice abierto) + Crossref",
};

function CitationNetworkDialog({ start, onClose }: { start: Work; onClose: () => void }) {
  const { citations, repo, refresh } = useApp();
  const [trail, setTrail] = useState<Work[]>([start]);
  const [dir, setDir] = useState<CitationDirection>("citations");
  const [res, setRes] = useState<CitationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const current = trail[trail.length - 1]!;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setRes(null);
    citations.network(current, dir, 100).then(
      (r) => alive && setRes(r),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    ).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [citations, current, dir]);

  const key = (w: Work) => w.doi ?? w.pmid ?? w.title;
  async function saveWork(w: Work) {
    const { id } = await repo.upsertWork(w);
    await repo.addToLibrary(id);
    setSaved((s) => new Set(s).add(key(w)));
    refresh();
  }

  return (
    <Dialog title="Red de citas" onClose={onClose}>
      <nav aria-label="Rastro" className="bc-sub" style={{ fontSize: "0.82rem", marginBottom: 8 }}>
        {trail.map((w, i) => (
          <span key={i}>
            {i > 0 ? " → " : ""}
            {i < trail.length - 1 ? (
              <button className="bc-btn bc-btn-ghost" style={{ padding: 0, fontSize: "inherit" }} onClick={() => setTrail(trail.slice(0, i + 1))}>
                {w.title.slice(0, 40)}…
              </button>
            ) : (
              <strong>{w.title.slice(0, 60)}{w.title.length > 60 ? "…" : ""}</strong>
            )}
          </span>
        ))}
      </nav>
      <div className="bc-row" role="tablist" style={{ gap: 6, marginBottom: 8 }}>
        <button role="tab" aria-selected={dir === "citations"} className={`bc-btn bc-btn-sm ${dir === "citations" ? "bc-btn-primary" : ""}`} onClick={() => setDir("citations")}>
          La citan (posteriores)
        </button>
        <button role="tab" aria-selected={dir === "references"} className={`bc-btn bc-btn-sm ${dir === "references" ? "bc-btn-primary" : ""}`} onClick={() => setDir("references")}>
          Cita a (referencias)
        </button>
      </div>
      {loading ? <div role="status">Consultando…</div> : null}
      {error ? <div className="bc-alert bc-alert-error" role="status">{error}</div> : null}
      {res ? (
        <>
          <div className="bc-sub" role="status" style={{ fontSize: "0.82rem" }}>
            {res.works.length === 0
              ? `Sin ${dir === "citations" ? "citas" : "referencias"} registradas en ${VIA[res.via]}. Que no aparezcan no significa que no existan: no todas las editoriales depositan sus referencias.`
              : `${res.works.length} de ${res.total} ${dir === "citations" ? "publicaciones que la citan" : "referencias"} · fuente: ${VIA[res.via]}`}
            {res.unresolved.length ? ` · ${res.unresolved.length} sin datos completos (no se muestran)` : ""}
          </div>
          {res.warning ? <div className="bc-alert bc-alert-warn" role="status" style={{ fontSize: "0.82rem", marginTop: 6 }}>{res.warning}. Vuelva a intentarlo en un momento.</div> : null}
          {res.works.length ? (
            <div style={{ margin: "6px 0" }}>
              <ExportButton label="Exportar lista" baseName={`red-de-citas ${dir}`} getWorks={async () => res.works} />
            </div>
          ) : null}
          <ul style={{ listStyle: "none", padding: 0, maxHeight: "50vh", overflow: "auto" }} data-testid="citation-list">
            {res.works.map((w, i) => (
              <li key={`${key(w)}-${i}`} style={{ padding: "8px 0", borderBottom: "1px solid var(--bc-border)" }}>
                <div style={{ fontWeight: 600 }}>{w.title}</div>
                <div className="bc-sub" style={{ fontSize: "0.82rem" }}>
                  {formatAuthors(w, 3)} · {w.year ?? "s. f."}{w.venue ? ` · ${w.venue}` : ""}
                  {w.citedByCount != null ? ` · ${w.citedByCount} ${w.citedByCount === 1 ? "cita" : "citas"}` : ""}
                </div>
                <div className="bc-row" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  {w.doi || w.pmid ? (
                    <button className="bc-btn bc-btn-sm" onClick={() => setTrail([...trail, w])} disabled={trail.length >= 6} title="Ver la red de citas de esta publicación">
                      Seguir desde aquí
                    </button>
                  ) : null}
                  {saved.has(key(w)) ? (
                    <span className="bc-badge bc-badge-green">Guardado</span>
                  ) : (
                    <button className="bc-btn bc-btn-sm bc-btn-primary" onClick={() => void saveWork(w)}>Guardar en biblioteca</button>
                  )}
                  {w.doi ? <a className="bc-btn bc-btn-sm" href={`https://doi.org/${w.doi}`} target="_blank" rel="noreferrer">Abrir</a> : w.landingUrl ? <a className="bc-btn bc-btn-sm" href={w.landingUrl} target="_blank" rel="noreferrer">Abrir</a> : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Dialog>
  );
}
