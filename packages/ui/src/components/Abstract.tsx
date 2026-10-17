import { useState } from "react";
import type { Work } from "@biociencia/core";
import { crossrefByDois } from "@biociencia/sources";
import { useApp } from "../context.tsx";

/**
 * Pestaña «Resumen» de cada publicación: vista previa de 3 líneas y lectura completa con un clic.
 * Si la fuente no trajo resumen, lo busca a pedido en Europe PMC (por DOI o PMID) y en Crossref (por DOI),
 * y si la publicación ya está guardada, lo agrega a la biblioteca. Nunca se inventa un resumen.
 */
export function AbstractTab({ work }: { work: Work }) {
  const { sources, repo, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<{ text: string; from: string } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "none" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const text = work.abstract ?? found?.text ?? null;

  async function fetchAbstract() {
    setState("loading");
    setError(null);
    try {
      const query = work.doi ? `DOI:"${work.doi}"` : work.pmid ? `EXT_ID:${work.pmid} AND SRC:MED` : null;
      if (query) {
        const r = await sources.europepmc.search({ text: query, perPage: 1 });
        const hit = r.works.find((w) => w.abstract && (!work.doi || w.doi === work.doi));
        if (hit?.abstract) return done(hit.abstract, "Europe PMC");
      }
      if (work.doi) {
        const cr = await crossrefByDois((u, i) => fetch(u, i), [work.doi], new Date().toISOString());
        const a = cr.works.find((w) => w.abstract)?.abstract;
        if (a) return done(a, "Crossref");
      }
      setState("none");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  async function done(abstract: string, from: string) {
    setFound({ text: abstract, from });
    setOpen(true);
    setState("idle");
    // Se guarda en la base local (se une por DOI/PMID con la ficha existente; no la agrega a la biblioteca)
    await repo.upsertWork({ ...work, abstract });
    refresh();
  }

  if (!text) {
    return (
      <div className="bc-abstract" data-testid="abstract">
        <span className="bc-work-meta">Resumen no disponible en la fuente.</span>{" "}
        {work.doi || work.pmid ? (
          state === "loading" ? <span className="bc-work-meta" role="status">Buscando resumen…</span>
          : state === "none" ? <span className="bc-work-meta" role="status">Tampoco está en Europe PMC ni en Crossref.</span>
          : <button className="bc-link-btn" onClick={() => void fetchAbstract()}>Buscar resumen</button>
        ) : null}
        {error ? <span className="bc-work-meta" role="status"> · No se pudo buscar: {error}</span> : null}
      </div>
    );
  }

  return (
    <div className="bc-abstract" data-testid="abstract">
      <div className={open ? "bc-work-abstract bc-open" : "bc-work-abstract"} id={`resumen-${work.id ?? work.doi ?? work.title.slice(0, 20)}`}>
        {open ? <strong className="bc-abstract-title">Resumen{found ? ` (obtenido de ${found.from})` : ""}</strong> : null}
        {text}
      </div>
      <button className="bc-link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Ocultar resumen" : "Leer resumen completo"}
      </button>
    </div>
  );
}
