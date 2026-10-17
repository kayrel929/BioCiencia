import { useEffect, useRef, useState } from "react";
import type { Work } from "@biociencia/core";
import {
  askMessages, checkAnswer, checkVerdict, createProvider, keywordMessages, listOllamaModels, parseKeywords, PROVIDER_PRESETS, sourceLabel,
  VERDICT_LABEL, verdictMessages, type CheckedAnswer, type CheckedVerdict, type LlmProvider, type Source,
  sourceTextFor,
} from "@biociencia/ai";
import { searchSources } from "@biociencia/sources";
import { useApp, useAsync } from "../context.tsx";
import { RetractionBanner } from "../components/Evidence.tsx";

/**
 * Análisis con IA con fuentes verificables (Fase 7). La IA solo recibe publicaciones reales y BioCiencia
 * comprueba después, sin IA, cada número de cita y cada frase citada.
 */

type Tab = "ask" | "evidence" | "verify";

interface AiConfig {
  preset: string;
  model: string;
  apiKey: string;
  consent: boolean;
}

function useAiConfig() {
  const { repo, refresh } = useApp();
  const stored = useAsync(async () => ({
    preset: (await repo.getSetting("ai_provider")) ?? "ollama",
    model: (await repo.getSetting("ai_model")) ?? "",
    apiKey: (await repo.getSetting("ai_api_key")) ?? "",
    consent: (await repo.getSetting("ai_cloud_consent")) === "1",
  }), []);
  const save = async (c: AiConfig) => {
    await repo.setSetting("ai_provider", c.preset);
    await repo.setSetting("ai_model", c.model.trim());
    await repo.setSetting("ai_api_key", c.apiKey.trim());
    await repo.setSetting("ai_cloud_consent", c.consent ? "1" : "");
    refresh();
  };
  return { config: stored.data, loading: stored.loading, save };
}

function providerFrom(c: AiConfig | undefined): { provider: LlmProvider | null; problem: string | null } {
  if (!c) return { provider: null, problem: "Cargando…" };
  const preset = PROVIDER_PRESETS.find((p) => p.id === c.preset);
  if (!preset) return { provider: null, problem: "Elija un proveedor." };
  if (!c.model) return { provider: null, problem: "Configure el modelo de IA para empezar." };
  if (!preset.local && !c.consent) return { provider: null, problem: `Para usar ${preset.label} debe autorizar el envío de datos a ese servicio.` };
  try {
    return { provider: createProvider({ kind: preset.kind, baseUrl: preset.baseUrl, model: c.model, apiKey: c.apiKey || null }), problem: null };
  } catch (e) {
    return { provider: null, problem: e instanceof Error ? e.message : String(e) };
  }
}

export function Analysis() {
  const { config, save } = useAiConfig();
  const [tab, setTab] = useState<Tab>("ask");
  const [showConfig, setShowConfig] = useState(false);
  const { provider, problem } = providerFrom(config);
  const preset = PROVIDER_PRESETS.find((p) => p.id === config?.preset);

  return (
    <div className="bc-page">
      <h1>Análisis con IA</h1>
      <p className="bc-sub">
        Pregunte a sus publicaciones, busque evidencia a favor o en contra de una afirmación, o compruebe si un artículo respalda lo que se le atribuye.
        La IA solo recibe publicaciones reales y BioCiencia verifica cada cita: los números que no corresponden a una fuente se eliminan y cada frase
        «citada» se busca letra por letra en el resumen.
      </p>
      <div className="bc-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span className={`bc-badge ${provider ? (provider.local ? "bc-badge-green" : "bc-badge-warn") : ""}`} data-testid="ai-status">
          {provider ? `${provider.label} · ${config?.model}${provider.local ? " · privado" : " · en la nube"}` : "IA sin configurar"}
        </span>
        <button className="bc-btn bc-btn-sm" onClick={() => setShowConfig(!showConfig)} aria-expanded={showConfig || !provider}>Configurar IA</button>
      </div>
      {showConfig || !provider ? <AiSettings initial={config} onSave={async (c) => { await save(c); setShowConfig(false); }} problem={problem} /> : null}

      {provider ? (
        <>
          <div className="bc-row" role="tablist" style={{ gap: 6, margin: "12px 0" }}>
            {([["ask", "Preguntar a mi biblioteca"], ["evidence", "Evidencia para una afirmación"], ["verify", "Verificar una cita"]] as [Tab, string][]).map(([t, l]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`bc-btn ${tab === t ? "bc-btn-primary" : ""}`} onClick={() => setTab(t)}>{l}</button>
            ))}
          </div>
          {!provider.local ? (
            <div className="bc-alert bc-alert-warn" style={{ fontSize: "0.82rem", marginBottom: 10 }}>
              Usando {preset?.label}: su pregunta y los resúmenes de las fuentes elegidas se envían a ese servicio. Su biblioteca completa no se envía.
            </div>
          ) : null}
          {tab === "ask" ? <AskTab provider={provider} /> : tab === "evidence" ? <EvidenceTab provider={provider} /> : <VerifyTab provider={provider} />}
        </>
      ) : null}
    </div>
  );
}

function AiSettings({ initial, onSave, problem }: { initial: AiConfig | undefined; onSave: (c: AiConfig) => Promise<void>; problem: string | null }) {
  const [c, setC] = useState<AiConfig>({ preset: "ollama", model: "", apiKey: "", consent: false });
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Los ajustes guardados se cargan una sola vez y nunca pisan lo que el usuario ya cambió
  const loaded = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    if (initial && !loaded.current && !touched.current) {
      // Un proveedor guardado que ya no existe (ajuste de una versión anterior o editado a mano) se
      // sustituye por el primero: antes, un id desconocido rompía la pantalla al leer sus datos.
      setC(PROVIDER_PRESETS.some((p) => p.id === initial.preset) ? initial : { ...initial, preset: PROVIDER_PRESETS[0]!.id });
    }
    if (initial) loaded.current = true;
  }, [initial]);
  const edit = (patch: Partial<AiConfig>) => {
    touched.current = true;
    setC((prev) => ({ ...prev, ...patch }));
  };
  // Nunca `!`: si el id no estuviera en la lista, la pantalla se rompería.
  const preset = PROVIDER_PRESETS.find((p) => p.id === c.preset) ?? PROVIDER_PRESETS[0]!;

  async function detect() {
    setMsg(null);
    try {
      const m = await listOllamaModels(preset.baseUrl);
      setModels(m);
      if (!m.length) setMsg({ text: "Ollama está funcionando pero no tiene modelos. En una terminal: ollama pull qwen2.5:7b (unos 4,7 GB) o llama3.2:3b (unos 2 GB).", error: true });
      else if (!c.model) edit({ model: m[0]! });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  }

  async function test() {
    setMsg(null);
    setBusy(true);
    try {
      const p = createProvider({ kind: preset.kind, baseUrl: preset.baseUrl, model: c.model, apiKey: c.apiKey || null });
      const r = await p.chat([{ role: "user", content: "Responde únicamente con la palabra: listo" }], { timeoutMs: 120_000 });
      setMsg({ text: `Conexión correcta. Respuesta del modelo: «${r.trim().slice(0, 60)}»` });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="bc-card"
      aria-label="Configuración de la IA"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave(c);
      }}
    >
      <h2>Configuración de la IA</h2>
      <p className="bc-sub" style={{ fontSize: "0.82rem", marginTop: 0 }}>
        La IA es <strong>opcional</strong>: buscar, guardar, leer PDF, citar, exportar y descubrir publicaciones funciona sin ella. La IA solo añade la
        síntesis de consenso, los veredictos por artículo, la extracción de datos y las búsquedas profundas.
      </p>
      {problem ? <div className="bc-alert" role="status" style={{ marginBottom: 8 }}>{problem}</div> : null}
      <label className="bc-label" htmlFor="ai-preset">Proveedor</label>
      <select id="ai-preset" className="bc-select" value={c.preset} onChange={(e) => { edit({ preset: e.target.value, model: "" }); setModels([]); setMsg(null); }}>
        {PROVIDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <div className="bc-alert" style={{ fontSize: "0.82rem", margin: "8px 0" }}>
        <strong>¿No tiene una IA en su computadora?</strong> Hay dos caminos gratuitos:
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          <li><strong>En la nube, gratis:</strong> cree una clave gratuita en <em>Groq</em> o <em>Google Gemini</em> (las dos tienen plan gratuito), o use un modelo gratuito de <em>OpenRouter</em>. Elija el proveedor, pegue la clave y autorice el envío de sus preguntas.</li>
          <li><strong>En su computadora:</strong> instale <em>Ollama</em> (ollama.com) y descargue un modelo pequeño; nada sale de su equipo.</li>
        </ul>
        En cualquier caso, la clave es suya y se guarda solo en esta computadora.
      </div>
      {preset.id === "ollama" ? (
        <p className="bc-sub" style={{ fontSize: "0.8rem" }}>
          Ollama es gratuito y funciona sin internet: nada sale de su computadora. Si quiere usarlo, instálelo desde ollama.com, descargue un modelo
          (por ejemplo <code>ollama pull qwen2.5:7b</code>) y abra BioCiencia en <code>http://127.0.0.1:5173</code>. Con 8 GB de RAM use un modelo de 3B; con 16 GB, uno de 7-8B.
        </p>
      ) : preset.local ? (
        <p className="bc-sub" style={{ fontSize: "0.8rem" }}>LM Studio: active el servidor local en la pestaña «Developer» (puerto 1234) y escriba el nombre del modelo cargado.</p>
      ) : preset.id === "openai" ? (
        <p className="bc-sub" style={{ fontSize: "0.8rem" }}>
          OpenAI no permite que el navegador lea sus respuestas, así que BioCiencia las pide desde su propia computadora (puente local): con «Iniciar BioCiencia» funciona.
          Ojo: <strong>una suscripción a ChatGPT no es una clave de API</strong>; la clave se crea aparte en platform.openai.com y se paga por uso (resumir unos cuantos artículos cuesta céntimos).
        </p>
      ) : (
        <p className="bc-sub" style={{ fontSize: "0.8rem" }}>Servicio en la nube. Necesita su propia clave (gratuita en Groq y Google Gemini; OpenRouter tiene modelos gratis). BioCiencia no incluye ninguna clave.</p>
      )}
      <label className="bc-label" htmlFor="ai-model">Modelo</label>
      <div className="bc-row" style={{ gap: 8 }}>
        {models.length ? (
          <select id="ai-model" className="bc-select" value={c.model} onChange={(e) => edit({ model: e.target.value })}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input id="ai-model" className="bc-input mono" value={c.model} onChange={(e) => edit({ model: e.target.value })} placeholder={preset.id === "ollama" ? "qwen2.5:7b" : "nombre del modelo"} />
        )}
        {preset.id === "ollama" ? <button type="button" className="bc-btn" onClick={() => void detect()}>Detectar modelos</button> : null}
      </div>
      {preset.needsKey ? (
        <>
          <label className="bc-label" htmlFor="ai-key">Clave de API (se guarda solo en esta computadora y no va en las copias de seguridad)</label>
          <input id="ai-key" className="bc-input mono" type="password" autoComplete="off" value={c.apiKey} onChange={(e) => edit({ apiKey: e.target.value })} />
          <label className="bc-row" style={{ gap: 6, marginTop: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={c.consent} onChange={(e) => edit({ consent: e.target.checked })} />
            <span style={{ fontSize: "0.85rem" }}>Autorizo enviar mis preguntas y los resúmenes de las publicaciones elegidas a {preset.label.replace(/ \(.*\)$/, "")}. Entiendo que es un servicio externo.</span>
          </label>
        </>
      ) : null}
      <div className="bc-row" style={{ gap: 8, marginTop: 10 }}>
        <button className="bc-btn bc-btn-primary" type="submit">Guardar</button>
        <button className="bc-btn" type="button" disabled={busy || !c.model || (preset.needsKey && (!c.apiKey || !c.consent))} onClick={() => void test()}>
          {busy ? "Probando…" : "Probar conexión"}
        </button>
      </div>
      {msg ? <div className={`bc-alert ${msg.error ? "bc-alert-error" : ""}`} role="status" style={{ marginTop: 8 }}>{msg.text}</div> : null}
    </form>
  );
}

/**
 * Busca en la biblioteca con varios términos y ordena por coincidencias.
 * Sirven las publicaciones con resumen o con PDF adjunto (se usa también su texto completo).
 */
async function retrieve(repo: ReturnType<typeof useApp>["repo"], terms: string[], k: number): Promise<Work[]> {
  const score = new Map<string, { w: Work; n: number }>();
  for (const t of terms) {
    for (const e of await repo.listLibrary({ text: t, limit: 30 })) {
      if (!e.work.abstract && !e.pdfCount) continue;
      const s = score.get(e.work.id!) ?? { w: e.work, n: 0 };
      s.n++;
      score.set(e.work.id!, s);
    }
  }
  return [...score.values()].sort((a, b) => b.n - a.n).slice(0, k).map((s) => s.w);
}

/** Fuentes numeradas con el resumen y los pasajes más relevantes de cada PDF adjunto. */
async function toSources(repo: ReturnType<typeof useApp>["repo"], works: Work[], terms: string[]): Promise<Source[]> {
  const pdf = await repo.attachmentTexts(works.map((w) => w.id).filter((x): x is string => !!x));
  return works
    .map((w) => ({ work: w, text: sourceTextFor(w.abstract, w.id ? pdf.get(w.id) : null, terms) }))
    .filter((s) => s.text)
    .map((s, i) => ({ n: i + 1, ...s }));
}

const STATUS: Record<string, { label: string; cls: string }> = {
  verificada: { label: "Cita verificada en la fuente", cls: "bc-badge-green" },
  cita_no_encontrada: { label: "La frase NO aparece en la fuente", cls: "bc-badge-warn" },
  sin_cita: { label: "Sin frase citada", cls: "" },
  fuente_inexistente: { label: "Cita a una fuente que no existe", cls: "bc-badge-warn" },
};

function SourceList({ sources, cited }: { sources: Source[]; cited?: number[] }) {
  return (
    <ol className="bc-ai-sources" data-testid="ai-sources" style={{ fontSize: "0.85rem" }}>
      {sources.map((s) => (
        <li key={s.n} value={s.n} id={`fuente-${s.n}`} style={{ opacity: cited && !cited.includes(s.n) ? 0.6 : 1 }}>
          {sourceLabel(s.work)}
          {s.work.doi ? <> · <a href={`https://doi.org/${s.work.doi}`} target="_blank" rel="noreferrer">DOI</a></> : s.work.landingUrl ? <> · <a href={s.work.landingUrl} target="_blank" rel="noreferrer">Abrir</a></> : null}
          {cited && !cited.includes(s.n) ? <span className="bc-sub"> (no citada)</span> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Medidor de evidencia: proporción de publicaciones que apoyan, refutan o tienen resultados mixtos.
 * Solo cuentan los veredictos con una frase verificada en la fuente.
 */
function EvidenceMeter({ rows }: { rows: string[] }) {
  const yes = rows.filter((v) => v === "apoya").length;
  const no = rows.filter((v) => v === "refuta").length;
  const mix = rows.filter((v) => v === "mixto").length;
  const total = yes + no + mix;
  if (!total) return <div className="bc-sub" style={{ fontSize: "0.85rem" }} data-testid="evidence-meter">Medidor de evidencia: ninguna publicación se pronuncia con una frase verificable.</div>;
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div data-testid="evidence-meter">
      <strong style={{ fontSize: "0.9rem" }}>Medidor de evidencia</strong> <span className="bc-sub" style={{ fontSize: "0.8rem" }}>({total} publicación(es) con frase verificada)</span>
      <div className="bc-meter" role="img" aria-label={`Apoya ${pct(yes)} %, mixto ${pct(mix)} %, refuta ${pct(no)} %`}>
        {yes ? <div className="yes" style={{ width: `${pct(yes)}%` }}>{pct(yes)} %</div> : null}
        {mix ? <div className="mix" style={{ width: `${pct(mix)}%` }}>{pct(mix)} %</div> : null}
        {no ? <div className="no" style={{ width: `${pct(no)}%` }}>{pct(no)} %</div> : null}
      </div>
      <div className="bc-sub" style={{ fontSize: "0.78rem" }}>Verde: apoya · Ámbar: mixto · Rojo: refuta. Pocas publicaciones no bastan para concluir; revise cada una.</div>
    </div>
  );
}

function AskTab({ provider }: { provider: LlmProvider }) {
  const { repo } = useApp();
  const [q, setQ] = useState("");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sources: Source[]; checked: CheckedAnswer } | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    try {
      setBusy("Eligiendo términos de búsqueda…");
      const terms = parseKeywords(await provider.chat(keywordMessages(q), { json: true }), q);
      setBusy("Buscando en su biblioteca…");
      const works = await retrieve(repo, terms, 8);
      const sources: Source[] = await toSources(repo, works, [...terms, q]);
      if (pasted.trim()) {
        sources.push({ n: sources.length + 1, work: { title: "Texto pegado por usted", authors: [], source: "manual", fetchedAt: "" }, text: pasted.trim() });
      }
      if (!sources.length) {
        setError(`No encontré publicaciones con resumen o PDF en su biblioteca para: ${terms.join(", ")}. Guarde artículos desde el Buscador o pegue el texto de un artículo.`);
        return;
      }
      setBusy(`Consultando la IA con ${sources.length} fuentes…`);
      const raw = await provider.chat(askMessages(q, sources), { json: true });
      setResult({ sources, checked: checkAnswer(raw, sources) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bc-card">
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) void run(); }} aria-label="Preguntar a mi biblioteca">
        <label className="bc-label" htmlFor="ai-q">Su pregunta</label>
        <textarea id="ai-q" className="bc-textarea" style={{ minHeight: 70 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Qué prácticas de manejo reducen la pudrición de mazorca por Stenocarpella?" />
        <details style={{ margin: "6px 0" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Agregar el texto de un artículo o PDF (copiar y pegar)</summary>
          <textarea className="bc-textarea" aria-label="Texto pegado" style={{ minHeight: 100, marginTop: 6 }} value={pasted} onChange={(e) => setPasted(e.target.value)} />
        </details>
        <button className="bc-btn bc-btn-primary" type="submit" disabled={!!busy || !q.trim()}>Preguntar</button>
      </form>
      {busy ? <div className="bc-sub" role="status" style={{ marginTop: 8 }}>{busy}</div> : null}
      {error ? <div className="bc-alert bc-alert-error" role="status" style={{ marginTop: 8 }}>{error}</div> : null}
      {result ? <AnswerView {...result} /> : null}
    </div>
  );
}

function AnswerView({ sources, checked }: { sources: Source[]; checked: CheckedAnswer }) {
  const bad = checked.claims.filter((c) => c.status === "cita_no_encontrada" || c.status === "fuente_inexistente").length;
  return (
    <div style={{ marginTop: 12 }} data-testid="ai-answer">
      {checked.invalidRefs.length ? (
        <div className="bc-alert bc-alert-warn" role="status">
          La IA citó fuentes que no existen ({checked.invalidRefs.map((n) => `[${n}]`).join(", ")}); se reemplazaron por [?]. Tome con cautela esas frases.
        </div>
      ) : null}
      {bad ? <div className="bc-alert bc-alert-warn" role="status" style={{ marginTop: 6 }}>{bad} afirmación(es) con citas que no se pudieron comprobar en las fuentes.</div> : null}
      <h3>Respuesta</h3>
      <p style={{ whiteSpace: "pre-wrap" }} data-testid="ai-answer-text">{checked.answer}</p>
      {checked.claims.length ? (
        <>
          <h3>Comprobación de cada afirmación</h3>
          <ul style={{ paddingLeft: 18 }} data-testid="ai-claims">
            {checked.claims.map((c, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {c.text} {c.sources.length ? `[${c.sources.join(", ")}]` : ""}{" "}
                <span className={`bc-badge ${STATUS[c.status]!.cls}`}>{STATUS[c.status]!.label}</span>
                {c.quote ? <div className="bc-sub" style={{ fontSize: "0.8rem" }}>«{c.quote}»</div> : null}
              </li>
            ))}
          </ul>
        </>
      ) : checked.unstructured ? <p className="bc-sub">El modelo no detalló sus afirmaciones; solo se verificaron los números de cita.</p> : null}
      <h3>Fuentes entregadas a la IA</h3>
      <SourceList sources={sources} cited={checked.cited} />
      <p className="bc-sub" style={{ fontSize: "0.76rem" }}>La IA leyó solo los resúmenes (o el texto pegado), no los artículos completos. Revise las fuentes antes de usar la respuesta.</p>
    </div>
  );
}

function VerdictBadge({ v }: { v: CheckedVerdict }) {
  const cls = v.verdict === "apoya" ? "bc-badge-green" : v.verdict === "refuta" || v.verdict === "no_verificado" ? "bc-badge-warn" : "";
  return <span className={`bc-badge ${cls}`} data-testid="verdict">{VERDICT_LABEL[v.verdict]}</span>;
}

function EvidenceTab({ provider }: { provider: LlmProvider }) {
  const { repo, sources: clients } = useApp();
  const [claim, setClaim] = useState("");
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<{ source: Source; v: CheckedVerdict }[] | null>(null);
  const [saved, setSaved] = useState<Set<number>>(new Set());

  async function run() {
    setError(null);
    setRows(null);
    try {
      setBusy("Eligiendo términos de búsqueda…");
      const terms = parseKeywords(await provider.chat(keywordMessages(claim), { json: true }), claim);
      setBusy("Buscando publicaciones…");
      const works: Work[] = await retrieve(repo, terms, 6);
      if (online) {
        const r = await searchSources([clients.europepmc, clients.pubmed], { text: terms.slice(0, 4).join(" "), perPage: 10 });
        for (const w of r.works) if (w.abstract && !works.some((x) => (x.doi && x.doi === w.doi) || x.title === w.title)) works.push(w);
      }
      const list = (await toSources(repo, works.slice(0, 12), [...terms, claim]));
      if (!list.length) return setError("No se encontraron publicaciones con resumen para evaluar.");
      const out: { source: Source; v: CheckedVerdict }[] = [];
      for (const s of list) {
        setBusy(`Evaluando ${s.n} de ${list.length}…`);
        out.push({ source: s, v: checkVerdict(await provider.chat(verdictMessages(claim, s), { json: true }), s) });
        setRows([...out]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const order = ["apoya", "refuta", "mixto", "no_verificado", "no_relacionado", "sin_respuesta"] as const;
  return (
    <div className="bc-card">
      <form onSubmit={(e) => { e.preventDefault(); if (claim.trim()) void run(); }} aria-label="Evidencia para una afirmación">
        <label className="bc-label" htmlFor="ai-claim">Afirmación a evaluar</label>
        <textarea id="ai-claim" className="bc-textarea" style={{ minHeight: 60 }} value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="La rotación de cultivos reduce la pudrición de mazorca por Stenocarpella maydis." />
        <label className="bc-row" style={{ gap: 6, margin: "6px 0" }}>
          <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} /> Buscar también en PubMed y Europe PMC (además de su biblioteca)
        </label>
        <button className="bc-btn bc-btn-primary" type="submit" disabled={!!busy || !claim.trim()}>Buscar evidencia</button>
      </form>
      {busy ? <div className="bc-sub" role="status" style={{ marginTop: 8 }}>{busy}</div> : null}
      {error ? <div className="bc-alert bc-alert-error" role="status" style={{ marginTop: 8 }}>{error}</div> : null}
      {rows ? (
        <div style={{ marginTop: 10 }} data-testid="evidence">
          <EvidenceMeter rows={rows.filter((r) => r.source.work.retraction?.status !== "retracted" && r.source.work.retraction?.status !== "withdrawn").map((r) => r.v.verdict)} />
          <p className="bc-sub" style={{ fontSize: "0.85rem" }}>
            {order.filter((o) => o !== "sin_respuesta").map((o) => `${VERDICT_LABEL[o]}: ${rows.filter((r) => r.v.verdict === o).length}`).join(" · ")}
          </p>
          {[...rows].sort((a, b) => order.indexOf(a.v.verdict) - order.indexOf(b.v.verdict)).map(({ source: s, v }) => (
            <article key={s.n} className="bc-screen-item" data-testid="evidence-item">
              <div style={{ fontWeight: 600 }}>{s.work.title}</div>
              <div className="bc-sub" style={{ fontSize: "0.8rem" }}>{sourceLabel(s.work).split(". ")[0]}</div>
              <RetractionBanner work={s.work} />
              <div style={{ marginTop: 4 }}><VerdictBadge v={v} /> {v.explanation ? <span style={{ fontSize: "0.85rem" }}>{v.explanation}</span> : null}</div>
              {v.quote ? <div className="bc-sub" style={{ fontSize: "0.8rem" }}>{v.quoteVerified ? "✓ Frase verificada en el resumen" : "✗ Esta frase no aparece en el resumen"}: «{v.quote}»</div> : null}
              <div className="bc-row" style={{ gap: 6, marginTop: 4 }}>
                {s.work.doi ? <a className="bc-btn bc-btn-sm" href={`https://doi.org/${s.work.doi}`} target="_blank" rel="noreferrer">Abrir</a> : null}
                {saved.has(s.n) ? <span className="bc-badge bc-badge-green">Guardado</span> : (
                  <button className="bc-btn bc-btn-sm" onClick={async () => { const { id } = await repo.upsertWork(s.work); await repo.addToLibrary(id); setSaved(new Set(saved).add(s.n)); }}>Guardar en biblioteca</button>
                )}
              </div>
            </article>
          ))}
          <p className="bc-sub" style={{ fontSize: "0.76rem" }}>Evaluación hecha sobre los resúmenes. «Sin cita verificable»: la IA dijo apoyar o refutar pero la frase que dio no está en el resumen, por eso no se cuenta.</p>
        </div>
      ) : null}
    </div>
  );
}

function VerifyTab({ provider }: { provider: LlmProvider }) {
  const { repo, sources: clients } = useApp();
  const [claim, setClaim] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ source: Source; v: CheckedVerdict } | null>(null);

  async function findWork(input: string): Promise<Work | null> {
    const doi = input.match(/10\.\d{4,9}\/\S+/)?.[0]?.replace(/[.,;)]+$/, "").toLowerCase();
    const lib = await repo.listLibrary({ text: doi ? undefined : input, limit: 200 });
    const hit = lib.find((e) => (doi ? e.work.doi === doi : true) && (e.work.abstract || e.pdfCount));
    if (hit) return hit.work;
    if (doi) {
      const r = await clients.europepmc.search({ text: `DOI:"${doi}"`, perPage: 1 });
      return r.works[0] ?? null;
    }
    return null;
  }

  async function run() {
    setError(null);
    setRes(null);
    setBusy(true);
    try {
      const w = await findWork(ref.trim());
      if (!w) return setError("No encontré esa publicación (ni en su biblioteca ni en Europe PMC). Escriba su DOI o guárdela primero en la biblioteca.");
      const pdfText = w.id ? (await repo.attachmentTexts([w.id])).get(w.id) : null;
      const text = sourceTextFor(w.abstract, pdfText, [claim]);
      if (!text) return setError("La publicación no tiene resumen ni PDF adjunto: no se puede verificar.");
      const s: Source = { n: 1, work: w, text };
      setRes({ source: s, v: checkVerdict(await provider.chat(verdictMessages(claim, s), { json: true }), s) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bc-card">
      <form onSubmit={(e) => { e.preventDefault(); if (claim.trim() && ref.trim()) void run(); }} aria-label="Verificar una cita">
        <label className="bc-label" htmlFor="ai-vclaim">Lo que se afirma citando el artículo</label>
        <textarea id="ai-vclaim" className="bc-textarea" style={{ minHeight: 60 }} value={claim} onChange={(e) => setClaim(e.target.value)} />
        <label className="bc-label" htmlFor="ai-vref">Artículo citado: DOI o palabras del título (de su biblioteca)</label>
        <input id="ai-vref" className="bc-input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="10.1094/PDIS.2001.85.1.92" />
        <button className="bc-btn bc-btn-primary" type="submit" style={{ marginTop: 8 }} disabled={busy || !claim.trim() || !ref.trim()}>{busy ? "Verificando…" : "Verificar"}</button>
      </form>
      {error ? <div className="bc-alert bc-alert-error" role="status" style={{ marginTop: 8 }}>{error}</div> : null}
      {res ? (
        <div style={{ marginTop: 10 }} data-testid="verify-result">
          <div style={{ fontWeight: 600 }}>{sourceLabel(res.source.work)}</div>
          <div style={{ marginTop: 6 }}><VerdictBadge v={res.v} /> {res.v.explanation}</div>
          {res.v.quote ? <div className="bc-sub" style={{ fontSize: "0.85rem", marginTop: 4 }}>{res.v.quoteVerified ? "✓ Frase verificada en el resumen" : "✗ Esta frase no aparece en el resumen"}: «{res.v.quote}»</div> : null}
          <details style={{ marginTop: 6 }}><summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Ver el resumen evaluado</summary><p style={{ fontSize: "0.85rem" }}>{res.source.text}</p></details>
        </div>
      ) : null}
    </div>
  );
}
