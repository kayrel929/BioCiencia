import { hlcNow, hlcParse, hlcReceive, hlcToString, ulid, type Work } from "@biociencia/core";
import type { BioRepo, MaterializedProject, ProjectChange } from "@biociencia/storage";
import { generateKeyPair, keyPairMatches, type KeyPair } from "./crypto.ts";
import {
  decodeResearcherCode,
  encodeResearcherCode,
  isWellFormed,
  projectBoundTo,
  projectIdFor,
  signEvent,
  verifyEventSignature,
  type EventBody,
  type ProjectRole,
  type SyncEvent,
} from "./events.ts";
import { replayProject, workSyncKey, type ProjectState, type ReplayResult } from "./replay.ts";
import { completeLines, type SyncTransport } from "./transport.ts";
import { pushLibrary, pullLibrary, BIBLIO_PROJECT, type LibraryShareReport } from "./library.ts";

export const BUNDLE_FORMAT = "biociencia-sync-1";

export interface IngestReport {
  /** Líneas/eventos leídos */
  read: number;
  /** Eventos que no se conocían */
  fresh: number;
  /** Descartados por formato o firma inválida */
  invalid: number;
  /** Archivos con una última línea incompleta (se leerá en la próxima sincronización) */
  partial: number;
  /** Proyectos recalculados */
  projects: string[];
  /** Eventos rechazados por permisos (de los nuevos) */
  rejected: number;
}

export interface SyncReport extends IngestReport {
  written: number;
  errors: string[];
}

export interface ProjectHistory extends ReplayResult {
  names: Record<string, string>;
}

/**
 * Motor de sincronización: firma los cambios locales de proyectos compartidos,
 * los escribe en la carpeta de sincronización, lee los de otras computadoras,
 * verifica firmas y permisos, y recalcula el estado de cada proyecto.
 */
export class SyncEngine {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repo: BioRepo,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Activa la sincronización: crea las llaves si no existen y escucha los cambios del repositorio. */
  async attach(): Promise<void> {
    await this.ensureKeys();
    this.repo.setProjectHook((projectId, change) => this.onLocalChange(projectId, change));
    this.repo.setProjectIdFactory(async () => projectIdFor((await this.ensureKeys()).publicKey, this.clock()));
  }

  detach(): void {
    this.repo.setProjectHook(null);
    this.repo.setProjectIdFactory(null);
  }

  /** Ejecuta las operaciones de una en una (evita mezclar una sincronización con un cambio local). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Las llaves se leen siempre de la base (pueden cambiar al restaurar una copia de seguridad). */
  async ensureKeys(): Promise<KeyPair> {
    let k = await this.repo.getKeys();
    if (k && !(await keyPairMatches(k))) throw new Error("Las llaves guardadas de esta identidad están dañadas.");
    if (!k) {
      k = await generateKeyPair();
      await this.repo.saveKeys(k);
    }
    return k;
  }

  /** Código para que un administrador lo invite a un proyecto (no contiene la llave privada). */
  async researcherCode(): Promise<string> {
    const me = await this.me();
    const k = await this.ensureKeys();
    return encodeResearcherCode({ id: me.id, name: me.displayName, key: k.publicKey });
  }

  private async me() {
    const me = await this.repo.getIdentity();
    if (!me) throw new Error("Primero se debe crear la identidad local");
    return me;
  }

  private async nextHlc(deviceId: string): Promise<string> {
    const prevS = await this.repo.getSetting("sync_hlc");
    const prev = prevS ? hlcParse(prevS) : null;
    const h = hlcToString(hlcNow(prev ? { ...prev, node: deviceId } : null, deviceId, this.clock()));
    await this.repo.setSetting("sync_hlc", h);
    return h;
  }

  private async observeRemoteHlc(remote: string): Promise<void> {
    const me = await this.repo.getIdentity();
    if (!me) return;
    const prevS = await this.repo.getSetting("sync_hlc");
    const local = prevS ? hlcParse(prevS) : { ms: 0, counter: 0, node: me.deviceId };
    try {
      const h = hlcReceive({ ...local, node: me.deviceId }, hlcParse(remote), this.clock());
      await this.repo.setSetting("sync_hlc", hlcToString(h));
    } catch {
      // Reloj remoto demasiado adelantado: el evento se acepta igual (el orden lo da su HLC),
      // pero el reloj local no salta al futuro.
    }
  }

  // ---------------- Eventos locales ----------------

  private async signed(projectId: string, body: EventBody): Promise<SyncEvent> {
    const me = await this.me();
    const k = await this.ensureKeys();
    return signEvent(
      { v: 1, id: ulid(this.clock()), project: projectId, author: me.id, authorKey: k.publicKey, device: me.deviceId, hlc: await this.nextHlc(me.deviceId), type: body.type, data: body.data },
      k.secretKey,
    );
  }

  /** Firma y guarda eventos locales. Si los permisos los rechazarían, no se guardan y se lanza el motivo. */
  private async recordLocal(projectId: string, bodies: EventBody[]): Promise<void> {
    const events: SyncEvent[] = [];
    for (const b of bodies) events.push(await this.signed(projectId, b));
    const existing = await this.projectEvents(projectId);
    const check = replayProject([...existing, ...events]);
    const bad = check.rejected.find((r) => events.some((e) => e.id === r.id));
    if (bad) {
      await this.rematerialize(projectId); // deshace el cambio local que no tenía permiso
      throw new Error(bad.reason);
    }
    await this.repo.insertSyncEvents(events.map((e) => toStored(e, true)));
    await this.rematerialize(projectId);
  }

  private async onLocalChange(projectId: string, c: ProjectChange): Promise<void> {
    return this.serial(() => this.recordLocal(projectId, [changeToBody(c)]));
  }

  /** Convierte un proyecto personal en compartido: crea su historial firmado desde el estado actual. */
  /** Comparte el proyecto. Devuelve su identificador, que cambia si el proyecto se creó sin llave (versiones anteriores). */
  async shareProject(projectIdIn: string): Promise<string> {
    return this.serial(async () => {
      let projectId = projectIdIn;
      const me = await this.me();
      const p = await this.repo.getProject(projectId);
      if (!p) throw new Error("El proyecto no existe");
      if (p.visibility === "shared") return projectId;
      if ((await this.repo.myRole(projectId)) !== "admin") throw new Error("Solo un administrador puede compartir el proyecto");
      const { publicKey } = await this.ensureKeys();
      if (!projectBoundTo(projectId, publicKey)) {
        projectId = projectIdFor(publicKey, this.clock());
        await this.repo.rekeyProject(projectIdIn, projectId);
      }
      const bodies: EventBody[] = [
        { type: "project.create", data: { name: p.name, description: p.description, objectives: p.objectives, ownerName: me.displayName } },
      ];
      for (const w of [...(await this.repo.listProjectWorks(projectId))].reverse()) bodies.push({ type: "work.add", data: { key: workSyncKey(w), work: portableWork(w) } });
      for (const n of [...(await this.repo.listNotes("project", projectId))].reverse()) bodies.push({ type: "note.add", data: { noteId: n.id, body: n.body } });
      await this.recordLocal(projectId, bodies);
      await this.repo.markProjectShared(projectId);
      await this.repo.addSyncLog({ direction: "local", count: bodies.length, status: "ok", detail: `Proyecto «${p.name}» compartido` });
      return projectId;
    });
  }

  async addMember(projectId: string, code: string, role: ProjectRole): Promise<{ name: string }> {
    const c = decodeResearcherCode(code);
    const me = await this.me();
    if (c.id === me.id) throw new Error("Ese es su propio código. Pida el código a la otra persona.");
    await this.serial(() => this.recordLocal(projectId, [{ type: "member.set", data: { memberId: c.id, displayName: c.name, role, publicKey: c.key } }]));
    return { name: c.name };
  }

  async setMemberRole(projectId: string, memberId: string, role: ProjectRole): Promise<void> {
    const st = await this.projectState(projectId);
    const m = st?.members.find((x) => x.memberId === memberId);
    if (!m) throw new Error("Ese miembro no existe");
    await this.serial(() => this.recordLocal(projectId, [{ type: "member.set", data: { ...m, role } }]));
  }

  async removeMember(projectId: string, memberId: string): Promise<void> {
    await this.serial(() => this.recordLocal(projectId, [{ type: "member.remove", data: { memberId } }]));
  }

  // ---------------- Estado ----------------

  private async projectEvents(projectId: string): Promise<SyncEvent[]> {
    return (await this.repo.syncEventsRaw(projectId)).map((r) => JSON.parse(r) as SyncEvent);
  }

  async projectState(projectId: string): Promise<ProjectState | null> {
    return replayProject(await this.projectEvents(projectId)).state;
  }

  /** Historial de cambios, con los reemplazados y los rechazados, y nombres de autores. */
  async history(projectId: string): Promise<ProjectHistory> {
    const events = await this.projectEvents(projectId);
    const r = replayProject(events);
    const names: Record<string, string> = {};
    for (const e of events) {
      const d = e.data as { ownerName?: string; memberId?: string; displayName?: string };
      if (e.type === "project.create" && d?.ownerName) names[e.author] = d.ownerName;
      if (e.type === "member.set" && d?.memberId && d.displayName) names[d.memberId] = d.displayName;
    }
    return { ...r, names };
  }

  private async rematerialize(projectId: string): Promise<{ rejectedIds: string[] }> {
    const r = replayProject(await this.projectEvents(projectId));
    await this.repo.setSyncEventStatuses([
      ...r.accepted.map((id) => ({ id, status: "accepted" as const })),
      ...r.rejected.map((x) => ({ id: x.id, status: "rejected" as const, reason: x.reason })),
    ]);
    if (r.state) await this.repo.materializeProject(toMaterialized(r.state));
    return { rejectedIds: r.rejected.map((x) => x.id) };
  }

  // ---------------- Recepción ----------------

  /** Valida, guarda y aplica eventos recibidos (desde archivos o un paquete). */
  private async ingest(lines: string[]): Promise<IngestReport> {
    const report: IngestReport = { read: lines.length, fresh: 0, invalid: 0, partial: 0, projects: [], rejected: 0 };
    const valid: SyncEvent[] = [];
    for (const line of lines) {
      let e: unknown;
      try {
        e = typeof line === "string" ? JSON.parse(line) : line;
      } catch {
        report.invalid++;
        continue;
      }
      if (!isWellFormed(e) || !(await verifyEventSignature(e))) {
        report.invalid++;
        continue;
      }
      valid.push(e);
    }
    const freshIds = new Set(await this.repo.insertSyncEvents(valid.map((e) => toStored(e, false))));
    report.fresh = freshIds.size;
    const touched = new Set<string>();
    for (const e of valid) {
      if (!freshIds.has(e.id)) continue;
      touched.add(e.project);
      await this.observeRemoteHlc(e.hlc);
    }
    for (const p of touched) {
      const { rejectedIds } = await this.rematerialize(p);
      report.rejected += rejectedIds.filter((id) => freshIds.has(id)).length;
    }
    report.projects = [...touched];
    return report;
  }

  /** Sincroniza con una carpeta compartida: escribe lo pendiente y lee lo de los demás. */
  async syncNow(t: SyncTransport): Promise<SyncReport> {
    return this.serial(async () => {
      const me = await this.me();
      const errors: string[] = [];
      // 1. Escribir los eventos propios pendientes, agrupados por proyecto
      const pending = await this.repo.unexportedLocalEvents();
      const byProject = new Map<string, { id: string; raw: string }[]>();
      for (const e of pending) byProject.set(e.projectId, [...(byProject.get(e.projectId) ?? []), e]);
      let written = 0;
      for (const [project, evs] of byProject) {
        try {
          await t.append(project, me.deviceId, evs.map((e) => e.raw + "\n").join(""));
          await this.repo.markExported(evs.map((e) => e.id));
          written += evs.length;
        } catch (err) {
          errors.push(`No se pudo escribir en la carpeta (${project}): ${(err as Error).message}`);
        }
      }
      // 2. Leer los archivos de las demás computadoras (la carpeta «biblioteca» no son eventos de proyectos)
      const lines: string[] = [];
      let partial = 0;
      const peers = new Set<string>();
      for (const f of await t.list()) {
        if (f.device === me.deviceId) continue;
        if (f.project === BIBLIO_PROJECT) continue;
        try {
          const r = completeLines(await t.read(f.project, f.device));
          lines.push(...r.lines);
          if (r.partial) partial++;
          peers.add(f.device);
        } catch (err) {
          errors.push(`No se pudo leer ${f.project}/${f.device}: ${(err as Error).message}`);
        }
      }
      const rep = await this.ingest(lines);
      rep.partial = partial;
      await this.repo.addSyncLog({
        peer: t.label,
        direction: "carpeta",
        count: written + rep.fresh,
        status: errors.length ? "error" : "ok",
        detail: summary({ ...rep, written, errors }, peers.size),
      });
      return { ...rep, written, errors };
    });
  }

  // ---------------- Biblioteca compartida (misma carpeta, sin servidores) ----------------

  /** Comparte las publicaciones de la biblioteca personal que aún no están en la carpeta. */
  async shareLibrary(t: SyncTransport, opts: { includePdfs: boolean } = { includePdfs: true }): Promise<number> {
    return this.serial(async () => {
      const me = await this.me();
      const k = await this.ensureKeys();
      const n = await pushLibrary(this.repo, t, { deviceId: me.deviceId, name: me.displayName }, k, opts.includePdfs);
      if (n) await this.repo.addSyncLog({ direction: "biblioteca-salida", count: n, status: "ok", detail: `${n} publicación(es) compartida(s) en «biblioteca/»` });
      return n;
    });
  }

  /** Importa las publicaciones compartidas por las otras computadoras (unión de bibliotecas). */
  async pullLibrary(t: SyncTransport): Promise<LibraryShareReport> {
    return this.serial(async () => {
      const me = await this.me();
      const r = await pullLibrary(this.repo, t, me.deviceId);
      if (r.imported || r.errors.length) {
        await this.repo.addSyncLog({
          direction: "biblioteca-entrada",
          count: r.imported,
          status: r.errors.length ? "error" : "ok",
          detail: `${r.imported} nueva(s) · ${r.merged} ya existente(s) · ${r.attachments} PDF nuevo(s)${r.errors.length ? ` · ${r.errors.join("; ")}` : ""}`,
        });
      }
      return r;
    });
  }

  // ---------------- Paquetes manuales (web, correo, USB) ----------------

  /** Todos los eventos de los proyectos compartidos de los que soy miembro, en un archivo JSON. */
  async exportBundle(projectIds?: string[]): Promise<string> {
    const me = await this.me();
    const ids = projectIds ?? (await this.repo.listProjects()).filter((p) => p.visibility === "shared").map((p) => p.id);
    const events: SyncEvent[] = [];
    for (const id of ids) events.push(...(await this.projectEvents(id)));
    await this.repo.addSyncLog({ direction: "paquete-salida", count: events.length, status: "ok", detail: `${events.length} evento(s) de ${ids.length} proyecto(s)` });
    return JSON.stringify({ format: BUNDLE_FORMAT, createdAt: new Date(this.clock()).toISOString(), device: me.deviceId, events }, null, 1);
  }

  async importBundle(text: string): Promise<IngestReport> {
    let b: { format?: string; events?: unknown[] };
    try {
      b = JSON.parse(text);
    } catch {
      throw new Error("El archivo no es un paquete de sincronización de BioCiencia.");
    }
    if (b?.format !== BUNDLE_FORMAT || !Array.isArray(b.events)) throw new Error("El archivo no es un paquete de sincronización de BioCiencia.");
    return this.serial(async () => {
      const rep = await this.ingest(b.events!.map((e) => JSON.stringify(e)));
      await this.repo.addSyncLog({ direction: "paquete-entrada", count: rep.fresh, status: "ok", detail: summary({ ...rep, written: 0, errors: [] }, 0) });
      return rep;
    });
  }
}

function summary(r: SyncReport, peers: number): string {
  const parts = [`${r.written} enviado(s)`, `${r.fresh} recibido(s) nuevo(s)`];
  if (peers) parts.push(`${peers} archivo(s) de otras computadoras`);
  if (r.invalid) parts.push(`${r.invalid} descartado(s) por firma o formato inválido`);
  if (r.rejected) parts.push(`${r.rejected} rechazado(s) por permisos`);
  if (r.partial) parts.push(`${r.partial} archivo(s) incompletos, se reintentará`);
  if (r.errors.length) parts.push(r.errors.join("; "));
  return parts.join(" · ");
}

function toStored(e: SyncEvent, local: boolean) {
  return { id: e.id, projectId: e.project, authorId: e.author, deviceId: e.device, hlc: e.hlc, type: e.type, raw: JSON.stringify(e), local };
}

/** Quita datos locales (id interno) antes de enviar un artículo a otra computadora. */
function portableWork(w: Work): Work {
  const { id: _id, ...rest } = w;
  return rest as Work;
}

function changeToBody(c: ProjectChange): EventBody {
  switch (c.type) {
    case "project.update":
      return { type: "project.update", data: { field: c.field, value: c.value } };
    case "project.archive":
      return { type: "project.archive", data: {} };
    case "work.add":
      return { type: "work.add", data: { key: workSyncKey(c.work), work: portableWork(c.work) } };
    case "work.remove":
      return { type: "work.remove", data: { key: workSyncKey(c.work) } };
    case "note.add":
      return { type: "note.add", data: { noteId: c.noteId, body: c.body } };
    case "note.delete":
      return { type: "note.delete", data: { noteId: c.noteId } };
  }
}

function toMaterialized(s: ProjectState): MaterializedProject {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    objectives: s.objectives,
    ownerId: s.ownerId,
    archived: s.archived,
    members: s.members.map((m) => ({ memberId: m.memberId, displayName: m.displayName, role: m.role })),
    works: s.works.map((w) => w.work),
    notes: s.notes,
  };
}
