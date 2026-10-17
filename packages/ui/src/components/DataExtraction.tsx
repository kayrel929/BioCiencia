import { useState } from "react";
import type { Work } from "@biociencia/core";
import { extractDataMessages, type ExtractedData } from "@biociencia/ai";
import { useApp } from "../context.tsx";
import { useAiSetup } from "./Consensus.tsx";
import { Dialog } from "./Pending.tsx";

/**
 * Extracción de datos con IA (estilo Elicit): extrae PICO y otros datos
 * estructurados del resumen de un paper. Los datos se pueden guardar
 * como notas en la biblioteca.
 */

const FIELDS: { key: keyof ExtractedData; label: string }[] = [
  { key: "population", label: "Población" },
  { key: "intervention", label: "Intervención" },
  { key: "comparison", label: "Comparación" },
  { key: "outcome", label: "Resultado" },
  { key: "studyDesign", label: "Diseño del estudio" },
  { key: "sampleSize", label: "Tamaño de muestra" },
  { key: "location", label: "Ubicación" },
  { key: "duration", label: "Duración" },
  { key: "keyFindings", label: "Hallazgos clave" },
  { key: "limitations", label: "Limitaciones" },
];

export function DataExtractionButton({ work }: { work: Work }) {
  const { provider } = useAiSetup();
  const [open, setOpen] = useState(false);
  if (!work.abstract) return null;
  return (
    <>
      <button
        type="button"
        className="bc-btn bc-btn-sm"
        onClick={() => setOpen(true)}
        title="Extraer datos del estudio con IA (estilo Elicit)"
        disabled={!provider}
      >
        Extraer datos
      </button>
      {open ? <DataExtractionDialog work={work} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DataExtractionDialog({ work, onClose }: { work: Work; onClose: () => void }) {
  const { provider } = useAiSetup();
  const { repo, refresh } = useApp();
  const [data, setData] = useState<ExtractedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function extract() {
    if (!provider) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const raw = await provider.chat(extractDataMessages(work), { json: true });
      const j = JSON.parse(raw);
      const d: ExtractedData = {};
      for (const f of FIELDS) {
        const v = j?.[f.key];
        if (typeof v === "string" && v.trim()) d[f.key] = v.trim();
      }
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveNotes() {
    if (!data || !work.id) return;
    const lines = FIELDS.filter((f) => data[f.key]).map((f) => `${f.label}: ${data[f.key]}`);
    if (!lines.length) return;
    const note = `Datos extraídos con IA:\n${lines.join("\n")}`;
    // Se AÑADE a las observaciones: antes se sobrescribían y se perdía lo que el usuario hubiera escrito.
    await repo.appendLibraryNotes(work.id, note);
    refresh();
    setSaved(true);
  }

  const filled = data ? FIELDS.filter((f) => data[f.key]).length : 0;

  return (
    <Dialog title="Extracción de datos (estilo Elicit)" onClose={onClose} wide>
      <p className="bc-sub" style={{ fontSize: "0.85rem", marginTop: 0 }}>
        <strong>{work.title.slice(0, 80)}</strong>
      </p>
      <p className="bc-sub" style={{ fontSize: "0.82rem" }}>
        La IA extrae datos estructurados del resumen. Revise antes de guardar.
      </p>
      {!data && !loading ? (
        <button className="bc-btn bc-btn-primary" onClick={() => void extract()} disabled={!provider}>
          Extraer con IA
        </button>
      ) : null}
      {loading ? <div className="bc-sub" role="status">Extrayendo datos…</div> : null}
      {error ? <div className="bc-alert bc-alert-error" role="status">{error}</div> : null}
      {data ? (
        <>
          <p className="bc-sub" style={{ fontSize: "0.82rem", marginTop: 8 }}>
            {filled} de {FIELDS.length} campos extraídos
          </p>
          <table className="bc-table" style={{ fontSize: "0.85rem" }}>
            <tbody>
              {FIELDS.map((f) => (
                <tr key={f.key}>
                  <th scope="row" style={{ width: "30%" }}>{f.label}</th>
                  <td>{data[f.key] ?? <span className="bc-sub">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bc-row" style={{ gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button className="bc-btn" onClick={() => void saveNotes()} disabled={!filled || saved}>
              {saved ? "Guardado" : "Guardar como nota"}
            </button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
