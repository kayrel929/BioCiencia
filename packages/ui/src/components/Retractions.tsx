import { useState } from "react";
import { normalizeDoi, RETRACTION_LABEL } from "@biociencia/core";
import { checkRetractions } from "@biociencia/sources";
import { useApp, useAsync } from "../context.tsx";

/** Revisa toda la biblioteca contra Retraction Watch (vía Crossref) y PubMed. */
export function RetractionCheckButton() {
  const { repo, contactEmail, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const last = useAsync(() => repo.getSetting("retractions_checked_at"), []);
  return (
    <span className="bc-row" style={{ gap: 6, flexWrap: "wrap" }}>
      <button
        type="button"
        className="bc-btn"
        disabled={busy}
        title={last.data ? `Última revisión: ${new Date(last.data).toLocaleString()}` : "Busca retractaciones, retiros, avisos de preocupación y correcciones"}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const entries = await repo.listLibrary({ limit: 100000 });
            const withDoi = entries.filter((e) => normalizeDoi(e.work.doi ?? null));
            const r = await checkRetractions((u, i) => fetch(u, i), withDoi.map((e) => e.work.doi!), { email: contactEmail });
            const updates = withDoi
              .map((e) => ({ e, d: normalizeDoi(e.work.doi!)! }))
              .filter(({ d }) => r.checked.has(d))
              .map(({ e, d }) => ({ workId: e.work.id!, retraction: r.results.get(d) ?? null }));
            await repo.setRetractions(updates);
            const counts = new Map<string, number>();
            for (const u of updates) if (u.retraction) counts.set(u.retraction.status, (counts.get(u.retraction.status) ?? 0) + 1);
            const found = [...counts].map(([k, n]) => `${RETRACTION_LABEL[k as keyof typeof RETRACTION_LABEL].toLowerCase()}: ${n}`).join(", ");
            const parts = [
              `${updates.length} de ${entries.length} publicaciones revisadas`,
              found ? `Avisos — ${found}` : "ninguna retractada ni corregida",
            ];
            if (entries.length - withDoi.length) parts.push(`${entries.length - withDoi.length} sin DOI no se pueden revisar`);
            if (r.errors.length) parts.push(`no respondió: ${r.errors.join(" · ")}`);
            setMsg({ text: parts.join(" · "), error: r.errors.length > 0 && updates.length === 0 });
            refresh();
          } catch (e) {
            setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Revisando retracciones…" : "Revisar retracciones"}
      </button>
      {msg ? <span className={`bc-sub ${msg.error ? "bc-text-danger" : ""}`} role="status" style={{ fontSize: "0.85rem" }} data-testid="retraction-summary">{msg.text}</span> : null}
    </span>
  );
}
