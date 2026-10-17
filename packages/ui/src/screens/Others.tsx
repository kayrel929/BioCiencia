import { useState } from "react";
import { decryptText, encryptText, isEncryptedFile, passwordProblem, type EncryptedFile } from "@biociencia/core";
import { useApp, useAsync } from "../context.tsx";

export function Settings() {
  const { repo, identity, setIdentity, theme, setTheme, platform } = useApp();
  const [name, setName] = useState(identity?.displayName ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const storage = useAsync(() => repo.describeStorage(), []);
  const counts = useAsync(async () => ({ works: await repo.countWorks(), library: await repo.libraryCount() }), []);

  return (
    <div className="bc-page">
      <h1>Configuración</h1>
      <div className="bc-grid-2" style={{ alignItems: "start" }}>
        <form
          className="bc-card"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || !identity) return;
            await repo.renameIdentity(name);
            setIdentity({ ...identity, displayName: name.trim() });
            setMsg("Nombre actualizado.");
          }}
        >
          <h2>Perfil</h2>
          <label className="bc-label" htmlFor="st-name">Nombre visible</label>
          <input id="st-name" className="bc-input" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="bc-btn bc-btn-primary" style={{ marginTop: 12 }} type="submit">Guardar</button>
          {msg ? <div className="bc-alert" style={{ marginTop: 10 }}>{msg}</div> : null}
        </form>
        <OpenAlexSettings />
        <BackupCard />
        <div className="bc-card">
          <h2>Apariencia</h2>
          <div className="bc-row">
            <button className={`bc-btn ${theme === "light" ? "bc-btn-primary" : ""}`} onClick={() => setTheme("light")}>Modo claro</button>
            <button className={`bc-btn ${theme === "dark" ? "bc-btn-primary" : ""}`} onClick={() => setTheme("dark")}>Modo oscuro</button>
          </div>
        </div>
        <div className="bc-card">
          <h2>Almacenamiento local</h2>
          {storage.data ? (
            <table className="bc-table">
              <tbody>
                <tr><td>Motor</td><td>{storage.data.kind}</td></tr>
                <tr><td>Ubicación</td><td className="mono" style={{ wordBreak: "break-all" }}>{storage.data.location}</td></tr>
                <tr><td>Persistente</td><td>{storage.data.persistent ? "Sí" : "No: los datos se perderán al cerrar"}</td></tr>
                <tr><td>Publicaciones conocidas</td><td>{counts.data?.works ?? "–"}</td></tr>
                <tr><td>En la biblioteca</td><td>{counts.data?.library ?? "–"}</td></tr>
              </tbody>
            </table>
          ) : null}
          {storage.data && !storage.data.persistent ? (
            <div className="bc-alert bc-alert-warn" style={{ marginTop: 10 }}>
              Este navegador no ofrece almacenamiento persistente (OPFS). Use un navegador actualizado o la versión Windows.
            </div>
          ) : null}
        </div>
        <div className="bc-card">
          <h2>Acerca de</h2>
          <p style={{ margin: 0 }}>BioCiencia 0.1.0 (desarrollo) · {platform === "desktop" ? "Windows" : "Web"}</p>
          <p className="bc-sub" style={{ fontSize: "0.85rem" }}>La ciencia conectada, el conocimiento compartido.</p>
        </div>
      </div>
    </div>
  );
}

/** Correo de contacto para las APIs científicas y proxy de la biblioteca institucional. */
function OpenAlexSettings() {
  const { contactEmail, setContactEmail, libraryProxy, setLibraryProxy } = useApp();
  const [mail, setMail] = useState<string | null>(null);
  const [proxy, setProxy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const mailValue = mail ?? contactEmail ?? "";
  const proxyValue = proxy ?? libraryProxy ?? "";
  return (
    <form
      className="bc-card"
      onSubmit={(e) => {
        e.preventDefault();
        const v = mailValue.trim();
        const p = proxyValue.trim();
        if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setMsg({ text: "El correo no es válido.", error: true });
        if (p && !/^https:\/\/\S+$/i.test(p)) return setMsg({ text: "El proxy debe empezar con https://", error: true });
        setContactEmail(v || null);
        setLibraryProxy(p || null);
        setMsg({ text: "Configuración guardada." });
      }}
    >
      <h2>Fuentes científicas y acceso al texto completo</h2>
      <label className="bc-label" htmlFor="st-mail">Correo de contacto</label>
      <input id="st-mail" className="bc-input" type="email" value={mailValue} onChange={(e) => setMail(e.target.value)} placeholder="usted@institucion.edu" />
      <p className="bc-sub" style={{ fontSize: "0.82rem", marginTop: 6 }}>
        Se envía solo a OpenAlex, Crossref, PubMed y Unpaywall, que lo piden para identificar a quien consulta (sin él, Unpaywall no busca copias legales).
        No se envía a ningún otro sitio. OpenAlex cobra por uso: 0,001 USD por búsqueda de un cupo gratuito diario de 0,10 USD; las demás fuentes son gratuitas.
      </p>
      <label className="bc-label" htmlFor="st-proxy">Proxy de la biblioteca institucional (opcional)</label>
      <input id="st-proxy" className="bc-input" value={proxyValue} onChange={(e) => setProxy(e.target.value)} placeholder="https://login.ezproxy.su-universidad.edu/login?url=" />
      <p className="bc-sub" style={{ fontSize: "0.82rem", marginTop: 6 }}>
        Si su universidad o instituto tiene suscripciones, su biblioteca le da esta dirección. Con ella aparece «Acceso institucional» en cada artículo
        y usted entra con su propia cuenta de la biblioteca (BioCiencia no guarda esa contraseña).
      </p>
      <button className="bc-btn bc-btn-primary" type="submit">Guardar</button>
      {msg ? <div className={`bc-alert ${msg.error ? "bc-alert-error" : ""}`} role="status" style={{ marginTop: 10 }}>{msg.text}</div> : null}
    </form>
  );
}

/** Copia de seguridad completa y restauración (funciona igual en Windows y web). */
function BackupCard() {
  const { repo, saveFile, setIdentity, refresh } = useApp();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  // Copia cifrada elegida para restaurar, a la espera de la contraseña
  const [pending, setPending] = useState<EncryptedFile | null>(null);
  const [restorePw, setRestorePw] = useState("");
  const [withPdfs, setWithPdfs] = useState(true);
  const pdfSize = useAsync(() => repo.pdfStorageSize(), []);

  async function restore(data: unknown) {
    const r = await repo.restoreBackup(data);
    const me = await repo.getIdentity();
    if (me) setIdentity(me);
    refresh();
    setMsg({ text: `Copia restaurada (${r.rows} registros).` });
  }

  return (
    <div className="bc-card">
      <h2>Copias de seguridad</h2>
      <p className="bc-sub" style={{ fontSize: "0.85rem" }}>
        Guarda toda su información (biblioteca, PDF y subrayados, proyectos, notas, grupos, historial) en un archivo .json. Sirve también para pasar sus datos de la versión web a la de Windows o al revés.
      </p>
      <div className="bc-alert bc-alert-warn" style={{ fontSize: "0.85rem", marginBottom: 10 }}>
        La copia incluye su <strong>llave privada de firma</strong> (con ella se firman sus cambios en proyectos compartidos).
        Protéjala con una contraseña: el archivo queda cifrado (AES-256) y nadie puede abrirlo sin ella. BioCiencia no guarda la contraseña; si la olvida, la copia no se puede recuperar.
      </div>
      <form
        aria-label="Crear copia de seguridad"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          if (pw || pw2) {
            if (pw !== pw2) return setMsg({ text: "Las contraseñas no coinciden.", error: true });
            const problem = passwordProblem(pw);
            if (problem) return setMsg({ text: problem, error: true });
          }
          setBusy(true);
          try {
            const b = await repo.exportBackup({ includePdfs: withPdfs });
            const date = b.createdAt.slice(0, 10);
            const ok = pw
              ? await saveFile(`biociencia-copia-cifrada-${date}.json`, JSON.stringify(await encryptText(JSON.stringify(b), pw)), "application/json")
              : await saveFile(`biociencia-copia-${date}.json`, JSON.stringify(b), "application/json");
            if (ok) {
              setMsg({ text: pw ? "Copia cifrada guardada. Consérvela en otro disco o en la nube y recuerde la contraseña." : "Copia guardada SIN contraseña. Consérvela en un lugar seguro." });
              setPw("");
              setPw2("");
            }
          } catch (err) {
            setMsg({ text: `No se pudo crear la copia: ${err instanceof Error ? err.message : String(err)}`, error: true });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="bc-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input className="bc-input" style={{ flex: 1, minWidth: 180 }} type="password" autoComplete="new-password" aria-label="Contraseña de la copia" placeholder="Contraseña (mín. 10 caracteres)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <input className="bc-input" style={{ flex: 1, minWidth: 180 }} type="password" autoComplete="new-password" aria-label="Repetir contraseña" placeholder="Repetir contraseña" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {pdfSize.data?.count ? (
          <label className="bc-row" style={{ gap: 6, marginBottom: 8, fontSize: "0.88rem" }}>
            <input type="checkbox" checked={withPdfs} onChange={(e) => setWithPdfs(e.target.checked)} />
            Incluir los PDF adjuntos ({pdfSize.data.count} archivo(s), {(pdfSize.data.bytes / 1048576).toFixed(1)} MB). Sin ellos la copia es más liviana, pero conserva los subrayados y el texto.
          </label>
        ) : null}
        <div className="bc-row">
          <button className="bc-btn bc-btn-primary" type="submit" disabled={busy}>
            {pw ? "Crear copia cifrada" : "Crear copia de seguridad"}
          </button>
          <label className="bc-btn" htmlFor="bk-file" style={{ cursor: "pointer" }}>Restaurar desde archivo…</label>
          <input
            id="bk-file"
            type="file"
            accept=".json,application/json"
            aria-label="Archivo de copia de seguridad"
            style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setMsg(null);
              let data: unknown;
              try {
                data = JSON.parse(await file.text());
              } catch {
                return setMsg({ text: "No se restauró nada: el archivo no es JSON válido.", error: true });
              }
              if (isEncryptedFile(data)) {
                setPending(data);
                setRestorePw("");
                return;
              }
              if (!window.confirm("Restaurar REEMPLAZA todos los datos actuales por los de la copia. Se recomienda crear antes una copia de lo actual. ¿Continuar?")) return;
              setBusy(true);
              try {
                await restore(data);
              } catch (err) {
                setMsg({ text: `No se restauró nada: ${err instanceof Error ? err.message : String(err)}`, error: true });
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      </form>
      {pending ? (
        <form
          aria-label="Abrir copia cifrada"
          className="bc-row"
          style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!window.confirm("Restaurar REEMPLAZA todos los datos actuales por los de la copia. ¿Continuar?")) return;
            setBusy(true);
            try {
              const data = JSON.parse(await decryptText(pending, restorePw));
              await restore(data);
              setPending(null);
            } catch (err) {
              setMsg({ text: `No se restauró nada: ${err instanceof Error ? err.message : String(err)}`, error: true });
            } finally {
              setBusy(false);
              setRestorePw("");
            }
          }}
        >
          <span style={{ alignSelf: "center" }}>Esta copia está cifrada.</span>
          <input className="bc-input" style={{ flex: 1, minWidth: 180 }} type="password" autoComplete="current-password" aria-label="Contraseña para abrir la copia" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} />
          <button className="bc-btn bc-btn-primary" type="submit" disabled={busy || !restorePw}>Descifrar y restaurar</button>
          <button className="bc-btn" type="button" onClick={() => setPending(null)}>Cancelar</button>
        </form>
      ) : null}
      {busy ? <div className="bc-sub" role="status" style={{ marginTop: 8 }}>Procesando…</div> : null}
      {msg ? <div className={`bc-alert ${msg.error ? "bc-alert-error" : ""}`} role="status" style={{ marginTop: 10 }}>{msg.text}</div> : null}
    </div>
  );
}
