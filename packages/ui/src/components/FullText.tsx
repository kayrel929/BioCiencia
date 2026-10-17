import { useState } from "react";
import type { Work } from "@biociencia/core";
import { institutionalUrl, OA_STATUS_LABEL, VERSION_LABEL, type OaInfo } from "@biociencia/sources";
import { useApp } from "../context.tsx";
import { RequestArticleDialog } from "./RequestArticle.tsx";

/**
 * «¿Dónde leerlo?»: busca una copia LEGAL y gratuita del texto completo (Unpaywall) y,
 * si no existe, ofrece acceso institucional o pedirlo al autor.
 * No descarga nada por sí mismo: abre los enlaces en el navegador.
 */
export function FullTextButton({ work }: { work: Work }) {
  const { unpaywall, libraryProxy } = useApp();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ loading: boolean; info: OaInfo | null; error: string | null }>({ loading: false, info: null, error: null });
  const [asking, setAsking] = useState(false);

  async function check() {
    setOpen(!open);
    if (open || state.info || state.loading || !work.doi) return;
    setState({ loading: true, info: null, error: null });
    try {
      setState({ loading: false, info: await unpaywall.lookup(work.doi), error: null });
    } catch (e) {
      setState({ loading: false, info: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const inst = institutionalUrl(libraryProxy, work);
  const info = state.info;
  return (
    <>
      <button type="button" className="bc-btn bc-btn-sm" aria-expanded={open} onClick={check}>
        ¿Dónde leerlo?
      </button>
      {open ? (
        <div className="bc-alert" style={{ flexBasis: "100%", marginTop: 6 }} data-testid="fulltext-panel">
          {!work.doi ? <div>Esta publicación no tiene DOI, así que no se puede buscar una copia legal automáticamente.</div> : null}
          {state.loading ? <div role="status">Buscando copias legales gratuitas en Unpaywall…</div> : null}
          {state.error ? <div className="bc-alert-error" style={{ padding: 6, borderRadius: 6 }} role="status">{state.error}</div> : null}
          {info && !info.found ? <div role="status">Unpaywall no conoce este DOI.</div> : null}
          {info && info.found ? (
            info.isOa && info.best ? (
              <div role="status">
                <strong>Hay una copia legal gratuita</strong> · {OA_STATUS_LABEL[info.status ?? ""] ?? info.status}
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {[info.best, ...info.locations.filter((l) => l.url !== info.best!.url)].slice(0, 5).map((l, i) => (
                    <li key={l.url + i}>
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {l.pdfUrl ? "PDF" : "Página"} {l.hostType === "publisher" ? "de la editorial" : `en ${l.repository ?? "repositorio"}`}
                      </a>
                      {l.version ? ` · ${VERSION_LABEL[l.version] ?? l.version}` : ""}
                      {l.license ? ` · licencia ${l.license}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div role="status">
                <strong>No se encontró una copia legal gratuita</strong> ({OA_STATUS_LABEL[info.status ?? "closed"] ?? info.status}).
                <div className="bc-sub" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                  Dos caminos legales para conseguir el texto completo:
                  <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    <li><strong>Acceso institucional</strong>: si su universidad o centro tiene suscripción, ábralo con su proxy (Configuración → Fuentes científicas).</li>
                    <li><strong>Solicitar al autor</strong>: casi todos los autores envían su artículo con gusto; BioCiencia le prepara la carta.</li>
                  </ol>
                </div>
              </div>
            )
          ) : null}
          <div className="bc-row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {inst ? <a className="bc-btn bc-btn-sm" href={inst} target="_blank" rel="noreferrer">Acceso institucional</a> : null}
            <button type="button" className="bc-btn bc-btn-sm" onClick={() => setAsking(true)}>Solicitar al autor</button>
          </div>
          {!inst ? <div className="bc-sub" style={{ fontSize: "0.78rem", marginTop: 6 }}>Si su institución tiene suscripciones, configure su proxy de biblioteca en Configuración.</div> : null}
        </div>
      ) : null}
      {asking ? <RequestArticleDialog work={work} onClose={() => setAsking(false)} /> : null}
    </>
  );
}
