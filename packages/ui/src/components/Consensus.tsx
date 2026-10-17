import { useState } from "react";
import { Link } from "react-router-dom";
import { evidenceLevel, type Work } from "@biociencia/core";
import {
  askMessages, checkAnswer, checkVerdict, createProvider, parseRelatedQuestions, PROVIDER_PRESETS, questionVerdictMessages,
  relatedQuestionsMessages, type CheckedAnswer, type CheckedVerdict, type LlmProvider, type Source,
} from "@biociencia/ai";
import { useApp, useAsync } from "../context.tsx";
import { tr, useLang, type Lang } from "../i18n.tsx";

/**
 * Flujo de consenso (estilo Consensus) sobre la búsqueda actual:
 *  1) Mirada general SIN IA: cuántos metaanálisis, ensayos, revisiones o estudios retractados hay entre los resultados.
 *  2) Síntesis CON IA (con preguntas de seguimiento): el modelo solo recibe resúmenes reales y BioCiencia
 *     comprueba después, sin IA, cada número de cita y cada frase citada.
 *  3) Veredicto por artículo: apoya / mixto / refuta, siempre con la frase literal del resumen.
 *  4) Tabla de síntesis y preguntas relacionadas para el siguiente paso.
 * Sin IA configurada el panel sigue funcionando: muestra la mirada general y explica cómo activar la IA.
 */

export interface ConsensusRow {
  id: string;
  work: Work;
}

const VERDICT_STYLE: Record<CheckedVerdict["verdict"], { cls: string; sym: string }> = {
  apoya: { cls: "bc-verdict-positive", sym: "✓" },
  mixto: { cls: "bc-verdict-mixed", sym: "≈" },
  refuta: { cls: "bc-verdict-negative", sym: "✗" },
  no_relacionado: { cls: "bc-verdict-muted", sym: "○" },
  no_verificado: { cls: "bc-verdict-negative", sym: "?" },
  sin_respuesta: { cls: "bc-verdict-muted", sym: "·" },
};

/** Chip de veredicto estilo Consensus: ✓ Apoya (verde), ≈ Mixto (ámbar), ✗ Refuta (rojo). */
export function VerdictChip({ v, lang: langProp }: { v: CheckedVerdict; lang?: Lang }) {
  const { lang } = useLang();
  const l = langProp ?? lang;
  const st = VERDICT_STYLE[v.verdict];
  const label = tr(l, `v.${v.verdict}`);
  const tip = `${label}${v.explanation ? ` — ${v.explanation}` : ""}`;
  return <span className={`bc-verdict ${st.cls}`} data-testid="consensus-verdict" title={tip}>{st.sym} {label}</span>;
}

/** Configuración de IA (la misma que guarda «Análisis con IA»). */
export function useAiSetup(): { provider: LlmProvider | null; problem: string | null; loading: boolean } {
  const { repo } = useApp();
  const stored = useAsync(async () => ({
    preset: (await repo.getSetting("ai_provider")) ?? "ollama",
    model: (await repo.getSetting("ai_model")) ?? "",
    apiKey: (await repo.getSetting("ai_api_key")) ?? "",
    consent: (await repo.getSetting("ai_cloud_consent")) === "1",
  }), []);
  if (stored.loading) return { provider: null, problem: "Cargando…", loading: true };
  const c = stored.data;
  const preset = PROVIDER_PRESETS.find((p) => p.id === c?.preset);
  if (!c?.model) return { provider: null, problem: "Sin modelo.", loading: false };
  if (preset && !preset.local && !c.consent) return { provider: null, problem: "Sin autorización para ese servicio en la nube.", loading: false };
  try {
    return { provider: createProvider({ kind: preset!.kind, baseUrl: preset!.baseUrl, model: c.model, apiKey: c.apiKey || null }), problem: null, loading: false };
  } catch (e) {
    return { provider: null, problem: e instanceof Error ? e.message : String(e), loading: false };
  }
}

function evidenceLevelLabel(level: number, lang: Lang): string {
  const key = level === 1 ? "cs.level1" : level === 2 ? "cs.level2" : "cs.level3";
  return tr(lang, key);
}

/** Mirada general sin IA: la calidad del conjunto de resultados, con el mismo criterio de «Calidad de la evidencia». */
function Overview({ rows, lang }: { rows: ConsensusRow[]; lang: Lang }) {
  const counts = new Map<number, number>();
  let retracted = 0;
  let withAbstract = 0;
  for (const r of rows) {
    const lv = evidenceLevel(r.work);
    if (lv) counts.set(lv.level, (counts.get(lv.level) ?? 0) + 1);
    if (r.work.retraction?.status === "retracted" || r.work.retraction?.status === "withdrawn") retracted++;
    if ((r.work.abstract ?? "").trim()) withAbstract++;
  }
  if (!rows.length) return null;
  const en = lang === "en";
  return (
    <div className="bc-row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }} data-testid="consensus-overview">
      {[1, 2, 3].filter((l) => counts.get(l)).map((l) => (
        <span key={l} className="bc-badge bc-badge-blue">{counts.get(l)} {evidenceLevelLabel(l, lang)}</span>
      ))}
      {counts.get(4) ? <span className="bc-badge">{counts.get(4)} {tr(lang, "cs.obs")}</span> : null}
      {counts.get(5) || counts.get(6) ? <span className="bc-badge">{(counts.get(5) ?? 0) + (counts.get(6) ?? 0)} {tr(lang, "cs.reports")}</span> : null}
      {retracted ? <span className="bc-badge bc-badge-danger">{retracted} {tr(lang, "cs.retracted")}</span> : null}
      <span className="bc-sub" style={{ fontSize: "0.78rem" }}>
        {withAbstract} {en ? "of" : "de"} {rows.length} {tr(lang, "cs.withAbstract")}
      </span>
    </div>
  );
}

/** Medidor compacto: proporción de veredictos con frase verificada (los no verificados no cuentan). */
function ConsensusMeter({ verdicts, lang }: { verdicts: CheckedVerdict[]; lang: Lang }) {
  const yes = verdicts.filter((v) => v.verdict === "apoya").length;
  const no = verdicts.filter((v) => v.verdict === "refuta").length;
  const mix = verdicts.filter((v) => v.verdict === "mixto").length;
  const total = yes + no + mix;
  if (!total) return null;
  const pct = (n: number) => Math.round((n / total) * 100);
  const en = lang === "en";
  return (
    <div style={{ marginTop: 10 }} data-testid="consensus-meter">
      <div className="bc-meter" role="img" aria-label={en ? `Supports ${pct(yes)} %, mixed ${pct(mix)} %, refutes ${pct(no)} %` : `Apoya ${pct(yes)} %, mixto ${pct(mix)} %, refuta ${pct(no)} %`}>
        {yes ? <div className="yes" style={{ width: `${pct(yes)}%` }}>{pct(yes)} %</div> : null}
        {mix ? <div className="mix" style={{ width: `${pct(mix)}%` }}>{pct(mix)} %</div> : null}
        {no ? <div className="no" style={{ width: `${pct(no)}%` }}>{pct(no)} %</div> : null}
      </div>
      <div className="bc-sub" style={{ fontSize: "0.78rem" }}>
        {tr(lang, "v.apoya")}: {yes} · {tr(lang, "v.mixto")}: {mix} · {tr(lang, "v.refuta")}: {no}
        {tr(lang, "cs.meterFoot")}
      </div>
    </div>
  );
}

const CLAIM_STATUS_KEY: Record<string, string> = {
  verificada: "cs.verified",
  cita_no_encontrada: "cs.notFound",
  sin_cita: "cs.noQuote",
  fuente_inexistente: "cs.brokenRef",
};

/** Una respuesta de síntesis (la primera pregunta y las de seguimiento). */
interface AnswerStep {
  question: string;
  checked: CheckedAnswer;
}

export function ConsensusPanel({ question, rows, verdicts, onVerdict }: {
  question: string;
  rows: ConsensusRow[];
  verdicts: Record<string, CheckedVerdict>;
  onVerdict: (rowId: string, v: CheckedVerdict) => void;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(lang, k);
  const en = lang === "en";
  const { provider, problem, loading } = useAiSetup();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerStep[]>([]);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [related, setRelated] = useState<string[]>([]);
  const [follow, setFollow] = useState("");
  const used = Object.values(verdicts);
  const MAX = 8;

  /** Construye las fuentes numeradas (los mejores resultados con resumen, los primeros `MAX`). */
  function buildSources(): { sources: Source[]; candidates: ConsensusRow[] } | null {
    const candidates = rows
      .filter((r) => (r.work.abstract ?? "").trim().length >= 80 && r.work.retraction?.status !== "retracted" && r.work.retraction?.status !== "withdrawn")
      .map((r, i) => ({ r, lv: evidenceLevel(r.work)?.level ?? 9, i }))
      .sort((a, b) => a.lv - b.lv || a.i - b.i)
      .slice(0, MAX)
      .map((x) => x.r);
    if (!candidates.length) {
      setError(t("cs.noAbstract"));
      return null;
    }
    return { sources: candidates.map((c, i) => ({ n: i + 1, work: c.work, text: (c.work.abstract ?? "").trim() })), candidates };
  }

  /** Primera síntesis + veredictos por artículo + preguntas relacionadas. */
  async function run() {
    setAnswers([]);
    setRelated([]);
    setError(null);
    if (!provider) return;
    const built = buildSources();
    if (!built) return;
    setSources(built.sources);
    try {
      setBusy(en ? `Asking for the synthesis of ${built.sources.length} abstracts (may take a minute on Ollama)…` : `Pidiendo la síntesis de ${built.sources.length} resúmenes (puede tardar un minuto en Ollama)…`);
      const raw = await provider.chat(askMessages(question, built.sources), { json: true });
      setAnswers([{ question, checked: checkAnswer(raw, built.sources) }]);
      for (const s of built.sources) {
        setBusy(en ? `Evaluating result ${s.n} of ${built.sources.length}…` : `Evaluando resultado ${s.n} de ${built.sources.length}…`);
        const v = checkVerdict(await provider.chat(questionVerdictMessages(question, s), { json: true }), s);
        onVerdict(built.candidates[s.n - 1]!.id, v);
      }
      setBusy(en ? "Generating related questions…" : "Generando preguntas relacionadas…");
      try {
        setRelated(parseRelatedQuestions(await provider.chat(relatedQuestionsMessages(question, built.sources), { json: true })));
      } catch {
        // Las preguntas de sobra son un plus: si el modelo no las da, el panel queda igual y bien.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Pregunta de seguimiento sobre los mismos resultados (estilo chat de Consensus). */
  async function followUp(ask: string) {
    if (!provider || !sources) return;
    setError(null);
    setBusy(en ? `Asking the AI with ${sources.length} abstracts…` : `Preguntando a la IA con ${sources.length} resúmenes…`);
    try {
      const raw = await provider.chat(askMessages(ask, sources), { json: true });
      setAnswers((prev) => [...prev.filter((a) => a.question !== ask), { question: ask, checked: checkAnswer(raw, sources) }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const evaluated = rows.filter((r) => verdicts[r.id]);

  return (
    <div className="bc-consensus" data-testid="consensus-panel">
      <h3 style={{ margin: 0 }} data-testid="consensus-title">
        {t("cs.about")} <span className="bc-consensus-q">{/\?\s*$|…$/.test(question.trim()) ? question : `${question}?`}</span>
      </h3>
      <Overview rows={rows} lang={lang} />
      {!loading && !provider ? (
        <p className="bc-sub" style={{ fontSize: "0.82rem", marginTop: 10 }}>
          {t("cs.needsAi")}{" "}
          {!problem || problem === "Cargando…" ? null : problem === "Sin modelo." ? `${t("cs.noModel")} ` : `${problem} `}
          <Link to="/analisis">{t("cs.settings")} 🡒</Link>
        </p>
      ) : null}
      {provider ? (
        <div className="bc-row" style={{ gap: 8, marginTop: 10 }}>
          <button className="bc-btn bc-btn-primary" data-testid="consensus-run" disabled={!!busy} onClick={() => void run()}>
            {answers.length ? t("cs.runAgain") : t("cs.runFirst")}
          </button>
          {!provider.local ? (
            <span className="bc-sub" style={{ fontSize: "0.78rem" }}>
              {en
                ? `${provider.label}: the question and the abstracts of ${Math.min(MAX, rows.length)} results are sent to that service.`
                : `${provider.label}: la pregunta y los resúmenes de ${Math.min(MAX, rows.length)} resultados se envían a ese servicio.`}
            </span>
          ) : (
            <span className="bc-sub" style={{ fontSize: "0.78rem" }}>
              {en ? `${provider.label} · private: nothing leaves this computer.` : `${provider.label} · privado: nada sale de esta computadora.`}
            </span>
          )}
        </div>
      ) : null}
      {busy ? <div className="bc-sub" role="status" style={{ marginTop: 8, fontSize: "0.85rem" }}>{busy}</div> : null}
      {error ? <div className="bc-alert bc-alert-error" role="alert" style={{ marginTop: 8 }}>{error}</div> : null}
      {answers.map((a, i) => (
        <div key={i} style={{ marginTop: 10 }} data-testid="consensus-synthesis">
          <h3 style={{ margin: "8px 0 4px" }}>
            {i === 0 ? t("cs.synthesis") : t("cs.followAnswer")}: <em>{a.question}</em>
          </h3>
          {a.checked.invalidRefs.length ? (
            <div className="bc-alert bc-alert-warn" role="status">
              {en
                ? `The AI cited sources that do not exist (${a.checked.invalidRefs.map((n) => `[${n}]`).join(", ")}); replaced with [?].`
                : `La IA citó fuentes que no existen (${a.checked.invalidRefs.map((n) => `[${n}]`).join(", ")}); se reemplazaron por [?].`}
            </div>
          ) : null}
          <p style={{ whiteSpace: "pre-wrap", marginBottom: 6 }} data-testid="consensus-text">{a.checked.answer}</p>
          <ul style={{ paddingLeft: 18, margin: "4px 0" }} data-testid="consensus-claims">
            {a.checked.claims.map((c, j) => (
              <li key={j} style={{ marginBottom: 4, fontSize: "0.85rem" }}>
                {c.text} {c.sources.length ? `[${c.sources.join(", ")}]` : ""}{" "}
                <span className={`bc-badge ${c.status === "verificada" ? "bc-badge-green" : c.status === "sin_cita" ? "" : "bc-badge-warn"}`}>
                  {t(CLAIM_STATUS_KEY[c.status]!)}
                </span>
                {c.quote ? <div className="bc-sub" style={{ fontSize: "0.78rem" }}>«{c.quote}»</div> : null}
              </li>
            ))}
          </ul>
          {i === 0 ? (
            <p className="bc-sub" style={{ fontSize: "0.76rem" }}>
              {en
                ? `The AI read only the abstracts of the first ${MAX} results (best evidence first; no retracted papers).`
                : `La IA leyó solo los resúmenes de los primeros ${MAX} resultados (mejor evidencia primero; sin retractados).`}
            </p>
          ) : null}
        </div>
      ))}
      {/* Pregunta de seguimiento estilo chat (solo cuando la IA ya leyó estos resultados) */}
      {provider && sources && !busy ? (
        <form
          className="bc-row"
          style={{ gap: 8, marginTop: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            const ask = follow.trim();
            if (ask) void followUp(ask);
            setFollow("");
          }}
        >
          <input
            className="bc-input"
            aria-label={en ? "Follow-up question" : "Pregunta de seguimiento"}
            placeholder={t("cs.askFollow")}
            value={follow}
            onChange={(e) => setFollow(e.target.value)}
          />
          <button className="bc-btn" type="submit" disabled={!follow.trim()}>{t("cs.ask")}</button>
        </form>
      ) : null}
      {evaluated.length ? (
        <div style={{ marginTop: 12 }} data-testid="consensus-table">
          <h3 style={{ margin: "0 0 4px" }}>{t("cs.table")}</h3>
          <table className="bc-table">
            <thead>
              <tr><th>{t("cs.tablePaper")}</th><th>{t("cs.tableVerdict")}</th><th>{t("cs.tableQuote")}</th></tr>
            </thead>
            <tbody>
              {evaluated.map((r) => {
                const v = verdicts[r.id]!;
                return (
                  <tr key={r.id}>
                    <td style={{ maxWidth: 280 }}>{r.work.title}</td>
                    <td><VerdictChip v={v} lang={lang} /></td>
                    <td className="bc-sub" style={{ fontSize: "0.8rem" }}>
                      {v.quote ? <>«{v.quote}»{v.quoteVerified ? "" : en ? " (quote NOT found)" : " (frase NO encontrada)"}</> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {used.filter((v) => v.verdict === "apoya" || v.verdict === "refuta" || v.verdict === "mixto").length ? (
        <ConsensusMeter verdicts={used} lang={lang} />
      ) : null}
      {used.length ? (
        <p className="bc-sub" style={{ fontSize: "0.78rem", marginTop: 6 }}>
          {en
            ? "Verdicts also appear next to each result. A few papers are not enough to conclude; review each one and discuss with your group."
            : "Los veredictos aparecen también junto a cada resultado. Pocas publicaciones no bastan para concluir; revise cada una y converse con su grupo."}
        </p>
      ) : null}
      {related.length ? (
        <div style={{ marginTop: 10 }} data-testid="consensus-related">
          <span className="bc-sub" style={{ fontSize: "0.8rem" }}>{t("cs.related")}</span>
          <div className="bc-row" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            {related.map((q) => (
              <Link key={q} className="bc-chip" to={`/buscar?q=${encodeURIComponent(q)}`} title={`${t("cs.searchTipClick")} ${q}`}>{q}</Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
