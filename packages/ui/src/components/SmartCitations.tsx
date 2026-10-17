import { useState } from "react";
import type { Work } from "@biociencia/core";
import { CITATION_TYPE_LABEL, smartCitationMessages, type CitationType } from "@biociencia/ai";
import { useApp } from "../context.tsx";
import { useAiSetup } from "./Consensus.tsx";
import { Dialog } from "./Pending.tsx";

/**
 * Citas inteligentes (estilo Scite): muestra si las citas a un paper
 * lo apoyan, contrastan o solo lo mencionan, con el contexto de la cita.
 *
 * Se integra con la red de citas: al explorar "quién me cita", cada cita
 * se clasifica automáticamente con IA.
 */

const TYPE_STYLE: Record<CitationType, { cls: string; sym: string }> = {
  supporting: { cls: "bc-verdict-positive", sym: "✓" },
  contrasting: { cls: "bc-verdict-negative", sym: "✗" },
  mentioning: { cls: "bc-verdict-muted", sym: "○" },
};

export interface SmartCitation {
  citingWork: Work;
  type: CitationType;
  reason: string;
}

/** Clasifica una cita con IA. Devuelve null si no hay IA configurada. */
export async function classifyCitation(
  provider: ReturnType<typeof useAiSetup>["provider"],
  citingWork: Work,
  citedWork: Work,
  context: string,
): Promise<SmartCitation | null> {
  if (!provider) return null;
  const raw = await provider.chat(smartCitationMessages(citingWork, citedWork, context), { json: true });
  const j = JSON.parse(raw);
  const tipo = String(j?.tipo ?? "") as CitationType;
  if (!["supporting", "contrasting", "mentioning"].includes(tipo)) return null;
  return { citingWork, type: tipo, reason: String(j?.razon ?? "") };
}

/** Botón que abre el diálogo de citas inteligentes para un paper. */
export function SmartCitationsButton({ work }: { work: Work }) {
  const { provider } = useAiSetup();
  const [open, setOpen] = useState(false);
  if (!work.doi && !work.pmid) return null;
  return (
    <>
      <button
        type="button"
        className="bc-btn bc-btn-sm"
        onClick={() => setOpen(true)}
        title="Ver cómo citan este paper: apoyan, contrastan o mencionan"
        disabled={!provider}
      >
        Citas inteligentes
      </button>
      {open ? <SmartCitationsDialog work={work} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SmartCitationsDialog({ work, onClose }: { work: Work; onClose: () => void }) {
  const { citations, repo } = useApp();
  const { provider } = useAiSetup();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SmartCitation[]>([]);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await citations.network(work, "citations", 50);
      const list: SmartCitation[] = [];
      for (const citing of res.works.slice(0, 10)) {
        setBusyIdx(list.length);
        // El contexto de la cita: el resumen del paper que cita (aproximación)
        const context = (citing.abstract ?? "").slice(0, 2000);
        const sc = await classifyCitation(provider, citing, work, context);
        if (sc) list.push(sc);
      }
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setBusyIdx(null);
    }
  }

  const counts = { supporting: 0, contrasting: 0, mentioning: 0 };
  for (const it of items) counts[it.type]++;

  return (
    <Dialog title={`Citas inteligentes: ${work.title.slice(0, 60)}`} onClose={onClose} wide>
      <p className="bc-sub" style={{ fontSize: "0.85rem", marginTop: 0 }}>
        Clasificación con IA de cómo citan este paper: <strong>apoya</strong>, <strong>contrasta</strong> o solo <strong>menciona</strong>.
        Estilo Scite.
      </p>
      {items.length === 0 && !loading ? (
        <button className="bc-btn bc-btn-primary" onClick={() => void load()}>
          Analizar citas con IA
        </button>
      ) : null}
      {loading ? <div className="bc-sub" role="status">Analizando citas… {busyIdx !== null ? `(${busyIdx})` : ""}</div> : null}
      {error ? <div className="bc-alert bc-alert-error" role="status">{error}</div> : null}
      {items.length ? (
        <>
          <div className="bc-row" style={{ gap: 6, margin: "10px 0", flexWrap: "wrap" }}>
            <span className={`bc-verdict ${TYPE_STYLE.supporting.cls}`}>{counts.supporting} apoyan</span>
            <span className={`bc-verdict ${TYPE_STYLE.contrasting.cls}`}>{counts.contrasting} contrastan</span>
            <span className={`bc-verdict ${TYPE_STYLE.mentioning.cls}`}>{counts.mentioning} mencionan</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, maxHeight: "50vh", overflow: "auto" }}>
            {items.map((it, i) => (
              <li key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--bc-border)" }}>
                <div style={{ fontWeight: 600 }}>{it.citingWork.title}</div>
                <div className="bc-sub" style={{ fontSize: "0.82rem" }}>
                  {it.citingWork.authors[0]?.name} · {it.citingWork.year ?? "s. f."}
                </div>
                <div style={{ marginTop: 4 }}>
                  <span className={`bc-verdict ${TYPE_STYLE[it.type].cls}`}>
                    {TYPE_STYLE[it.type].sym} {CITATION_TYPE_LABEL[it.type]}
                  </span>
                </div>
                {it.reason ? <div className="bc-sub" style={{ fontSize: "0.78rem", marginTop: 2 }}>{it.reason}</div> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Dialog>
  );
}
