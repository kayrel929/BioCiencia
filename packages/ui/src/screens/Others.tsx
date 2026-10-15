import { useState } from "react";
import { useApp, useAsync } from "../context.tsx";
import { Pending } from "../components/Pending.tsx";

export function Analysis() {
  return (
    <div className="bc-page">
      <h1>Análisis con IA</h1>
      <Pending
        phase={7}
        title="Asistente científico con referencias verificables"
        items={[
          "Preguntas en lenguaje natural respondidas solo con publicaciones recuperadas (RAG).",
          "Cada afirmación citada con enlace a la publicación; aviso cuando solo hay resumen.",
          "Separación entre resultados reportados, inferencias y limitaciones de la evidencia.",
          "IA local con Ollama; servicios en línea solo con su autorización expresa.",
          "Lectura y comparación de PDF con tablas que citan cada documento.",
        ]}
      />
    </div>
  );
}

export function Editor() {
  return (
    <div className="bc-page">
      <h1>Editor científico</h1>
      <Pending
        phase={8}
        title="Redacción de manuscritos"
        items={[
          "Secciones IMRyD, versiones y comentarios de coautores.",
          "Edición simultánea sin pérdidas (CRDT).",
          "Citas en APA, Vancouver, Chicago, IEEE y estilos CSL.",
          "Exportación a DOCX, PDF y HTML.",
        ]}
      />
    </div>
  );
}

export function Statistics() {
  return (
    <div className="bc-page">
      <h1>Estadística</h1>
      <Pending
        phase={9}
        title="Análisis de datos experimentales"
        items={[
          "Importación de CSV y XLSX conservando los datos originales.",
          "Descriptiva, intervalos de confianza, ANOVA y comparación de medias con verificación de supuestos.",
          "Incidencia, severidad y AUDPC.",
          "Gráficos y tablas exportables.",
        ]}
      />
    </div>
  );
}



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
  return (
    <div className="bc-card">
      <h2>Copias de seguridad</h2>
      <p className="bc-sub" style={{ fontSize: "0.85rem" }}>
        Guarda toda su información (biblioteca, proyectos, notas, historial) en un archivo .json. Sirve también para pasar sus datos de la versión web a la de Windows o al revés.
      </p>
      <div className="bc-alert bc-alert-warn" style={{ fontSize: "0.85rem", marginBottom: 10 }}>
        La copia incluye su <strong>llave privada de firma</strong> (con ella se firman sus cambios en proyectos compartidos).
        Guárdela en un lugar seguro y no la envíe a otras personas: para invitarle a un proyecto solo hace falta su código de investigador.
      </div>
      <div className="bc-row">
        <button
          className="bc-btn bc-btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const b = await repo.exportBackup();
              const ok = await saveFile(`biociencia-copia-${b.createdAt.slice(0, 10)}.json`, JSON.stringify(b), "application/json");
              if (ok) setMsg({ text: "Copia de seguridad guardada. Consérvela en otro disco o en la nube." });
            } catch (e) {
              setMsg({ text: `No se pudo crear la copia: ${e instanceof Error ? e.message : String(e)}`, error: true });
            } finally {
              setBusy(false);
            }
          }}
        >
          Crear copia de seguridad
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
            if (!window.confirm("Restaurar REEMPLAZA todos los datos actuales por los de la copia. Se recomienda crear antes una copia de lo actual. ¿Continuar?")) return;
            setBusy(true);
            try {
              const data = JSON.parse(await file.text());
              const r = await repo.restoreBackup(data);
              const me = await repo.getIdentity();
              if (me) setIdentity(me);
              refresh();
              setMsg({ text: `Copia restaurada (${r.rows} registros).` });
            } catch (err) {
              setMsg({ text: `No se restauró nada: ${err instanceof Error ? err.message : String(err)}`, error: true });
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {msg ? <div className={`bc-alert ${msg.error ? "bc-alert-error" : ""}`} role="status" style={{ marginTop: 10 }}>{msg.text}</div> : null}
    </div>
  );
}
