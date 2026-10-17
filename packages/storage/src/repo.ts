import { mergeWork, normalizeWork, redact, ulid, workKeys, type Work } from "@biociencia/core";
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
  /** Colecciones a las que pertenece */
  collectionIds: string[];
  /** PDF adjuntos */
  pdfCount: number;
  /** Es publicación propia */
  own: boolean;
}

export interface Attachment {
  id: string;
  workId: string;
  filename: string;
  size: number;
  sha256: string;
  pages: number | null;
  createdAt: string;
  annotationCount: number;
}

export type AnnotationColor = "amarillo" | "verde" | "azul" | "rosado";

export interface Annotation {
  id: string;
  attachmentId: string;
  page: number;
  /** Rectángulos normalizados (0–1) respecto de la página */
  rects: { x: number; y: number; w: number; h: number }[];
  quote: string;
  note: string;
  color: AnnotationColor;
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  query: string;
  label: string;
  params: unknown;
  lastChecked: string | null;
  lastNew: number;
  unseen: number;
  createdAt: string;
}

export interface SmartGroup {
  id: string;
  name: string;
  rules: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Tamaño máximo de un PDF adjunto */
export const MAX_PDF_BYTES = 80 * 1024 * 1024;

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

/** Cambio local en un proyecto compartido: el módulo de sincronización lo convierte en evento firmado. */
export type ProjectChange =
  | { type: "project.update"; field: "name" | "description" | "objectives"; value: string }
  | { type: "project.archive" }
  | { type: "work.add"; work: Work }
  | { type: "work.remove"; work: Work }
  | { type: "note.add"; noteId: string; body: string }
  | { type: "note.delete"; noteId: string };

export type ProjectHook = (projectId: string, change: ProjectChange) => Promise<void>;

/** Estado de un proyecto compartido calculado a partir de sus eventos. */
export interface MaterializedProject {
  id: string;
  name: string;
  description: string;
  objectives: string;
  ownerId: string;
  archived: boolean;
  members: { memberId: string; displayName: string; role: Role }[];
  works: Work[];
  notes: { noteId: string; body: string; author: string; hlc: string }[];
}

export interface StoredSyncEvent {
  id: string;
  projectId: string;
  authorId: string;
  deviceId: string;
  hlc: string;
  type: string;
  raw: string;
  local: boolean;
}

export interface SyncLogEntry {
  id: string;
  peer: string | null;
  direction: string;
  count: number;
  status: string;
  detail: string | null;
  at: string;
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
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
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
  pub_types?: string | null;
  retraction?: string | null;
}

function rowToWork(r: WorkRow): Work {
  return {
    id: r.id,
    title: r.title,
    authors: JSON.parse(r.authors_json),
    year: r.year,
    venue: r.venue,
    volume: r.volume ?? null,
    issue: r.issue ?? null,
    pages: r.pages ?? null,
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
    pubTypes: r.pub_types ? JSON.parse(r.pub_types) : [],
    retraction: r.retraction ? JSON.parse(r.retraction) : null,
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
    w.volume ?? null,
    w.issue ?? null,
    w.pages ?? null,
    JSON.stringify(w.pubTypes ?? []),
    w.retraction ? JSON.stringify(w.retraction) : null,
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

export const BACKUP_FORMAT = "biociencia-backup-1";
/** Tablas en orden de dependencias (las referenciadas primero). */
/** Ajustes con secretos del usuario que no se copian en las copias de seguridad. */
export const SECRET_SETTINGS = ["scopus_api_key", "ai_api_key"];

export const BACKUP_TABLES = [
  "identity", "devices", "settings", "works", "work_ids", "sources_log", "searches", "search_results",
  "library_items", "tags", "projects", "collections", "collection_items", "project_members", "project_works",
  "notes", "files", "events", "sync_peers", "sync_log", "identity_keys", "sync_events", "own_works", "datasets", "manuscripts", "reviews", "review_records", "citation_counts",
  "attachments", "attachment_data", "annotations", "csl_styles", "smart_groups", "alerts", "alert_items",
] as const;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  createdAt: string;
  app: "BioCiencia";
  tables: Record<string, Record<string, unknown>[]>;
}

/**
 * Acceso a los datos locales de BioCiencia. Funciona igual en Windows y web
 * porque solo depende de la interfaz SqlDriver.
 */
export class BioRepo {
  constructor(private readonly db: SqlDriver) {}

  private projectHook: ProjectHook | null = null;
  private projectIdFactory: (() => Promise<string>) | null = null;

  /** La sincronización registra aquí cómo crear identificadores de proyecto ligados a la llave del usuario. */
  setProjectIdFactory(fn: (() => Promise<string>) | null): void {
    this.projectIdFactory = fn;
  }

  /** El módulo de sincronización se registra aquí para enterarse de los cambios en proyectos compartidos. */
  setProjectHook(hook: ProjectHook | null): void {
    this.projectHook = hook;
  }

  private async emit(projectId: string, change: ProjectChange): Promise<void> {
    const r = await this.db.all<{ visibility: string }>("SELECT visibility FROM projects WHERE id = ?", [projectId]);
    if (r[0]?.visibility !== "shared") return;
    // Un cambio en un proyecto compartido que no se firma nunca llegaría a los demás: mejor avisar.
    if (!this.projectHook) throw new Error("La sincronización aún no está lista; el cambio se guardó solo en esta computadora. Intente de nuevo.");
    await this.projectHook(projectId, change);
  }

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
          sql: `UPDATE works SET title=?, authors_json=?, year=?, venue=?, doi=?, pmid=?, openalex_id=?, arxiv_id=?, abstract=?, keywords_json=?, type=?, language=?, cited_by_count=?, is_oa=?, oa_url=?, landing_url=?, source=?, fetched_at=?, volume=?, issue=?, pages=?, pub_types=?, retraction=?, updated_at=? WHERE id=?`,
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
        sql: `INSERT INTO works (title, authors_json, year, venue, doi, pmid, openalex_id, arxiv_id, abstract, keywords_json, type, language, cited_by_count, is_oa, oa_url, landing_url, source, fetched_at, volume, issue, pages, pub_types, retraction, id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  }): Promise<{ searchId: string; ids: string[]; workIds: string[] }> {
    const ids: string[] = [];
    for (const w of input.results) ids.push((await this.upsertWork(w)).id);
    const searchId = ulid();
    const unique = [...new Set(ids)];
    await this.db.batch([
      {
        sql: "INSERT INTO searches (id, query, filters_json, source, total_hits, result_count, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [searchId, input.query, JSON.stringify(input.filters ?? {}), input.source, input.totalHits ?? null, unique.length, input.error ?? null, now()],
      },
      ...unique.map((wid, i) => ({ sql: "INSERT INTO search_results (search_id, work_id, rank) VALUES (?, ?, ?)", params: [searchId, wid, i + 1] })),
    ]);
    return { searchId, ids, workIds: unique };
  }

  /** Añade a una búsqueda guardada los resultados de las páginas siguientes. */
  async appendSearchResults(searchId: string, results: Work[]): Promise<string[]> {
    const ids: string[] = [];
    for (const w of results) ids.push((await this.upsertWork(w)).id);
    const r = await this.db.all<{ n: number }>("SELECT COALESCE(MAX(rank), 0) AS n FROM search_results WHERE search_id = ?", [searchId]);
    const start = Number(r[0]?.n ?? 0);
    const unique = [...new Set(ids)];
    await this.db.batch([
      ...unique.map((wid, i) => ({ sql: "INSERT OR IGNORE INTO search_results (search_id, work_id, rank) VALUES (?, ?, ?)", params: [searchId, wid, start + i + 1] })),
      { sql: "UPDATE searches SET result_count = (SELECT COUNT(*) FROM search_results WHERE search_id = ?) WHERE id = ?", params: [searchId, searchId] },
    ]);
    return ids;
  }

  /** Ids locales de las publicaciones que ya están en la biblioteca (para marcar resultados). */
  async libraryMembership(workIds: string[]): Promise<Set<string>> {
    if (workIds.length === 0) return new Set();
    const r = await this.db.all<{ work_id: string }>(
      `SELECT work_id FROM library_items WHERE deleted = 0 AND work_id IN (${workIds.map(() => "?").join(",")})`,
      workIds,
    );
    return new Set(r.map((x) => x.work_id));
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

  /**
   * Añade texto a las observaciones de una publicación SIN borrar lo que ya había.
   * Si la publicación todavía no está en la biblioteca, se añade: antes, un `UPDATE` sobre una fila
   * inexistente no guardaba nada y el usuario veía «Guardado» sin que se hubiera guardado.
   */
  async appendLibraryNotes(workId: string, text: string): Promise<void> {
    const add = text.trim();
    if (!add) return;
    const t = now();
    // Sin filtrar por deleted: si el elemento se quitó de la biblioteca, sus observaciones se conservan.
    const rows = await this.db.all<{ notes: string | null }>("SELECT notes FROM library_items WHERE work_id = ?", [workId]);
    const prev = (rows[0]?.notes ?? "").trim();
    const merged = prev ? `${prev}\n\n${add}` : add;
    await this.db.batch([
      {
        sql: `INSERT INTO library_items (work_id, notes, added_at, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(work_id) DO UPDATE SET notes = excluded.notes, deleted = 0, updated_at = excluded.updated_at`,
        params: [workId, merged, t, t],
      },
    ]);
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
  async listLibrary(opts: { text?: string; favorite?: boolean; own?: boolean; tag?: string; collectionId?: string; projectId?: string; limit?: number } = {}): Promise<LibraryEntry[]> {
    const where: string[] = ["l.deleted = 0", "w.deleted = 0"];
    const params: SqlValue[] = [];
    const fts = opts.text ? toFtsQuery(opts.text) : null;
    if (opts.text && !fts) return [];
    if (fts) {
      // También busca dentro del texto de los PDF adjuntos
      where.push("(w.id IN (SELECT work_id FROM works_fts WHERE works_fts MATCH ?) OR w.id IN (SELECT f.work_id FROM attachments_fts f JOIN attachments a ON a.id = f.attachment_id WHERE attachments_fts MATCH ? AND a.deleted = 0))");
      params.push(fts, fts);
    }
    if (opts.favorite) where.push("l.favorite = 1");
    if (opts.own) where.push("EXISTS (SELECT 1 FROM own_works o WHERE o.work_id = w.id)");
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
    const rows = await this.db.all<WorkRow & { favorite: number; notes: string; added_at: string; tags: string | null; cols: string | null; pdfs: number; own: number }>(
      `SELECT w.*, l.favorite, l.notes, l.added_at,
              (SELECT group_concat(tag, '\u001f') FROM tags t WHERE t.work_id = w.id) AS tags,
              (SELECT group_concat(collection_id, '\u001f') FROM collection_items c WHERE c.work_id = w.id) AS cols,
              (SELECT COUNT(*) FROM attachments a WHERE a.work_id = w.id AND a.deleted = 0) AS pdfs,
              EXISTS (SELECT 1 FROM own_works o WHERE o.work_id = w.id) AS own
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
      collectionIds: r.cols ? r.cols.split("\u001f") : [],
      pdfCount: Number(r.pdfs ?? 0),
      own: Number(r.own) === 1,
    }));
  }

  async libraryCount(): Promise<number> {
    const r = await this.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM library_items WHERE deleted = 0");
    return Number(r[0]?.n ?? 0);
  }

  // ---------------- Publicaciones propias (ORCID) ----------------

  /** Guarda las publicaciones del propio investigador: van a la biblioteca y quedan marcadas como propias. */
  async importOwnWorks(works: (Work & { putCode?: string })[], orcid: string | null): Promise<{ created: number; merged: number; ids: string[] }> {
    let created = 0;
    let merged = 0;
    const ids: string[] = [];
    for (const w of works) {
      const { putCode, ...work } = w;
      const r = await this.upsertWork(work);
      if (r.created) created++;
      else merged++;
      ids.push(r.id);
      await this.addToLibrary(r.id);
      await this.db.batch([
        {
          sql: `INSERT INTO own_works (work_id, orcid, put_code, origin, added_at) VALUES (?, ?, ?, 'orcid', ?)
                ON CONFLICT(work_id) DO UPDATE SET orcid = excluded.orcid, put_code = excluded.put_code`,
          params: [r.id, orcid, putCode ?? null, now()],
        },
      ]);
    }
    return { created, merged, ids };
  }

  async setOwnWork(workId: string, own: boolean): Promise<void> {
    if (own) {
      await this.addToLibrary(workId);
      await this.db.batch([{ sql: "INSERT OR IGNORE INTO own_works (work_id, origin, added_at) VALUES (?, 'manual', ?)", params: [workId, now()] }]);
    } else {
      await this.db.batch([{ sql: "DELETE FROM own_works WHERE work_id = ?", params: [workId] }]);
    }
  }

  async ownWorkIds(workIds?: string[]): Promise<Set<string>> {
    const r = workIds
      ? workIds.length
        ? await this.db.all<{ work_id: string }>(`SELECT work_id FROM own_works WHERE work_id IN (${workIds.map(() => "?").join(",")})`, workIds)
        : []
      : await this.db.all<{ work_id: string }>("SELECT work_id FROM own_works");
    return new Set(r.map((x) => x.work_id));
  }

  /** Publicaciones propias, de la más reciente a la más antigua. */
  async listOwnWorks(): Promise<(Work & { origin: "orcid" | "manual" })[]> {
    const r = await this.db.all<WorkRow & { origin: "orcid" | "manual" }>(
      "SELECT w.*, o.origin FROM own_works o JOIN works w ON w.id = o.work_id WHERE w.deleted = 0 ORDER BY w.year DESC, w.title",
    );
    return r.map((x) => ({ ...rowToWork(x), origin: x.origin }));
  }

  /** Guarda el historial de citas de una publicación según una fuente (reemplaza el anterior). */
  async saveCitationHistory(workId: string, source: string, h: { total: number; byYear: Record<string, number> }): Promise<void> {
    await this.db.batch([
      {
        sql: `INSERT INTO citation_counts (work_id, source, total, by_year, fetched_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(work_id, source) DO UPDATE SET total = excluded.total, by_year = excluded.by_year, fetched_at = excluded.fetched_at`,
        params: [workId, source, Math.max(0, Math.round(h.total)), JSON.stringify(h.byYear ?? {}), now()],
      },
    ]);
  }

  async listCitationHistories(): Promise<{ workId: string; source: string; total: number; byYear: Record<string, number>; fetchedAt: string }[]> {
    const r = await this.db.all<{ work_id: string; source: string; total: number; by_year: string; fetched_at: string }>("SELECT * FROM citation_counts ORDER BY work_id, source");
    return r.map((x) => {
      let byYear: Record<string, number> = {};
      try {
        byYear = JSON.parse(x.by_year);
      } catch {
        /* dato dañado: se ignora el detalle por año */
      }
      return { workId: x.work_id, source: x.source, total: Number(x.total), byYear, fetchedAt: x.fetched_at };
    });
  }

  /** Personas con las que comparto proyectos (para el directorio de investigadores). */
  async listCollaborators(): Promise<{ memberId: string; displayName: string; projects: { id: string; name: string; role: Role }[] }[]> {
    const me = await this.getIdentity();
    if (!me) return [];
    const r = await this.db.all<{ member_id: string; display_name: string; project_id: string; name: string; role: Role }>(
      `SELECT m.member_id, m.display_name, p.id AS project_id, p.name, m.role
       FROM project_members m JOIN projects p ON p.id = m.project_id
       WHERE p.deleted = 0 AND m.member_id <> ?
         AND EXISTS (SELECT 1 FROM project_members mine WHERE mine.project_id = p.id AND mine.member_id = ?)
       ORDER BY m.display_name, p.name`,
      [me.id, me.id],
    );
    const by = new Map<string, { memberId: string; displayName: string; projects: { id: string; name: string; role: Role }[] }>();
    for (const x of r) {
      const e = by.get(x.member_id) ?? { memberId: x.member_id, displayName: x.display_name, projects: [] };
      e.projects.push({ id: x.project_id, name: x.name, role: x.role });
      by.set(x.member_id, e);
    }
    return [...by.values()];
  }

  // ---------------- Manuscritos (editor científico) ----------------

  // (El editor científico se retiró en la versión 1.1; la tabla `manuscripts` se conserva para no perder datos antiguos.)

  async libraryWorksStable(): Promise<Work[]> {
    const r = await this.db.all<WorkRow>(
      "SELECT w.* FROM library_items l JOIN works w ON w.id = l.work_id WHERE l.deleted = 0 AND w.deleted = 0 ORDER BY w.id",
    );
    return r.map(rowToWork);
  }

  // ---------------- Revisiones de literatura ----------------

  async saveReview(r: { id?: string; title: string; projectId?: string | null; question: unknown; filters: unknown }): Promise<string> {
    if (!r.title.trim()) throw new Error("La revisión necesita un título");
    const id = r.id ?? ulid();
    const t = now();
    await this.db.batch([
      {
        sql: `INSERT INTO reviews (id, title, project_id, question, filters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET title = excluded.title, project_id = excluded.project_id, question = excluded.question, filters = excluded.filters, updated_at = excluded.updated_at`,
        params: [id, r.title.trim(), r.projectId ?? null, JSON.stringify(r.question ?? {}), JSON.stringify(r.filters ?? {}), t, t],
      },
    ]);
    return id;
  }

  async listReviews(): Promise<{ id: string; title: string; projectId: string | null; searchedAt: string | null; updatedAt: string; total: number; included: number; pending: number }[]> {
    const r = await this.db.all<{ id: string; title: string; project_id: string | null; searched_at: string | null; updated_at: string; total: number; included: number; pending: number }>(
      `SELECT r.id, r.title, r.project_id, r.searched_at, r.updated_at,
              (SELECT COUNT(*) FROM review_records x WHERE x.review_id = r.id) AS total,
              (SELECT COUNT(*) FROM review_records x WHERE x.review_id = r.id AND x.decision = 'include') AS included,
              (SELECT COUNT(*) FROM review_records x WHERE x.review_id = r.id AND x.decision = 'pending') AS pending
       FROM reviews r WHERE r.deleted = 0 ORDER BY r.updated_at DESC`,
    );
    return r.map((x) => ({ id: x.id, title: x.title, projectId: x.project_id, searchedAt: x.searched_at, updatedAt: x.updated_at, total: Number(x.total), included: Number(x.included), pending: Number(x.pending) }));
  }

  async getReview(id: string): Promise<{ id: string; title: string; projectId: string | null; question: any; filters: any; runs: any[]; searchedAt: string | null } | null> {
    const r = await this.db.all<{ id: string; title: string; project_id: string | null; question: string; filters: string; runs: string; searched_at: string | null }>(
      "SELECT * FROM reviews WHERE id = ? AND deleted = 0",
      [id],
    );
    const x = r[0];
    if (!x) return null;
    const parse = (s: string, d: unknown) => {
      try {
        return JSON.parse(s);
      } catch {
        return d;
      }
    };
    return { id: x.id, title: x.title, projectId: x.project_id, question: parse(x.question, {}), filters: parse(x.filters, {}), runs: parse(x.runs, []), searchedAt: x.searched_at };
  }

  async deleteReview(id: string): Promise<void> {
    await this.db.batch([{ sql: "UPDATE reviews SET deleted = 1, updated_at = ? WHERE id = ?", params: [now(), id] }]);
  }

  /**
   * Guarda el resultado de una búsqueda: las publicaciones (sin duplicar) quedan como registros por cribar.
   * Las decisiones ya tomadas se conservan si la publicación vuelve a aparecer.
   */
  async setReviewResults(reviewId: string, runs: unknown[], works: (Work & { foundIn?: string[] })[]): Promise<{ added: number; kept: number }> {
    const prev = new Set((await this.db.all<{ work_id: string }>("SELECT work_id FROM review_records WHERE review_id = ?", [reviewId])).map((r) => r.work_id));
    let added = 0;
    let kept = 0;
    const stmts: Statement[] = [];
    let pos = 0;
    for (const w of works) {
      const { id } = await this.upsertWork(w);
      pos++;
      if (prev.has(id)) {
        kept++;
        stmts.push({ sql: "UPDATE review_records SET found_in = ?, position = ? WHERE review_id = ? AND work_id = ?", params: [(w.foundIn ?? []).join(","), pos, reviewId, id] });
      } else {
        added++;
        prev.add(id);
        stmts.push({ sql: "INSERT OR IGNORE INTO review_records (review_id, work_id, found_in, position) VALUES (?, ?, ?, ?)", params: [reviewId, id, (w.foundIn ?? []).join(","), pos] });
      }
    }
    const t = now();
    stmts.push({ sql: "UPDATE reviews SET runs = ?, searched_at = ?, updated_at = ? WHERE id = ?", params: [JSON.stringify(runs), t, t, reviewId] });
    await this.db.batch(stmts);
    return { added, kept };
  }

  async listReviewRecords(reviewId: string): Promise<{ work: Work; decision: "pending" | "include" | "exclude"; reason: string | null; foundIn: string[] }[]> {
    const r = await this.db.all<WorkRow & { decision: "pending" | "include" | "exclude"; reason: string | null; found_in: string }>(
      `SELECT w.*, x.decision, x.reason, x.found_in FROM review_records x JOIN works w ON w.id = x.work_id
       WHERE x.review_id = ? ORDER BY x.position, w.id`,
      [reviewId],
    );
    return r.map((x) => ({ work: rowToWork(x), decision: x.decision, reason: x.reason, foundIn: x.found_in ? x.found_in.split(",") : [] }));
  }

  async setReviewDecision(reviewId: string, workId: string, decision: "pending" | "include" | "exclude", reason: string | null = null): Promise<void> {
    if (decision === "exclude" && !reason) throw new Error("Indique el motivo de exclusión");
    await this.db.batch([
      {
        sql: "UPDATE review_records SET decision = ?, reason = ?, decided_at = ? WHERE review_id = ? AND work_id = ?",
        params: [decision, decision === "exclude" ? reason : null, decision === "pending" ? null : now(), reviewId, workId],
      },
      { sql: "UPDATE reviews SET updated_at = ? WHERE id = ?", params: [now(), reviewId] },
    ]);
  }

  // ---------------- Conjuntos de datos (estadística) ----------------

  async saveDataset(input: { id?: string; name: string; content: string; projectId?: string | null }): Promise<string> {
    if (!input.name.trim()) throw new Error("El conjunto de datos necesita un nombre");
    const id = input.id ?? ulid();
    const t = now();
    await this.db.batch([
      {
        sql: `INSERT INTO datasets (id, name, project_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, project_id = excluded.project_id, content = excluded.content, updated_at = excluded.updated_at`,
        params: [id, input.name.trim(), input.projectId ?? null, input.content, t, t],
      },
    ]);
    return id;
  }

  async listDatasets(): Promise<{ id: string; name: string; projectId: string | null; updatedAt: string; size: number }[]> {
    const r = await this.db.all<{ id: string; name: string; project_id: string | null; updated_at: string; size: number }>(
      "SELECT id, name, project_id, updated_at, length(content) AS size FROM datasets ORDER BY updated_at DESC",
    );
    return r.map((x) => ({ id: x.id, name: x.name, projectId: x.project_id, updatedAt: x.updated_at, size: Number(x.size) }));
  }

  async getDataset(id: string): Promise<{ id: string; name: string; projectId: string | null; content: string } | null> {
    const r = await this.db.all<{ id: string; name: string; project_id: string | null; content: string }>("SELECT * FROM datasets WHERE id = ?", [id]);
    return r[0] ? { id: r[0].id, name: r[0].name, projectId: r[0].project_id, content: r[0].content } : null;
  }

  async deleteDataset(id: string): Promise<void> {
    await this.db.batch([{ sql: "DELETE FROM datasets WHERE id = ?", params: [id] }]);
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

  /**
   * Cambia el identificador de un proyecto que todavía no se compartió (proyectos creados antes de la
   * Fase 11). Todo en una transacción: si algo falla, el proyecto queda como estaba.
   */
  async rekeyProject(oldId: string, newId: string): Promise<void> {
    const p = await this.db.all<{ visibility: string }>("SELECT visibility FROM projects WHERE id = ?", [oldId]);
    if (!p[0]) throw new Error("El proyecto no existe");
    if (p[0].visibility === "shared") throw new Error("Un proyecto compartido no puede cambiar de identificador");
    const ev = await this.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM sync_events WHERE project_id = ?", [oldId]);
    if (Number(ev[0]?.n ?? 0) > 0) throw new Error("El proyecto ya tiene eventos de sincronización");
    // Todas las tablas con una columna project_id que apunta a projects(id) (migraciones 4, 5 y 6).
    // Si falta alguna, el DELETE final rompe la clave foránea y el proyecto no se puede compartir.
    const children = ["project_members", "project_works", "collections", "datasets", "manuscripts", "reviews", "events"];
    await this.db.batch([
      {
        sql: `INSERT INTO projects (id, name, description, objectives, owner_id, visibility, created_at, updated_at, hlc, deleted)
              SELECT ?, name, description, objectives, owner_id, visibility, created_at, updated_at, hlc, deleted FROM projects WHERE id = ?`,
        params: [newId, oldId],
      },
      ...children.map((t) => ({ sql: `UPDATE ${t} SET project_id = ? WHERE project_id = ?`, params: [newId, oldId] })),
      { sql: "UPDATE notes SET entity_id = ? WHERE entity = 'project' AND entity_id = ?", params: [newId, oldId] },
      { sql: "DELETE FROM projects WHERE id = ?", params: [oldId] },
    ]);
  }

  async createProject(input: { name: string; description?: string; objectives?: string }): Promise<string> {
    const me = await this.getIdentity();
    if (!me) throw new Error("Primero se debe crear la identidad local");
    if (!input.name.trim()) throw new Error("El proyecto necesita un nombre");
    const id = this.projectIdFactory ? await this.projectIdFactory() : ulid();
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
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !["name", "description", "objectives"].includes(k)) continue;
      await this.emit(id, { type: "project.update", field: k as "name", value: String(v) });
    }
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
    const w = await this.getWork(workId);
    if (w) await this.emit(projectId, { type: "work.add", work: w });
  }

  async removeWorkFromProject(projectId: string, workId: string): Promise<void> {
    await this.requireRole(projectId, ["admin", "editor"]);
    await this.db.batch([{ sql: "DELETE FROM project_works WHERE project_id = ? AND work_id = ?", params: [projectId, workId] }]);
    const w = await this.getWork(workId);
    if (w) await this.emit(projectId, { type: "work.remove", work: w });
  }

  /** Borra el proyecto en esta computadora. Si es compartido, además lo archiva para todos. */
  async deleteProject(projectId: string): Promise<void> {
    await this.requireRole(projectId, ["admin"]);
    await this.emit(projectId, { type: "project.archive" });
    await this.db.batch([{ sql: "UPDATE projects SET deleted = 1, updated_at = ? WHERE id = ?", params: [now(), projectId] }]);
  }

  /** Publicaciones de un proyecto (estén o no en la biblioteca personal). */
  async listProjectWorks(projectId: string): Promise<Work[]> {
    const r = await this.db.all<WorkRow>(
      "SELECT w.* FROM project_works p JOIN works w ON w.id = p.work_id WHERE p.project_id = ? AND w.deleted = 0 ORDER BY p.added_at DESC, w.id",
      [projectId],
    );
    return r.map(rowToWork);
  }

  // ---------------- Sincronización ----------------

  async getKeys(): Promise<{ publicKey: string; secretKey: string } | null> {
    const me = await this.getIdentity();
    if (!me) return null;
    const r = await this.db.all<{ public_key: string; secret_key: string }>("SELECT public_key, secret_key FROM identity_keys WHERE identity_id = ?", [me.id]);
    return r[0] ? { publicKey: r[0].public_key, secretKey: r[0].secret_key } : null;
  }

  async saveKeys(keys: { publicKey: string; secretKey: string }): Promise<void> {
    const me = await this.getIdentity();
    if (!me) throw new Error("Primero se debe crear la identidad local");
    await this.db.batch([
      { sql: "INSERT INTO identity_keys (identity_id, public_key, secret_key, created_at) VALUES (?, ?, ?, ?)", params: [me.id, keys.publicKey, keys.secretKey, now()] },
      { sql: "UPDATE identity SET public_key = ? WHERE id = ?", params: [keys.publicKey, me.id] },
    ]);
  }

  async markProjectShared(projectId: string): Promise<void> {
    await this.db.batch([{ sql: "UPDATE projects SET visibility = 'shared', updated_at = ? WHERE id = ?", params: [now(), projectId] }]);
  }

  /** Guarda eventos nuevos (ignora los que ya existen). Devuelve los ids realmente nuevos. */
  async insertSyncEvents(events: StoredSyncEvent[]): Promise<string[]> {
    const fresh: StoredSyncEvent[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < events.length; i += 200) {
      const chunk = events.slice(i, i + 200);
      const have = await this.db.all<{ id: string }>(`SELECT id FROM sync_events WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk.map((e) => e.id));
      const haveSet = new Set(have.map((h) => h.id));
      for (const e of chunk) if (!haveSet.has(e.id) && !seen.has(e.id)) { fresh.push(e); seen.add(e.id); }
    }
    if (fresh.length === 0) return [];
    const t = now();
    await this.db.batch(
      fresh.map((e) => ({
        sql: "INSERT OR IGNORE INTO sync_events (id, project_id, author_id, device_id, hlc, type, raw, local, exported, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
        params: [e.id, e.projectId, e.authorId, e.deviceId, e.hlc, e.type, e.raw, e.local ? 1 : 0, t],
      })),
    );
    return fresh.map((e) => e.id);
  }

  async syncEventsRaw(projectId: string): Promise<string[]> {
    const r = await this.db.all<{ raw: string }>("SELECT raw FROM sync_events WHERE project_id = ? ORDER BY hlc, id", [projectId]);
    return r.map((x) => x.raw);
  }

  async syncProjectIds(): Promise<string[]> {
    const r = await this.db.all<{ project_id: string }>("SELECT DISTINCT project_id FROM sync_events ORDER BY project_id");
    return r.map((x) => x.project_id);
  }

  /** Eventos creados en esta computadora que aún no se escribieron en la carpeta de sincronización. */
  async unexportedLocalEvents(): Promise<{ id: string; projectId: string; raw: string }[]> {
    const r = await this.db.all<{ id: string; project_id: string; raw: string }>("SELECT id, project_id, raw FROM sync_events WHERE local = 1 AND exported = 0 ORDER BY hlc, id");
    return r.map((x) => ({ id: x.id, projectId: x.project_id, raw: x.raw }));
  }

  async markExported(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.batch(ids.map((id) => ({ sql: "UPDATE sync_events SET exported = 1 WHERE id = ?", params: [id] })));
  }

  async setSyncEventStatuses(items: { id: string; status: "accepted" | "rejected"; reason?: string | null }[]): Promise<void> {
    if (items.length === 0) return;
    await this.db.batch(items.map((x) => ({ sql: "UPDATE sync_events SET status = ?, reason = ? WHERE id = ?", params: [x.status, x.reason ?? null, x.id] })));
  }

  async syncEventCounts(): Promise<{ total: number; pendingExport: number; rejected: number }> {
    const r = await this.db.all<{ total: number; pe: number; rj: number }>(
      "SELECT COUNT(*) AS total, COALESCE(SUM(local = 1 AND exported = 0), 0) AS pe, COALESCE(SUM(status = 'rejected'), 0) AS rj FROM sync_events",
    );
    return { total: Number(r[0]?.total ?? 0), pendingExport: Number(r[0]?.pe ?? 0), rejected: Number(r[0]?.rj ?? 0) };
  }

  async addSyncLog(e: { peer?: string | null; direction: string; count: number; status: string; detail?: string | null }): Promise<void> {
    await this.db.batch([
      { sql: "INSERT INTO sync_log (id, peer, direction, events_count, status, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [ulid(), e.peer ? redact(e.peer) : null, e.direction, e.count, e.status, e.detail ? redact(e.detail).slice(0, 2000) : null, now()] },
    ]);
  }

  async listSyncLog(limit = 30): Promise<SyncLogEntry[]> {
    const r = await this.db.all<{ id: string; peer: string | null; direction: string; events_count: number; status: string; detail: string | null; at: string }>(
      "SELECT * FROM sync_log ORDER BY at DESC, id DESC LIMIT ?",
      [limit],
    );
    return r.map((x) => ({ id: x.id, peer: x.peer, direction: x.direction, count: Number(x.events_count), status: x.status, detail: x.detail, at: x.at }));
  }

  /**
   * Reemplaza los datos locales de un proyecto compartido por el estado calculado de sus eventos.
   * Si la identidad local no es miembro, el proyecto se oculta (o no se crea).
   */
  async materializeProject(p: MaterializedProject): Promise<void> {
    const me = await this.getIdentity();
    if (!me) return;
    const isMember = p.members.some((m) => m.memberId === me.id);
    const exists = (await this.db.all("SELECT 1 FROM projects WHERE id = ?", [p.id])).length > 0;
    if (!isMember) {
      if (exists) await this.db.batch([{ sql: "UPDATE projects SET deleted = 1 WHERE id = ? AND visibility = 'shared'", params: [p.id] }]);
      return;
    }
    const workIds: string[] = [];
    for (const w of p.works) workIds.push((await this.upsertWork({ ...w, id: undefined })).id);
    const t = now();
    const stmts: Statement[] = [
      {
        sql: `INSERT INTO projects (id, name, description, objectives, owner_id, visibility, created_at, updated_at, deleted) VALUES (?, ?, ?, ?, ?, 'shared', ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, objectives = excluded.objectives,
              owner_id = excluded.owner_id, visibility = 'shared', updated_at = excluded.updated_at, deleted = excluded.deleted`,
        params: [p.id, p.name, p.description, p.objectives, p.ownerId, t, t, p.archived ? 1 : 0],
      },
      { sql: "DELETE FROM project_members WHERE project_id = ?", params: [p.id] },
      ...p.members.map((m) => ({
        sql: "INSERT INTO project_members (project_id, member_id, display_name, role, added_at) VALUES (?, ?, ?, ?, ?)",
        params: [p.id, m.memberId, m.displayName, m.role, t],
      })),
      { sql: "DELETE FROM project_works WHERE project_id = ?", params: [p.id] },
      ...[...new Set(workIds)].map((wid) => ({ sql: "INSERT OR IGNORE INTO project_works (project_id, work_id, added_at) VALUES (?, ?, ?)", params: [p.id, wid, t] })),
      { sql: "DELETE FROM notes WHERE entity = 'project' AND entity_id = ?", params: [p.id] },
      ...p.notes.map((n) => {
        const at = hlcIso(n.hlc) ?? t;
        return {
          sql: "INSERT OR REPLACE INTO notes (id, entity, entity_id, body, author_id, created_at, updated_at) VALUES (?, 'project', ?, ?, ?, ?, ?)",
          params: [n.noteId, p.id, n.body, n.author, at, at],
        };
      }),
    ];
    await this.db.batch(stmts);
  }

  // ---------------- Importación ----------------

  /**
   * Agrega publicaciones importadas (BibTeX, RIS, EndNote) a la biblioteca sin duplicarlas.
   * Devuelve cuántas eran nuevas y cuántas ya existían (se completan sus datos).
   */
  async importWorks(works: Work[], opts: { collectionId?: string; projectId?: string } = {}): Promise<{ created: number; merged: number; ids: string[] }> {
    let created = 0;
    let merged = 0;
    const ids: string[] = [];
    for (const w of works) {
      const r = await this.upsertWork(w);
      if (r.created) created++;
      else merged++;
      ids.push(r.id);
      await this.addToLibrary(r.id);
      if (opts.collectionId) await this.addToCollection(opts.collectionId, r.id);
      if (opts.projectId) await this.addWorkToProject(opts.projectId, r.id);
    }
    return { created, merged, ids };
  }

  /** Publicaciones por id, en el orden pedido (para exportar una selección). */
  async worksByIds(ids: string[]): Promise<Work[]> {
    const out: Work[] = [];
    for (const id of ids) {
      const w = await this.getWork(id);
      if (w) out.push(w);
    }
    return out;
  }

  // ---------------- Copias de seguridad ----------------

  /** Copia completa de los datos locales en un objeto JSON portable (Windows ↔ web). */
  async exportBackup(opts: { includePdfs?: boolean } = {}): Promise<Backup> {
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const t of BACKUP_TABLES) {
      if (t === "attachment_data" && opts.includePdfs === false) {
        tables[t] = [];
        continue;
      }
      tables[t] = await this.db.all(`SELECT * FROM ${t}`);
    }
    // Claves de servicios externos del usuario: no viajan en las copias (se vuelven a pegar si hace falta)
    tables.settings = (tables.settings ?? []).filter((r) => !SECRET_SETTINGS.includes(String(r.key)));
    const v = await this.db.all<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations");
    return { format: BACKUP_FORMAT, schemaVersion: Number(v[0]?.v ?? 0), createdAt: now(), app: "BioCiencia", tables };
  }

  /**
   * Restaura una copia reemplazando TODOS los datos locales, en una sola transacción:
   * si algo falla, los datos actuales quedan intactos.
   */
  async restoreBackup(input: unknown): Promise<{ rows: number }> {
    const b = input as Partial<Backup> | null;
    if (!b || b.format !== BACKUP_FORMAT || typeof b.tables !== "object" || !b.tables) throw new Error("El archivo no es una copia de seguridad de BioCiencia.");
    const current = await this.db.all<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations");
    if (Number(b.schemaVersion) > Number(current[0]?.v ?? 0)) throw new Error("La copia fue hecha con una versión más nueva de BioCiencia. Actualice la aplicación antes de restaurar.");
    const stmts: Statement[] = [];
    for (const t of [...BACKUP_TABLES].reverse()) stmts.push({ sql: `DELETE FROM ${t}` });
    stmts.push({ sql: "DELETE FROM works_fts" });
    stmts.push({ sql: "DELETE FROM attachments_fts" });
    let rows = 0;
    for (const t of BACKUP_TABLES) {
      const cols = new Set((await this.db.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
      for (const row of b.tables[t] ?? []) {
        const keys = Object.keys(row).filter((k) => cols.has(k));
        if (keys.length === 0) continue;
        stmts.push({
          sql: `INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
          params: keys.map((k) => {
            const v = (row as Record<string, unknown>)[k];
            return v === null || v === undefined ? null : typeof v === "number" ? v : String(v);
          }),
        });
        rows++;
      }
    }
    for (const w of (b.tables.works ?? []) as unknown as WorkRow[]) {
      if (!w?.id) continue;
      stmts.push(...ftsStatements(w.id, rowToWork(w)));
    }
    for (const a of (b.tables.attachments ?? []) as { id?: string; work_id?: string; text?: string; deleted?: number }[]) {
      if (a?.id && !a.deleted) stmts.push({ sql: "INSERT INTO attachments_fts (attachment_id, work_id, text) VALUES (?, ?, ?)", params: [a.id, String(a.work_id), String(a.text ?? "")] });
    }
    // Si la copia se restaura en otra computadora, esta debe tener su propio id de dispositivo:
    // dos equipos con el mismo id escribirían en el mismo archivo de sincronización.
    stmts.push({ sql: "UPDATE devices SET id = ? WHERE is_local = 1", params: [ulid()] });
    stmts.push({ sql: "UPDATE sync_events SET exported = 0 WHERE local = 1" });
    stmts.push({ sql: "DELETE FROM settings WHERE key IN ('sync_hlc')" });
    await this.db.batch(stmts);
    return { rows };
  }

  // ---------------- Alertas de búsquedas ----------------

  /** Sigue una búsqueda. `baseline` son las publicaciones que ya se vieron (no cuentan como nuevas). */
  async createAlert(input: { query: string; label?: string; params?: unknown; baseline: Work[] }): Promise<string> {
    const q = input.query.trim();
    if (!q) throw new Error("La búsqueda está vacía.");
    const dup = await this.db.all<{ id: string }>("SELECT id FROM alerts WHERE query = ?", [q]);
    if (dup[0]) return dup[0].id;
    const id = ulid();
    const keys = [...new Set(input.baseline.map((w) => workKeys(normalizeWork(w))[0]!).map((k) => `${k.kind}:${k.value}`))];
    await this.db.batch([{
      sql: "INSERT INTO alerts (id, query, label, params, seen_keys, last_checked, last_new, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
      params: [id, q, (input.label ?? q).slice(0, 200), JSON.stringify(input.params ?? {}), JSON.stringify(keys), now(), now()],
    }]);
    return id;
  }

  async listAlerts(): Promise<Alert[]> {
    const r = await this.db.all<{ id: string; query: string; label: string; params: string; last_checked: string | null; last_new: number; created_at: string; unseen: number }>(
      `SELECT a.*, (SELECT COUNT(*) FROM alert_items i WHERE i.alert_id = a.id AND i.seen = 0) AS unseen FROM alerts a ORDER BY a.created_at`,
    );
    return r.map((x) => ({ id: x.id, query: x.query, label: x.label, params: JSON.parse(x.params || "{}"), lastChecked: x.last_checked, lastNew: Number(x.last_new), unseen: Number(x.unseen), createdAt: x.created_at }));
  }

  /**
   * Registra el resultado de revisar una alerta: guarda las publicaciones que no se habían visto
   * y devuelve cuántas son nuevas.
   */
  async recordAlertCheck(alertId: string, works: Work[]): Promise<{ newIds: string[] }> {
    const r = await this.db.all<{ seen_keys: string }>("SELECT seen_keys FROM alerts WHERE id = ?", [alertId]);
    if (!r[0]) throw new Error("La alerta no existe.");
    const seen = new Set<string>(JSON.parse(r[0].seen_keys || "[]"));
    const newIds: string[] = [];
    for (const w of works) {
      const n = normalizeWork(w);
      const k = workKeys(n)[0]!;
      const key = `${k.kind}:${k.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { id } = await this.upsertWork(n);
      newIds.push(id);
    }
    const t = now();
    const keep = [...seen].slice(-5000);
    await this.db.batch([
      ...newIds.map((id) => ({ sql: "INSERT OR IGNORE INTO alert_items (alert_id, work_id, found_at, seen) VALUES (?, ?, ?, 0)", params: [alertId, id, t] as SqlValue[] })),
      { sql: "UPDATE alerts SET seen_keys = ?, last_checked = ?, last_new = ? WHERE id = ?", params: [JSON.stringify(keep), t, newIds.length, alertId] },
    ]);
    return { newIds };
  }

  async alertItems(alertId: string, onlyUnseen = false): Promise<{ work: Work; foundAt: string; seen: boolean }[]> {
    const r = await this.db.all<WorkRow & { found_at: string; seen: number }>(
      `SELECT w.*, i.found_at, i.seen FROM alert_items i JOIN works w ON w.id = i.work_id WHERE i.alert_id = ? ${onlyUnseen ? "AND i.seen = 0" : ""} ORDER BY i.found_at DESC, w.year DESC LIMIT 200`,
      [alertId],
    );
    return r.map((x) => ({ work: rowToWork(x), foundAt: x.found_at, seen: Number(x.seen) === 1 }));
  }

  async markAlertSeen(alertId: string): Promise<void> {
    await this.db.batch([{ sql: "UPDATE alert_items SET seen = 1 WHERE alert_id = ?", params: [alertId] }]);
  }

  async deleteAlert(alertId: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM alert_items WHERE alert_id = ?", params: [alertId] },
      { sql: "DELETE FROM alerts WHERE id = ?", params: [alertId] },
    ]);
  }

  // ---------------- Retracciones ----------------

  /** Guarda el resultado de revisar retracciones (null = revisado y sin avisos). */
  async setRetractions(items: { workId: string; retraction: Work["retraction"] }[]): Promise<void> {
    if (!items.length) return;
    await this.db.batch(items.map((i) => ({ sql: "UPDATE works SET retraction = ? WHERE id = ?", params: [i.retraction ? JSON.stringify(i.retraction) : null, i.workId] })));
    await this.setSetting("retractions_checked_at", now());
  }

  // ---------------- PDF adjuntos y subrayados ----------------

  async addAttachment(input: { workId: string; filename: string; base64: string; size: number; sha256: string; pages: number | null; text: string }): Promise<{ id: string; duplicate: boolean }> {
    if (input.size > MAX_PDF_BYTES) throw new Error(`El PDF pesa ${(input.size / 1048576).toFixed(1)} MB; el máximo es ${MAX_PDF_BYTES / 1048576} MB.`);
    const same = await this.db.all<{ id: string }>("SELECT id FROM attachments WHERE work_id = ? AND sha256 = ? AND deleted = 0", [input.workId, input.sha256]);
    if (same[0]) return { id: same[0].id, duplicate: true };
    const id = ulid();
    const filename = input.filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 200) || "documento.pdf";
    await this.db.batch([
      {
        sql: "INSERT INTO attachments (id, work_id, filename, mime, size, sha256, pages, text, created_at) VALUES (?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?)",
        params: [id, input.workId, filename, input.size, input.sha256, input.pages, input.text, now()],
      },
      { sql: "INSERT INTO attachment_data (attachment_id, data) VALUES (?, ?)", params: [id, input.base64] },
      { sql: "INSERT INTO attachments_fts (attachment_id, work_id, text) VALUES (?, ?, ?)", params: [id, input.workId, input.text] },
    ]);
    return { id, duplicate: false };
  }

  async listAttachments(workId: string): Promise<Attachment[]> {
    const r = await this.db.all<{ id: string; work_id: string; filename: string; size: number; sha256: string; pages: number | null; created_at: string; n: number }>(
      `SELECT a.id, a.work_id, a.filename, a.size, a.sha256, a.pages, a.created_at,
              (SELECT COUNT(*) FROM annotations n WHERE n.attachment_id = a.id) AS n
       FROM attachments a WHERE a.work_id = ? AND a.deleted = 0 ORDER BY a.created_at`,
      [workId],
    );
    return r.map((x) => ({ id: x.id, workId: x.work_id, filename: x.filename, size: Number(x.size), sha256: x.sha256, pages: x.pages === null ? null : Number(x.pages), createdAt: x.created_at, annotationCount: Number(x.n) }));
  }

  async attachmentData(id: string): Promise<string | null> {
    const r = await this.db.all<{ data: string }>("SELECT d.data FROM attachment_data d JOIN attachments a ON a.id = d.attachment_id WHERE d.attachment_id = ? AND a.deleted = 0", [id]);
    return r[0]?.data ?? null;
  }

  async attachmentText(workId: string): Promise<string> {
    const r = await this.db.all<{ text: string }>("SELECT text FROM attachments WHERE work_id = ? AND deleted = 0 ORDER BY created_at", [workId]);
    return r.map((x) => x.text).filter(Boolean).join("\n\n");
  }

  /** Textos de los PDF de varias publicaciones (para el análisis con IA). */
  async attachmentTexts(workIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < workIds.length; i += 200) {
      const ids = workIds.slice(i, i + 200);
      const r = await this.db.all<{ work_id: string; text: string }>(
        `SELECT work_id, text FROM attachments WHERE deleted = 0 AND text <> '' AND work_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at`,
        ids,
      );
      for (const x of r) out.set(x.work_id, out.has(x.work_id) ? `${out.get(x.work_id)}\n\n${x.text}` : x.text);
    }
    return out;
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM annotations WHERE attachment_id = ?", params: [id] },
      { sql: "DELETE FROM attachment_data WHERE attachment_id = ?", params: [id] },
      { sql: "DELETE FROM attachments_fts WHERE attachment_id = ?", params: [id] },
      { sql: "DELETE FROM attachments WHERE id = ?", params: [id] },
    ]);
  }

  async pdfStorageSize(): Promise<{ count: number; bytes: number }> {
    const r = await this.db.all<{ n: number; b: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM attachments WHERE deleted = 0");
    return { count: Number(r[0]?.n ?? 0), bytes: Number(r[0]?.b ?? 0) };
  }

  async addAnnotation(a: Omit<Annotation, "id" | "createdAt" | "updatedAt">): Promise<string> {
    const id = ulid();
    const t = now();
    await this.db.batch([
      {
        sql: "INSERT INTO annotations (id, attachment_id, page, rects, quote, note, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [id, a.attachmentId, a.page, JSON.stringify(a.rects), a.quote, a.note, a.color, t, t],
      },
    ]);
    return id;
  }

  async updateAnnotation(id: string, patch: { note?: string; color?: AnnotationColor }): Promise<void> {
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (patch.note !== undefined) { sets.push("note = ?"); params.push(patch.note); }
    if (patch.color !== undefined) { sets.push("color = ?"); params.push(patch.color); }
    if (!sets.length) return;
    sets.push("updated_at = ?");
    params.push(now(), id);
    await this.db.batch([{ sql: `UPDATE annotations SET ${sets.join(", ")} WHERE id = ?`, params }]);
  }

  async deleteAnnotation(id: string): Promise<void> {
    await this.db.batch([{ sql: "DELETE FROM annotations WHERE id = ?", params: [id] }]);
  }

  async listAnnotations(attachmentId: string): Promise<Annotation[]> {
    const r = await this.db.all<{ id: string; attachment_id: string; page: number; rects: string; quote: string; note: string; color: string; created_at: string; updated_at: string }>(
      "SELECT * FROM annotations WHERE attachment_id = ? ORDER BY page, created_at",
      [attachmentId],
    );
    return r.map((x) => ({
      id: x.id, attachmentId: x.attachment_id, page: Number(x.page), rects: JSON.parse(x.rects || "[]"), quote: x.quote, note: x.note,
      color: x.color as AnnotationColor, createdAt: x.created_at, updatedAt: x.updated_at,
    }));
  }

  // ---------------- Estilos de cita CSL guardados ----------------

  async getCslStyle(id: string): Promise<string | null> {
    const r = await this.db.all<{ xml: string }>("SELECT xml FROM csl_styles WHERE id = ?", [id]);
    return r[0]?.xml ?? null;
  }

  async saveCslStyle(id: string, title: string, xml: string, origin: "descargado" | "importado"): Promise<void> {
    await this.db.batch([{ sql: "INSERT OR REPLACE INTO csl_styles (id, title, xml, origin, saved_at) VALUES (?, ?, ?, ?, ?)", params: [id, title, xml, origin, now()] }]);
  }

  async listCslStyles(): Promise<{ id: string; title: string; origin: string; savedAt: string }[]> {
    const r = await this.db.all<{ id: string; title: string; origin: string; saved_at: string }>("SELECT id, title, origin, saved_at FROM csl_styles ORDER BY title");
    return r.map((x) => ({ id: x.id, title: x.title, origin: x.origin, savedAt: x.saved_at }));
  }

  async deleteCslStyle(id: string): Promise<void> {
    await this.db.batch([{ sql: "DELETE FROM csl_styles WHERE id = ?", params: [id] }]);
  }

  // ---------------- Grupos inteligentes ----------------

  async saveSmartGroup(g: { id?: string; name: string; rules: unknown }): Promise<string> {
    const name = g.name.trim();
    if (!name) throw new Error("El grupo necesita un nombre.");
    const t = now();
    if (g.id) {
      await this.db.batch([{ sql: "UPDATE smart_groups SET name = ?, rules = ?, updated_at = ? WHERE id = ?", params: [name, JSON.stringify(g.rules), t, g.id] }]);
      return g.id;
    }
    const id = ulid();
    await this.db.batch([{ sql: "INSERT INTO smart_groups (id, name, rules, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", params: [id, name, JSON.stringify(g.rules), t, t] }]);
    return id;
  }

  async listSmartGroups(): Promise<SmartGroup[]> {
    const r = await this.db.all<{ id: string; name: string; rules: string; created_at: string; updated_at: string }>("SELECT * FROM smart_groups ORDER BY name");
    return r.map((x) => ({ id: x.id, name: x.name, rules: JSON.parse(x.rules), createdAt: x.created_at, updatedAt: x.updated_at }));
  }

  async deleteSmartGroup(id: string): Promise<void> {
    await this.db.batch([{ sql: "DELETE FROM smart_groups WHERE id = ?", params: [id] }]);
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
    if (entity === "project") await this.emit(entityId, { type: "note.add", noteId: id, body: body.trim() });
    return id;
  }

  async deleteNote(id: string): Promise<void> {
    const r = await this.db.all<{ entity: string; entity_id: string }>("SELECT entity, entity_id FROM notes WHERE id = ?", [id]);
    await this.db.batch([{ sql: "UPDATE notes SET deleted = 1, updated_at = ? WHERE id = ?", params: [now(), id] }]);
    if (r[0]?.entity === "project") await this.emit(r[0].entity_id, { type: "note.delete", noteId: id });
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

function hlcIso(hlc: string): string | null {
  const ms = Number(hlc.slice(0, 13));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
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
