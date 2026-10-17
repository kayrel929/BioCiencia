import { useState } from "react";
import { normalizeOrcid } from "@biociencia/core";
import { collapseSameWork, type OrcidPerson } from "@biociencia/sources";
import { useApp, useAsync } from "../context.tsx";
import { WorkItem } from "../components/WorkItem.tsx";
import { CiteButton, ExportButton } from "../components/RefsIO.tsx";
import { FullTextButton } from "../components/FullText.tsx";

const ROLE: Record<string, string> = { admin: "Administrador", editor: "Editor", reader: "Lector" };

export function Researchers() {
  const { identity, repo, orcid, refresh } = useApp();
  const saved = useAsync(() => repo.getSetting("my_orcid"), []);
  const syncedAt = useAsync(() => repo.getSetting("my_orcid_synced_at"), []);
  const own = useAsync(() => repo.listOwnWorks(), []);
  const [input, setInput] = useState<string | null>(null);
  const [person, setPerson] = useState<OrcidPerson | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const value = input ?? saved.data ?? "";
  const valid = normalizeOrcid(value);

  async function check() {
    if (!valid) return setMsg({ text: "El ORCID no es válido. Son 16 dígitos, por ejemplo 0000-0002-1825-0097 (el último puede ser X).", error: true });
    setBusy(true);
    setMsg(null);
    try {
      const p = await orcid.person(valid);
      setPerson(p);
      await repo.setSetting("my_orcid", valid);
      refresh();
    } catch (e) {
      setPerson(null);
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function importWorks() {
    const id = valid ?? saved.data;
    if (!id) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = person ?? (await orcid.person(id));
      setPerson(p);
      const raw = await orcid.works(id, p.name);
      const { works: list, collapsed } = collapseSameWork(raw);
      if (list.length === 0) {
        setMsg({ text: "Su registro ORCID no tiene publicaciones públicas. Puede agregarlas en orcid.org o marcarlas como propias desde la Biblioteca." });
        return;
      }
      const enr = await orcid.enrichWithCrossref(list);
      const r = await repo.importOwnWorks(enr.works, id);
      await repo.setSetting("my_orcid_synced_at", new Date().toISOString());
      setMsg({
        text: `${list.length} publicación(es) de su ORCID: ${r.created} nueva(s), ${r.merged} ya estaban en su biblioteca. ${enr.enriched} completada(s) con coautores y resumen de Crossref.${enr.error ? ` Crossref no respondió: ${enr.error} (se guardaron los datos de ORCID).` : ""}${
          collapsed.length
            ? ` Se unieron ${collapsed.reduce((a, c) => a + c.dropped.length, 0)} entrada(s) repetida(s) con DOI distinto (mismo título y año): ${collapsed.map((c) => `«${c.kept.title.slice(0, 60)}» (${[c.kept.doi, ...c.dropped.map((d) => d.doi)].filter(Boolean).join(", ")})`).join("; ")}.`
            : ""
        }`,
      });
      refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  const works = own.data ?? [];
  const byYear = new Map<number | string, number>();
  for (const w of works) byYear.set(w.year ?? "s/f", (byYear.get(w.year ?? "s/f") ?? 0) + 1);
  const cites = works.reduce((a, w) => a + (w.citedByCount ?? 0), 0);
  
  return (
    <div className="bc-page">
      <h1>Investigadores</h1>

      <div className="bc-grid-2" style={{ alignItems: "start" }}>
        <form className="bc-card" onSubmit={(e) => (e.preventDefault(), void check())}>
          <h2>Mi perfil de investigador</h2>
          <p style={{ margin: "0 0 8px" }}><strong>{identity?.displayName}</strong></p>
          <label className="bc-label" htmlFor="my-orcid">Mi ORCID</label>
          <div className="bc-row" style={{ gap: 8 }}>
            <input id="my-orcid" className="bc-input mono" style={{ flex: 1 }} value={value} onChange={(e) => setInput(e.target.value)} placeholder="0000-0000-0000-0000" />
            <button className="bc-btn" type="submit" disabled={busy || !value.trim()}>Verificar</button>
          </div>
          <p className="bc-sub" style={{ fontSize: "0.82rem", marginTop: 6 }}>
            Se consulta el registro público en orcid.org (gratis). Solo se leen los datos que usted marcó como públicos; BioCiencia no pide su contraseña de ORCID.
          </p>
          {person ? (
            <div className="bc-alert" role="status" data-testid="orcid-person">
              Registro ORCID: <strong>{person.name}</strong> ·{" "}
              <a href={`https://orcid.org/${person.orcid}`} target="_blank" rel="noreferrer" className="mono">orcid.org/{person.orcid}</a>
              {identity && !sameName(person, identity.displayName) ? (
                <div style={{ marginTop: 6 }}>
                  El nombre del registro no coincide con «{identity.displayName}». Importe solo si este ORCID es suyo.
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="bc-row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button type="button" className="bc-btn bc-btn-primary" disabled={busy || !(valid || saved.data)} onClick={() => void importWorks()}>
              {busy ? "Consultando ORCID…" : works.length ? "Actualizar mis publicaciones desde ORCID" : "Importar mis publicaciones desde ORCID"}
            </button>
          </div>
          {syncedAt.data ? <p className="bc-sub" style={{ fontSize: "0.78rem" }}>Última actualización: {new Date(syncedAt.data).toLocaleString()}</p> : null}
          {msg ? <div className={`bc-alert ${msg.error ? "bc-alert-error" : ""}`} role="status" style={{ marginTop: 10 }}>{msg.text}</div> : null}
        </form>

        <div className="bc-card">
          <h2>Resumen</h2>
          <table className="bc-table" data-testid="own-summary">
            <tbody>
              <tr><td>Publicaciones propias</td><td>{works.length}</td></tr>
              <tr><td>Citas registradas (Crossref/OpenAlex)</td><td>{cites || "—"}</td></tr>
              {[...byYear.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0]))).slice(0, 8).map(([y, n]) => (
                <tr key={y}><td>{y}</td><td>{n}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="bc-sub" style={{ fontSize: "0.8rem" }}>También puede marcar artículos como propios desde la Biblioteca («Es mía»).</p>
        </div>
      </div>

      <section className="bc-card" style={{ marginTop: 16 }}>
        <div className="bc-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Mis publicaciones ({works.length})</h2>
          {works.length ? <ExportButton label="Exportar mis publicaciones" baseName={`publicaciones ${identity?.displayName ?? ""}`} getWorks={() => repo.listOwnWorks()} /> : null}
        </div>
        {works.length === 0 ? <p className="bc-sub">Todavía no hay publicaciones propias. Escriba su ORCID e impórtelas, o márquelas desde la Biblioteca.</p> : null}
        {works.map((w) => (
          <WorkItem
            key={w.id}
            work={w}
            extra={<div className="bc-sub" style={{ fontSize: "0.78rem", marginTop: 4 }}>{w.origin === "orcid" ? "Importada de su ORCID" : "Marcada como propia"}</div>}
            actions={
              <>
                <FullTextButton work={w} />
                <CiteButton work={w} />
                <button className="bc-btn bc-btn-sm" onClick={async () => { await repo.setOwnWork(w.id!, false); refresh(); }}>No es mía</button>
              </>
            }
          />
        ))}
      </section>
    </div>
  );
}

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((x) => x.length > 2);
}

/** ¿Comparten al menos un apellido o nombre? (aviso suave, no bloquea) */
function sameName(p: OrcidPerson, local: string): boolean {
  const a = new Set(norm(local));
  return [p.name, ...p.otherNames].some((n) => norm(n).some((t) => a.has(t)));
}
