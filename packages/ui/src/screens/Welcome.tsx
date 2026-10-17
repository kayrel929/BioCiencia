import { useState } from "react";
import { useApp } from "../context.tsx";
import { Logo } from "../components/Logo.tsx";

/** Primera apertura: crea la identidad local (sin servidor, sin contraseña en texto plano). */
export function Welcome() {
  const { repo, setIdentity, platform } = useApp();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Escriba su nombre como aparecerá ante otros investigadores.");
    setError(null);
    setBusy(true);
    try {
      const id = await repo.ensureIdentity(name.trim(), platform === "desktop" ? "Computadora Windows" : "Navegador web");
      setIdentity(id);
    } catch (err) {
      // Sin esto, un fallo al guardar dejaba el botón sin ninguna respuesta visible.
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 16 }}>
      <form className="bc-card" style={{ width: "min(460px, 100%)" }} onSubmit={start}>
        <div className="bc-row" style={{ gap: 12, marginBottom: 12 }}>
          <Logo size={44} />
          <div>
            <div className="bc-brand-name">
              Bio<span>Ciencia</span>
            </div>
            <div className="bc-brand-tag">La ciencia conectada, el conocimiento compartido</div>
          </div>
        </div>
        <h2>Bienvenido</h2>
        <p className="bc-sub">
          BioCiencia guarda sus datos en esta {platform === "desktop" ? "computadora" : "aplicación del navegador"}. Para empezar, cree su identidad local.
        </p>
        <label className="bc-label" htmlFor="w-name">Nombre</label>
        <input id="w-name" className="bc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Nombre Apellido" autoFocus />
        {error ? <div className="bc-alert bc-alert-error" style={{ marginTop: 10 }}>{error}</div> : null}
        <button className="bc-btn bc-btn-primary" style={{ marginTop: 16, width: "100%", justifyContent: "center" }} type="submit" disabled={busy}>
          {busy ? "Creando…" : "Crear identidad y entrar"}
        </button>
      </form>
    </div>
  );
}
