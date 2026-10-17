import type { ReactNode } from "react";
import type { Work } from "@biociencia/core";
import { WORK_TYPES } from "@biociencia/sources";
import { AbstractTab } from "./Abstract.tsx";
import { RequestArticleButton } from "./RequestArticle.tsx";
import { QualityBadges, RetractionBanner, StudySnapshot } from "./Evidence.tsx";
import { VerdictChip } from "./Consensus.tsx";
import { CitationGraphButton } from "./CitationGraph.tsx";
import { SmartCitationsButton } from "./SmartCitations.tsx";
import { DataExtractionButton } from "./DataExtraction.tsx";
import { OpenAccess } from "./OpenAccess.tsx";
import { tr, useLang } from "../i18n.tsx";
import type { CheckedVerdict } from "@biociencia/ai";

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
  openaire: "OpenAIRE",
  doaj: "DOAJ",
  orcid: "ORCID",
  manual: "Ingreso manual",
  import: "Importado",
};

/** Ficha de una publicación: datos bibliográficos, enlaces y acciones.
 *  Cuando hay veredicto de consenso, la ficha se organiza estilo Consensus:
 *  el veredicto (con su frase comprobada) queda en una columna a la izquierda. */
export function WorkItem({ work, actions, extra, noRequest = false, highlyCited = false, verdict, autoOa = false, workId }: { work: Work; actions?: ReactNode; extra?: ReactNode; noRequest?: boolean; highlyCited?: boolean; verdict?: CheckedVerdict; autoOa?: boolean; workId?: string }) {
  const { lang, t } = useLang();
  const en = lang === "en";
  const doiUrl = work.doi ? `https://doi.org/${work.doi}` : null;
  return (
    <article className={`bc-work ${verdict ? "bc-work-consensus" : ""} ${work.retraction?.status === "retracted" || work.retraction?.status === "withdrawn" ? "bc-retracted" : ""}`} data-testid="work-item">
      <div className="bc-work-title">{work.title}</div>
      <div className="bc-work-meta">
        {formatAuthors(work)}
        {work.year ? ` · ${work.year}` : ""}
        {work.venue ? <> · <em>{work.venue}</em></> : null}
      </div>
      {verdict ? (
        <div className="bc-consensus-quote" data-testid="work-verdict">
          <VerdictChip v={verdict} lang={lang} /> {verdict.explanation ? <span style={{ fontSize: "0.85rem" }}>{verdict.explanation}</span> : null}
          {verdict.quote ? (
            <div className="bc-consensus-cite">
              «{verdict.quote}»{verdict.quoteVerified ? t("wi.quoteChecked") : t("wi.quoteNot")}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="bc-row" style={{ marginTop: 6, gap: 6 }}>
        {work.doi ? (
          <a className="bc-badge bc-badge-blue mono" href={doiUrl!} target="_blank" rel="noreferrer">
            DOI {work.doi}
          </a>
        ) : (
          <span className="bc-badge">{t("wi.noDoi")}</span>
        )}
        <OpenAccess work={work} workId={workId ?? work.id} auto={autoOa} />
        {typeof work.citedByCount === "number" ? <span className="bc-badge">{work.citedByCount} {t("wi.cites")}</span> : null}
        {work.type ? <span className="bc-badge">{WORK_TYPES[work.type] ?? work.type}</span> : null}
        <QualityBadges work={work} highlyCited={highlyCited} />
        <span className="bc-badge" title={`${en ? "Data fetched on" : "Datos obtenidos el"} ${new Date(work.fetchedAt).toLocaleString()}`}>
          {en ? "Source:" : "Fuente:"} {SOURCE_LABEL[work.source] ?? work.source}
        </span>
      </div>
      <RetractionBanner work={work} />
      <AbstractTab work={work} />
      <StudySnapshot work={work} />
      {extra}
      <div className="bc-work-actions">
        {doiUrl || work.landingUrl ? (
          <a className="bc-btn bc-btn-sm" href={doiUrl ?? work.landingUrl!} target="_blank" rel="noreferrer">
            {t("wi.open")}
          </a>
        ) : null}
        {work.oaUrl ? (
          <a className="bc-btn bc-btn-sm" href={work.oaUrl} target="_blank" rel="noreferrer">
            {t("wi.oaPdf")}
          </a>
        ) : null}
        {!noRequest && !work.isOpenAccess ? <RequestArticleButton work={work} label={t("wi.requestArticle")} /> : null}
        <CitationGraphButton work={work} />
        <SmartCitationsButton work={work} />
        <DataExtractionButton work={work} />
        {actions}
      </div>
    </article>
  );
}
