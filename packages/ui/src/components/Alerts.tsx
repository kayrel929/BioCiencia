import { useState } from "react";
import type { Work } from "@biociencia/core";
import { searchSources } from "@biociencia/sources";
import type { Alert } from "@biociencia/storage";
import { useApp, useAsync, type SearchSourceId } from "../context.tsx";
import { WorkItem } from "./WorkItem.tsx";

const DEFAULT_SOURCES: SearchSourceId[] = ["europepmc", "pubmed", "crossref", "doaj"];

/** «Seguir esta búsqueda»: las publicaciones de ahora quedan como vistas; las nuevas aparecerán en Inicio. */
export function FollowSearchButton({ query, label, sources, baseline }: { query: string; label: string; sources: SearchSourceId[]; baseline: Work[] }) {
  const { repo, refresh } = useApp();
  const [done, setDone] = useState(false);
  const free = sources.filter((s) => s !== "openalex");
  return done ? (
    <span className="bc-badge bc-badge-green" role="status">Siguiendo esta búsqueda: verá las novedades en Inicio</span>
  ) : (
    <button
      type="button"
      className="bc-btn bc-btn-sm"
      title="Avisa en Inicio cuando aparezcan publicaciones nuevas con esta búsqueda"
      onClick={async () => {
        await repo.createAlert({ query, label, params: { sources: free.length ? free : DEFAULT_SOURCES }, baseline });
        setDone(true);
        refresh();
      }}
    >
      🔔 Seguir esta búsqueda
    </button>
  );
}

/** Revisa una alerta: busca lo más reciente en las fuentes gratuitas elegidas y guarda lo que no se había visto. */
export async function checkAlert(repo: ReturnType<typeof useApp>["repo"], sources: ReturnType<typeof useApp>["sources"], a: Alert): Promise<{ added: number; errors: string[] }> {
  const ids = ((a.params as { sources?: SearchSourceId[] })?.sources ?? DEFAULT_SOURCES).filter((s) => s !== "openalex" && sources[s]);
  const u = await searchSources(ids.map((id) => sources[id]), { text: a.query, sort: "recent", page: 1, perPage: 25 });
  const errors = u.outcomes.filter((o) => o.error).map((o) => `${o.label}: ${o.error}`);
  if (errors.length === u.outcomes.length) return { added: 0, errors };
  const { newIds } = await repo.recordAlertCheck(a.id, u.works);
  return { added: newIds.length, errors };
}

/** Panel de Inicio con las búsquedas que se siguen y sus novedades. */
export function AlertsPanel() {
  const { repo, sources, refresh } = useApp();
  const [tick, setTick] = useState(0);
  const alerts = useAsync(() => repo.listAlerts(), [tick]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const items = useAsync(() => (open ? repo.alertItems(open) : Promise.resolve([])), [open, tick]);

  async function checkAll() {
    setMsg(null);
    const list = alerts.data ?? [];
    const out: string[] = [];
    for (const a of list) {
      setBusy(`Revisando «${a.label}»…`);
      try {
        const r = await checkAlert(repo, sources, a);
        out.push(`${a.label}: ${r.added} nueva(s)${r.errors.length ? ` (sin respuesta de ${r.errors.map((e) => e.split(":")[0]).join(", ")})` : ""}`);
      } catch (e) {
        out.push(`${a.label}: error — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(null);
    setMsg(out.join(" · "));
    setTick((t) => t + 1);
    refresh();
  }

  if (!alerts.data?.length) {
    return (
      <div className="bc-card" data-testid="alerts">
        <h2 style={{ marginTop: 0 }}>Novedades de sus búsquedas</h2>
        <p className="bc-sub" style={{ margin: 0, fontSize: "0.9rem" }}>
          En el Buscador, pulse <strong>«Seguir esta búsqueda»</strong> y aquí verá las publicaciones nuevas que vayan apareciendo sobre su tema.
        </p>
      </div>
    );
  }
  return (
    <div className="bc-card" data-testid="alerts">
      <div className="bc-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Novedades de sus búsquedas</h2>
        <button className="bc-btn bc-btn-primary bc-btn-sm" disabled={!!busy} onClick={() => void checkAll()}>{busy ? "Revisando…" : "Revisar ahora"}</button>
      </div>
      {busy ? <div className="bc-sub" role="status" style={{ marginTop: 6 }}>{busy}</div> : null}
      {msg ? <div className="bc-alert" role="status" style={{ marginTop: 8, fontSize: "0.86rem" }}>{msg}</div> : null}
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
        {alerts.data.map((a) => (
          <li key={a.id} style={{ borderTop: "1px solid var(--bc-border)", padding: "8px 0" }} data-testid="alert">
            <div className="bc-row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <strong>{a.label}</strong>{" "}
                {a.unseen ? <span className="bc-badge bc-badge-green">{a.unseen} nueva(s)</span> : <span className="bc-badge">sin novedades</span>}
                <div className="bc-work-meta">Última revisión: {a.lastChecked ? new Date(a.lastChecked).toLocaleString() : "nunca"}</div>
              </div>
              <div className="bc-row" style={{ gap: 6 }}>
                <button className="bc-btn bc-btn-sm" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? "Ocultar" : "Ver"}</button>
                {a.unseen ? <button className="bc-btn bc-btn-sm" onClick={async () => { await repo.markAlertSeen(a.id); setTick((t) => t + 1); }}>Marcar como vistas</button> : null}
                <button className="bc-btn bc-btn-sm bc-btn-ghost" onClick={async () => { await repo.deleteAlert(a.id); if (open === a.id) setOpen(null); setTick((t) => t + 1); }}>Dejar de seguir</button>
              </div>
            </div>
            {open === a.id ? (
              <div style={{ marginTop: 6 }}>
                {items.data?.length === 0 ? <p className="bc-sub" style={{ fontSize: "0.86rem" }}>Todavía no hay publicaciones nuevas desde que empezó a seguir esta búsqueda.</p> : null}
                {items.data?.map((it) => (
                  <WorkItem key={it.work.id} work={it.work} extra={!it.seen ? <span className="bc-badge bc-badge-green" style={{ marginTop: 4 }}>Nueva · {new Date(it.foundAt).toLocaleDateString()}</span> : null}
                    actions={<button className="bc-btn bc-btn-sm bc-btn-primary" onClick={async () => { await repo.addToLibrary(it.work.id!); refresh(); }}>Guardar en biblioteca</button>} />
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
