import { useMemo, useState } from "react";
import { evidenceLevel, RETRACTION_LABEL, studySnapshot, type Work } from "@biociencia/core";

/** Aviso destacado si la publicación fue retractada, retirada o corregida. */
export function RetractionBanner({ work }: { work: Work }) {
  const r = work.retraction;
  if (!r) return null;
  const severe = r.status === "retracted" || r.status === "withdrawn";
  return (
    <div className={`bc-alert ${severe ? "bc-alert-error" : "bc-alert-warn"}`} role="note" data-testid="retraction" style={{ marginTop: 6, fontSize: "0.86rem" }}>
      <strong>⚠ {RETRACTION_LABEL[r.status]}</strong>
      {r.date ? ` (${r.date})` : ""}
      {severe ? ". No conviene citarlo como evidencia." : "."}
      {r.noticeDoi ? <> <a href={`https://doi.org/${r.noticeDoi}`} target="_blank" rel="noreferrer">Ver el aviso</a></> : null}
      <span className="bc-sub"> · Fuente: {r.source === "crossref" ? "Crossref / Retraction Watch" : "PubMed"}</span>
    </div>
  );
}

const LEVEL_CLASS: Record<number, string> = { 1: "bc-badge-green", 2: "bc-badge-green", 3: "bc-badge-blue", 4: "bc-badge-blue", 5: "", 6: "" };

/** Insignias de calidad: nivel de evidencia y «muy citado». */
export function QualityBadges({ work, highlyCited }: { work: Work; highlyCited?: boolean }) {
  const ev = useMemo(() => evidenceLevel(work), [work]);
  return (
    <>
      {ev ? (
        <span className={`bc-badge ${LEVEL_CLASS[ev.level]}`} data-testid="evidence-level" title={`Nivel ${ev.level} de 6 (1 = más alto). Clasificado por: ${ev.basis}. Es una orientación automática: revise el estudio.`}>
          Evidencia: {ev.label}
        </span>
      ) : null}
      {highlyCited ? (
        <span className="bc-badge bc-badge-green" data-testid="highly-cited" title="Entre el 10 % con más citas por año de estos resultados (mínimo 5 citas)">★ Muy citado</span>
      ) : null}
    </>
  );
}

/** Ficha rápida del estudio: datos sacados del resumen con su frase de origen (sin IA). */
export function StudySnapshot({ work }: { work: Work }) {
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState<string | null>(null);
  const items = useMemo(() => (open ? studySnapshot(work) : []), [open, work]);
  if (!work.abstract) return null;
  return (
    <div className="bc-snapshot" data-testid="snapshot">
      <button type="button" className="bc-link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Ocultar ficha del estudio" : "Ficha del estudio"}
      </button>
      {open ? (
        items.length ? (
          <>
            <table className="bc-snapshot-table">
              <tbody>
                {items.map((it) => (
                  <tr key={it.label}>
                    <th scope="row">{it.label}</th>
                    <td>
                      {it.value}{" "}
                      {it.sentence && it.sentence !== it.value ? (
                        <button type="button" className="bc-link-btn" onClick={() => setShow(show === it.label ? null : it.label)}>
                          {show === it.label ? "ocultar frase" : "¿de dónde?"}
                        </button>
                      ) : null}
                      {show === it.label ? <div className="bc-snapshot-src">«{it.sentence}»</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="bc-sub" style={{ fontSize: "0.75rem" }}>Extraído automáticamente del resumen, sin IA. Compruebe cada dato con su frase.</div>
          </>
        ) : (
          <div className="bc-sub" style={{ fontSize: "0.85rem" }}>El resumen no tiene datos que se puedan extraer automáticamente (muestra, diseño, lugar, organismos…).</div>
        )
      ) : null}
    </div>
  );
}
