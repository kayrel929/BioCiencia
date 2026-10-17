import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { deepSearchMessages } from "@biociencia/ai";
import { useApp } from "../context.tsx";
import { useAiSetup } from "./Consensus.tsx";
import { Dialog } from "./Pending.tsx";

/**
 * Búsqueda profunda iterativa (estilo Undermind): la IA sugiere términos
 * alternativos para encontrar papers que una búsqueda por palabras clave
 * no encontraría. Se puede iterar varias veces.
 */

export function DeepSearchButton({ question, foundTitles }: { question: string; foundTitles: string[] }) {
  const { provider } = useAiSetup();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="bc-btn bc-btn-sm"
        onClick={() => setOpen(true)}
        title="Búsqueda profunda con IA: encuentra papers que una búsqueda normal no hallaría"
        disabled={!provider}
      >
        Búsqueda profunda
      </button>
      {open ? (
        <DeepSearchDialog question={question} foundTitles={foundTitles} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function DeepSearchDialog({ question, foundTitles, onClose }: { question: string; foundTitles: string[]; onClose: () => void }) {
  const { provider } = useAiSetup();
  const nav = useNavigate();
  const [terms, setTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iterations, setIterations] = useState(0);

  async function refine() {
    if (!provider) return;
    setLoading(true);
    setError(null);
    try {
      const raw = await provider.chat(deepSearchMessages(question, foundTitles), { json: true });
      const j = JSON.parse(raw);
      const list: string[] = Array.isArray(j?.terminos) ? j.terminos.filter((t: unknown) => typeof t === "string") : [];
      setTerms(list);
      setIterations((i) => i + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog title="Búsqueda profunda (estilo Undermind)" onClose={onClose} wide>
      <p className="bc-sub" style={{ fontSize: "0.85rem", marginTop: 0 }}>
        <strong>Pregunta:</strong> {question}
      </p>
      <p className="bc-sub" style={{ fontSize: "0.82rem" }}>
        La IA sugiere términos alternativos para encontrar papers relevantes que la búsqueda original no halló.
        Puede iterar para refinar.
      </p>
      {terms.length === 0 && !loading ? (
        <button className="bc-btn bc-btn-primary" onClick={() => void refine()} disabled={!provider}>
          Sugerir términos
        </button>
      ) : null}
      {loading ? <div className="bc-sub" role="status">Pensando…</div> : null}
      {error ? <div className="bc-alert bc-alert-error" role="status">{error}</div> : null}
      {terms.length ? (
        <>
          <p className="bc-sub" style={{ fontSize: "0.82rem", marginTop: 8 }}>
            Iteración {iterations}: {terms.length} términos sugeridos
          </p>
          <div className="bc-row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {terms.map((t, i) => (
              <button
                key={i}
                className="bc-chip"
                onClick={() => {
                  onClose();
                  nav(`/buscar?q=${encodeURIComponent(t)}`);
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="bc-row" style={{ gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button className="bc-btn" onClick={() => void refine()}>
              Refinar otra vez
            </button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
