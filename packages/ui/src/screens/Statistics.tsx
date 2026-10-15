import { useMemo, useState } from "react";
import {
  anovaFactorial, anovaOneWay, anovaRcbd, chiSquare, completeRows, describe, fmt, formatP, kruskalWallis, levene, linearRegression,
  parseTable, pearson, shapiroWilk, spearman, stars, tTestIndependent, tTestPaired, tukeyHsd, type AnovaResult, type Table,
} from "@biociencia/stats";
import { useApp, useAsync } from "../context.tsx";

type Kind = "desc" | "t" | "paired" | "dca" | "dbca" | "fact" | "kw" | "cor" | "chi";
const ANALYSES: { id: Kind; label: string; help: string }[] = [
  { id: "desc", label: "Estadística descriptiva", help: "Media, desviación, error estándar, CV, cuartiles e intervalo de confianza, por grupo si se elige." },
  { id: "dca", label: "ANOVA — Diseño completamente al azar (DCA) + Tukey", help: "Un factor (tratamientos). Acepta repeticiones desiguales." },
  { id: "dbca", label: "ANOVA — Bloques completos al azar (DBCA) + Tukey", help: "Tratamientos y bloques; una observación por tratamiento en cada bloque." },
  { id: "fact", label: "ANOVA — Factorial A × B (DCA) + Tukey", help: "Dos factores con interacción; mismo número de repeticiones por combinación." },
  { id: "t", label: "t de Student — dos grupos independientes", help: "Compara las medias de dos grupos (Welch por defecto)." },
  { id: "paired", label: "t pareada — antes y después", help: "Dos columnas medidas en las mismas unidades." },
  { id: "kw", label: "Kruskal-Wallis (no paramétrica)", help: "Alternativa al ANOVA de una vía cuando no hay normalidad." },
  { id: "cor", label: "Correlación y regresión lineal", help: "Pearson, Spearman y recta y = a + b·x." },
  { id: "chi", label: "χ² de independencia", help: "Dos variables categóricas (conteos de casos)." },
];

interface Out {
  title: string;
  tables: { caption: string; head: string[]; rows: (string | number)[][] }[];
  notes: string[];
  warnings: string[];
}

export function Statistics() {
  const { repo, refresh, saveFile } = useApp();
  const datasets = useAsync(() => repo.listDatasets(), []);
  const projects = useAsync(() => repo.listProjects(), []);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dsId, setDsId] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("dca");
  const [sel, setSel] = useState<Record<string, string>>({});
  const [alpha, setAlpha] = useState(0.05);
  const [equalVar, setEqualVar] = useState(false);
  const [out, setOut] = useState<Out | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const parsed = useMemo<{ t: Table | null; error: string | null }>(() => {
    if (!text.trim()) return { t: null, error: null };
    try {
      return { t: parseTable(text), error: null };
    } catch (e) {
      return { t: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);
  const t = parsed.t;
  const numCols = t?.columns.filter((c) => c.kind === "number").map((c) => c.name) ?? [];
  const allCols = t?.columns.map((c) => c.name) ?? [];

  const fields: Record<Kind, { key: string; label: string; numeric?: boolean; optional?: boolean }[]> = {
    desc: [{ key: "y", label: "Variable", numeric: true }, { key: "g", label: "Agrupar por (opcional)", optional: true }],
    dca: [{ key: "y", label: "Variable respuesta", numeric: true }, { key: "g", label: "Tratamiento" }],
    dbca: [{ key: "y", label: "Variable respuesta", numeric: true }, { key: "g", label: "Tratamiento" }, { key: "b", label: "Bloque" }],
    fact: [{ key: "y", label: "Variable respuesta", numeric: true }, { key: "g", label: "Factor A" }, { key: "b", label: "Factor B" }],
    t: [{ key: "y", label: "Variable respuesta", numeric: true }, { key: "g", label: "Grupo (2 niveles)" }],
    paired: [{ key: "y", label: "Medición 1", numeric: true }, { key: "x", label: "Medición 2", numeric: true }],
    kw: [{ key: "y", label: "Variable respuesta", numeric: true }, { key: "g", label: "Grupo" }],
    cor: [{ key: "x", label: "Variable X (independiente)", numeric: true }, { key: "y", label: "Variable Y (dependiente)", numeric: true }],
    chi: [{ key: "g", label: "Variable categórica 1" }, { key: "b", label: "Variable categórica 2" }],
  };

  function run() {
    setOut(null);
    setMsg(null);
    if (!t) return setMsg({ text: "Primero pegue o importe una tabla de datos.", error: true });
    try {
      setOut(analyze(t, kind, sel, alpha, equalVar));
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  }

  async function exportCsv() {
    if (!out) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [esc(out.title)];
    for (const tb of out.tables) lines.push("", esc(tb.caption), tb.head.map(esc).join(";"), ...tb.rows.map((r) => r.map(esc).join(";")));
    if (out.notes.length) lines.push("", ...out.notes.map(esc));
    await saveFile(`${(name || "analisis").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-resultados.csv`, "﻿" + lines.join("\r\n"), "text/csv");
  }

  return (
    <div className="bc-page">
      <h1>Estadística</h1>
      <p className="bc-sub">
        Pegue sus datos desde Excel (una fila por unidad experimental, una columna por variable), elija el análisis y obtenga tablas listas para su
        informe. Los cálculos se verificaron contra SciPy y statsmodels.
      </p>

      <div className="bc-grid-2" style={{ alignItems: "start" }}>
        <div className="bc-card">
          <h2>1. Datos</h2>
          <label className="bc-label" htmlFor="st-data">Pegue aquí su tabla (con encabezados)</label>
          <textarea
            id="st-data"
            className="bc-textarea mono"
            style={{ minHeight: 180, fontSize: "0.8rem" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Tratamiento\tBloque\tRendimiento\nT1\tI\t4,52\nT2\tI\t5,10\n…"}
          />
          <div className="bc-row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <label className="bc-btn bc-btn-sm" style={{ cursor: "pointer" }}>
              Abrir archivo CSV
              <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" aria-label="Archivo de datos" style={{ display: "none" }} onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setText(await f.text());
                if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
              }} />
            </label>
            <input className="bc-input" style={{ flex: 1, minWidth: 140 }} aria-label="Nombre del conjunto de datos" placeholder="Nombre (p. ej. Ensayo maíz 2026)" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="bc-select" style={{ width: "auto" }} aria-label="Proyecto del conjunto de datos" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Sin proyecto</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button
              className="bc-btn bc-btn-sm"
              disabled={!t}
              onClick={async () => {
                try {
                  const id = await repo.saveDataset({ id: dsId ?? undefined, name: name || "Datos sin nombre", content: text, projectId: projectId || null });
                  setDsId(id);
                  setMsg({ text: "Datos guardados en esta computadora." });
                  refresh();
                } catch (e) {
                  setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
                }
              }}
            >
              Guardar datos
            </button>
          </div>
          {parsed.error ? <div className="bc-alert bc-alert-error" role="status" style={{ marginTop: 8 }}>{parsed.error}</div> : null}
          {t ? (
            <div style={{ marginTop: 10 }} data-testid="data-preview">
              <p className="bc-sub" style={{ fontSize: "0.82rem", margin: "0 0 6px" }}>
                {t.rows} filas · {t.columns.length} columnas · separador {t.delimiter === "\t" ? "tabulador" : `«${t.delimiter}»`}
                {t.decimalComma ? " · coma decimal" : ""}
              </p>
              {t.warnings.map((w) => <div key={w} className="bc-alert bc-alert-warn" style={{ fontSize: "0.8rem" }}>{w}</div>)}
              <div style={{ overflowX: "auto" }}>
                <table className="bc-table" style={{ fontSize: "0.8rem" }}>
                  <thead>
                    <tr>{t.columns.map((c) => <th key={c.name}>{c.name}<br /><span className="bc-badge">{c.kind === "number" ? "numérica" : "categórica"}</span></th>)}</tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.min(t.rows, 6) }, (_, i) => (
                      <tr key={i}>{t.columns.map((c) => <td key={c.name}>{c.raw[i]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {datasets.data && datasets.data.length ? (
            <>
              <h3 style={{ marginTop: 14, fontSize: "0.95rem" }}>Datos guardados</h3>
              <table className="bc-table" style={{ fontSize: "0.85rem" }}>
                <tbody>
                  {datasets.data.map((d) => (
                    <tr key={d.id}>
                      <td>{d.name}</td>
                      <td>{new Date(d.updatedAt).toLocaleDateString()}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="bc-btn bc-btn-sm" onClick={async () => {
                          const ds = await repo.getDataset(d.id);
                          if (!ds) return;
                          setText(ds.content);
                          setName(ds.name);
                          setProjectId(ds.projectId ?? "");
                          setDsId(ds.id);
                          setOut(null);
                        }}>Abrir</button>{" "}
                        <button className="bc-btn bc-btn-sm bc-btn-ghost" onClick={async () => {
                          if (!confirm(`¿Borrar «${d.name}»?`)) return;
                          await repo.deleteDataset(d.id);
                          if (dsId === d.id) setDsId(null);
                          refresh();
                        }}>Borrar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </div>

        <div className="bc-card">
          <h2>2. Análisis</h2>
          <label className="bc-label" htmlFor="st-kind">Tipo de análisis</label>
          <select id="st-kind" className="bc-select" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setOut(null); }}>
            {ANALYSES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <p className="bc-sub" style={{ fontSize: "0.82rem" }}>{ANALYSES.find((a) => a.id === kind)!.help}</p>
          {fields[kind].map((f) => (
            <div key={f.key}>
              <label className="bc-label" htmlFor={`st-${f.key}`}>{f.label}</label>
              <select id={`st-${f.key}`} className="bc-select" value={sel[`${kind}.${f.key}`] ?? ""} onChange={(e) => setSel({ ...sel, [`${kind}.${f.key}`]: e.target.value })}>
                <option value="">{f.optional ? "— ninguno —" : "Elija una columna"}</option>
                {(f.numeric ? numCols : allCols).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ))}
          {kind === "t" ? (
            <label className="bc-row" style={{ gap: 6, marginTop: 8, fontSize: "0.9rem" }}>
              <input type="checkbox" checked={equalVar} onChange={(e) => setEqualVar(e.target.checked)} /> Suponer varianzas iguales (t de Student clásica)
            </label>
          ) : null}
          <label className="bc-label" htmlFor="st-alpha">Nivel de significancia (α)</label>
          <select id="st-alpha" className="bc-select" style={{ width: "auto" }} value={alpha} onChange={(e) => setAlpha(Number(e.target.value))}>
            <option value={0.05}>0,05</option>
            <option value={0.01}>0,01</option>
            <option value={0.1}>0,10</option>
          </select>
          <div style={{ marginTop: 14 }}>
            <button className="bc-btn bc-btn-primary" onClick={run} disabled={!t}>Calcular</button>
          </div>
          {msg ? <div className={`bc-alert ${msg.error ? "bc-alert-error" : ""}`} role="status" style={{ marginTop: 10 }}>{msg.text}</div> : null}
        </div>
      </div>

      {out ? (
        <section className="bc-card" style={{ marginTop: 16 }} data-testid="stats-result" aria-label="Resultados">
          <div className="bc-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>{out.title}</h2>
            <button className="bc-btn bc-btn-sm" onClick={() => void exportCsv()}>Descargar resultados (CSV)</button>
          </div>
          {out.warnings.map((w) => <div key={w} className="bc-alert bc-alert-warn" style={{ marginTop: 8 }}>{w}</div>)}
          {out.tables.map((tb) => (
            <div key={tb.caption} style={{ marginTop: 14, overflowX: "auto" }}>
              <h3 style={{ fontSize: "0.95rem", margin: "0 0 6px" }}>{tb.caption}</h3>
              <table className="bc-table">
                <thead><tr>{tb.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{tb.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ))}
          {out.notes.length ? (
            <div className="bc-alert" style={{ marginTop: 14 }} data-testid="stats-interpretation">
              <strong>Interpretación</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{out.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

// ---------------- Cálculo y redacción de resultados ----------------

function col(t: Table, name: string | undefined, label: string) {
  if (!name) throw new Error(`Elija la columna para «${label}».`);
  const c = t.columns.find((x) => x.name === name);
  if (!c) throw new Error(`No existe la columna «${name}».`);
  return c;
}

function anovaTable(a: AnovaResult, alpha: number) {
  return {
    caption: "Análisis de varianza",
    head: ["Fuente de variación", "gl", "SC", "CM", "F", "p", ""],
    rows: a.table.map((r) => [r.source, r.df, fmt(r.ss, 4), Number.isFinite(r.ms) ? fmt(r.ms, 4) : "", r.f === null ? "" : fmt(r.f, 3), r.p === null ? "" : formatP(r.p), r.p === null ? "" : r.p < alpha ? stars(r.p) : "ns"]),
  };
}

function assumptions(a: AnovaResult, y: number[], g: string[], alpha: number): { table: Out["tables"][number]; notes: string[] } {
  const notes: string[] = [];
  const rows: (string | number)[][] = [];
  if (a.residuals.length >= 3 && a.residuals.length <= 5000) {
    const sw = shapiroWilk(a.residuals);
    rows.push(["Normalidad de residuos (Shapiro-Wilk)", `W = ${fmt(sw.w, 4)}`, formatP(sw.p)]);
    if (sw.p < alpha) notes.push("Los residuos no siguen una distribución normal (Shapiro-Wilk). Considere transformar los datos (log, raíz) o usar Kruskal-Wallis.");
  }
  const lv = levene(y, g);
  rows.push(["Homogeneidad de varianzas (Levene, mediana)", `F = ${fmt(lv.f, 3)} (${lv.df1}, ${lv.df2})`, formatP(lv.p)]);
  if (lv.p < alpha) notes.push("Las varianzas de los grupos no son homogéneas (Levene). Interprete el ANOVA con cautela.");
  return { table: { caption: "Supuestos del ANOVA", head: ["Prueba", "Estadístico", "p"], rows }, notes };
}

function tukeyTables(y: number[], g: string[], a: AnovaResult, alpha: number, factorLabel: string) {
  const tk = tukeyHsd(y, g, a.mse, a.dfError, alpha);
  return {
    tk,
    tables: [
      {
        caption: `Medias de ${factorLabel} y prueba de Tukey (α = ${String(alpha).replace(".", ",")})`,
        head: [factorLabel, "n", "Media", "Grupo"],
        rows: tk.groups.map((x) => [x.name, x.n, fmt(x.mean, 3), x.letters]),
      },
      {
        caption: "Comparaciones por pares (Tukey HSD)",
        head: ["Comparación", "Diferencia", "IC 95 %", "p", ""],
        rows: tk.pairs.map((p) => [`${p.a} − ${p.b}`, fmt(p.diff, 3), `${fmt(p.ci95[0], 3)} a ${fmt(p.ci95[1], 3)}`, formatP(p.p), p.p < alpha ? stars(p.p) : "ns"]),
      },
    ],
  };
}

export function analyze(t: Table, kind: Kind, sel: Record<string, string>, alpha: number, equalVar: boolean): Out {
  const k = (f: string) => sel[`${kind}.${f}`] || undefined;
  const warnings: string[] = [];
  const pick = (names: (string | undefined)[]) => {
    const r = completeRows(t, names.filter((n): n is string => !!n));
    if (r.dropped) warnings.push(`Se omitieron ${r.dropped} fila(s) con datos faltantes.`);
    return r.index;
  };
  const sig = (p: number) => (p < alpha ? "hay diferencias estadísticamente significativas" : "no hay diferencias estadísticamente significativas");

  if (kind === "desc") {
    const yc = col(t, k("y"), "Variable");
    const gname = k("g");
    const idx = pick([yc.name, gname]);
    const gc = gname ? col(t, gname, "Agrupar por") : null;
    const levels = gc ? [...new Set(idx.map((i) => gc.raw[i]!))] : ["Todos"];
    const rows = levels.map((lv) => {
      const v = idx.filter((i) => !gc || gc.raw[i] === lv).map((i) => yc.num[i]!);
      const d = describe(v);
      return [lv, d.n, fmt(d.mean), fmt(d.sd), fmt(d.se), `${fmt(d.cv, 1)} %`, fmt(d.min), fmt(d.q1), fmt(d.median), fmt(d.q3), fmt(d.max), `${fmt(d.ci95[0])} a ${fmt(d.ci95[1])}`];
    });
    return {
      title: `Estadística descriptiva de ${yc.name}`,
      tables: [{ caption: gc ? `Por ${gc.name}` : "Resumen", head: [gc ? gc.name : "", "n", "Media", "DE", "EE", "CV", "Mín.", "Q1", "Mediana", "Q3", "Máx.", "IC 95 % de la media"], rows }],
      notes: ["DE: desviación estándar; EE: error estándar de la media; CV: coeficiente de variación; cuartiles por el método de Excel/R (tipo 7)."],
      warnings,
    };
  }

  if (kind === "dca" || kind === "kw" || kind === "t") {
    const yc = col(t, k("y"), "Variable respuesta");
    const gc = col(t, k("g"), kind === "t" ? "Grupo" : "Tratamiento");
    const idx = pick([yc.name, gc.name]);
    const y = idx.map((i) => yc.num[i]!);
    const g = idx.map((i) => gc.raw[i]!);
    const levels = [...new Set(g)];
    if (kind === "t") {
      if (levels.length !== 2) throw new Error(`La columna «${gc.name}» tiene ${levels.length} niveles; la prueba t necesita exactamente 2. Use ANOVA para más grupos.`);
      const A = y.filter((_, i) => g[i] === levels[0]);
      const B = y.filter((_, i) => g[i] === levels[1]);
      const r = tTestIndependent(A, B, equalVar);
      const dA = describe(A);
      const dB = describe(B);
      return {
        title: `${equalVar ? "t de Student" : "t de Welch"}: ${yc.name} según ${gc.name}`,
        tables: [
          { caption: "Grupos", head: [gc.name, "n", "Media", "DE"], rows: [[levels[0]!, dA.n, fmt(dA.mean), fmt(dA.sd)], [levels[1]!, dB.n, fmt(dB.mean), fmt(dB.sd)]] },
          { caption: "Prueba", head: ["t", "gl", "p (bilateral)", "Diferencia de medias", "IC 95 %"], rows: [[fmt(r.t, 3), fmt(r.df, 2), formatP(r.p), fmt(r.meanDiff), `${fmt(r.ci95[0])} a ${fmt(r.ci95[1])}`]] },
        ],
        notes: [`Con α = ${String(alpha).replace(".", ",")}, ${sig(r.p)} entre ${levels[0]} y ${levels[1]} (p ${formatP(r.p).startsWith("<") ? "" : "= "}${formatP(r.p)}).`],
        warnings,
      };
    }
    if (kind === "kw") {
      const r = kruskalWallis(y, g);
      return {
        title: `Kruskal-Wallis: ${yc.name} según ${gc.name}`,
        tables: [
          { caption: "Medianas por grupo", head: [gc.name, "n", "Mediana"], rows: levels.map((lv) => { const v = y.filter((_, i) => g[i] === lv); return [lv, v.length, fmt(describe(v).median)]; }) },
          { caption: "Prueba", head: ["H", "gl", "p"], rows: [[fmt(r.h, 3), r.df, formatP(r.p)]] },
        ],
        notes: [`Con α = ${String(alpha).replace(".", ",")}, ${sig(r.p)} entre los grupos (corrección por empates incluida).`],
        warnings,
      };
    }
    const a = anovaOneWay(y, g);
    const sup = assumptions(a, y, g, alpha);
    const p = a.table[0]!.p!;
    const tk = p < alpha ? tukeyTables(y, g, a, alpha, gc.name) : null;
    return {
      title: `ANOVA (DCA): ${yc.name} según ${gc.name}`,
      tables: [anovaTable(a, alpha), ...(tk ? tk.tables : []), sup.table],
      notes: [
        `Con α = ${String(alpha).replace(".", ",")}, ${sig(p)} entre tratamientos (F = ${fmt(a.table[0]!.f!, 3)}, p ${formatP(p)}).`,
        `Coeficiente de variación del experimento: ${fmt(a.cv, 1)} %. Media general: ${fmt(a.grandMean)}.`,
        ...(tk ? ["Medias con la misma letra no difieren significativamente (Tukey)."] : ["Como el ANOVA no es significativo, no se hace la prueba de Tukey."]),
        ...sup.notes,
      ],
      warnings,
    };
  }

  if (kind === "dbca" || kind === "fact") {
    const yc = col(t, k("y"), "Variable respuesta");
    const gc = col(t, k("g"), kind === "dbca" ? "Tratamiento" : "Factor A");
    const bc = col(t, k("b"), kind === "dbca" ? "Bloque" : "Factor B");
    const idx = pick([yc.name, gc.name, bc.name]);
    const y = idx.map((i) => yc.num[i]!);
    const g = idx.map((i) => gc.raw[i]!);
    const b = idx.map((i) => bc.raw[i]!);
    if (kind === "dbca") {
      const a = anovaRcbd(y, g, b);
      const p = a.table[0]!.p!;
      const tk = p < alpha ? tukeyTables(y, g, a, alpha, gc.name) : null;
      const sw = shapiroWilk(a.residuals);
      return {
        title: `ANOVA (DBCA): ${yc.name} — ${gc.name} con bloques ${bc.name}`,
        tables: [anovaTable(a, alpha), ...(tk ? tk.tables : []), { caption: "Supuestos", head: ["Prueba", "Estadístico", "p"], rows: [["Normalidad de residuos (Shapiro-Wilk)", `W = ${fmt(sw.w, 4)}`, formatP(sw.p)]] }],
        notes: [
          `Con α = ${String(alpha).replace(".", ",")}, ${sig(p)} entre tratamientos (F = ${fmt(a.table[0]!.f!, 3)}, p ${formatP(p)}).`,
          `Bloques: p ${formatP(a.table[1]!.p!)}${a.table[1]!.p! < alpha ? " (el bloqueo fue útil)" : ""}. CV del experimento: ${fmt(a.cv, 1)} %.`,
          ...(tk ? ["Medias con la misma letra no difieren significativamente (Tukey, con el CM del error del DBCA)."] : []),
          ...(sw.p < alpha ? ["Los residuos no siguen una distribución normal; considere transformar los datos."] : []),
        ],
        warnings,
      };
    }
    const a = anovaFactorial(y, g, b, gc.name, bc.name);
    const [ra, rb, rab] = a.table;
    const tables = [anovaTable(a, alpha)];
    const notes = [
      `${gc.name}: p ${formatP(ra!.p!)}; ${bc.name}: p ${formatP(rb!.p!)}; interacción: p ${formatP(rab!.p!)}. CV: ${fmt(a.cv, 1)} %.`,
    ];
    if (rab!.p! < alpha) {
      const cellG = y.map((_, i) => `${g[i]} × ${b[i]}`);
      tables.push(...tukeyTables(y, cellG, a, alpha, `${gc.name} × ${bc.name}`).tables);
      notes.push("La interacción es significativa: el efecto de un factor depende del otro; se comparan las combinaciones (Tukey sobre las celdas).");
    } else {
      if (ra!.p! < alpha) tables.push(tukeyTables(y, g, a, alpha, gc.name).tables[0]!);
      if (rb!.p! < alpha) tables.push(tukeyTables(y, b, a, alpha, bc.name).tables[0]!);
      notes.push("La interacción no es significativa: los factores se interpretan por separado (efectos principales).");
    }
    const sw = shapiroWilk(a.residuals);
    tables.push({ caption: "Supuestos", head: ["Prueba", "Estadístico", "p"], rows: [["Normalidad de residuos (Shapiro-Wilk)", `W = ${fmt(sw.w, 4)}`, formatP(sw.p)]] });
    return { title: `Factorial ${gc.name} × ${bc.name}: ${yc.name}`, tables, notes, warnings };
  }

  if (kind === "paired") {
    const a = col(t, k("y"), "Medición 1");
    const bb = col(t, k("x"), "Medición 2");
    const idx = pick([a.name, bb.name]);
    const r = tTestPaired(idx.map((i) => a.num[i]!), idx.map((i) => bb.num[i]!));
    return {
      title: `t pareada: ${a.name} frente a ${bb.name}`,
      tables: [{ caption: "Prueba", head: ["n", "Diferencia media", "IC 95 %", "t", "gl", "p"], rows: [[idx.length, fmt(r.meanDiff), `${fmt(r.ci95[0])} a ${fmt(r.ci95[1])}`, fmt(r.t, 3), r.df, formatP(r.p)]] }],
      notes: [`Con α = ${String(alpha).replace(".", ",")}, ${sig(r.p)} entre las dos mediciones.`],
      warnings,
    };
  }

  if (kind === "cor") {
    const xc = col(t, k("x"), "Variable X");
    const yc = col(t, k("y"), "Variable Y");
    const idx = pick([xc.name, yc.name]);
    const x = idx.map((i) => xc.num[i]!);
    const y = idx.map((i) => yc.num[i]!);
    const pr = pearson(x, y);
    const sp = spearman(x, y);
    const lr = linearRegression(x, y);
    return {
      title: `Relación entre ${xc.name} y ${yc.name}`,
      tables: [
        { caption: "Correlación", head: ["Coeficiente", "Valor", "p"], rows: [["Pearson (r)", fmt(pr.r, 4), formatP(pr.p)], ["Spearman (ρ)", fmt(sp.rho, 4), formatP(sp.p)]] },
        { caption: "Regresión lineal", head: ["Término", "Estimado", "EE", "IC 95 %"], rows: [["Intercepto (a)", fmt(lr.intercept, 4), fmt(lr.seIntercept, 4), ""], ["Pendiente (b)", fmt(lr.slope, 4), fmt(lr.seSlope, 4), `${fmt(lr.slopeCi95[0], 4)} a ${fmt(lr.slopeCi95[1], 4)}`]] },
      ],
      notes: [
        `Ecuación: ${yc.name} = ${fmt(lr.intercept, 4)} ${lr.slope < 0 ? "−" : "+"} ${fmt(Math.abs(lr.slope), 4)} · ${xc.name}; R² = ${fmt(lr.r2, 3)} (n = ${idx.length}).`,
        `La pendiente ${lr.p < alpha ? "es" : "no es"} significativamente distinta de cero (p ${formatP(lr.p)}).`,
        "Correlación no implica causalidad.",
      ],
      warnings,
    };
  }

  // χ²
  const ac = col(t, k("g"), "Variable categórica 1");
  const bc2 = col(t, k("b"), "Variable categórica 2");
  const idx = pick([ac.name, bc2.name]);
  const ra = [...new Set(idx.map((i) => ac.raw[i]!))];
  const cb = [...new Set(idx.map((i) => bc2.raw[i]!))];
  if (ra.length < 2 || cb.length < 2) throw new Error("Cada variable necesita al menos 2 categorías.");
  const tab = ra.map((r) => cb.map((c) => idx.filter((i) => ac.raw[i] === r && bc2.raw[i] === c).length));
  const r = chiSquare(tab);
  if (r.lowExpected) warnings.push(`${r.lowExpected} celda(s) tienen frecuencia esperada menor que 5: el resultado de χ² puede no ser confiable.`);
  return {
    title: `χ² de independencia: ${ac.name} × ${bc2.name}`,
    tables: [
      { caption: "Tabla de contingencia (observados)", head: [ac.name, ...cb], rows: tab.map((row, i) => [ra[i]!, ...row]) },
      { caption: "Prueba", head: ["χ²", "gl", "p"], rows: [[fmt(r.chi2, 3), r.df, formatP(r.p)]] },
    ],
    notes: [`Con α = ${String(alpha).replace(".", ",")}, ${r.p < alpha ? "las variables están asociadas" : "no hay evidencia de asociación entre las variables"} (p ${formatP(r.p)}).`],
    warnings,
  };
}
