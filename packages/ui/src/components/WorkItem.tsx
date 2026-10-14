import type { ReactNode } from "react";
import type { Work } from "@biociencia/core";
import { WORK_TYPES } from "@biociencia/sources";

export function formatAuthors(w: Work, max = 4): string {
  const names = w.authors.map((a) => a.name);
  if (names.length === 0) return "Autor no indicado";
  return names.length > max ? `${names.slice(0, max).join(", ")} et al.` : names.join(", ");
}

const SOURCE_LABEL: Record<string, string> = {
  openalex: "OpenAlex",
  crossref: "Crossref",
  pubmed: "PubMed",
  europepmc: "Europe PMC",
  semanticscholar: "Semantic Scholar",
  arxiv: "arXiv",
  doaj: "DOAJ",
  manual: "Ingreso manual",
  import: "Importado",
};

/** Ficha de una publicación: datos bibliográficos, enlaces y acciones. */
export function WorkItem({ work, actions, extra }: { work: Work; actions?: ReactNode; extra?: ReactNode }) {
  const doiUrl = work.doi ? `https://doi.org/${work.doi}` : null;
  return (
    <article className="bc-work" data-testid="work-item">
      <div className="bc-work-title">{work.title}</div>
      <div className="bc-work-meta">
        {formatAuthors(work)}
        {work.year ? ` · ${work.year}` : ""}
        {work.venue ? <> · <em>{work.venue}</em></> : null}
      </div>
      <div className="bc-row" style={{ marginTop: 6, gap: 6 }}>
        {work.doi ? (
          <a className="bc-badge bc-badge-blue mono" href={doiUrl!} target="_blank" rel="noreferrer">
            DOI {work.doi}
          </a>
        ) : (
          <span className="bc-badge">Sin DOI</span>
        )}
        {work.isOpenAccess ? <span className="bc-badge bc-badge-green">Acceso abierto</span> : null}
        {typeof work.citedByCount === "number" ? <span className="bc-badge">{work.citedByCount} citas</span> : null}
        {work.type ? <span className="bc-badge">{WORK_TYPES[work.type] ?? work.type}</span> : null}
        <span className="bc-badge" title={`Datos obtenidos el ${new Date(work.fetchedAt).toLocaleString()}`}>
          Fuente: {SOURCE_LABEL[work.source] ?? work.source}
        </span>
      </div>
      {work.abstract ? <div className="bc-work-abstract">{work.abstract}</div> : <div className="bc-work-meta" style={{ marginTop: 6 }}>Resumen no disponible en la fuente.</div>}
      {extra}
      <div className="bc-work-actions">
        {doiUrl ? (
          <a className="bc-btn bc-btn-sm" href={doiUrl} target="_blank" rel="noreferrer">
            Abrir artículo
          </a>
        ) : work.landingUrl ? (
          <a className="bc-btn bc-btn-sm" href={work.landingUrl} target="_blank" rel="noreferrer">
            Abrir artículo
          </a>
        ) : null}
        {work.oaUrl ? (
          <a className="bc-btn bc-btn-sm" href={work.oaUrl} target="_blank" rel="noreferrer">
            PDF de acceso abierto
          </a>
        ) : null}
        {actions}
      </div>
    </article>
  );
}
