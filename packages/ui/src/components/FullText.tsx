import { useState } from "react";
import type { Work } from "@biociencia/core";
import { authorRequestEmail, googleScholarForWork, institutionalUrl, mailtoLink, OA_STATUS_LABEL, VERSION_LABEL, type OaInfo } from "@biociencia/sources";
import { useApp } from "../context.tsx";
import { Dialog } from "./Pending.tsx";

/**
 * «¿Dónde leerlo?»: busca una copia LEGAL y gratuita del texto completo (Unpaywall) y,
 * si no existe, ofrece acceso institucional, pedirlo al autor o abrir Google Académico.
 * No descarga nada por sí mismo: abre los enlaces en el navegador.
 */
export function FullTextButton({ work }: { work: Work }) {
  const { unpaywall, libraryProxy, identity } = useApp();
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
              <div role="status">No se encontró una copia legal gratuita (estado: {OA_STATUS_LABEL[info.status ?? "closed"] ?? info.status}).</div>
            )
          ) : null}
          <div className="bc-row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {inst ? <a className="bc-btn bc-btn-sm" href={inst} target="_blank" rel="noreferrer">Acceso institucional</a> : null}
            <button type="button" className="bc-btn bc-btn-sm" onClick={() => setAsking(true)}>Pedir al autor</button>
            <a className="bc-btn bc-btn-sm" href={googleScholarForWork(work)} target="_blank" rel="noreferrer">Buscar en Google Académico</a>
          </div>
          {!inst ? <div className="bc-sub" style={{ fontSize: "0.78rem", marginTop: 6 }}>Si su institución tiene suscripciones, configure su proxy de biblioteca en Configuración.</div> : null}
        </div>
      ) : null}
      {asking ? <AskAuthorDialog work={work} sender={identity?.displayName ?? ""} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

function AskAuthorDialog({ work, sender, onClose }: { work: Work; sender: string; onClose: () => void }) {
  const draft = authorRequestEmail(work, sender);
  const [to, setTo] = useState("");
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="Pedir el artículo al autor" onClose={onClose}>
      <p className="bc-sub" style={{ fontSize: "0.85rem", marginTop: 0 }}>
        Los autores suelen enviar sus artículos gratis cuando se les pide. El correo del autor de correspondencia aparece en la página del artículo
        («Abrir artículo»). BioCiencia no envía nada: el mensaje se abre en su programa de correo.
      </p>
      <label className="bc-label" htmlFor="ask-to">Correo del autor</label>
      <input id="ask-to" className="bc-input" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="autor@universidad.edu" />
      <label className="bc-label" htmlFor="ask-body">Mensaje</label>
      <textarea id="ask-body" className="bc-textarea" style={{ minHeight: 220 }} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="bc-row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="bc-btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${draft.subject}\n\n${body}`);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copiado" : "Copiar mensaje"}
        </button>
        <a
          className={`bc-btn bc-btn-primary ${/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) ? "" : "bc-disabled"}`}
          aria-disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())}
          href={/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) ? mailtoLink(to.trim(), draft.subject, body) : undefined}
        >
          Abrir en mi correo
        </a>
      </div>
    </Dialog>
  );
}
