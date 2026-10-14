import { mergeWork, workKeys, type Work } from "@biociencia/core";
import { compareEvents, type ProjectRole, type SyncEvent } from "./events.ts";

/**
 * Reproduce TODOS los eventos de un proyecto en orden HLC y calcula su estado.
 * Es una función pura: dos computadoras con los mismos eventos obtienen exactamente
 * el mismo resultado, sin importar en qué orden los recibieron.
 *
 * Reglas:
 *  - Solo cuentan eventos con firma válida (se verifica antes de llamar aquí).
 *  - El autor debe ser miembro del proyecto, con la misma llave pública registrada.
 *  - Lectores: no modifican nada. Editores: datos, bibliografía y notas. Administradores: además, miembros.
 *  - Cambios simultáneos al mismo campo: gana el de HLC mayor; el otro queda en el historial.
 */

export interface MemberState {
  memberId: string;
  displayName: string;
  role: ProjectRole;
  publicKey: string;
}

export interface NoteState {
  noteId: string;
  body: string;
  author: string;
  hlc: string;
}

export interface ProjectState {
  id: string;
  name: string;
  description: string;
  objectives: string;
  ownerId: string;
  archived: boolean;
  createdHlc: string;
  updatedHlc: string;
  members: MemberState[];
  works: { key: string; work: Work }[];
  notes: NoteState[];
}

export interface HistoryEntry {
  id: string;
  hlc: string;
  author: string;
  type: string;
  summary: string;
  /** Cambio de un campo que otro cambio posterior reemplazó */
  superseded?: boolean;
}

export interface ReplayResult {
  state: ProjectState | null;
  accepted: string[];
  rejected: { id: string; reason: string }[];
  history: HistoryEntry[];
}

const CAN_EDIT: ProjectRole[] = ["admin", "editor"];

export function replayProject(events: SyncEvent[]): ReplayResult {
  const sorted = [...events].sort(compareEvents);
  const accepted: string[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const history: HistoryEntry[] = [];
  let st: ProjectState | null = null;
  const members = new Map<string, MemberState>();
  const works = new Map<string, Work>();
  const notes = new Map<string, NoteState>();
  const lastFieldEntry = new Map<string, HistoryEntry>();
  // Un mismo artículo puede llegar con identificadores distintos desde cada computadora
  // (una tiene el DOI, otra solo el PMID). alias: cada identificador → clave canónica.
  const alias = new Map<string, string>();
  const idsOf = (w: Work, key: string) => [key, ...safeKeys(w)];
  const canonicalKey = (w: Work | undefined, key: string) => {
    for (const k of w ? idsOf(w, key) : [key]) {
      const c = alias.get(k);
      if (c && works.has(c)) return c;
    }
    return null;
  };

  const reject = (e: SyncEvent, reason: string) => rejected.push({ id: e.id, reason });

  for (const e of sorted) {
    if (!st) {
      if (e.type !== "project.create") {
        reject(e, "Evento anterior a la creación del proyecto");
        continue;
      }
      const d = e.data as { name: string; description: string; objectives: string; ownerName: string };
      if (typeof d?.name !== "string" || !d.name.trim()) {
        reject(e, "Creación sin nombre");
        continue;
      }
      st = {
        id: e.project, name: d.name, description: d.description ?? "", objectives: d.objectives ?? "",
        ownerId: e.author, archived: false, createdHlc: e.hlc, updatedHlc: e.hlc, members: [], works: [], notes: [],
      };
      members.set(e.author, { memberId: e.author, displayName: d.ownerName || "Administrador", role: "admin", publicKey: e.authorKey });
      accepted.push(e.id);
      history.push({ id: e.id, hlc: e.hlc, author: e.author, type: e.type, summary: `Creó el proyecto «${d.name}»` });
      continue;
    }
    if (e.type === "project.create") {
      reject(e, "El proyecto ya existe");
      continue;
    }
    const me = members.get(e.author);
    if (!me) {
      reject(e, "El autor no es miembro del proyecto");
      continue;
    }
    if (me.publicKey !== e.authorKey) {
      reject(e, "La llave del autor no coincide con la registrada");
      continue;
    }
    const isAdmin = me.role === "admin";
    const canEdit = CAN_EDIT.includes(me.role);
    const adminCount = () => [...members.values()].filter((m) => m.role === "admin").length;

    switch (e.type) {
      case "project.update": {
        const d = e.data as { field: string; value: string };
        if (!canEdit) { reject(e, "Un lector no puede editar el proyecto"); continue; }
        if (!["name", "description", "objectives"].includes(d?.field) || typeof d.value !== "string") { reject(e, "Campo no válido"); continue; }
        if (d.field === "name" && !d.value.trim()) { reject(e, "El nombre no puede quedar vacío"); continue; }
        (st as unknown as Record<string, string>)[d.field] = d.value;
        const prev = lastFieldEntry.get(d.field);
        if (prev) prev.superseded = true;
        const h: HistoryEntry = { id: e.id, hlc: e.hlc, author: e.author, type: e.type, summary: `Cambió ${FIELD[d.field]} a «${d.value.slice(0, 80)}»` };
        lastFieldEntry.set(d.field, h);
        history.push(h);
        break;
      }
      case "project.archive":
        if (!isAdmin) { reject(e, "Solo un administrador puede archivar"); continue; }
        st.archived = true;
        history.push({ id: e.id, hlc: e.hlc, author: e.author, type: e.type, summary: "Archivó el proyecto" });
        break;
      case "member.set": {
        const d = e.data as { memberId: string; displayName: string; role: ProjectRole; publicKey: string };
        if (!isAdmin) { reject(e, "Solo un administrador gestiona miembros"); continue; }
        if (!d?.memberId || !["admin", "editor", "reader"].includes(d.role) || !/^[0-9a-f]{64}$/.test(d.publicKey ?? "")) { reject(e, "Datos de miembro no válidos"); continue; }
        const existing = members.get(d.memberId);
        if (existing && existing.publicKey !== d.publicKey) { reject(e, "No se puede cambiar la llave de un miembro existente"); continue; }
        if (existing?.role === "admin" && d.role !== "admin" && adminCount() === 1) { reject(e, "El proyecto debe conservar al menos un administrador"); continue; }
        members.set(d.memberId, { memberId: d.memberId, displayName: d.displayName || "Investigador", role: d.role, publicKey: d.publicKey });
        history.push({ id: e.id, hlc: e.hlc, author: e.author, type: e.type, summary: `${existing ? "Cambió el rol de" : "Invitó a"} ${d.displayName} (${ROLE[d.role]})` });
        break;
      }
      case "member.remove": {
        const d = e.data as { memberId: string };
        if (!isAdmin) { reject(e, "Solo un administrador gestiona miembros"); continue; }
        const m = members.get(d?.memberId);
        if (!m) { reject(e, "Ese miembro no existe"); continue; }
        if (m.role === "admin" && adminCount() === 1) { reject(e, "El proyecto debe conservar al menos un administrador"); continue; }
        members.delete(d.memberId);
        history.push({ id: e.id, hlc: e.hlc, author: e.author, type: e.type, summary: `Retiró a ${m.displayName}` });
        break;
      }
      case "work.add": {
        const d = e.data as { key: string; work: Work };
        if (!canEdit) { reject(e, "Un lector no puede cambiar la bibliografía"); continue; }
        if (typeof d?.key !== "string" || !d.work?.title) { reject(e, "Publicación no válida"); continue; }
        const w = { ...d.work, id: undefined };
        const target = canonicalKey(w, d.key) ?? d.key;
        const prev = works.get(target);
        const merged = prev ? mergeWork(prev, w) : w;
        works.set(target, merged);
        for (const k of idsOf(merged, d.key)) alias.set(k, target);
        history.push({ id: e.id, hlc: e.hlc, author: e.author, type: e.type, summary: `Añadió «${d.work.title.slice(0, 80)}»` });
        break;
      }
      case "work.remove": {
        const d = e.data as { key: string };
        if (!canEdit) { reject(e, "Un lector no puede cambiar la bibliografía"); continue; }
        const target = typeof d?.key === "string" ? canonicalKey(undefined, d.key) : null;
        const w = target ? works.get(target) : undefined;
        if (target) works.delete(target);
        history.push({ id: e.id, hlc: e.hlc, author: e.author, type: e.type, summary: `Quitó «${(w?.title ?? d?.key ?? "").slice(0, 80)}»` });
        break;
      }
      case "note.add": {
        const d = e.data as { noteId: string; body: string };
        if (!canEdit) { reject(e, "Un lector no puede escribir notas"); continue; }
        if (!d?.noteId || typeof d.body !== "string" || !d.body.trim()) { reject(e, "Nota no válida"); continue; }
        if (!notes.has(d.noteId)) notes.set(d.noteId, { noteId: d.noteId, body: d.body, author: e.author, hlc: e.hlc });
        history.push({ id: e.id, hlc: e.hlc, author: e.author, type: e.type, summary: `Escribió una nota: «${d.body.slice(0, 60)}»` });
        break;
      }
      case "note.delete": {
        const d = e.data as { noteId: string };
        const n = notes.get(d?.noteId);
        if (!n) { reject(e, "Esa nota no existe"); continue; }
        if (n.author !== e.author && !isAdmin) { reject(e, "Solo el autor o un administrador borran una nota"); continue; }
        notes.delete(d.noteId);
        history.push({ id: e.id, hlc: e.hlc, author: e.author, type: e.type, summary: "Borró una nota" });
        break;
      }
      default:
        reject(e, `Tipo de evento desconocido: ${String((e as SyncEvent).type)}`);
        continue;
    }
    st.updatedHlc = e.hlc;
    accepted.push(e.id);
  }

  if (st) {
    st.members = [...members.values()].sort((a, b) => a.memberId.localeCompare(b.memberId));
    st.works = [...works.entries()].map(([key, work]) => ({ key, work })).sort((a, b) => a.key.localeCompare(b.key));
    st.notes = [...notes.values()].sort((a, b) => (a.hlc < b.hlc ? 1 : -1));
  }
  return { state: st, accepted, rejected, history };
}

const FIELD: Record<string, string> = { name: "el nombre", description: "la descripción", objectives: "los objetivos" };
const ROLE: Record<ProjectRole, string> = { admin: "administrador", editor: "editor", reader: "lector" };

function safeKeys(w: Work): string[] {
  try {
    return workKeys({ ...w, authors: Array.isArray(w.authors) ? w.authors : [] }).map((k) => `${k.kind}:${k.value}`);
  } catch {
    return [];
  }
}

/** Clave estable de un artículo para los eventos de sincronización (su mejor identificador). */
export function workSyncKey(w: Work): string {
  return safeKeys(w)[0] ?? `title:${w.title.toLowerCase()}`;
}
