import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Work } from "@biociencia/core";
import {
  DOMAINS, OpenAlexError, prepareQuery, WORK_TYPES,
  type AutocompleteItem, type SearchFilters, type SearchMode, type SortOrder,
} from "@biociencia/sources";
import { useApp, useAsync } from "../context.tsx";
import { Icon } from "../components/Icon.tsx";
import { WorkItem } from "../components/WorkItem.tsx";
import { CiteButton, ExportButton } from "../components/RefsIO.tsx";

const LANGUAGES: Record<string, string> = { es: "Español", en: "Inglés", pt: "Portugués", fr: "Francés", de: "Alemán" };
const MODES: { value: SearchMode; label: string; placeholder: string }[] = [
  { value: "keywords", label: "Pregunta o palabras clave", placeholder: "Ej.: ¿Qué microorganismos controlan Ralstonia solanacearum? · o un DOI" },
  { value: "title", label: "Título", placeholder: "Palabras del título" },
  { value: "author", label: "Autor", placeholder: "Nombre del autor" },
  { value: "journal", label: "Revista", placeholder: "Nombre de la revista" },
];

interface Row {
  work: Work;
  id: string;
}

interface RunState {
  searchId: string;
  sentText: string;
  simplified: boolean;
  total: number;
  page: number;
  perPage: number;
  costUsd: number | null;
  remainingUsd: number | null;
  rows: Row[];
}

const PER_PAGE = 20;

export function Search() {
  const { repo, openalex, refresh } = useApp();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const savedId = params.get("s");

  const [text, setText] = useState(q);
  const [mode, setMode] = useState<SearchMode>("keywords");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [sort, setSort] = useState<SortOrder>("relevance");
  const [showFilters, setShowFilters] = useState(false);
  const [entity, setEntity] = useState<AutocompleteItem | null>(null);
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);

  const [run, setRun] = useState<RunState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inLibrary, setInLibrary] = useState<Set<string>>(new Set());
  const lastAuto = useRef<string>("");

  const history = useAsync(() => repo.listSearches(15), []);
  const projects = useAsync(() => repo.listProjects(), []);

  // Búsqueda pedida desde Inicio (?q=…)
  useEffect(() => {
    if (q && !savedId) {
      setText(q);
      void execute(q, "keywords", {}, "relevance");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Búsqueda guardada (?s=…): se muestra desde la base local, sin internet ni costo
  useEffect(() => {
    if (!savedId) return;
    void (async () => {
      const s = (await repo.listSearches(500)).find((x) => x.id === savedId);
      const works = await repo.searchResults(savedId);
      if (!s) return;
      setText(s.query);
      setError(s.error);
      const rows = works.map((w) => ({ work: w, id: w.id! }));
      setRun({ searchId: s.id, sentText: s.query, simplified: false, total: s.totalHits ?? rows.length, page: Math.ceil(rows.length / PER_PAGE) || 1, perPage: PER_PAGE, costUsd: 0, remainingUsd: null, rows });
      setInLibrary(await repo.libraryMembership(rows.map((r) => r.id)));
    })();
  }, [savedId, repo]);

  // Autocompletado de autores y revistas (gratuito en OpenAlex)
  useEffect(() => {
    if ((mode !== "author" && mode !== "journal") || entity) {
      setSuggestions([]);
      return;
    }
    const t = text.trim();
    if (t.length < 3 || t === lastAuto.current) return;
    const h = setTimeout(async () => {
      lastAuto.current = t;
      try {
        setSuggestions(mode === "author" ? await openalex.autocompleteAuthors(t) : await openalex.autocompleteSources(t));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 350);
    return () => clearTimeout(h);
  }, [text, mode, entity, openalex]);

  async function execute(rawText: string, m: SearchMode, f: SearchFilters, s: SortOrder, page = 1) {
    setBusy(true);
    setError(null);
    const fullFilters: SearchFilters = { ...f };
    if (m === "author" && entity) fullFilters.authorId = entity.id;
    if (m === "journal" && entity) fullFilters.sourceId = entity.id;
    const prepared = m === "keywords" ? prepareQuery(rawText) : { kind: "keywords" as const, text: rawText.trim(), simplified: false };
    // En modo autor/revista con la entidad elegida, el texto es solo para encontrarla
    const sentText = (m === "author" || m === "journal") && entity ? "" : prepared.text;
    const record = { mode: m, filters: fullFilters, sort: s, sent: sentText || entity?.name || "" };
    try {
      if (prepared.kind === "doi" && prepared.doi && page === 1) {
        const w = await openalex.getByDoi(prepared.doi);
        const saved = await repo.saveSearch({ query: rawText.trim(), filters: record, source: "openalex", results: w ? [w] : [], totalHits: w ? 1 : 0, error: w ? null : "DOI no encontrado en OpenAlex" });
        if (!w) setError(`El DOI ${prepared.doi} no está en OpenAlex. Puede registrarlo manualmente en la Biblioteca.`);
        setRun({ searchId: saved.searchId, sentText: `doi:${prepared.doi}`, simplified: false, total: w ? 1 : 0, page: 1, perPage: 1, costUsd: 0, remainingUsd: null, rows: w ? [{ work: w, id: saved.ids[0]! }] : [] });
        setInLibrary(await repo.libraryMembership(saved.ids));
        return;
      }
      if (m !== "keywords" && !sentText && !entity) {
        setError(m === "author" ? "Elija un autor de la lista." : m === "journal" ? "Elija una revista de la lista." : "Escriba algo para buscar.");
        return;
      }
      if (m === "keywords" && !sentText) {
        setError("Escriba una pregunta, palabras clave o un DOI.");
        return;
      }
      const r = await openalex.searchWorks({ text: sentText, mode: m, filters: fullFilters, sort: s, page, perPage: PER_PAGE });
      let rows: Row[];
      let searchId: string;
      if (page === 1 || !run) {
        const saved = await repo.saveSearch({ query: rawText.trim() || entity?.name || "", filters: record, source: "openalex", results: r.works, totalHits: r.total });
        searchId = saved.searchId;
        rows = r.works.map((w, i) => ({ work: w, id: saved.ids[i]! }));
      } else {
        searchId = run.searchId;
        const ids = await repo.appendSearchResults(run.searchId, r.works);
        const seen = new Set(run.rows.map((x) => x.id));
        rows = [...run.rows, ...r.works.map((w, i) => ({ work: w, id: ids[i]! })).filter((x) => !seen.has(x.id))];
      }
      setRun({ searchId, sentText, simplified: prepared.simplified, total: r.total, page: r.page, perPage: r.perPage, costUsd: r.costUsd, remainingUsd: r.remainingUsd, rows });
      setInLibrary(await repo.libraryMembership(rows.map((x) => x.id)));
    } catch (e) {
      const msg = e instanceof OpenAlexError || e instanceof Error ? e.message : String(e);
      setError(msg);
      if (page === 1) await repo.saveSearch({ query: rawText.trim() || entity?.name || "", filters: record, source: "openalex", results: [], error: msg });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (savedId) setParams({});
    void execute(text, mode, filters, sort);
  }

  async function save(row: Row) {
    await repo.addToLibrary(row.id);
    setInLibrary(new Set([...inLibrary, row.id]));
    refresh();
  }

  const setF = (patch: Partial<SearchFilters>) => setFilters({ ...filters, ...patch });
  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
  const activeFilters = Object.values(filters).filter((v) => v !== null && v !== undefined && v !== false && v !== "").length;
  const modeInfo = MODES.find((x) => x.value === mode)!;

  return (
    <div className="bc-page">
      <div className="bc-page-head">
        <div>
          <h1>Buscador científico</h1>
          <p className="bc-sub">Fuente: OpenAlex (más de 250 millones de trabajos académicos). Más fuentes en próximas versiones.</p>
        </div>
      </div>

      <form className="bc-card" onSubmit={submit}>
        <div className="bc-row" style={{ gap: 8, marginBottom: 10 }}>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`bc-chip ${mode === m.value ? "bc-chip-on" : ""}`}
              aria-pressed={mode === m.value}
              onClick={() => {
                setMode(m.value);
                setEntity(null);
                setSuggestions([]);
                lastAuto.current = "";
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="bc-search" style={{ maxWidth: "none", boxShadow: "none" }}>
          <Icon name="search" size={20} />
          <input
            aria-label="Texto de búsqueda"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (entity) setEntity(null);
            }}
            placeholder={modeInfo.placeholder}
          />
          <button className="bc-btn bc-btn-primary" type="submit" disabled={busy}>
            {busy ? "Buscando…" : "Buscar"}
          </button>
        </div>

        {entity ? (
          <div className="bc-alert" style={{ marginTop: 10 }}>
            {mode === "author" ? "Autor" : "Revista"}: <strong>{entity.name}</strong>
            {entity.hint ? ` · ${entity.hint}` : ""} {entity.externalId ? ` · ${entity.externalId}` : ""}
            <button type="button" className="bc-btn bc-btn-ghost bc-btn-sm" onClick={() => setEntity(null)}>Cambiar</button>
          </div>
        ) : null}
        {suggestions.length > 0 ? (
          <ul className="bc-suggest" role="listbox" aria-label={mode === "author" ? "Autores encontrados" : "Revistas encontradas"}>
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setEntity(s);
                    setText(s.name);
                    setSuggestions([]);
                  }}
                >
                  <strong>{s.name}</strong>
                  <span>
                    {s.hint ?? "Sin institución"} · {s.worksCount ?? "?"} trabajos{s.externalId ? ` · ${s.externalId}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="bc-row" style={{ marginTop: 10, justifyContent: "space-between" }}>
          <button type="button" className="bc-btn bc-btn-sm" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
            Filtros{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          <label className="bc-row" style={{ gap: 6, fontSize: "0.9rem" }}>
            Ordenar por
            <select className="bc-select" style={{ width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value as SortOrder)} aria-label="Orden">
              <option value="relevance">Relevancia</option>
              <option value="cited">Más citados</option>
              <option value="recent">Más recientes</option>
            </select>
          </label>
        </div>

        {showFilters ? (
          <div className="bc-filters" data-testid="filters">
            <div>
              <label className="bc-label" htmlFor="f-from">Año desde</label>
              <input id="f-from" className="bc-input" inputMode="numeric" value={filters.yearFrom ?? ""} onChange={(e) => setF({ yearFrom: numOrNull(e.target.value) })} />
            </div>
            <div>
              <label className="bc-label" htmlFor="f-to">Año hasta</label>
              <input id="f-to" className="bc-input" inputMode="numeric" value={filters.yearTo ?? ""} onChange={(e) => setF({ yearTo: numOrNull(e.target.value) })} />
            </div>
            <div>
              <label className="bc-label" htmlFor="f-type">Tipo de documento</label>
              <select id="f-type" className="bc-select" value={filters.type ?? ""} onChange={(e) => setF({ type: e.target.value || null })}>
                <option value="">Todos</option>
                {Object.entries(WORK_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="bc-label" htmlFor="f-area">Área científica</label>
              <select id="f-area" className="bc-select" value={filters.domainId ?? ""} onChange={(e) => setF({ domainId: e.target.value || null })}>
                <option value="">Todas</option>
                {DOMAINS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="bc-label" htmlFor="f-lang">Idioma</label>
              <select id="f-lang" className="bc-select" value={filters.language ?? ""} onChange={(e) => setF({ language: e.target.value || null })}>
                <option value="">Todos</option>
                {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="bc-label" htmlFor="f-cites">Citas mínimas</label>
              <input id="f-cites" className="bc-input" inputMode="numeric" value={filters.minCitations ?? ""} onChange={(e) => setF({ minCitations: numOrNull(e.target.value) })} />
            </div>
            <label className="bc-row" style={{ gap: 6, alignSelf: "end", paddingBottom: 8 }}>
              <input type="checkbox" checked={!!filters.openAccess} onChange={(e) => setF({ openAccess: e.target.checked })} /> Solo acceso abierto
            </label>
            <button type="button" className="bc-btn bc-btn-ghost bc-btn-sm" style={{ alignSelf: "end" }} onClick={() => setFilters({})}>Quitar filtros</button>
          </div>
        ) : null}
      </form>

      {error ? <div className="bc-alert bc-alert-error" role="alert" style={{ marginTop: 16 }}>{error}</div> : null}

      {run ? (
        <section className="bc-card" style={{ marginTop: 16 }} aria-label="Resultados">
          <div className="bc-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ margin: 0 }} data-testid="results-count">
              {run.total.toLocaleString("es")} resultados
            </h2>
            <span className="bc-sub" style={{ fontSize: "0.82rem" }}>
              {savedId
                ? "Búsqueda guardada · mostrada sin conexión, sin costo"
                : run.costUsd !== null
                  ? `Costo de esta consulta en OpenAlex: ${run.costUsd} USD${run.remainingUsd !== null ? ` · saldo gratuito de hoy: ${run.remainingUsd} USD` : ""}`
                  : ""}
            </span>
          </div>
          {run.simplified ? (
            <p className="bc-sub" style={{ fontSize: "0.85rem", marginTop: 6 }} data-testid="sent-query">
              OpenAlex busca por palabras; se envió: <code>{run.sentText}</code>
            </p>
          ) : null}
          {run.rows.length ? (
            <div style={{ marginTop: 8 }}>
              <ExportButton label="Exportar estos resultados" baseName={`busqueda ${run.sentText ?? ""}`} getWorks={async () => run.rows.map((r) => r.work)} />
            </div>
          ) : null}
          {run.rows.length === 0 ? <p className="bc-empty">Sin resultados con estos criterios.</p> : null}
          {run.rows.map((row) => (
            <WorkItem
              key={row.id}
              work={row.work}
              actions={
                <>
                  <CiteButton work={row.work} />
                  {inLibrary.has(row.id) ? (
                    <span className="bc-badge bc-badge-green">En su biblioteca</span>
                  ) : (
                    <button className="bc-btn bc-btn-sm bc-btn-primary" onClick={() => save(row)}>Guardar en biblioteca</button>
                  )}
                  {projects.data && projects.data.length ? (
                    <select
                      className="bc-select bc-btn-sm"
                      style={{ width: "auto" }}
                      aria-label="Añadir a proyecto"
                      defaultValue=""
                      onChange={async (e) => {
                        if (!e.target.value) return;
                        await repo.addWorkToProject(e.target.value, row.id);
                        setInLibrary(new Set([...inLibrary, row.id]));
                        e.target.value = "";
                        refresh();
                      }}
                    >
                      <option value="">Añadir a proyecto…</option>
                      {projects.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : null}
                </>
              }
            />
          ))}
          {!savedId && run.rows.length < run.total && run.perPage > 1 ? (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button className="bc-btn" disabled={busy} onClick={() => execute(text, mode, filters, sort, run.page + 1)}>
                {busy ? "Cargando…" : "Cargar más resultados"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="bc-card" style={{ marginTop: 16 }}>
        <h2>Historial de búsquedas</h2>
        <p className="bc-sub" style={{ fontSize: "0.85rem" }}>Al abrir una búsqueda guardada se muestran sus resultados desde su equipo, sin internet ni costo.</p>
        {history.data && history.data.length === 0 ? <p className="bc-sub">Todavía no hay búsquedas.</p> : null}
        {history.data && history.data.length > 0 ? (
          <table className="bc-table">
            <thead>
              <tr><th>Consulta</th><th>Resultados</th><th>Fecha</th><th><span className="bc-sr">Acciones</span></th></tr>
            </thead>
            <tbody>
              {history.data.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/buscar?s=${s.id}`}>{s.query || "(sin texto)"}</Link></td>
                  <td>{s.error ? <span className="bc-badge bc-badge-warn">{s.error.slice(0, 60)}</span> : `${s.resultCount}${s.totalHits ? ` de ${s.totalHits.toLocaleString("es")}` : ""}`}</td>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                  <td>
                    <button
                      className="bc-btn bc-btn-ghost bc-btn-sm"
                      aria-label={`Borrar del historial: ${s.query}`}
                      onClick={async () => {
                        await repo.deleteSearch(s.id);
                        if (savedId === s.id) setParams({});
                        refresh();
                      }}
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
