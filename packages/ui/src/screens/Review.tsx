import { useEffect, useMemo, useState } from "react";
import {
  buildStrategy, DOCX_MIME, EXCLUSION_REASONS, formatReference, manuscriptDocx, methodsText, prismaCounts, segsToText,
  type Block, type Concept, type Decision, type ReviewQuestion, type SourceRun, type Work,
} from "@biociencia/core";
import { METHODS, runReviewSearch, SOURCE_LABELS, STUDY_TYPES, type MethodId, type StudyType } from "@biociencia/sources";
import { useApp, useAsync, type SearchSourceId } from "../context.tsx";
import { ExportButton } from "../components/RefsIO.tsx";
import { formatAuthors } from "../components/WorkItem.tsx";

/**
 * Revisión de literatura estructurada (sin IA): pregunta → conceptos y sinónimos → estrategia booleana
 * por base de datos → búsqueda → cribado con motivos → diagrama PRISMA 2020 y exportación.
 */

const FRAMEWORKS: Record<ReviewQuestion["framework"], { label: string; concepts: string[] }> = {
  pico: { label: "PICO (población, intervención, comparación, resultado)", concepts: ["Población / cultivo", "Intervención", "Comparación (opcional)", "Resultado"] },
  peo: { label: "PEO (población, exposición, resultado)", concepts: ["Población / cultivo", "Exposición / patógeno / factor", "Resultado"] },
  libre: { label: "Conceptos libres", concepts: ["Concepto 1", "Concepto 2"] },
};

const REVIEW_SOURCES: SearchSourceId[] = ["pubmed", "europepmc", "crossref", "doaj"];

interface Filters {
  yearFrom?: number | null;
  yearTo?: number | null;
  openAccess?: boolean;
  studyTypes?: StudyType[];
  method?: MethodId | null;
  sources?: SearchSourceId[];
  maxPerSource?: number;
}

export function Review() {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId ? <ReviewDetail id={openId} onClose={() => setOpenId(null)} /> : <ReviewList onOpen={setOpenId} />;
}

function ReviewList({ onOpen }: { onOpen: (id: string) => void }) {
  const { repo, refresh } = useApp();
  const list = useAsync(() => repo.listReviews(), []);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="bc-page">
      <h1>Revisión de literatura</h1>
      <p className="bc-sub">
        Planifique una búsqueda sistemática: defina su pregunta y los sinónimos de cada concepto, y BioCiencia arma la estrategia booleana para
        PubMed y Europe PMC, busca, quita repetidos y le ayuda a cribar artículo por artículo. Al final obtiene el diagrama PRISMA 2020, la
        estrategia para la sección de métodos y la lista de incluidos. No usa inteligencia artificial: usted decide qué entra.
      </p>
      <div className="bc-card">
        <h2>Nueva revisión</h2>
        <form
          aria-label="Nueva revisión"
          className="bc-row"
          style={{ gap: 8, flexWrap: "wrap" }}
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const id = await repo.saveReview({
                title: title || "Revisión sin título",
                projectId: null,
                question: { question: "", framework: "peo", concepts: FRAMEWORKS.peo.concepts.map((name) => ({ name, terms: [] })) } satisfies ReviewQuestion,
                filters: { sources: ["pubmed", "europepmc"], maxPerSource: 100 } satisfies Filters,
              });
              refresh();
              onOpen(id);
            } catch (err) {
              setMsg(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <input className="bc-input" style={{ flex: 2, minWidth: 220 }} aria-label="Título de la revisión" placeholder="p. ej. Resistencia del maíz a Stenocarpella" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="bc-btn bc-btn-primary" type="submit">Crear</button>
        </form>
        {msg ? <div className="bc-alert bc-alert-error" role="status">{msg}</div> : null}
      </div>
      <div className="bc-card">
        <h2>Mis revisiones</h2>
        {list.data?.length === 0 ? <div className="bc-empty">Todavía no hay revisiones.</div> : null}
        {list.data?.length ? (
          <table className="bc-table">
            <thead><tr><th>Título</th><th>Registros</th><th>Por cribar</th><th>Incluidos</th><th>Última búsqueda</th><th /></tr></thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <td><button className="bc-btn bc-btn-ghost" style={{ padding: 0 }} onClick={() => onOpen(r.id)}>{r.title}</button></td>
                  <td>{r.total}</td>
                  <td>{r.pending}</td>
                  <td>{r.included}</td>
                  <td>{r.searchedAt ? new Date(r.searchedAt).toLocaleString("es") : "—"}</td>
                  <td>
                    <button className="bc-btn bc-btn-sm" aria-label={`Eliminar ${r.title}`} onClick={async () => {
                      if (!window.confirm(`¿Eliminar la revisión «${r.title}»? Las publicaciones guardadas en su biblioteca no se borran.`)) return;
                      await repo.deleteReview(r.id);
                      refresh();
                    }}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}

type Step = "plan" | "screen" | "result";
type Rec = { work: Work; decision: Decision; reason: string | null; foundIn: string[] };

function ReviewDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { repo, sources, refresh } = useApp();
  const [title, setTitle] = useState("");
  const [q, setQ] = useState<ReviewQuestion | null>(null);
  const [f, setF] = useState<Filters>({});
  const [runs, setRuns] = useState<SourceRun[]>([]);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [step, setStep] = useState<Step>("plan");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function load() {
    const r = await repo.getReview(id);
    if (!r) return;
    setTitle(r.title);
    setQ({ question: r.question?.question ?? "", framework: r.question?.framework ?? "peo", concepts: r.question?.concepts ?? [] });
    setF(r.filters ?? {});
    setRuns(r.runs ?? []);
    setSearchedAt(r.searchedAt);
    setRecs(await repo.listReviewRecords(id));
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!q) return <div className="bc-page">Cargando…</div>;

  const save = (nq = q, nf = f) => repo.saveReview({ id, title: title || "Revisión sin título", projectId: null, question: nq, filters: nf });
  const chosen: SearchSourceId[] = (f.sources?.length ? f.sources : (["pubmed", "europepmc"] as SearchSourceId[])).filter((s) => REVIEW_SOURCES.includes(s));

  async function runSearch() {
    setMsg(null);
    if (!q!.concepts.some((c) => c.terms.some((t) => t.trim()))) return setMsg({ text: "Escriba al menos un término en algún concepto.", error: true });
    await save();
    setBusy("Buscando…");
    try {
      const r = await runReviewSearch(chosen.map((s) => sources[s]), q!, {
        filters: { yearFrom: f.yearFrom, yearTo: f.yearTo, openAccess: f.openAccess, studyTypes: f.studyTypes, method: f.method ?? null },
        maxPerSource: f.maxPerSource ?? 100,
        onProgress: (m) => setBusy(m),
      });
      if (r.runs.every((x) => x.error || x.skipped)) {
        setRuns(r.runs);
        return setMsg({ text: `Ninguna fuente respondió: ${r.runs.map((x) => `${x.label}: ${x.error ?? x.skipped}`).join(" · ")}`, error: true });
      }
      setBusy("Guardando registros…");
      const s = await repo.setReviewResults(id, r.runs, r.works);
      await load();
      refresh();
      setMsg({ text: `Búsqueda terminada: ${r.works.length} registros únicos (${s.added} nuevos; ${s.kept} ya estaban y conservan su decisión).` });
      setStep("screen");
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function decide(r: Rec, decision: Decision, reason: string | null = null) {
    await repo.setReviewDecision(id, r.work.id!, decision, reason);
    setRecs((all) => all.map((x) => (x.work.id === r.work.id ? { ...x, decision, reason: decision === "exclude" ? reason : null } : x)));
  }

  const counts = prismaCounts(runs, recs);

  return (
    <div className="bc-page">
      <div className="bc-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <button className="bc-btn bc-btn-ghost" onClick={() => { refresh(); onClose(); }}>← Mis revisiones</button>
        <span className="bc-sub">{counts.screened ? `${counts.screened - counts.pending} de ${counts.screened} cribados · ${counts.included} incluidos` : "Sin búsqueda todavía"}</span>
      </div>
      <input className="bc-input" style={{ fontWeight: 700, fontSize: "1.1rem", margin: "8px 0" }} aria-label="Título de la revisión" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void save()} />
      <div className="bc-row" role="tablist" style={{ gap: 6, marginBottom: 12 }}>
        {([["plan", "1. Pregunta y búsqueda"], ["screen", `2. Cribado (${counts.pending} pendientes)`], ["result", "3. Resultados y PRISMA"]] as [Step, string][]).map(([s, l]) => (
          <button key={s} role="tab" aria-selected={step === s} className={`bc-btn ${step === s ? "bc-btn-primary" : ""}`} onClick={() => setStep(s)}>{l}</button>
        ))}
      </div>
      {msg ? <div className={`bc-alert ${msg.error ? "bc-alert-error" : ""}`} role="status" style={{ marginBottom: 10 }}>{msg.text}</div> : null}
      {busy ? <div className="bc-alert" role="status" style={{ marginBottom: 10 }}>{busy}</div> : null}

      {step === "plan" ? (
        <PlanStep q={q} setQ={setQ} f={f} setF={setF} chosen={chosen} onSave={save} onRun={runSearch} busy={!!busy} runs={runs} searchedAt={searchedAt} />
      ) : step === "screen" ? (
        <ScreenStep recs={recs} decide={decide} />
      ) : (
        <ResultStep title={title} q={q} f={f} runs={runs} recs={recs} searchedAt={searchedAt} />
      )}
    </div>
  );
}

function PlanStep(props: {
  q: ReviewQuestion; setQ: (q: ReviewQuestion) => void; f: Filters; setF: (f: Filters) => void; chosen: SearchSourceId[];
  onSave: (q?: ReviewQuestion, f?: Filters) => Promise<unknown>; onRun: () => void; busy: boolean; runs: SourceRun[]; searchedAt: string | null;
}) {
  const { q, setQ, f, setF, chosen, onSave, onRun, busy, runs, searchedAt } = props;
  const setConcept = (i: number, patch: Partial<Concept>) => setQ({ ...q, concepts: q.concepts.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const strategies = useMemo(() => ({ pubmed: buildStrategy(q, "pubmed"), europepmc: buildStrategy(q, "europepmc"), simple: buildStrategy(q, "simple") }), [q]);
  const toggleSource = (s: SearchSourceId, on: boolean) => setF({ ...f, sources: on ? [...chosen, s] : chosen.filter((x) => x !== s) });
  return (
    <div className="bc-grid-2" style={{ alignItems: "start" }} onBlur={() => void onSave()}>
      <div className="bc-card">
        <h2>Pregunta</h2>
        <label className="bc-label" htmlFor="rv-q">Pregunta de investigación</label>
        <textarea id="rv-q" className="bc-textarea" style={{ minHeight: 70 }} value={q.question} onChange={(e) => setQ({ ...q, question: e.target.value })}
          placeholder="¿Qué fuentes de resistencia a la pudrición de mazorca por Stenocarpella se han evaluado en maíz?" />
        <label className="bc-label" htmlFor="rv-fw">Esquema</label>
        <select id="rv-fw" className="bc-select" value={q.framework} onChange={(e) => {
          const fw = e.target.value as ReviewQuestion["framework"];
          // Conserva los términos ya escritos y ajusta los nombres de los conceptos
          const names = FRAMEWORKS[fw].concepts;
          const concepts = names.map((name, i) => ({ name, terms: q.concepts[i]?.terms ?? [] }));
          for (let i = names.length; i < q.concepts.length; i++) if (q.concepts[i]!.terms.length) concepts.push(q.concepts[i]!);
          setQ({ ...q, framework: fw, concepts });
        }}>
          {Object.entries(FRAMEWORKS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <h3 style={{ marginTop: 14 }}>Conceptos y sinónimos</h3>
        <p className="bc-sub" style={{ fontSize: "0.82rem" }}>
          Un término por línea, en inglés (idioma de los resúmenes indexados). Use * al final para incluir variantes: <code>resist*</code> encuentra
          resistance, resistant… Los sinónimos de un concepto se unen con OR; los conceptos entre sí, con AND. Un concepto vacío no se usa.
        </p>
        {q.concepts.map((c, i) => (
          <div key={i} className="bc-concept" style={{ marginBottom: 8 }}>
            <div className="bc-row" style={{ gap: 6 }}>
              <input className="bc-input" style={{ fontWeight: 600 }} aria-label={`Nombre del concepto ${i + 1}`} value={c.name} onChange={(e) => setConcept(i, { name: e.target.value })} />
              <button className="bc-btn bc-btn-sm bc-btn-ghost" aria-label={`Quitar concepto ${i + 1}`} onClick={() => setQ({ ...q, concepts: q.concepts.filter((_, j) => j !== i) })}>✕</button>
            </div>
            <textarea className="bc-textarea mono" style={{ minHeight: 64, marginTop: 6, fontSize: "0.85rem" }} aria-label={`Términos de ${c.name}`}
              value={c.terms.join("\n")} onChange={(e) => setConcept(i, { terms: e.target.value.split("\n") })} />
          </div>
        ))}
        <button className="bc-btn bc-btn-sm" onClick={() => setQ({ ...q, concepts: [...q.concepts, { name: `Concepto ${q.concepts.length + 1}`, terms: [] }] })}>+ Concepto</button>
      </div>

      <div>
        <div className="bc-card">
          <h2>Bases de datos y filtros</h2>
          <fieldset style={{ border: 0, padding: 0 }} aria-label="Bases de datos de la revisión">
            {(["pubmed", "europepmc", "crossref", "doaj"] as SearchSourceId[]).map((s) => (
              <label key={s} className="bc-row" style={{ gap: 6 }}>
                <input type="checkbox" checked={chosen.includes(s)} onChange={(e) => toggleSource(s, e.target.checked)} />
                {SOURCE_LABELS[s]}
                <span className="bc-sub" style={{ fontSize: "0.75rem" }}>{s === "pubmed" || s === "europepmc" ? "estrategia completa en título y resumen" : "consulta simplificada (sin lógica booleana)"}</span>
              </label>
            ))}
          </fieldset>
          <div className="bc-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <label>Año desde <input className="bc-input" style={{ width: 90 }} inputMode="numeric" value={f.yearFrom ?? ""} onChange={(e) => setF({ ...f, yearFrom: Number(e.target.value) || null })} /></label>
            <label>hasta <input className="bc-input" style={{ width: 90 }} inputMode="numeric" value={f.yearTo ?? ""} onChange={(e) => setF({ ...f, yearTo: Number(e.target.value) || null })} /></label>
            <label className="bc-row" style={{ gap: 4 }}><input type="checkbox" checked={!!f.openAccess} onChange={(e) => setF({ ...f, openAccess: e.target.checked })} /> Solo acceso abierto</label>
          </div>
          <label className="bc-label" style={{ marginTop: 8 }}>Tipo de estudio (solo PubMed y Europe PMC)</label>
          <div className="bc-row" style={{ gap: 6, flexWrap: "wrap" }}>
            {STUDY_TYPES.map((t) => {
              const on = f.studyTypes?.includes(t.id) ?? false;
              return (
                <label key={t.id} className={`bc-chip ${on ? "bc-chip-on" : ""}`} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.8rem" }}>
                  <input type="checkbox" checked={on} onChange={(e) => setF({ ...f, studyTypes: e.target.checked ? [...(f.studyTypes ?? []), t.id] : (f.studyTypes ?? []).filter((x) => x !== t.id) })} />
                  {t.label}
                </label>
              );
            })}
          </div>
          <div className="bc-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <label>Método{" "}
              <select className="bc-select" style={{ width: "auto" }} value={f.method ?? ""} onChange={(e) => setF({ ...f, method: (e.target.value || null) as MethodId | null })}>
                <option value="">Cualquiera</option>
                {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label>Máximo por base{" "}
              <select className="bc-select" style={{ width: "auto" }} value={f.maxPerSource ?? 100} onChange={(e) => setF({ ...f, maxPerSource: Number(e.target.value) })}>
                {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="bc-card">
          <h2>Estrategia generada</h2>
          {(["pubmed", "europepmc"] as const).map((k) => (
            <div key={k} style={{ marginBottom: 8 }}>
              <div className="bc-label">{SOURCE_LABELS[k]}</div>
              <code className="mono" data-testid={`strategy-${k}`} style={{ display: "block", whiteSpace: "pre-wrap", fontSize: "0.8rem", background: "var(--bc-surface-2)", padding: 8, borderRadius: 6 }}>
                {strategies[k] || "—"}
              </code>
            </div>
          ))}
          {chosen.some((s) => s === "crossref" || s === "doaj") ? <div className="bc-sub" style={{ fontSize: "0.8rem" }}>Crossref / DOAJ: <code>{strategies.simple || "—"}</code></div> : null}
          <button className="bc-btn bc-btn-primary" style={{ marginTop: 10 }} disabled={busy || !chosen.length} onClick={onRun}>
            {searchedAt ? "Repetir búsqueda" : "Buscar"}
          </button>
          {runs.length ? (
            <table className="bc-table" style={{ marginTop: 10 }} aria-label="Resultado por base de datos">
              <thead><tr><th>Base</th><th>Encontrados</th><th>Recuperados</th><th>Estado</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.source}>
                    <td>{r.label}</td>
                    <td>{r.found.toLocaleString("es")}</td>
                    <td>{r.retrieved}</td>
                    <td>{r.error ? <span className="bc-badge bc-badge-warn">Error: {r.error}</span> : r.skipped ? <span className="bc-badge">{r.skipped}</span> : "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {searchedAt ? <div className="bc-sub" style={{ fontSize: "0.8rem" }}>Última búsqueda: {new Date(searchedAt).toLocaleString("es")}</div> : null}
        </div>
      </div>
    </div>
  );
}

function ScreenStep({ recs, decide }: { recs: Rec[]; decide: (r: Rec, d: Decision, reason?: string | null) => Promise<void> }) {
  const [show, setShow] = useState<Decision | "all">("pending");
  const [limit, setLimit] = useState(25);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const shown = recs.filter((r) => show === "all" || r.decision === show);
  if (!recs.length) return <div className="bc-empty">Primero ejecute la búsqueda en «1. Pregunta y búsqueda».</div>;
  return (
    <div className="bc-card">
      <div className="bc-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <select className="bc-select" style={{ width: "auto" }} aria-label="Mostrar" value={show} onChange={(e) => { setShow(e.target.value as typeof show); setLimit(25); }}>
          <option value="pending">Por cribar ({recs.filter((r) => r.decision === "pending").length})</option>
          <option value="include">Incluidos ({recs.filter((r) => r.decision === "include").length})</option>
          <option value="exclude">Excluidos ({recs.filter((r) => r.decision === "exclude").length})</option>
          <option value="all">Todos ({recs.length})</option>
        </select>
        <span className="bc-sub" style={{ fontSize: "0.82rem" }}>Lea el título y el resumen y decida. Para excluir, elija el motivo (se cuenta en el diagrama PRISMA).</span>
      </div>
      {shown.length === 0 ? <div className="bc-empty">{show === "pending" ? "¡Cribado terminado! Vea «3. Resultados y PRISMA»." : "Nada que mostrar."}</div> : null}
      {shown.slice(0, limit).map((r) => {
        const k = r.work.id!;
        return (
          <article key={k} className="bc-screen-item" data-decision={r.decision} data-testid="screen-item">
            <div style={{ fontWeight: 600 }}>{r.work.title}</div>
            <div className="bc-sub" style={{ fontSize: "0.82rem" }}>
              {formatAuthors(r.work, 3)} · {r.work.year ?? "s. f."}{r.work.venue ? ` · ${r.work.venue}` : ""} · {r.foundIn.map((s) => SOURCE_LABELS[s] ?? s).join(", ")}
              {r.work.doi ? <> · <a href={`https://doi.org/${r.work.doi}`} target="_blank" rel="noreferrer">DOI</a></> : null}
            </div>
            {r.work.abstract ? (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Resumen</summary>
                <p style={{ fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>{r.work.abstract}</p>
              </details>
            ) : <div className="bc-sub" style={{ fontSize: "0.8rem" }}>Sin resumen en la fuente.</div>}
            <div className="bc-row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {r.decision === "pending" ? (
                <>
                  <button className="bc-btn bc-btn-sm bc-btn-primary" onClick={() => void decide(r, "include")}>Incluir</button>
                  <select className="bc-select bc-btn-sm" style={{ width: "auto" }} aria-label={`Motivo de exclusión: ${r.work.title.slice(0, 40)}`} value={reasons[k] ?? ""} onChange={(e) => setReasons({ ...reasons, [k]: e.target.value })}>
                    <option value="">Motivo de exclusión…</option>
                    {EXCLUSION_REASONS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <button className="bc-btn bc-btn-sm" disabled={!reasons[k]} onClick={() => void decide(r, "exclude", reasons[k])}>Excluir</button>
                </>
              ) : (
                <>
                  <span className={`bc-badge ${r.decision === "include" ? "bc-badge-green" : ""}`}>{r.decision === "include" ? "Incluido" : `Excluido: ${r.reason}`}</span>
                  <button className="bc-btn bc-btn-sm bc-btn-ghost" onClick={() => void decide(r, "pending")}>Deshacer</button>
                </>
              )}
            </div>
          </article>
        );
      })}
      {shown.length > limit ? <button className="bc-btn" style={{ marginTop: 8 }} onClick={() => setLimit(limit + 25)}>Mostrar más ({shown.length - limit} restantes)</button> : null}
    </div>
  );
}

function ResultStep({ title, q, f, runs, recs, searchedAt }: { title: string; q: ReviewQuestion; f: Filters; runs: SourceRun[]; recs: Rec[]; searchedAt: string | null }) {
  const { repo, saveFile, refresh } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  const c = prismaCounts(runs, recs);
  const included = recs.filter((r) => r.decision === "include").map((r) => r.work);
  const extra = [
    ...(f.studyTypes ?? []).map((s) => STUDY_TYPES.find((t) => t.id === s)?.label ?? s),
    ...(f.method ? [`método: ${METHODS.find((m) => m.id === f.method)?.label}`] : []),
    ...(f.openAccess ? ["solo acceso abierto"] : []),
  ];
  const methods = methodsText(q, runs, searchedAt ? searchedAt.slice(0, 10) : "(sin búsqueda)", { yearFrom: f.yearFrom, yearTo: f.yearTo, extra });
  const sorted = [...included].sort((a, b) => segsToText(formatReference(a, "apa-es")).localeCompare(segsToText(formatReference(b, "apa-es")), "es"));

  async function report() {
    const blocks: Block[] = [
      { type: "h1", runs: [{ text: title }] },
      { type: "h2", runs: [{ text: "Estrategia de búsqueda" }] },
      ...methods.split("\n").map((l): Block => ({ type: "p", runs: [{ text: l }] })),
      { type: "h2", runs: [{ text: "Diagrama de flujo PRISMA 2020 (conteos)" }] },
      { type: "ul", items: [
        ...c.identified.map((x) => [{ text: `Identificados en ${x.label}: ${x.found} (recuperados para cribado: ${x.retrieved})` }]),
        [{ text: `Duplicados eliminados: ${c.duplicates}` }],
        [{ text: `Registros cribados: ${c.screened}` }],
        [{ text: `Excluidos: ${c.excluded}` }],
        ...c.excludedByReason.map((x) => [{ text: `   ${x.reason}: ${x.n}` }]),
        [{ text: `Pendientes de cribado: ${c.pending}` }],
        [{ text: `Incluidos: ${c.included}` }],
      ] },
    ];
    const bytes = manuscriptDocx({ title, blocks, references: sorted.map((w) => ({ segs: formatReference(w, "apa-es") })), referencesHeading: "Estudios incluidos" });
    await saveFile(`${title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").toLowerCase() || "revision"}-informe.docx`, bytes, DOCX_MIME);
  }

  return (
    <div className="bc-grid-2" style={{ alignItems: "start" }}>
      <div className="bc-card">
        <h2>Diagrama de flujo PRISMA 2020</h2>
        <div className="bc-prisma" data-testid="prisma">
          <div className="bc-prisma-stage">Identificación</div>
          <div className="bc-prisma-row">
            <div className="bc-prisma-box">
              Registros identificados:
              {c.identified.map((x) => <div key={x.source}>{x.label}: <strong>{x.found.toLocaleString("es")}</strong> <span className="bc-sub">(recuperados {x.retrieved})</span></div>)}
            </div>
            <div className="bc-prisma-box">Duplicados eliminados: <strong>{c.duplicates}</strong></div>
          </div>
          <div className="bc-prisma-stage">Cribado</div>
          <div className="bc-prisma-row">
            <div className="bc-prisma-box">Registros cribados (título y resumen): <strong>{c.screened}</strong>{c.pending ? <div className="bc-sub">Pendientes: {c.pending}</div> : null}</div>
            <div className="bc-prisma-box">
              Excluidos: <strong>{c.excluded}</strong>
              {c.excludedByReason.map((x) => <div key={x.reason} style={{ fontSize: "0.8rem" }}>{x.reason}: {x.n}</div>)}
            </div>
          </div>
          <div className="bc-prisma-stage">Incluidos</div>
          <div className="bc-prisma-row"><div className="bc-prisma-box">Estudios incluidos: <strong>{c.included}</strong></div></div>
        </div>
        <p className="bc-sub" style={{ fontSize: "0.78rem" }}>
          «Identificados» es el total que informa cada base; «recuperados» son los que se trajeron para cribar (límite elegido por base). La lectura de
          textos completos y su elegibilidad se registra fuera de la app por ahora.
        </p>
      </div>
      <div>
        <div className="bc-card">
          <h2>Para la sección de métodos</h2>
          <pre className="mono" data-testid="methods-text" style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", background: "var(--bc-surface-2)", padding: 8, borderRadius: 6 }}>{methods}</pre>
        </div>
        <div className="bc-card">
          <h2>Estudios incluidos ({included.length})</h2>
          <div className="bc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="bc-btn bc-btn-primary" onClick={() => void report()}>Descargar informe (.docx)</button>
            {included.length ? <ExportButton label="Exportar incluidos" baseName={`${title} incluidos`} getWorks={async () => included} /> : null}
            {included.length ? (
              <button className="bc-btn" onClick={async () => {
                for (const w of included) await repo.addToLibrary(w.id!);
                refresh();
                setMsg(`${included.length} estudios agregados a su biblioteca.`);
              }}>Agregar a mi biblioteca</button>
            ) : null}
          </div>
          {msg ? <div className="bc-alert" role="status" style={{ marginTop: 8 }}>{msg}</div> : null}
          <ol style={{ fontSize: "0.88rem", marginTop: 10 }}>
            {sorted.map((w) => <li key={w.id}>{segsToText(formatReference(w, "apa-es"))}</li>)}
          </ol>
        </div>
      </div>
    </div>
  );
}
