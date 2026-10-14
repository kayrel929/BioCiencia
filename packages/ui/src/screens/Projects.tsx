import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp, useAsync } from "../context.tsx";
import { Icon } from "../components/Icon.tsx";
import { Dialog } from "../components/Pending.tsx";
import { WorkItem } from "../components/WorkItem.tsx";
import { ExportButton } from "../components/RefsIO.tsx";
import type { ProjectMember, Role } from "@biociencia/storage";

const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", editor: "Investigador editor", reader: "Investigador lector" };

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
  const { repo, refresh, identity } = useApp();
  const nav = useNavigate();
  const project = useAsync(() => repo.getProject(id), [id]);
  const members = useAsync(() => repo.projectMembers(id), [id]);
  const role = useAsync(() => repo.myRole(id), [id]);
  const works = useAsync(() => repo.listProjectWorks(id), [id]);
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
              if (!confirm(project.data?.visibility === "shared" ? "¿Archivar este proyecto para TODOS sus participantes? Las publicaciones seguirán en su biblioteca." : "¿Archivar este proyecto? Las publicaciones seguirán en su biblioteca.")) return;
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
          {msg ? <div className="bc-alert" role="status" style={{ marginTop: 10 }}>{msg}</div> : null}
        </form>

        <div className="bc-stack">
          <MembersCard projectId={id} shared={project.data.visibility === "shared"} isAdmin={role.data === "admin"} members={members.data ?? []} myId={identity?.id ?? ""} />
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
          <ExportButton baseName={project.data.name} getWorks={() => repo.listProjectWorks(id)} />
        </div>
        {works.data && works.data.length === 0 ? (
          <p className="bc-sub">Añada publicaciones desde la Biblioteca con «Etiquetas, notas y proyecto».</p>
        ) : null}
        {works.data?.map((w) => (
          <WorkItem
            key={w.id}
            work={w}
            actions={canEdit ? (
              <button className="bc-btn bc-btn-sm" onClick={async () => { await repo.removeWorkFromProject(id, w.id!); refresh(); }}>
                Quitar del proyecto
              </button>
            ) : null}
          />
        ))}
      </div>

      {project.data.visibility === "shared" ? <HistoryCard projectId={id} /> : null}
    </div>
  );
}

function MembersCard({ projectId, shared, isAdmin, members, myId }: { projectId: string; shared: boolean; isAdmin: boolean; members: ProjectMember[]; myId: string }) {
  const { sync, refresh } = useApp();
  const [code, setCode] = useState("");
  const [newRole, setNewRole] = useState<Role>("editor");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const run = async (fn: () => Promise<string>) => {
    try {
      setMsg({ text: await fn() });
      refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  };
  return (
    <div className="bc-card">
      <div className="bc-row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Participantes</h2>
        <span className={`bc-badge ${shared ? "bc-badge-blue" : ""}`}>{shared ? "Compartido" : "Privado"}</span>
      </div>
      <table className="bc-table" style={{ marginTop: 8 }}>
        <tbody>
          {members.map((m) => (
            <tr key={m.memberId}>
              <td>{m.displayName}{m.memberId === myId ? " (usted)" : ""}</td>
              <td>
                {shared && isAdmin && m.memberId !== myId ? (
                  <select
                    className="bc-select"
                    style={{ width: "auto", maxWidth: "100%" }}
                    aria-label={`Rol de ${m.displayName}`}
                    value={m.role}
                    onChange={(e) => void run(async () => { await sync.setMemberRole(projectId, m.memberId, e.target.value as Role); return `Rol de ${m.displayName} actualizado.`; })}
                  >
                    {(["admin", "editor", "reader"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : ROLE_LABEL[m.role]}
              </td>
              <td style={{ textAlign: "right" }}>
                {shared && isAdmin && m.memberId !== myId ? (
                  <button className="bc-btn bc-btn-sm" onClick={() => { if (confirm(`¿Retirar a ${m.displayName} del proyecto?`)) void run(async () => { await sync.removeMember(projectId, m.memberId); return `${m.displayName} fue retirado.`; }); }}>
                    Retirar
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!shared && isAdmin ? (
        <div style={{ marginTop: 12 }}>
          <p className="bc-sub" style={{ fontSize: "0.85rem" }}>
            Al compartir, cada cambio del proyecto se firma y podrá sincronizarse con las personas que invite.
            Solo este proyecto se comparte: su biblioteca personal sigue siendo privada.
          </p>
          <button className="bc-btn bc-btn-primary" onClick={() => void run(async () => { await sync.shareProject(projectId); return "Proyecto compartido. Ahora puede invitar investigadores."; })}>
            Compartir proyecto
          </button>
        </div>
      ) : null}

      {shared && isAdmin ? (
        <form
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await sync.addMember(projectId, code, newRole);
              setCode("");
              return `${r.name} fue invitado. Sincronice para que reciba el proyecto.`;
            });
          }}
        >
          <label className="bc-label" htmlFor="inv-code">Invitar con el código de investigador</label>
          <textarea id="inv-code" className="bc-textarea mono" style={{ minHeight: 56, fontSize: "0.75rem" }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="BC1-…" />
          <div className="bc-row" style={{ gap: 8, marginTop: 8 }}>
            <select className="bc-select" style={{ width: "auto" }} aria-label="Rol del invitado" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              <option value="editor">{ROLE_LABEL.editor}</option>
              <option value="reader">{ROLE_LABEL.reader}</option>
              <option value="admin">{ROLE_LABEL.admin}</option>
            </select>
            <button className="bc-btn" type="submit" disabled={!code.trim()}>Invitar</button>
          </div>
        </form>
      ) : null}
      {msg ? <div className={`bc-alert ${msg.error ? "bc-alert-error" : ""}`} role="status" style={{ marginTop: 10 }}>{msg.text}</div> : null}
    </div>
  );
}

function HistoryCard({ projectId }: { projectId: string }) {
  const { sync } = useApp();
  const h = useAsync(() => sync.history(projectId), [projectId]);
  if (!h.data) return null;
  const items = [...h.data.history].reverse();
  const rejected = h.data.rejected;
  const name = (id: string) => h.data!.names[id] ?? `${id.slice(0, 6)}…`;
  return (
    <div className="bc-card" style={{ marginTop: 16 }}>
      <h2>Historial de cambios</h2>
      <p className="bc-sub" style={{ fontSize: "0.85rem" }}>
        Cuando dos personas cambian el mismo dato sin estar sincronizadas, queda el cambio más reciente; el otro se conserva aquí marcado como «reemplazado».
      </p>
      <table className="bc-table" data-testid="project-history">
        <tbody>
          {items.slice(0, 100).map((x) => (
            <tr key={x.id} style={x.superseded ? { opacity: 0.6 } : undefined}>
              <td style={{ whiteSpace: "nowrap" }}>{new Date(Number(x.hlc.slice(0, 13))).toLocaleString()}</td>
              <td>{name(x.author)}</td>
              <td>
                {x.superseded ? <s>{x.summary}</s> : x.summary}
                {x.superseded ? <span className="bc-badge" style={{ marginLeft: 6 }}>reemplazado</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rejected.length ? (
        <div className="bc-alert bc-alert-warn" style={{ marginTop: 10 }}>
          {rejected.length} cambio(s) recibidos no se aplicaron porque su autor no tenía permiso:
          <ul style={{ margin: "6px 0 0" }}>{rejected.slice(0, 10).map((r) => <li key={r.id}>{r.reason}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}
