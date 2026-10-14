import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncReport } from "@biociencia/sync";
import { useApp, useAsync } from "../context.tsx";

const AUTO_MS = 30_000;

function describe(r: SyncReport): string {
  const parts = [`${r.written} cambio(s) enviados`, `${r.fresh} recibido(s)`];
  if (r.invalid) parts.push(`${r.invalid} descartado(s) por firma o formato inválido`);
  if (r.rejected) parts.push(`${r.rejected} rechazado(s) por permisos`);
  if (r.partial) parts.push(`${r.partial} archivo(s) aún copiándose, se reintentará`);
  return parts.join(" · ");
}

export function SyncScreen() {
  const { identity, platform, repo, sync, syncFolder, saveFile, refresh } = useApp();
  const code = useAsync(() => (identity ? sync.researcherCode() : Promise.resolve("")), [identity?.id]);
  const folder = useAsync(() => repo.getSetting("sync_folder"), []);
  const auto = useAsync(async () => (await repo.getSetting("sync_auto")) === "1", []);
  const counts = useAsync(() => repo.syncEventCounts(), []);
  const log = useAsync(() => repo.listSyncLog(20), []);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const busyRef = useRef(false);

  const runSync = useCallback(
    async (silent = false) => {
      if (!syncFolder || !folder.data || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const r = await sync.syncNow(syncFolder.transport(folder.data));
        if (!silent || r.fresh || r.written || r.errors.length) {
          setMsg(r.errors.length ? { text: r.errors.join(" "), error: true } : { text: `Sincronizado: ${describe(r)}.` });
        }
        refresh();
      } catch (e) {
        setMsg({ text: `No se pudo sincronizar: ${e instanceof Error ? e.message : String(e)}`, error: true });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [syncFolder, folder.data, sync, refresh],
  );

  return (
    <div className="bc-page">
      <h1>Sincronización</h1>
      <p className="bc-sub">
        Solo se sincronizan los <strong>proyectos compartidos</strong>, y solo con las personas invitadas a cada uno.
        Cada cambio viaja firmado digitalmente; las otras computadoras verifican la firma y los permisos antes de aplicarlo.
        Su biblioteca personal, búsquedas y proyectos privados nunca salen de esta computadora.
      </p>

      <div className="bc-grid-2" style={{ alignItems: "start" }}>
        <div className="bc-card">
          <h2>Su código de investigador</h2>
          <p className="bc-sub" style={{ fontSize: "0.88rem" }}>
            Envíelo al administrador de un proyecto para que lo invite. Contiene su nombre, su identificador y su llave
            <strong> pública</strong>; no contiene ninguna contraseña ni su llave privada.
          </p>
          <textarea className="bc-textarea mono" readOnly value={code.data ?? ""} aria-label="Código de investigador" style={{ minHeight: 70, fontSize: "0.75rem" }} />
          <div className="bc-row" style={{ marginTop: 8 }}>
            <button
              className="bc-btn"
              disabled={!code.data}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(code.data ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setMsg({ text: "No se pudo copiar automáticamente; seleccione el texto y cópielo.", error: true });
                }
              }}
            >
              {copied ? "Copiado" : "Copiar código"}
            </button>
          </div>
          <p className="bc-sub mono" style={{ fontSize: "0.75rem", marginTop: 10 }}>Dispositivo: {identity?.deviceId}</p>
        </div>

        <div className="bc-card">
          <h2>Carpeta de sincronización</h2>
          {platform === "desktop" && syncFolder ? (
            <>
              <p className="bc-sub" style={{ fontSize: "0.88rem" }}>
                Elija una carpeta que se copie entre sus computadoras (recomendado: <strong>Syncthing</strong>, sin servidores de terceros;
                también sirve una carpeta de red o una memoria USB). BioCiencia escribe en ella solo los cambios firmados de sus proyectos compartidos.
              </p>
              <p className="mono" style={{ fontSize: "0.82rem", wordBreak: "break-all" }} data-testid="sync-folder">{folder.data ?? "Sin carpeta elegida"}</p>
              <div className="bc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button
                  className="bc-btn"
                  onClick={async () => {
                    const p = await syncFolder.pick();
                    if (!p) return;
                    await repo.setSetting("sync_folder", p);
                    refresh();
                  }}
                >
                  {folder.data ? "Cambiar carpeta" : "Elegir carpeta"}
                </button>
                <button className="bc-btn bc-btn-primary" disabled={!folder.data || busy} onClick={() => void runSync(false)}>
                  {busy ? "Sincronizando…" : "Sincronizar ahora"}
                </button>
              </div>
              <label className="bc-row" style={{ gap: 6, marginTop: 10, fontSize: "0.9rem" }}>
                <input
                  type="checkbox"
                  checked={!!auto.data}
                  disabled={!folder.data}
                  onChange={async (e) => {
                    await repo.setSetting("sync_auto", e.target.checked ? "1" : "0");
                    refresh();
                  }}
                />
                Sincronizar automáticamente cada 30 segundos mientras BioCiencia esté abierta
              </label>
            </>
          ) : (
            <p className="bc-sub" style={{ fontSize: "0.88rem" }}>
              El navegador no puede vigilar una carpeta del disco. En la versión web use los <strong>paquetes de sincronización</strong> de abajo,
              o la aplicación de Windows para sincronizar automáticamente.
            </p>
          )}
        </div>
      </div>

      {msg ? <div className={`bc-alert ${msg.error ? "bc-alert-error" : ""}`} role="status" style={{ marginTop: 12 }}>{msg.text}</div> : null}

      <div className="bc-card" style={{ marginTop: 16 }}>
        <h2>Paquete de sincronización (manual)</h2>
        <p className="bc-sub" style={{ fontSize: "0.88rem" }}>
          Para pasar cambios sin carpeta compartida (correo, USB, versión web): exporte un paquete aquí e impórtelo en la otra computadora.
          Importar el mismo paquete dos veces no duplica nada.
        </p>
        <div className="bc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            className="bc-btn"
            onClick={async () => {
              try {
                const text = await sync.exportBundle();
                const ok = await saveFile(`biociencia-sync-${new Date().toISOString().slice(0, 10)}.json`, text, "application/json");
                if (ok) setMsg({ text: "Paquete de sincronización creado." });
                refresh();
              } catch (e) {
                setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
              }
            }}
          >
            Exportar paquete
          </button>
          <label className="bc-btn" style={{ cursor: "pointer" }}>
            Importar paquete
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Paquete de sincronización"
              style={{ display: "none" }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const r = await sync.importBundle(await f.text());
                  setMsg({ text: `Paquete importado: ${r.fresh} cambio(s) nuevo(s)${r.invalid ? `, ${r.invalid} descartado(s) por firma inválida` : ""}${r.rejected ? `, ${r.rejected} rechazado(s) por permisos` : ""}.` });
                  refresh();
                } catch (err) {
                  setMsg({ text: err instanceof Error ? err.message : String(err), error: true });
                }
              }}
            />
          </label>
        </div>
      </div>

      <div className="bc-card" style={{ marginTop: 16 }}>
        <h2>Registro</h2>
        <p className="bc-sub" style={{ fontSize: "0.85rem" }}>
          {counts.data ? `${counts.data.total} cambio(s) firmados guardados · ${counts.data.pendingExport} pendiente(s) de enviar · ${counts.data.rejected} rechazado(s)` : ""}
        </p>
        {log.data && log.data.length === 0 ? <p className="bc-sub">Todavía no hay sincronizaciones.</p> : null}
        <table className="bc-table" data-testid="sync-log">
          <tbody>
            {log.data?.map((l) => (
              <tr key={l.id}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(l.at).toLocaleString()}</td>
                <td>{LOG_LABEL[l.direction] ?? l.direction}</td>
                <td className={l.status === "error" ? "bc-alert-error" : ""}>{l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LOG_LABEL: Record<string, string> = {
  local: "Cambio local",
  carpeta: "Carpeta",
  "paquete-salida": "Paquete exportado",
  "paquete-entrada": "Paquete importado",
};

/**
 * Sincronización automática en segundo plano (en toda la app, no solo en esta pantalla).
 * Solo en Windows, con carpeta elegida y la opción activada.
 */
export function AutoSync() {
  const { repo, sync, syncFolder, identity, refresh, version } = useApp();
  const [cfg, setCfg] = useState<{ folder: string | null; auto: boolean }>({ folder: null, auto: false });
  useEffect(() => {
    void Promise.all([repo.getSetting("sync_folder"), repo.getSetting("sync_auto")]).then(([folder, auto]) => setCfg({ folder, auto: auto === "1" }));
  }, [repo, version]);
  useEffect(() => {
    if (!syncFolder || !identity || !cfg.folder || !cfg.auto) return;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const r = await sync.syncNow(syncFolder.transport(cfg.folder!));
        if (r.fresh > 0) refresh();
      } catch {
        /* el error queda en el registro de sincronización */
      } finally {
        running = false;
      }
    };
    void tick();
    const t = setInterval(() => void tick(), AUTO_MS);
    return () => clearInterval(t);
  }, [syncFolder, identity, cfg.folder, cfg.auto, sync, refresh]);
  return null;
}
