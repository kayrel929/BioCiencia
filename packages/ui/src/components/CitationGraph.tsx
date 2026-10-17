import { useEffect, useMemo, useState } from "react";
import type { Work } from "@biociencia/core";
import type { CitationResult } from "@biociencia/sources";
import { useApp } from "../context.tsx";
import { Dialog } from "./Pending.tsx";
import { formatAuthors } from "./WorkItem.tsx";

/**
 * Grafo visual de citas (estilo ResearchRabbit): muestra la red de citas
 * como un grafo interactivo. Se puede hacer clic en un nodo para explorar
 * su propia red, y guardar papers en la biblioteca.
 */

interface Node {
  work: Work;
  x: number;
  y: number;
  r: number;
  color: string;
}

interface Edge {
  from: number;
  to: number;
}

export function CitationGraphButton({ work }: { work: Work }) {
  const [open, setOpen] = useState(false);
  if (!work.doi && !work.pmid) return null;
  return (
    <>
      <button
        type="button"
        className="bc-btn bc-btn-sm"
        onClick={() => setOpen(true)}
        title="Ver red de citas como grafo interactivo (estilo ResearchRabbit)"
      >
        Grafo de citas
      </button>
      {open ? <CitationGraphDialog start={work} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CitationGraphDialog({ start, onClose }: { start: Work; onClose: () => void }) {
  const { citations, repo, refresh } = useApp();
  const [trail, setTrail] = useState<Work[]>([start]);
  const [dir, setDir] = useState<"citations" | "references">("citations");
  const [res, setRes] = useState<CitationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const current = trail[trail.length - 1]!;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setRes(null);
    citations.network(current, dir, 30).then(
      (r) => alive && setRes(r),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    ).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [citations, current, dir]);

  const key = (w: Work) => w.doi ?? w.pmid ?? w.title;
  async function saveWork(w: Work) {
    const { id } = await repo.upsertWork(w);
    await repo.addToLibrary(id);
    setSaved((s) => new Set(s).add(key(w)));
    refresh();
  }

  // Layout simple: el paper actual en el centro, los demás en un círculo
  const nodes: Node[] = useMemo(() => {
    const all = [current, ...(res?.works ?? [])];
    const cx = 300;
    const cy = 200;
    return all.map((w, i) => {
      if (i === 0) return { work: w, x: cx, y: cy, r: 28, color: "var(--bc-primary)" };
      const angle = ((i - 1) / Math.max(all.length - 1, 1)) * Math.PI * 2;
      const radius = 140;
      return {
        work: w,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        r: 18,
        color: "var(--bc-blue)",
      };
    });
  }, [current, res]);

  const edges: Edge[] = useMemo(() => {
    if (!res) return [];
    return res.works.map((_, i) => ({ from: 0, to: i + 1 }));
  }, [res]);

  return (
    <Dialog title="Grafo de citas" onClose={onClose} wide>
      <nav aria-label="Rastro" className="bc-sub" style={{ fontSize: "0.82rem", marginBottom: 8 }}>
        {trail.map((w, i) => (
          <span key={i}>
            {i > 0 ? " → " : ""}
            {i < trail.length - 1 ? (
              <button className="bc-btn bc-btn-ghost" style={{ padding: 0, fontSize: "inherit" }} onClick={() => setTrail(trail.slice(0, i + 1))}>
                {w.title.slice(0, 40)}…
              </button>
            ) : (
              <strong>{w.title.slice(0, 60)}{w.title.length > 60 ? "…" : ""}</strong>
            )}
          </span>
        ))}
      </nav>
      <div className="bc-row" role="tablist" style={{ gap: 6, marginBottom: 8 }}>
        <button role="tab" aria-selected={dir === "citations"} className={`bc-btn bc-btn-sm ${dir === "citations" ? "bc-btn-primary" : ""}`} onClick={() => setDir("citations")}>
          La citan
        </button>
        <button role="tab" aria-selected={dir === "references"} className={`bc-btn bc-btn-sm ${dir === "references" ? "bc-btn-primary" : ""}`} onClick={() => setDir("references")}>
          Cita a
        </button>
      </div>
      {loading ? <div role="status">Consultando…</div> : null}
      {error ? <div className="bc-alert bc-alert-error" role="status">{error}</div> : null}
      {res ? (
        <>
          <div className="bc-sub" role="status" style={{ fontSize: "0.82rem" }}>
            {res.works.length === 0
              ? `Sin ${dir === "citations" ? "citas" : "referencias"} registradas.`
              : `${res.works.length} ${dir === "citations" ? "publicaciones que la citan" : "referencias"}`}
          </div>
          <svg
            viewBox="0 0 600 400"
            style={{ width: "100%", maxHeight: "40vh", border: "1px solid var(--bc-border)", borderRadius: 8, background: "var(--bc-surface)" }}
            role="img"
            aria-label="Grafo de citas"
          >
            {edges.map((e, i) => (
              <line
                key={i}
                x1={nodes[e.from]?.x ?? 0}
                y1={nodes[e.from]?.y ?? 0}
                x2={nodes[e.to]?.x ?? 0}
                y2={nodes[e.to]?.y ?? 0}
                stroke="var(--bc-border)"
                strokeWidth={1.5}
              />
            ))}
            {nodes.map((n, i) => (
              <g
                key={i}
                onClick={() => {
                  if (i > 0 && trail.length < 5) setTrail([...trail, n.work]);
                }}
                style={{ cursor: i > 0 ? "pointer" : "default" }}
              >
                <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} opacity={0.85} />
                <text x={n.x} y={n.y + n.r + 14} textAnchor="middle" fontSize={10} fill="var(--bc-text-2)">
                  {n.work.title.slice(0, 25)}…
                </text>
              </g>
            ))}
          </svg>
          {res.works.length ? (
            <ul style={{ listStyle: "none", padding: 0, maxHeight: "30vh", overflow: "auto", marginTop: 8 }}>
              {res.works.map((w, i) => (
                <li key={`${key(w)}-${i}`} style={{ padding: "8px 0", borderBottom: "1px solid var(--bc-border)" }}>
                  <div style={{ fontWeight: 600 }}>{w.title}</div>
                  <div className="bc-sub" style={{ fontSize: "0.82rem" }}>
                    {formatAuthors(w, 3)} · {w.year ?? "s. f."}
                  </div>
                  <div className="bc-row" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {w.doi || w.pmid ? (
                      <button className="bc-btn bc-btn-sm" onClick={() => setTrail([...trail, w])} disabled={trail.length >= 5}>
                        Explorar
                      </button>
                    ) : null}
                    {saved.has(key(w)) ? (
                      <span className="bc-badge bc-badge-green">Guardado</span>
                    ) : (
                      <button className="bc-btn bc-btn-sm bc-btn-primary" onClick={() => void saveWork(w)}>
                        Guardar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
