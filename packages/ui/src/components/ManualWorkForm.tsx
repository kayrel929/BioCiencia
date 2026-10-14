import { useState } from "react";
import { normalizeDoi, type Work } from "@biociencia/core";
import { useApp } from "../context.tsx";
import { Dialog } from "./Pending.tsx";

/**
 * Registro manual de una referencia (por ejemplo, un artículo que el usuario ya tiene).
 * No inventa datos: guarda exactamente lo que el usuario escribe, marcado como "Ingreso manual".
 */
export function ManualWorkForm({ onClose, onSaved }: { onClose: () => void; onSaved?: (id: string) => void }) {
  const { repo, refresh } = useApp();
  const [f, setF] = useState({ title: "", authors: "", year: "", venue: "", doi: "", abstract: "", keywords: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.title.trim()) return setError("El título es obligatorio.");
    if (f.doi.trim() && !normalizeDoi(f.doi)) return setError("El DOI no tiene un formato válido (debe empezar por 10.).");
    const year = f.year.trim() ? Number(f.year) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1500 || year > new Date().getFullYear() + 1)) return setError("El año no es válido.");
    const work: Work = {
      title: f.title,
      authors: f.authors.split(/;|\n/).map((n) => n.trim()).filter(Boolean).map((name) => ({ name })),
      year,
      venue: f.venue.trim() || null,
      doi: f.doi.trim() || null,
      abstract: f.abstract.trim() || null,
      keywords: f.keywords.split(/[;,]/).map((k) => k.trim()).filter(Boolean),
      source: "manual",
      fetchedAt: new Date().toISOString(),
    };
    try {
      const { id, created } = await repo.upsertWork(work);
      await repo.addToLibrary(id);
      refresh();
      onSaved?.(id);
      if (!created) alertDuplicate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function alertDuplicate() {
    // El repositorio unió los datos con el registro existente en lugar de duplicarlo.
    console.info("BioCiencia: la referencia ya existía y se completó con los datos nuevos.");
  }

  return (
    <Dialog title="Añadir referencia manual" onClose={onClose}>
      <form onSubmit={save}>
        <label className="bc-label" htmlFor="mw-title">Título *</label>
        <input id="mw-title" className="bc-input" value={f.title} onChange={set("title")} autoFocus />
        <label className="bc-label" htmlFor="mw-authors">Autores (separados por punto y coma)</label>
        <input id="mw-authors" className="bc-input" value={f.authors} onChange={set("authors")} placeholder="Pérez, María; Gómez, Luis" />
        <div className="bc-grid-2">
          <div>
            <label className="bc-label" htmlFor="mw-year">Año</label>
            <input id="mw-year" className="bc-input" value={f.year} onChange={set("year")} inputMode="numeric" />
          </div>
          <div>
            <label className="bc-label" htmlFor="mw-doi">DOI</label>
            <input id="mw-doi" className="bc-input mono" value={f.doi} onChange={set("doi")} placeholder="10.xxxx/xxxxx" />
          </div>
        </div>
        <label className="bc-label" htmlFor="mw-venue">Revista</label>
        <input id="mw-venue" className="bc-input" value={f.venue} onChange={set("venue")} />
        <label className="bc-label" htmlFor="mw-abstract">Resumen</label>
        <textarea id="mw-abstract" className="bc-textarea" value={f.abstract} onChange={set("abstract")} />
        <label className="bc-label" htmlFor="mw-kw">Palabras clave (separadas por coma)</label>
        <input id="mw-kw" className="bc-input" value={f.keywords} onChange={set("keywords")} />
        {error ? <div className="bc-alert bc-alert-error" style={{ marginTop: 12 }}>{error}</div> : null}
        <div className="bc-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="bc-btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="bc-btn bc-btn-primary">Guardar en la biblioteca</button>
        </div>
      </form>
    </Dialog>
  );
}
