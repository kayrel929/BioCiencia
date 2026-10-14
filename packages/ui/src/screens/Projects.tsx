import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp, useAsync } from "../context.tsx";
import { Icon } from "../components/Icon.tsx";
import { Dialog } from "../components/Pending.tsx";
import { WorkItem } from "../components/WorkItem.tsx";
import { ExportButton } from "../components/RefsIO.tsx";

const ROLE_LABEL = { admin: "Administrador", editor: "Investigador editor", reader: "Investigador lector" } as const;

export function Projects() {
  const { repo, refresh } = useApp();
  const nav = useNavigate();
  const list = useAsync(() => repo.listProjects(), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", objectives: "" });
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const id = await repo.createProject(form);
      setCreating(false);
      setForm({ name: "", description: "", objectives: "" });
      refresh();
      nav(`/proyectos/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="bc-page">
      <div className="bc-page-head">
        <div>
          <h1>Proyectos de investigación</h1>
          <p className="bc-sub">Organice bibliografía, objetivos y notas por proyecto.</p>
        </div>
        <button className="bc-btn bc-btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> Nuevo proyecto
        </button>
      </div>
      {list.data && list.data.length === 0 ? (
        <div className="bc-card bc-empty">Todavía no hay proyectos. Cree el primero.</div>
      ) : null}
      <div className="bc-cards">
        {list.data?.map((p) => (
          <Link key={p.id} to={`/proyectos/${p.id}`} className="bc-card" style={{ color: "inherit", textDecoration: "none" }}>
            <h3>{p.name}</h3>
            <p className="bc-sub" style={{ fontSize: "0.88rem" }}>{p.description || "Sin descripción"}</p>
            <div className="bc-row" style={{ gap: 6 }}>
              <span className="bc-badge">{p.workCount ?? 0} publicaciones</span>
              <span className="bc-badge">{p.visibility === "private" ? "Privado" : "Compartido"}</span>
            </div>
          </Link>
        ))}
      </div>

      {creating ? (
        <Dialog title="Nuevo proyecto" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            <label className="bc-label" htmlFor="np-name">Nombre *</label>
            <input id="np-name" className="bc-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Control biológico de Ralstonia mediante Trichoderma" autoFocus />
            <label className="bc-label" htmlFor="np-desc">Descripción</label>
            <textarea id="np-desc" className="bc-textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <label className="bc-label" htmlFor="np-obj">Objetivos</label>
            <textarea id="np-obj" className="bc-textarea" value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} />
            {error ? <div className="bc-alert bc-alert-error" style={{ marginTop: 10 }}>{error}</div> : null}
            <div className="bc-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="bc-btn" onClick={() => setCreating(false)}>Cancelar</button>
              <button type="submit" className="bc-btn bc-btn-primary">Crear proyecto</button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

export function ProjectDetail() {
  const { id = "" } = useParams();
  const { repo, refresh } = useApp();
  const nav = useNavigate();
  const project = useAsync(() => repo.getProject(id), [id]);
  const members = useAsync(() => repo.projectMembers(id), [id]);
  const role = useAsync(() => repo.myRole(id), [id]);
  const works = useAsync(() => repo.listLibrary({ projectId: id }), [id]);
  const notes = useAsync(() => repo.listNotes("project", id), [id]);
  const [form, setForm] = useState({ name: "", description: "", objectives: "" });
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const canEdit = role.data === "admin" || role.data === "editor";

  useEffect(() => {
    if (project.data) setForm({ name: project.data.name, description: project.data.description, objectives: project.data.objectives });
  }, [project.data]);

  if (project.loading && !project.data) return <div className="bc-page">Cargando…</div>;
  if (!project.data) {
    return (
      <div className="bc-page">
        <div className="bc-alert bc-alert-error">Este proyecto no existe o usted no es miembro.</div>
        <p><Link to="/proyectos">Volver a proyectos</Link></p>
      </div>
    );
  }

  return (
    <div className="bc-page">
      <p><Link to="/proyectos">← Proyectos</Link></p>
      <div className="bc-page-head">
        <div>
          <h1>{project.data.name}</h1>
          <p className="bc-sub">Su rol: {role.data ? ROLE_LABEL[role.data] : "—"} · Creado el {new Date(project.data.createdAt).toLocaleDateString()}</p>
        </div>
        {role.data === "admin" ? (
          <button
            className="bc-btn bc-btn-danger"
            onClick={async () => {
              if (!confirm("¿Archivar este proyecto? Las publicaciones seguirán en su biblioteca.")) return;
              await repo.deleteProject(id);
              refresh();
              nav("/proyectos");
            }}
          >
            Archivar proyecto
          </button>
        ) : null}
      </div>

      <div className="bc-grid-2" style={{ alignItems: "start" }}>
        <form
          className="bc-card"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await repo.updateProject(id, form);
              setMsg("Cambios guardados.");
              refresh();
            } catch (err) {
              setMsg(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <h2>Datos del proyecto</h2>
          <label className="bc-label" htmlFor="pd-name">Nombre</label>
          <input id="pd-name" className="bc-input" disabled={!canEdit} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="bc-label" htmlFor="pd-desc">Descripción</label>
          <textarea id="pd-desc" className="bc-textarea" disabled={!canEdit} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label className="bc-label" htmlFor="pd-obj">Objetivos</label>
          <textarea id="pd-obj" className="bc-textarea" disabled={!canEdit} value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} />
          {canEdit ? <button className="bc-btn bc-btn-primary" style={{ marginTop: 12 }} type="submit">Guardar</button> : null}
          {msg ? <div className="bc-alert" style={{ marginTop: 10 }}>{msg}</div> : null}
        </form>

        <div className="bc-stack">
          <div className="bc-card">
            <h2>Participantes</h2>
            <table className="bc-table">
              <tbody>
                {members.data?.map((m) => (
                  <tr key={m.memberId}><td>{m.displayName}</td><td>{ROLE_LABEL[m.role]}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="bc-sub" style={{ fontSize: "0.82rem", marginTop: 8 }}>Invitar investigadores y compartir el proyecto llega en las Fases 5 y 6.</p>
          </div>
          <div className="bc-card">
            <h2>Notas</h2>
            <form
              className="bc-row"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!note.trim()) return;
                await repo.addNote("project", id, note);
                setNote("");
                refresh();
              }}
            >
              <input className="bc-input" style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Escribir una nota" aria-label="Nueva nota" />
              <button className="bc-btn" type="submit">Añadir</button>
            </form>
            {notes.data?.map((n) => (
              <div key={n.id} style={{ borderTop: "1px solid var(--bc-border)", paddingTop: 8, marginTop: 8 }}>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                <div className="bc-sub" style={{ fontSize: "0.78rem" }}>{new Date(n.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bc-card" style={{ marginTop: 16 }}>
        <div className="bc-row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Bibliografía del proyecto ({works.data?.length ?? 0})</h2>
          <ExportButton baseName={project.data.name} getWorks={async () => (await repo.listLibrary({ projectId: id, limit: 100000 })).map((e) => e.work)} />
        </div>
        {works.data && works.data.length === 0 ? (
          <p className="bc-sub">Añada publicaciones desde la Biblioteca con «Etiquetas, notas y proyecto».</p>
        ) : null}
        {works.data?.map((e) => (
          <WorkItem
            key={e.work.id}
            work={e.work}
            actions={canEdit ? (
              <button className="bc-btn bc-btn-sm" onClick={async () => { await repo.removeWorkFromProject(id, e.work.id!); refresh(); }}>
                Quitar del proyecto
              </button>
            ) : null}
          />
        ))}
      </div>
    </div>
  );
}
