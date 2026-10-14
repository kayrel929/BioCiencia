import { mergeWork, normalizeWork, ulid, workKeys, type Work } from "@biociencia/core";
import type { SqlDriver, SqlValue, Statement } from "./driver.ts";
import { migrate } from "./migrations.ts";

export type Role = "admin" | "editor" | "reader";

export interface Identity {
  id: string;
  displayName: string;
  deviceId: string;
}

export interface SearchRecord {
  id: string;
  query: string;
  filters: Record<string, unknown>;
  source: string;
  totalHits: number | null;
  resultCount: number;
  error: string | null;
  createdAt: string;
}

export interface LibraryEntry {
  work: Work;
  favorite: boolean;
  notes: string;
  tags: string[];
  addedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  objectives: string;
  ownerId: string;
  visibility: "private" | "shared";
  createdAt: string;
  updatedAt: string;
  workCount?: number;
}

export interface ProjectMember {
  memberId: string;
  displayName: string;
  role: Role;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  kind: "personal" | "shared" | "project";
  projectId: string | null;
  itemCount: number;
}

interface WorkRow {
  id: string;
  title: string;
  authors_json: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  pmid: string | null;
  openalex_id: string | null;
  arxiv_id: string | null;
  abstract: string | null;
  keywords_json: string;
  type: string | null;
  language: string | null;
  cited_by_count: number | null;
  is_oa: number | null;
  oa_url: string | null;
  landing_url: string | null;
  source: Work["source"];
  fetched_at: string;
}

function rowToWork(r: WorkRow): Work {
  return {
    id: r.id,
    title: r.title,
    authors: JSON.parse(r.authors_json),
    year: r.year,
    venue: r.venue,
    doi: r.doi,
    pmid: r.pmid,
    openalexId: r.openalex_id,
    arxivId: r.arxiv_id,
    abstract: r.abstract,
    keywords: JSON.parse(r.keywords_json),
    type: r.type,
    language: r.language,
    citedByCount: r.cited_by_count,
    isOpenAccess: r.is_oa === null ? null : r.is_oa === 1,
    oaUrl: r.oa_url,
    landingUrl: r.landing_url,
    source: r.source,
    fetchedAt: r.fetched_at,
  };
}

function workParams(w: Work): SqlValue[] {
  return [
    w.title,
    JSON.stringify(w.authors),
    w.year ?? null,
    w.venue ?? null,
    w.doi ?? null,
    w.pmid ?? null,
    w.openalexId ?? null,
    w.arxivId ?? null,
    w.abstract ?? null,
    JSON.stringify(w.keywords ?? []),
    w.type ?? null,
    w.language ?? null,
    w.citedByCount ?? null,
    w.isOpenAccess === null || w.isOpenAccess === undefined ? null : w.isOpenAccess ? 1 : 0,
    w.oaUrl ?? null,
    w.landingUrl ?? null,
    w.source,
    w.fetchedAt,
  ];
}

function ftsStatements(id: string, w: Work): Statement[] {
  return [
    { sql: "DELETE FROM works_fts WHERE work_id = ?", params: [id] },
    {
      sql: "INSERT INTO works_fts (work_id, title, authors, abstract, venue, keywords) VALUES (?, ?, ?, ?, ?, ?)",
      params: [id, w.title, w.authors.map((a) => a.name).join("; "), w.abstract ?? "", w.venue ?? "", (w.keywords ?? []).join("; ")],
    },
  ];
}

/** Convierte texto libre en una consulta FTS5 segura (cada palabra entre comillas, prefijo). */
export function toFtsQuery(text: string): string | null {
  const tokens = text
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 12);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, "")}"*`).join(" ");
}

const now = () => new Date().toISOString();

/**
 * Acceso a los datos locales de BioCiencia. Funciona igual en Windows y web
 * porque solo depende de la interfaz SqlDriver.
 */
export class BioRepo {
  constructor(private readonly db: SqlDriver) {}

  async init(): Promise<number[]> {
    return migrate(this.db);
  }

  describeStorage() {
    return this.db.describe();
  }

  // ---------------- Identidad local ----------------

  async getIdentity(): Promise<Identity | null> {
    const rows = await this.db.all<{ id: string; display_name: string; device_id: string }>(
      "SELECT i.id, i.display_name, d.id AS device_id FROM identity i JOIN devices d ON d.identity_id = i.id AND d.is_local = 1 LIMIT 1",
    );
    const r = rows[0];
    return r ? { id: r.id, displayName: r.display_name, deviceId: r.device_id } : null;
  }

  /** Crea la identidad local la primera vez que se abre la app. */
  async ensureIdentity(displayName: string, deviceName = "Esta computadora"): Promise<Identity> {
    const existing = await this.getIdentity();
    if (existing) return existing;
    const id = ulid();
    const deviceId = ulid();
    const t = now();
    await this.db.batch([
      { sql: "INSERT INTO identity (id, display_name, created_at) VALUES (?, ?, ?)", params: [id, displayName.trim() || "Investigador", t] },
      {
        sql: "INSERT INTO devices (id, identity_id, name, is_local, authorized, created_at) VALUES (?, ?, ?, 1, 1, ?)",
        params: [deviceId, id, deviceName, t],
      },
    ]);
    return { id, displayName, deviceId };
  }

  async renameIdentity(displayName: string): Promise<void> {
    const me = await this.getIdentity();
    if (!me) throw new Error("No hay identidad local");
    await this.db.batch([{ sql: "UPDATE identity SET display_name = ? WHERE id = ?", params: [displayName.trim(), me.id] }]);
  }

  async getSetting(key: string): Promise<string | null> {
    const r = await this.db.all<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
    return r[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.batch([{ sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params: [key, value] }]);
  }

  // ---------------- Publicaciones ----------------

  /** Busca un artículo ya guardado que comparta cualquiera de sus identificadores. */
  async findExisting(w: Work): Promise<string | null> {
    for (const k of workKeys(w)) {
      const r = await this.db.all<{ work_id: string }>("SELECT work_id FROM work_ids WHERE kind = ? AND value = ?", [k.kind, k.value]);
      if (r[0]) return r[0].work_id;
    }
    return null;
  }

  /**
   * Guarda un artículo sin duplicarlo: si ya existe (por DOI, PMID, OpenAlex, arXiv
   * o título), completa sus datos; si no, lo crea. Devuelve su id local.
   */
  async upsertWork(input: Work): Promise<{ id: string; created: boolean }> {
    const incoming = normalizeWork(input);
    const existingId = await this.findExisting(incoming);
    const t = now();
    if (existingId) {
      const current = await this.getWork(existingId);
      const merged = current ? mergeWork(current, incoming) : incoming;
      const stmts: Statement[] = [
        {
          sql: `UPDATE works SET title=?, authors_json=?, year=?, venue=?, doi=?, pmid=?, openalex_id=?, arxiv_id=?, abstract=?, keywords_json=?, type=?, language=?, cited_by_count=?, is_oa=?, oa_url=?, landing_url=?, source=?, fetched_at=?, updated_at=? WHERE id=?`,
          params: [...workParams(merged), t, existingId],
        },
        { sql: "INSERT INTO sources_log (id, work_id, source, fetched_at) VALUES (?, ?, ?, ?)", params: [ulid(), existingId, incoming.source, incoming.fetchedAt] },
        ...ftsStatements(existingId, merged),
        ...workKeys(merged).map((k) => ({ sql: "INSERT OR IGNORE INTO work_ids (kind, value, work_id) VALUES (?, ?, ?)", params: [k.kind, k.value, existingId] })),
      ];
      await this.db.batch(stmts);
      return { id: existingId, created: false };
    }
    const id = ulid();
    await this.db.batch([
      {
        sql: `INSERT INTO works (title, authors_json, year, venue, doi, pmid, openalex_id, arxiv_id, abstract, keywords_json, type, language, cited_by_count, is_oa, oa_url, landing_url, source, fetched_at, id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [...workParams(incoming), id, t, t],
      },
      { sql: "INSERT INTO sources_log (id, work_id, source, fetched_at) VALUES (?, ?, ?, ?)", params: [ulid(), id, incoming.source, incoming.fetchedAt] },
      ...ftsStatements(id, incoming),
      ...workKeys(incoming).map((k) => ({ sql: "INSERT OR IGNORE INTO work_ids (kind, value, work_id) VALUES (?, ?, ?)", params: [k.kind, k.value, id] })),
    ]);
    return { id, created: true };
  }

  async getWork(id: string): Promise<Work | null> {
    const r = await this.db.all<WorkRow>("SELECT * FROM works WHERE id = ? AND deleted = 0", [id]);
    return r[0] ? rowToWork(r[0]) : null;
  }

  async countWorks(): Promise<number> {
    const r = await this.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM works WHERE deleted = 0");
    return Number(r[0]?.n ?? 0);
  }

  async workSources(id: string): Promise<{ source: string; fetchedAt: string }[]> {
    const r = await this.db.all<{ source: string; fetched_at: string }>(
      "SELECT source, fetched_at FROM sources_log WHERE work_id = ? ORDER BY fetched_at DESC",
      [id],
    );
    return r.map((x) => ({ source: x.source, fetchedAt: x.fetched_at }));
  }

  // ---------------- Historial de búsquedas ----------------

  /** Guarda una búsqueda con sus resultados (o con el error que devolvió la fuente). */
  async saveSearch(input: {
    query: string;
    filters?: Record<string, unknown>;
    source: string;
    results: Work[];
    totalHits?: number | null;
    error?: string | null;
  }): Promise<{ searchId: string; workIds: string[] }> {
    const workIds: string[] = [];
    for (const w of input.results) workIds.push((await this.upsertWork(w)).id);
    const searchId = ulid();
    const unique = [...new Set(workIds)];
    await this.db.batch([
      {
        sql: "INSERT INTO searches (id, query, filters_json, source, total_hits, result_count, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [searchId, input.query, JSON.stringify(input.filters ?? {}), input.source, input.totalHits ?? null, unique.length, input.error ?? null, now()],
      },
      ...unique.map((wid, i) => ({ sql: "INSERT INTO search_results (search_id, work_id, rank) VALUES (?, ?, ?)", params: [searchId, wid, i + 1] })),
    ]);
    return { searchId, workIds: unique };
  }

  async listSearches(limit = 50): Promise<SearchRecord[]> {
    const r = await this.db.all<{
      id: string; query: string; filters_json: string; source: string; total_hits: number | null; result_count: number; error: string | null; created_at: string;
    }>("SELECT * FROM searches ORDER BY created_at DESC, id DESC LIMIT ?", [limit]);
    return r.map((x) => ({
      id: x.id, query: x.query, filters: JSON.parse(x.filters_json), source: x.source, totalHits: x.total_hits,
      resultCount: x.result_count, error: x.error, createdAt: x.created_at,
    }));
  }

  async searchResults(searchId: string): Promise<Work[]> {
    const r = await this.db.all<WorkRow>(
      "SELECT w.* FROM search_results s JOIN works w ON w.id = s.work_id WHERE s.search_id = ? ORDER BY s.rank",
      [searchId],
    );
    return r.map(rowToWork);
  }

  async deleteSearch(searchId: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM search_results WHERE search_id = ?", params: [searchId] },
      { sql: "DELETE FROM searches WHERE id = ?", params: [searchId] },
    ]);
  }

  // ---------------- Biblioteca personal ----------------

  async addToLibrary(workId: string): Promise<void> {
    const t = now();
    await this.db.batch([
      {
        sql: `INSERT INTO library_items (work_id, added_at, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(work_id) DO UPDATE SET deleted = 0, updated_at = excluded.updated_at`,
        params: [workId, t, t],
      },
    ]);
  }

  async removeFromLibrary(workId: string): Promise<void> {
    await this.db.batch([{ sql: "UPDATE library_items SET deleted = 1, updated_at = ? WHERE work_id = ?", params: [now(), workId] }]);
  }

  async isInLibrary(workId: string): Promise<boolean> {
    const r = await this.db.all("SELECT 1 FROM library_items WHERE work_id = ? AND deleted = 0", [workId]);
    return r.length > 0;
  }

  async setFavorite(workId: string, favorite: boolean): Promise<void> {
    await this.db.batch([{ sql: "UPDATE library_items SET favorite = ?, updated_at = ? WHERE work_id = ?", params: [favorite ? 1 : 0, now(), workId] }]);
  }

  async setLibraryNotes(workId: string, notes: string): Promise<void> {
    await this.db.batch([{ sql: "UPDATE library_items SET notes = ?, updated_at = ? WHERE work_id = ?", params: [notes, now(), workId] }]);
  }

  async addTag(workId: string, tag: string): Promise<void> {
    const clean = tag.trim();
    if (!clean) return;
    await this.db.batch([{ sql: "INSERT OR IGNORE INTO tags (work_id, tag) VALUES (?, ?)", params: [workId, clean] }]);
  }

  async removeTag(workId: string, tag: string): Promise<void> {
    await this.db.batch([{ sql: "DELETE FROM tags WHERE work_id = ? AND tag = ?", params: [workId, tag] }]);
  }

  async allTags(): Promise<{ tag: string; count: number }[]> {
    const r = await this.db.all<{ tag: string; n: number }>(
      "SELECT t.tag, COUNT(*) AS n FROM tags t JOIN library_items l ON l.work_id = t.work_id AND l.deleted = 0 GROUP BY t.tag ORDER BY t.tag",
    );
    return r.map((x) => ({ tag: x.tag, count: Number(x.n) }));
  }

  /**
   * Lista la biblioteca. `text` busca en título, autores, resumen, revista y palabras clave
   * con el índice de texto completo (funciona sin internet).
   */
  async listLibrary(opts: { text?: string; favorite?: boolean; tag?: string; collectionId?: string; projectId?: string; limit?: number } = {}): Promise<LibraryEntry[]> {
    const where: string[] = ["l.deleted = 0", "w.deleted = 0"];
    const params: SqlValue[] = [];
    const fts = opts.text ? toFtsQuery(opts.text) : null;
    if (opts.text && !fts) return [];
    if (fts) {
      where.push("w.id IN (SELECT work_id FROM works_fts WHERE works_fts MATCH ?)");
      params.push(fts);
    }
    if (opts.favorite) where.push("l.favorite = 1");
    if (opts.tag) {
      where.push("EXISTS (SELECT 1 FROM tags t WHERE t.work_id = w.id AND t.tag = ?)");
      params.push(opts.tag);
    }
    if (opts.collectionId) {
      where.push("EXISTS (SELECT 1 FROM collection_items c WHERE c.work_id = w.id AND c.collection_id = ?)");
      params.push(opts.collectionId);
    }
    if (opts.projectId) {
      where.push("EXISTS (SELECT 1 FROM project_works p WHERE p.work_id = w.id AND p.project_id = ?)");
      params.push(opts.projectId);
    }
    params.push(opts.limit ?? 500);
    const rows = await this.db.all<WorkRow & { favorite: number; notes: string; added_at: string; tags: string | null }>(
      `SELECT w.*, l.favorite, l.notes, l.added_at,
              (SELECT group_concat(tag, '\u001f') FROM tags t WHERE t.work_id = w.id) AS tags
       FROM library_items l JOIN works w ON w.id = l.work_id
       WHERE ${where.join(" AND ")}
       ORDER BY l.added_at DESC LIMIT ?`,
      params,
    );
    return rows.map((r) => ({
      work: rowToWork(r),
      favorite: r.favorite === 1,
      notes: r.notes,
      tags: r.tags ? r.tags.split("\u001f").sort() : [],
      addedAt: r.added_at,
    }));
  }

  async libraryCount(): Promise<number> {
    const r = await this.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM library_items WHERE deleted = 0");
    return Number(r[0]?.n ?? 0);
  }

  // ---------------- Colecciones ----------------

  async createCollection(name: string, description = "", kind: Collection["kind"] = "personal", projectId: string | null = null): Promise<string> {
    if (!name.trim()) throw new Error("La colección necesita un nombre");
    const id = ulid();
    const t = now();
    await this.db.batch([
      {
        sql: "INSERT INTO collections (id, name, description, kind, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params: [id, name.trim(), description, kind, projectId, t, t],
      },
    ]);
    return id;
  }

  async listCollections(): Promise<Collection[]> {
    const r = await this.db.all<{ id: string; name: string; description: string; kind: Collection["kind"]; project_id: string | null; n: number }>(
      `SELECT c.*, (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id) AS n
       FROM collections c WHERE c.deleted = 0 ORDER BY c.name`,
    );
    return r.map((x) => ({ id: x.id, name: x.name, description: x.description, kind: x.kind, projectId: x.project_id, itemCount: Number(x.n) }));
  }

  async addToCollection(collectionId: string, workId: string): Promise<void> {
    await this.addToLibrary(workId);
    await this.db.batch([{ sql: "INSERT OR IGNORE INTO collection_items (collection_id, work_id, added_at) VALUES (?, ?, ?)", params: [collectionId, workId, now()] }]);
  }

  async removeFromCollection(collectionId: string, workId: string): Promise<void> {
    await this.db.batch([{ sql: "DELETE FROM collection_items WHERE collection_id = ? AND work_id = ?", params: [collectionId, workId] }]);
  }

  async deleteCollection(collectionId: string): Promise<void> {
    await this.db.batch([{ sql: "UPDATE collections SET deleted = 1, updated_at = ? WHERE id = ?", params: [now(), collectionId] }]);
  }

  // ---------------- Proyectos ----------------

  async createProject(input: { name: string; description?: string; objectives?: string }): Promise<string> {
    const me = await this.getIdentity();
    if (!me) throw new Error("Primero se debe crear la identidad local");
    if (!input.name.trim()) throw new Error("El proyecto necesita un nombre");
    const id = ulid();
    const t = now();
    await this.db.batch([
      {
        sql: "INSERT INTO projects (id, name, description, objectives, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params: [id, input.name.trim(), input.description ?? "", input.objectives ?? "", me.id, t, t],
      },
      {
        sql: "INSERT INTO project_members (project_id, member_id, display_name, role, added_at) VALUES (?, ?, ?, 'admin', ?)",
        params: [id, me.id, me.displayName, t],
      },
    ]);
    return id;
  }

  async updateProject(id: string, patch: Partial<Pick<Project, "name" | "description" | "objectives">>): Promise<void> {
    await this.requireRole(id, ["admin", "editor"]);
    const sets: string[] = [];
    const params: SqlValue[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (!["name", "description", "objectives"].includes(k)) continue;
      if (k === "name" && !String(v).trim()) throw new Error("El proyecto necesita un nombre");
      sets.push(`${k} = ?`);
      params.push(String(v));
    }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    params.push(now(), id);
    await this.db.batch([{ sql: `UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, params }]);
  }

  async listProjects(): Promise<Project[]> {
    const me = await this.getIdentity();
    if (!me) return [];
    const r = await this.db.all<ProjectRow & { n: number }>(
      `SELECT p.*, (SELECT COUNT(*) FROM project_works w WHERE w.project_id = p.id) AS n
       FROM projects p
       WHERE p.deleted = 0 AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.member_id = ?)
       ORDER BY p.updated_at DESC`,
      [me.id],
    );
    return r.map((x) => ({ ...rowToProject(x), workCount: Number(x.n) }));
  }

  /** Devuelve el proyecto solo si la identidad local es miembro. */
  async getProject(id: string): Promise<Project | null> {
    const me = await this.getIdentity();
    if (!me) return null;
    const r = await this.db.all<ProjectRow>(
      `SELECT p.* FROM projects p WHERE p.id = ? AND p.deleted = 0
       AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.member_id = ?)`,
      [id, me.id],
    );
    return r[0] ? rowToProject(r[0]) : null;
  }

  async projectMembers(id: string): Promise<ProjectMember[]> {
    const r = await this.db.all<{ member_id: string; display_name: string; role: Role }>(
      "SELECT member_id, display_name, role FROM project_members WHERE project_id = ? ORDER BY added_at",
      [id],
    );
    return r.map((x) => ({ memberId: x.member_id, displayName: x.display_name, role: x.role }));
  }

  async myRole(projectId: string): Promise<Role | null> {
    const me = await this.getIdentity();
    if (!me) return null;
    const r = await this.db.all<{ role: Role }>("SELECT role FROM project_members WHERE project_id = ? AND member_id = ?", [projectId, me.id]);
    return r[0]?.role ?? null;
  }

  private async requireRole(projectId: string, allowed: Role[]): Promise<void> {
    const role = await this.myRole(projectId);
    if (!role || !allowed.includes(role)) throw new Error("No tiene permiso para modificar este proyecto");
  }

  async addWorkToProject(projectId: string, workId: string): Promise<void> {
    await this.requireRole(projectId, ["admin", "editor"]);
    await this.addToLibrary(workId);
    await this.db.batch([
      { sql: "INSERT OR IGNORE INTO project_works (project_id, work_id, added_at) VALUES (?, ?, ?)", params: [projectId, workId, now()] },
      { sql: "UPDATE projects SET updated_at = ? WHERE id = ?", params: [now(), projectId] },
    ]);
  }

  async removeWorkFromProject(projectId: string, workId: string): Promise<void> {
    await this.requireRole(projectId, ["admin", "editor"]);
    await this.db.batch([{ sql: "DELETE FROM project_works WHERE project_id = ? AND work_id = ?", params: [projectId, workId] }]);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.requireRole(projectId, ["admin"]);
    await this.db.batch([{ sql: "UPDATE projects SET deleted = 1, updated_at = ? WHERE id = ?", params: [now(), projectId] }]);
  }

  // ---------------- Notas ----------------

  async addNote(entity: "work" | "project", entityId: string, body: string): Promise<string> {
    const me = await this.getIdentity();
    if (!me) throw new Error("Primero se debe crear la identidad local");
    if (!body.trim()) throw new Error("La nota está vacía");
    const id = ulid();
    const t = now();
    await this.db.batch([
      { sql: "INSERT INTO notes (id, entity, entity_id, body, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [id, entity, entityId, body.trim(), me.id, t, t] },
    ]);
    return id;
  }

  async listNotes(entity: "work" | "project", entityId: string): Promise<{ id: string; body: string; createdAt: string }[]> {
    const r = await this.db.all<{ id: string; body: string; created_at: string }>(
      "SELECT id, body, created_at FROM notes WHERE entity = ? AND entity_id = ? AND deleted = 0 ORDER BY created_at DESC",
      [entity, entityId],
    );
    return r.map((x) => ({ id: x.id, body: x.body, createdAt: x.created_at }));
  }
}

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  objectives: string;
  owner_id: string;
  visibility: "private" | "shared";
  created_at: string;
  updated_at: string;
}

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    objectives: r.objectives,
    ownerId: r.owner_id,
    visibility: r.visibility,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
