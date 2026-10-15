import { useState } from "react";
import { parseReferences, toBibTeX, toCSV, toCslJson, toEndNote, toEndNoteXML, toRIS, type ImportResult, type Work } from "@biociencia/core";
import { useApp, useAsync } from "../context.tsx";
import { Dialog } from "./Pending.tsx";

export const EXPORT_FORMATS = [
  { id: "bib", label: "BibTeX (.bib) · LaTeX, Zotero, JabRef", ext: "bib", mime: "application/x-bibtex", fn: toBibTeX },
  { id: "ris", label: "RIS (.ris) · Zotero, Mendeley, EndNote", ext: "ris", mime: "application/x-research-info-systems", fn: toRIS },
  { id: "enw", label: "EndNote etiquetado (.enw)", ext: "enw", mime: "application/x-endnote-refer", fn: toEndNote },
  { id: "enx", label: "EndNote XML (.xml)", ext: "xml", mime: "application/xml", fn: toEndNoteXML },
  { id: "csv", label: "CSV (.csv) · Excel", ext: "csv", mime: "text/csv", fn: toCSV },
  { id: "csl", label: "CSL-JSON (.json) · gestores de citas", ext: "json", mime: "application/json", fn: toCslJson },
] as const;

function slug(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "referencias";
}

/** Selector de formato + botón. `getWorks` se llama al exportar para usar los datos actuales. */
export function ExportButton({ getWorks, baseName, label = "Exportar" }: { getWorks: () => Promise<Work[]>; baseName: string; label?: string }) {
  const { saveFile } = useApp();
  const [fmt, setFmt] = useState<(typeof EXPORT_FORMATS)[number]["id"]>("ris");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="bc-row" style={{ gap: 6 }}>
      <select className="bc-select" style={{ width: "auto" }} aria-label="Formato de exportación" value={fmt} onChange={(e) => setFmt(e.target.value as typeof fmt)}>
        {EXPORT_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      <button
        type="button"
        className="bc-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const works = await getWorks();
            if (works.length === 0) return setMsg("No hay publicaciones para exportar.");
            const f = EXPORT_FORMATS.find((x) => x.id === fmt)!;
            const date = new Date().toISOString().slice(0, 10);
            const ok = await saveFile(`${slug(baseName)}-${date}.${f.ext}`, f.fn(works), f.mime);
            if (ok) setMsg(`${works.length} referencia(s) exportada(s).`);
          } catch (e) {
            setMsg(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </button>
      {msg ? <span className="bc-sub" role="status" style={{ fontSize: "0.85rem" }}>{msg}</span> : null}
    </div>
  );
}

/**
 * Descargar la cita de UNA publicación en el formato elegido (EndNote, RIS, BibTeX…).
 * Al abrir el archivo .enw o .ris con doble clic, EndNote/Zotero lo importan.
 */
export function CiteButton({ work }: { work: Work }) {
  const { saveFile } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  const first = work.authors[0]?.name ?? "";
  const surname = first.includes(",") ? first.split(",")[0]! : first.split(" ").slice(-1)[0] ?? "";
  const base = slug(`${surname || work.title.split(" ").slice(0, 3).join(" ")} ${work.year ?? ""}`);
  return (
    <span className="bc-row" style={{ gap: 4, display: "inline-flex" }}>
      <select
        className="bc-select bc-btn-sm"
        style={{ width: "auto" }}
        aria-label="Descargar cita"
        value=""
        onChange={async (e) => {
          const f = EXPORT_FORMATS.find((x) => x.id === e.target.value);
          e.target.value = "";
          if (!f) return;
          try {
            const ok = await saveFile(`${base}.${f.ext}`, f.fn([work]), f.mime);
            setMsg(ok ? "Cita descargada" : null);
          } catch (err) {
            setMsg(`No se pudo descargar: ${err instanceof Error ? err.message : String(err)}`);
          }
        }}
      >
        <option value="">Descargar cita…</option>
        {EXPORT_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      {msg ? <span className="bc-sub" role="status" style={{ fontSize: "0.8rem" }}>{msg}</span> : null}
    </span>
  );
}

/** Importar archivos de Zotero, Mendeley, EndNote o JabRef a la biblioteca. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { repo, refresh } = useApp();
  const collections = useAsync(() => repo.listCollections(), []);
  const projects = useAsync(() => repo.listProjects(), []);
  const [parsed, setParsed] = useState<(ImportResult & { fileName: string }) | null>(null);
  const [collectionId, setCollectionId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog title="Importar referencias" onClose={onClose}>
      <p className="bc-sub" style={{ fontSize: "0.9rem" }}>
        Formatos: BibTeX (.bib), RIS (.ris) y EndNote (.enw). Desde EndNote use «Exportar» con el estilo RefMan (RIS) o EndNote Export.
      </p>
      <label className="bc-label" htmlFor="imp-file">Archivo</label>
      <input
        id="imp-file"
        type="file"
        accept=".bib,.ris,.enw,.txt"
        onChange={async (e) => {
          setError(null);
          setResult(null);
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 20 * 1024 * 1024) return setError("El archivo supera 20 MB.");
          const text = await file.text();
          setParsed({ ...parseReferences(text, file.name), fileName: file.name });
        }}
      />
      {parsed ? (
        <div className="bc-alert" style={{ marginTop: 12 }} data-testid="import-preview">
          <strong>{parsed.works.length}</strong> referencia(s) leída(s) de {parsed.fileName} ({parsed.format.toUpperCase()}).
          {parsed.warnings.length ? (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {parsed.warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}
              {parsed.warnings.length > 8 ? <li>… y {parsed.warnings.length - 8} aviso(s) más</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="bc-grid-2" style={{ marginTop: 8 }}>
        <div>
          <label className="bc-label" htmlFor="imp-col">Añadir también a la colección</label>
          <select id="imp-col" className="bc-select" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            <option value="">Ninguna</option>
            {collections.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="bc-label" htmlFor="imp-proj">Añadir también al proyecto</label>
          <select id="imp-proj" className="bc-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Ninguno</option>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {error ? <div className="bc-alert bc-alert-error" style={{ marginTop: 12 }}>{error}</div> : null}
      {result ? <div className="bc-alert" role="status" style={{ marginTop: 12 }}>{result}</div> : null}
      <div className="bc-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button type="button" className="bc-btn" onClick={onClose}>{result ? "Cerrar" : "Cancelar"}</button>
        <button
          type="button"
          className="bc-btn bc-btn-primary"
          disabled={!parsed || parsed.works.length === 0 || busy || !!result}
          onClick={async () => {
            if (!parsed) return;
            setBusy(true);
            try {
              const r = await repo.importWorks(parsed.works, { collectionId: collectionId || undefined, projectId: projectId || undefined });
              setResult(`Importación terminada: ${r.created} nueva(s), ${r.merged} ya existían y se completaron (sin duplicar).`);
              refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Importar a la biblioteca
        </button>
      </div>
    </Dialog>
  );
}
