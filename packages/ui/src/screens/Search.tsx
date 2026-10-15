import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Work } from "@biociencia/core";
import {
  DOMAINS, googleScholarUrl, OpenAlexError, prepareQuery, searchSources, SOURCE_LABELS, WORK_TYPES,
  type AutocompleteItem, type SearchFilters, type SearchMode, type SortOrder, type SourceOutcome,
} from "@biociencia/sources";
import { useApp, useAsync, type SearchSourceId } from "../context.tsx";
import { FullTextButton } from "../components/FullText.tsx";
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
  foundIn?: string[];
}

/** Fuentes disponibles: OpenAlex cobra por uso; las demás son gratuitas. */
const SOURCE_OPTIONS: { id: SearchSourceId; note: string }[] = [
  { id: "europepmc", note: "gratis · incluye PubMed y preprints" },
  { id: "pubmed", note: "gratis · biomedicina y agro" },
  { id: "crossref", note: "gratis · casi todos los DOI" },
  { id: "doaj", note: "gratis · revistas abiertas, SciELO" },
  { id: "openalex", note: "0,001 USD por búsqueda (100 gratis al día)" },
];
const DEFAULT_SOURCES: SearchSourceId[] = ["europepmc", "pubmed", "crossref", "doaj"];

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
  /** Búsqueda en varias fuentes: resultado de cada una */
  outcomes?: SourceOutcome[];
  /** Búsqueda guardada que se hizo en varias fuentes */
  sourcesLabel?: string;
}

const PER_PAGE = 20;

export function Search() {
  const { repo, openalex, refresh, sources } = useApp();
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
  const [selected, setSelected] = useState<SearchSourceId[] | null>(null);

  // Fuentes elegidas (se recuerdan en esta computadora)
  useEffect(() => {
    void repo.getSetting("search_sources").then((v) => {
      try {
        const arr = JSON.parse(v ?? "null");
        setSelected(Array.isArray(arr) && arr.length ? arr.filter((x) => SOURCE_OPTIONS.some((o) => o.id === x)) : DEFAULT_SOURCES);
      } catch {
        setSelected(DEFAULT_SOURCES);
      }
    });
  }, [repo]);
  function toggleSource(id: SearchSourceId) {
    const cur = selected ?? DEFAULT_SOURCES;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (next.length === 0) return;
    setSelected(next);
    void repo.setSetting("search_sources", JSON.stringify(next));
  }

  const history = useAsync(() => repo.listSearches(15), []);
  const projects = useAsync(() => repo.listProjects(), []);

  // Búsqueda pedida desde Inicio (?q=…)
  useEffect(() => {
    if (q && !savedId && selected) {
      setText(q);
      void execute(q, "keywords", {}, "relevance");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, selected === null]);

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
      const multi = s.source.startsWith("varias:") ? s.source.slice(7).split(",").map((x) => SOURCE_LABELS[x] ?? x).join(", ") : undefined;
      setRun({ searchId: s.id, sentText: s.query, simplified: false, total: s.totalHits ?? rows.length, page: Math.ceil(rows.length / PER_PAGE) || 1, perPage: PER_PAGE, costUsd: 0, remainingUsd: null, rows, sourcesLabel: multi });
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
      const chosen = selected ?? DEFAULT_SOURCES;
      if (m === "keywords" && !(chosen.length === 1 && chosen[0] === "openalex")) {
        const u = await searchSources(chosen.map((id) => sources[id]), {
          text: sentText,
          filters: { yearFrom: fullFilters.yearFrom, yearTo: fullFilters.yearTo, openAccess: fullFilters.openAccess },
          sort: s,
          page,
          perPage: PER_PAGE,
        });
        const failed = u.outcomes.filter((o) => o.error);
        const label = `varias:${chosen.join(",")}`;
        const oa = u.outcomes.find((o) => o.source === "openalex");
        let rows: Row[];
        let searchId: string;
        if (page === 1 || !run) {
          const saved = await repo.saveSearch({
            query: rawText.trim(), filters: { ...record, sources: chosen }, source: label, results: u.works, totalHits: u.totalReported,
            error: failed.length === u.outcomes.length ? failed.map((o) => o.error).join(" · ") : null,
          });
          searchId = saved.searchId;
          rows = u.works.map((w, i) => ({ work: w, id: saved.ids[i]!, foundIn: w.foundIn }));
        } else {
          searchId = run.searchId;
          const ids = await repo.appendSearchResults(run.searchId, u.works);
          const seen = new Set(run.rows.map((x) => x.id));
          rows = [...run.rows, ...u.works.map((w, i) => ({ work: w, id: ids[i]!, foundIn: w.foundIn })).filter((x) => !seen.has(x.id))];
        }
        // Un mismo artículo puede llegar dos veces con ids locales iguales: se deja uno
        const uniq = new Map<string, Row>();
        for (const r of rows) if (!uniq.has(r.id)) uniq.set(r.id, r);
        rows = [...uniq.values()];
        if (failed.length === u.outcomes.length) setError(`Ninguna fuente respondió: ${failed.map((o) => `${o.label}: ${o.error}`).join(" · ")}`);
        setRun({
          searchId, sentText, simplified: prepared.simplified, total: u.totalReported, page, perPage: PER_PAGE,
          costUsd: oa?.costUsd ?? null, remainingUsd: oa?.remainingUsd ?? null, rows, outcomes: u.outcomes,
        });
        setInLibrary(await repo.libraryMembership(rows.map((x) => x.id)));
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
          <p className="bc-sub">Busca a la vez en Europe PMC, PubMed, Crossref, DOAJ y, si lo elige, OpenAlex. Los resultados repetidos se unen en una sola ficha.</p>
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

        {mode === "keywords" && selected ? (
          <fieldset className="bc-sources" aria-label="Fuentes de búsqueda">
            <legend className="bc-sub" style={{ fontSize: "0.82rem" }}>Fuentes</legend>
            {SOURCE_OPTIONS.map((o) => (
              <label key={o.id} className={`bc-chip ${selected.includes(o.id) ? "bc-chip-on" : ""}`} title={o.note}>
                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleSource(o.id)} aria-label={`${SOURCE_LABELS[o.id]} (${o.note})`} />
                {SOURCE_LABELS[o.id]} <span className="bc-chip-note">{o.id === "openalex" ? "0,001 USD" : "gratis"}</span>
              </label>
            ))}
          </fieldset>
        ) : mode !== "keywords" ? (
          <p className="bc-sub" style={{ fontSize: "0.82rem", marginTop: 8 }}>La búsqueda por {mode === "title" ? "título" : mode === "author" ? "autor" : "revista"} usa OpenAlex (0,001 USD por búsqueda; elegir el autor o la revista de la lista es gratis).</p>
        ) : null}

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
            <p className="bc-sub" style={{ fontSize: "0.78rem", gridColumn: "1 / -1", margin: 0 }}>
              Años y «solo acceso abierto» se aplican en todas las fuentes (Crossref no permite filtrar acceso abierto y se omite). Tipo, área, idioma y citas mínimas solo en OpenAlex.
            </p>
          </div>
        ) : null}
      </form>

      {error ? <div className="bc-alert bc-alert-error" role="alert" style={{ marginTop: 16 }}>{error}</div> : null}

      {run ? (
        <section className="bc-card" style={{ marginTop: 16 }} aria-label="Resultados">
          <div className="bc-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ margin: 0 }} data-testid="results-count">
              {run.outcomes ? `${run.rows.length} resultados combinados` : run.sourcesLabel ? `${run.rows.length} resultados guardados` : `${run.total.toLocaleString("es")} resultados`}
            </h2>
            <span className="bc-sub" style={{ fontSize: "0.82rem" }}>
              {savedId
                ? `Búsqueda guardada · mostrada sin conexión, sin costo${run.sourcesLabel ? ` · fuentes: ${run.sourcesLabel}` : ""}`
                : run.costUsd !== null
                  ? `Costo de esta consulta en OpenAlex: ${run.costUsd} USD${run.remainingUsd !== null ? ` · saldo gratuito de hoy: ${run.remainingUsd} USD` : ""}`
                  : ""}
            </span>
          </div>
          {run.outcomes ? (
            <div className="bc-row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }} data-testid="source-outcomes">
              {run.outcomes.map((o) => (
                <span key={o.source} className={`bc-badge ${o.error ? "bc-badge-warn" : o.skipped ? "" : "bc-badge-blue"}`} title={o.error ?? o.skipped ?? o.url ?? ""}>
                  {o.label}: {o.error ? `error — ${o.error}` : o.skipped ? "omitida" : `${o.total.toLocaleString("es")} encontrados`}
                </span>
              ))}
            </div>
          ) : null}
          {run.simplified ? (
            <p className="bc-sub" style={{ fontSize: "0.85rem", marginTop: 6 }} data-testid="sent-query">
              Las fuentes buscan por palabras; se envió: <code>{run.sentText}</code>
            </p>
          ) : null}
          {run.rows.length ? (
            <div style={{ marginTop: 8 }}>
              <div className="bc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <ExportButton label="Exportar estos resultados" baseName={`busqueda ${run.sentText ?? ""}`} getWorks={async () => run.rows.map((r) => r.work)} />
                {run.sentText ? <a className="bc-btn bc-btn-sm" href={googleScholarUrl(run.sentText)} target="_blank" rel="noreferrer">Buscar también en Google Académico</a> : null}
              </div>
            </div>
          ) : null}
          {run.rows.length === 0 ? <p className="bc-empty">Sin resultados con estos criterios.</p> : null}
          {run.rows.map((row) => (
            <WorkItem
              key={row.id}
              work={row.work}
              extra={row.foundIn && row.foundIn.length > 1 ? <div className="bc-sub" style={{ fontSize: "0.78rem", marginTop: 4 }}>Encontrado en: {row.foundIn.map((f) => SOURCE_LABELS[f] ?? f).join(", ")}</div> : null}
              actions={
                <>
                  <FullTextButton work={row.work} />
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
          {!savedId && (run.outcomes ? run.outcomes.some((o) => !o.error && !o.skipped && o.total > run.page * run.perPage) : run.rows.length < run.total) && run.perPage > 1 ? (
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
