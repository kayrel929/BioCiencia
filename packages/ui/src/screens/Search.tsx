import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApp, useAsync } from "../context.tsx";
import { Icon } from "../components/Icon.tsx";
import { WorkItem } from "../components/WorkItem.tsx";

/**
 * Buscador científico.
 * Fase 2: busca dentro de la biblioteca local y muestra el historial.
 * Fase 3: añadirá la búsqueda en línea (OpenAlex primero) con filtros.
 */
export function Search() {
  const { repo } = useApp();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);

  const local = useAsync(() => (q ? repo.listLibrary({ text: q, limit: 50 }) : Promise.resolve([])), [q]);
  const history = useAsync(() => repo.listSearches(20), []);

  return (
    <div className="bc-page">
      <div className="bc-page-head">
        <div>
          <h1>Buscador científico</h1>
          <p className="bc-sub">Preguntas, palabras clave, títulos, autores o DOI.</p>
        </div>
      </div>
      <form
        className="bc-search"
        style={{ maxWidth: "none" }}
        onSubmit={(e) => {
          e.preventDefault();
          setParams(text.trim() ? { q: text.trim() } : {});
        }}
      >
        <Icon name="search" size={20} />
        <input aria-label="Texto de búsqueda" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej.: Trichoderma harzianum banano" />
        <button className="bc-btn bc-btn-primary" type="submit">Buscar</button>
      </form>

      <div className="bc-alert bc-alert-warn" style={{ marginTop: 16 }} data-testid="online-pending">
        La búsqueda en línea (OpenAlex, y después Crossref, PubMed y otras fuentes) se activa en la <strong>Fase 3</strong>.
        Por ahora se busca dentro de su biblioteca guardada, que funciona sin internet.
      </div>

      {q ? (
        <section className="bc-card" style={{ marginTop: 16 }}>
          <h2>En su biblioteca</h2>
          {local.loading ? <p className="bc-sub">Buscando…</p> : null}
          {local.error ? <div className="bc-alert bc-alert-error">{local.error}</div> : null}
          {local.data && local.data.length === 0 ? <p className="bc-empty">No hay publicaciones guardadas que coincidan con «{q}».</p> : null}
          {local.data?.map((e) => <WorkItem key={e.work.id} work={e.work} />)}
        </section>
      ) : null}

      <section className="bc-card" style={{ marginTop: 16 }}>
        <h2>Historial de búsquedas</h2>
        {history.data && history.data.length === 0 ? <p className="bc-sub">Todavía no hay búsquedas en línea guardadas.</p> : null}
        {history.data && history.data.length > 0 ? (
          <table className="bc-table">
            <thead>
              <tr><th>Consulta</th><th>Fuente</th><th>Resultados</th><th>Fecha</th></tr>
            </thead>
            <tbody>
              {history.data.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/buscar?q=${encodeURIComponent(s.query)}`}>{s.query}</Link></td>
                  <td>{s.source}</td>
                  <td>{s.error ? <span className="bc-badge bc-badge-warn">Error: {s.error}</span> : `${s.resultCount}${s.totalHits ? ` de ${s.totalHits}` : ""}`}</td>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
