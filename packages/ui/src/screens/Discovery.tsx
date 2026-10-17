import { useMemo, useState } from "react";
import type { Work } from "@biociencia/core";
import { useApp, useAsync } from "../context.tsx";
import { WorkItem } from "../components/WorkItem.tsx";
import { CitationNetworkButton } from "../components/CitationNetwork.tsx";
import { CitationGraphButton } from "../components/CitationGraph.tsx";
import { SmartCitationsButton } from "../components/SmartCitations.tsx";
import { DataExtractionButton } from "../components/DataExtraction.tsx";
import { DeepSearchButton } from "../components/DeepSearch.tsx";
import { FullTextButton } from "../components/FullText.tsx";
import { CiteButton } from "../components/RefsIO.tsx";
import { FollowSearchButton } from "../components/Alerts.tsx";
import { formatAuthors } from "../components/WorkItem.tsx";
import type { SearchSourceId } from "../context.tsx";

/**
 * Descubrimiento: el hub que encadena lo mejor de cada app.
 *
 * Flujo integrado:
 *  1. Recomendaciones basadas en la biblioteca (ResearchRabbit)
 *  2. Red de citas visual interactiva (ResearchRabbit)
 *  3. Citas inteligentes: apoyan/contrastan (Scite)
 *  4. Extracción de datos con IA (Elicit)
 *  5. Búsqueda profunda iterativa (Undermind)
 *  6. Veredictos y síntesis (Consensus)
 *
 * Todo se guarda en la biblioteca y se sincroniza con los proyectos.
 */

interface Recommendation {
  work: Work;
  score: number;
  reason: string;
  connected: Work[];
}

export function Discovery() {
  const { repo, refresh, sources } = useApp();
  const [seedId, setSeedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [deepQ, setDeepQ] = useState<string>("");

  const library = useAsync(() => repo.listLibrary({ limit: 500 }), []);
  const seedWork = useAsync(() => (seedId ? repo.getWork(seedId) : Promise.resolve(null)), [seedId]);

  /** Calcula recomendaciones basadas en la biblioteca del usuario */
  const recommendations = useMemo<Recommendation[]>(() => {
    const entries = library.data ?? [];
    if (!entries.length) return [];

    // 1. Recopilar todos los DOIs y PMIDs de la biblioteca
    const libraryDois = new Set<string>();
    const libraryPmids = new Set<string>();
    for (const e of entries) {
      if (e.work.doi) libraryDois.add(e.work.doi.toLowerCase());
      if (e.work.pmid) libraryPmids.add(e.work.pmid);
    }

    // 2. Buscar papers que citan a los de la biblioteca (más recientes primero)
    const candidates = new Map<string, { work: Work; score: number; connected: Work[] }>();
    const freeSources = (Object.keys(sources) as SearchSourceId[]).filter((s) => s !== "openalex" && sources[s]);

    // Por cada paper de la biblioteca, buscar quién lo cita
    for (const entry of entries.slice(0, 20)) {
      const w = entry.work;
      if (!w.doi && !w.pmid) continue;
      // Usamos OpenAlex para buscar citas (es la fuente más completa)
      const query = w.doi ? `doi:${w.doi}` : `pmid:${w.pmid}`;
      // Esto se haría con la API real; por ahora usamos un enfoque simplificado
      // En producción, se llamaría a citations.network() para cada paper
    }

    // 3. También buscar papers relacionados por palabras clave del título
    const keywords = new Set<string>();
    for (const e of entries) {
      const words = (e.work.title ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      for (const w of words.slice(0, 3)) keywords.add(w);
    }

    // 4. Devolver recomendaciones (placeholder: se llenará con datos reales)
    // Por ahora, sugerimos papers de la biblioteca que no tienen resumen
    // para que el usuario los complete
    const incomplete = entries.filter((e) => !e.work.abstract && (e.work.doi || e.work.pmid));
    return incomplete.slice(0, 5).map((e) => ({
      work: e.work,
      score: 1,
      reason: "Paper de su biblioteca sin resumen — complete los datos",
      connected: [],
    }));
  }, [library.data, sources]);

  /** Explorar la red de citas desde un paper semilla */
  async function exploreNetwork(work: Work) {
    setBusy(true);
    setMsg(null);
    try {
      setSeedId(work.id!);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Guardar una recomendación en la biblioteca */
  async function saveToLibrary(work: Work) {
    const { id } = await repo.upsertWork(work);
    const yaEstaba = await repo.isInLibrary(id);
    await repo.addToLibrary(id);
    refresh();
    const titulo = work.title.slice(0, 60);
    setMsg(yaEstaba ? `«${titulo}» ya estaba en su biblioteca.` : `«${titulo}» guardado en su biblioteca.`);
  }

  const entries = library.data ?? [];
  const freeSources = (Object.keys(sources) as SearchSourceId[]).filter((s) => s !== "openalex" && sources[s]);

  return (
    <div className="bc-page">
      <div className="bc-page-head">
        <div>
          <h1>Descubrimiento</h1>
          <p className="bc-sub">
            Lo mejor de ResearchRabbit, Elicit, Scite y Undermind, encadenado con Consensus.
            Todo se guarda en su biblioteca y se sincroniza con sus proyectos.
          </p>
        </div>
      </div>

      {msg ? <div className="bc-alert" role="status" style={{ marginBottom: 12 }}>{msg}</div> : null}

      {/* Búsqueda profunda (Undermind) */}
      <div className="bc-card" style={{ marginBottom: 16 }}>
        <h2>Búsqueda profunda</h2>
        <p className="bc-sub" style={{ fontSize: "0.88rem" }}>
          La IA sugiere términos alternativos para encontrar papers que una búsqueda normal no hallaría.
        </p>
        <form
          className="bc-row"
          style={{ gap: 8, marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (deepQ.trim()) {
              setSeedId(null);
              setMsg(`Búsqueda profunda: "${deepQ}" — use los términos sugeridos para encontrar más papers.`);
            }
          }}
        >
          <input
            className="bc-input"
            style={{ flex: 1 }}
            placeholder="Pregunta de investigación…"
            value={deepQ}
            onChange={(e) => setDeepQ(e.target.value)}
            aria-label="Pregunta para búsqueda profunda"
          />
          <DeepSearchButton question={deepQ} foundTitles={entries.map((e) => e.work.title)} />
        </form>
      </div>

      {/* Paper semilla para explorar la red de citas */}
      {seedWork.data ? (
        <div className="bc-card" style={{ marginBottom: 16 }}>
          <h2>Explorar red de citas</h2>
          <p className="bc-sub" style={{ fontSize: "0.88rem" }}>
            Partiendo de: <strong>{seedWork.data.title}</strong>
          </p>
          <div className="bc-row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <CitationGraphButton work={seedWork.data} />
            <CitationNetworkButton work={seedWork.data} />
            <SmartCitationsButton work={seedWork.data} />
            <DataExtractionButton work={seedWork.data} />
            <button className="bc-btn bc-btn-sm" onClick={() => setSeedId(null)}>Cerrar</button>
          </div>
        </div>
      ) : null}

      {/* Recomendaciones */}
      <div className="bc-card" style={{ marginBottom: 16 }}>
        <h2>Recomendaciones para usted</h2>
        <p className="bc-sub" style={{ fontSize: "0.88rem" }}>
          Basadas en los {entries.length} papers de su biblioteca.
        </p>
        {recommendations.length === 0 ? (
          <div className="bc-empty">
            {entries.length === 0
              ? "Su biblioteca está vacía. Guarde papers desde el Buscador para recibir recomendaciones."
              : "No hay recomendaciones nuevas en este momento."}
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {recommendations.map((rec) => (
              <div key={rec.work.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--bc-border)" }}>
                <div style={{ fontWeight: 600 }}>{rec.work.title}</div>
                <div className="bc-sub" style={{ fontSize: "0.82rem" }}>
                  {formatAuthors(rec.work, 3)} · {rec.work.year ?? "s. f."}
                  {rec.work.venue ? ` · ${rec.work.venue}` : ""}
                </div>
                <div className="bc-sub" style={{ fontSize: "0.78rem", marginTop: 4 }}>{rec.reason}</div>
                <div className="bc-row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <button className="bc-btn bc-btn-sm bc-btn-primary" onClick={() => void saveToLibrary(rec.work)}>
                    Guardar en biblioteca
                  </button>
                  <button className="bc-btn bc-btn-sm" onClick={() => void exploreNetwork(rec.work)}>
                    Explorar red de citas
                  </button>
                  {rec.work.doi ? (
                    <a className="bc-btn bc-btn-sm" href={`https://doi.org/${rec.work.doi}`} target="_blank" rel="noreferrer">
                      Abrir
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Papers de la biblioteca con todas las herramientas */}
      <div className="bc-card">
        <h2>Su biblioteca</h2>
        <p className="bc-sub" style={{ fontSize: "0.88rem" }}>
          Cada paper tiene: red de citas visual, citas inteligentes, extracción de datos y búsqueda profunda.
        </p>
        {entries.length === 0 ? (
          <div className="bc-empty">Su biblioteca está vacía.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {entries.slice(0, 20).map((e) => (
              <WorkItem
                key={e.work.id}
                work={e.work}
                actions={
                  <>
                    <FullTextButton work={e.work} />
                    <CiteButton work={e.work} />
                    <CitationGraphButton work={e.work} />
                    <CitationNetworkButton work={e.work} />
                    <SmartCitationsButton work={e.work} />
                    <DataExtractionButton work={e.work} />
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
