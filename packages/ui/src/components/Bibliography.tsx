import { Fragment, useEffect, useMemo, useState } from "react";
import { DOCX_MIME, manuscriptDocx, type Work } from "@biociencia/core";
import {
  CSL_FORMAT_LABEL, CSL_LOCALES, formatBibliography, htmlToRich, isIncluded, loadCatalog, parseStyleXml, resolveStyle, searchStyles,
  type CslCatalog, type CslStyleInfo, type FormattedBibliography, type RichSeg, type StyleStore,
} from "@biociencia/cite";
import { useApp, useAsync } from "../context.tsx";
import { Dialog } from "./Pending.tsx";

const STYLE_KEY = "csl_style";
const LANG_KEY = "csl_lang";

function useStyleStore(): StyleStore {
  const { repo } = useApp();
  return useMemo(() => ({ get: (id) => repo.getCslStyle(id), put: (id, t, xml, o) => repo.saveCslStyle(id, t, xml, o) }), [repo]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML seguro (reconstruido por nosotros) para pegar en Word con cursivas. */
export function richToHtml(segs: RichSeg[]): string {
  return segs
    .map((s) => {
      let t = esc(s.text);
      if (s.i) t = `<i>${t}</i>`;
      if (s.b) t = `<b>${t}</b>`;
      if (s.sc) t = `<span style="font-variant:small-caps">${t}</span>`;
      if (s.sup) t = `<sup>${t}</sup>`;
      if (s.sub) t = `<sub>${t}</sub>`;
      return t;
    })
    .join("");
}

export function Rich({ segs }: { segs: RichSeg[] }) {
  return (
    <>
      {segs.map((s, i) => {
        let el: React.ReactNode = s.text;
        if (s.i) el = <i>{el}</i>;
        if (s.b) el = <b>{el}</b>;
        if (s.sc) el = <span className="sc">{el}</span>;
        if (s.sup) el = <sup>{el}</sup>;
        if (s.sub) el = <sub>{el}</sub>;
        return <Fragment key={i}>{el}</Fragment>;
      })}
    </>
  );
}

/** Botón que abre la bibliografía con estilos CSL para las publicaciones dadas. */
export function BibliographyButton({ getWorks, label = "Bibliografía con estilo", small = false }: { getWorks: () => Promise<Work[]>; label?: string; small?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`bc-btn ${small ? "bc-btn-sm" : ""}`} onClick={() => setOpen(true)}>{label}</button>
      {open ? <BibliographyDialog getWorks={getWorks} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function BibliographyDialog({ getWorks, onClose }: { getWorks: () => Promise<Work[]>; onClose: () => void }) {
  const { repo, saveFile } = useApp();
  const store = useStyleStore();
  const [catalog, setCatalog] = useState<CslCatalog | null>(null);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [lang, setLang] = useState<string>("");
  const [q, setQ] = useState("");
  const [works, setWorks] = useState<Work[] | null>(null);
  const [out, setOut] = useState<(FormattedBibliography & { title: string; origin: string; formatId: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const mine = useAsync(() => repo.listCslStyles(), [tick]);

  useEffect(() => {
    void (async () => {
      const [c, saved, savedLang, ws] = await Promise.all([loadCatalog(), repo.getSetting(STYLE_KEY), repo.getSetting(LANG_KEY), getWorks()]);
      setCatalog(c);
      setStyleId(saved || "apa");
      setLang(savedLang ?? "");
      setWorks(ws);
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!styleId || !works || !catalog) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const st = await resolveStyle(styleId, { store, catalog });
        const b = await formatBibliography(works, st.xml, { lang: lang || null });
        if (!cancelled) setOut({ ...b, title: st.title, origin: st.origin, formatId: st.formatId });
        await repo.setSetting(STYLE_KEY, styleId);
        await repo.setSetting(LANG_KEY, lang);
        if (st.origin === "descargado") setTick((t) => t + 1);
      } catch (e) {
        if (!cancelled) {
          setOut(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [styleId, lang, works, catalog, store, repo]);

  const results = useMemo(() => (catalog ? searchStyles(catalog, q, 80) : []), [catalog, q]);
  const current = catalog?.styles.find((s) => s.id === styleId);
  const imported = (mine.data ?? []).filter((s) => s.origin === "importado");
  const rich = out?.html.map(htmlToRich) ?? [];

  async function importCsl(file: File) {
    setMsg(null);
    const xml = await file.text();
    const meta = parseStyleXml(xml);
    if (!meta.valid) return setError(`«${file.name}» no es un estilo CSL válido.`);
    if (meta.parentId && catalog && !catalog.styles.some((s) => s.id === meta.parentId)) return setError(`El estilo depende de «${meta.parentId}», que no está en el catálogo.`);
    const id = `importado:${meta.id ?? file.name.replace(/\.csl$/i, "")}`;
    await repo.saveCslStyle(id, meta.title || file.name, xml, "importado");
    setTick((t) => t + 1);
    setStyleId(id);
    setMsg(`Estilo «${meta.title || file.name}» importado.`);
  }

  async function copy() {
    if (!out) return;
    const html = `<div>${rich.map((r) => `<p style="margin:0 0 8pt${out.hangingIndent ? ";padding-left:0.5in;text-indent:-0.5in" : ""}">${richToHtml(r)}</p>`).join("")}</div>`;
    const text = out.text.join("\n");
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      } else await navigator.clipboard.writeText(text);
      setMsg("Bibliografía copiada: al pegarla en Word conserva las cursivas.");
    } catch {
      setMsg("El navegador no permitió copiar. Use «Descargar Word».");
    }
  }

  const describe = (s: CslStyleInfo) => {
    const parent = s.p ? catalog?.styles.find((x) => x.id === s.p) : null;
    return [s.c ? CSL_FORMAT_LABEL[s.c] ?? s.c : null, parent ? `formato de ${parent.t}` : null, catalog && isIncluded(catalog, s.id) ? "sin internet" : "se descarga al elegirlo"].filter(Boolean).join(" · ");
  };

  return (
    <Dialog title="Bibliografía con estilo de revista" onClose={onClose} wide>
      <p className="bc-sub" style={{ fontSize: "0.85rem", marginTop: 0 }}>
        {catalog ? `${catalog.styles.length.toLocaleString("es")} estilos del repositorio oficial CSL (revistas, editoriales y normas). ` : "Cargando catálogo de estilos… "}
        Los más usados funcionan sin internet; los demás se descargan una vez y quedan guardados.
      </p>
      <div className="bc-grid-2">
        <div>
          <label className="bc-label" htmlFor="csl-q">Buscar estilo (revista, editorial o norma)</label>
          <input id="csl-q" className="bc-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="p. ej. Plant Disease, Agronomy, APA, Vancouver, ISO 690" />
          <div className="bc-style-list" role="listbox" aria-label="Estilos">
            {!q && imported.length ? imported.map((s) => (
              <button key={s.id} role="option" aria-selected={s.id === styleId} onClick={() => setStyleId(s.id)}>
                <strong>{s.title}</strong> <span className="bc-work-meta">· importado</span>
              </button>
            )) : null}
            {results.map((s) => (
              <button key={s.id} role="option" aria-selected={s.id === styleId} onClick={() => setStyleId(s.id)}>
                <strong>{s.t}</strong>
                <div className="bc-work-meta">{describe(s)}</div>
              </button>
            ))}
            {catalog && q && results.length === 0 ? <div className="bc-empty" style={{ padding: 10 }}>Ningún estilo coincide. Puede importar el archivo .csl de la revista.</div> : null}
          </div>
          <label className="bc-btn bc-btn-sm" style={{ marginTop: 6, cursor: "pointer" }}>
            Importar estilo (.csl)
            <input type="file" accept=".csl,application/xml,text/xml" hidden aria-label="Importar estilo CSL" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importCsl(f); }} />
          </label>
        </div>
        <div>
          <label className="bc-label" htmlFor="csl-lang">Idioma de la bibliografía</label>
          <select id="csl-lang" className="bc-select" value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="">El del estilo</option>
            {CSL_LOCALES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <div className="bc-alert" style={{ marginTop: 10, fontSize: "0.86rem" }} data-testid="csl-current">
            <div><strong>Estilo:</strong> {out?.title ?? current?.t ?? styleId ?? "…"}</div>
            {out ? <div className="bc-work-meta">{out.origin === "incluido" ? "Incluido en BioCiencia" : out.origin === "guardado" ? "Guardado en esta computadora" : out.origin === "descargado" ? "Descargado ahora del repositorio oficial" : "Importado por usted"}{out.formatId !== styleId && !String(styleId).startsWith("importado:") ? ` · usa el formato «${catalog?.styles.find((s) => s.id === out.formatId)?.t ?? out.formatId}»` : ""}</div> : null}
            {works ? <div className="bc-work-meta">{works.length} referencia(s)</div> : null}
            {out?.inText ? <div style={{ marginTop: 4 }}><strong>Cita en el texto:</strong> {out.inText}</div> : null}
          </div>
        </div>
      </div>

      {busy ? <div className="bc-alert" role="status" style={{ marginTop: 8 }}>Dando formato…</div> : null}
      {error ? <div className="bc-alert bc-alert-error" role="status" style={{ marginTop: 8 }}>{error}</div> : null}
      {msg ? <div className="bc-alert" role="status" style={{ marginTop: 8 }}>{msg}</div> : null}
      {works && works.length === 0 ? <div className="bc-empty">No hay publicaciones en esta vista.</div> : null}
      {out && rich.length ? (
        <div className={`bc-bib ${out.hangingIndent ? "hanging" : ""}`} data-testid="bibliography" lang={lang || undefined}>
          {rich.map((r, i) => <div key={i} className="csl-entry"><Rich segs={r} /></div>)}
        </div>
      ) : null}
      {out?.isNote && !rich.length ? <div className="bc-alert">Este estilo es de notas al pie y no define lista de referencias.</div> : null}

      <div className="bc-row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="bc-btn" disabled={!out?.text.length} onClick={() => void copy()}>Copiar</button>
        <button className="bc-btn" disabled={!out?.text.length} onClick={async () => {
          if (!out) return;
          const ok = await saveFile(`referencias-${slugId(styleId)}.docx`, manuscriptDocx({ title: "Referencias", blocks: [], references: out.segs.map((segs) => ({ segs })), referencesHeading: "Referencias", lang: lang || "es-ES" }), DOCX_MIME);
          if (ok) setMsg("Documento Word guardado.");
        }}>Descargar Word</button>
        <button className="bc-btn" disabled={!out?.text.length} onClick={async () => {
          if (!out) return;
          const ok = await saveFile(`referencias-${slugId(styleId)}.txt`, out.text.join("\r\n") + "\r\n", "text/plain");
          if (ok) setMsg("Archivo de texto guardado.");
        }}>Descargar texto</button>
      </div>
      <p className="bc-sub" style={{ fontSize: "0.75rem", marginTop: 8 }}>
        Estilos del proyecto Citation Style Language (https://citationstyles.org/, CC BY-SA 3.0), con citeproc-js. Revise siempre el resultado:
        si a una publicación le faltan datos (volumen, páginas), la referencia también saldrá incompleta. Los nombres de revista van completos (aún no hay lista de abreviaturas).
      </p>
    </Dialog>
  );
}

function slugId(id: string | null): string {
  return (id ?? "estilo").replace(/^importado:/, "").replace(/[^a-z0-9-]+/gi, "-").slice(0, 40);
}
