/**
 * Migraciones del esquema. Nunca se edita una migración ya publicada:
 * los cambios se agregan como una versión nueva al final de la lista.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "inicial",
    sql: /* sql */ `
CREATE TABLE identity (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  public_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  identity_id TEXT REFERENCES identity(id),
  name TEXT,
  public_key TEXT,
  is_local INTEGER NOT NULL DEFAULT 0,
  authorized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Publicaciones conocidas (resultados de búsqueda y biblioteca)
CREATE TABLE works (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]',
  year INTEGER,
  venue TEXT,
  doi TEXT,
  pmid TEXT,
  openalex_id TEXT,
  arxiv_id TEXT,
  abstract TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  type TEXT,
  language TEXT,
  cited_by_count INTEGER,
  is_oa INTEGER,
  oa_url TEXT,
  landing_url TEXT,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  hlc TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX works_year ON works(year);

-- Todas las formas de reconocer una publicación (DOI, PMID, OpenAlex, arXiv, título)
CREATE TABLE work_ids (
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  work_id TEXT NOT NULL REFERENCES works(id),
  PRIMARY KEY (kind, value)
);
CREATE INDEX work_ids_work ON work_ids(work_id);

-- Registro de qué fuente aportó datos y cuándo
CREATE TABLE sources_log (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id),
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX sources_log_work ON sources_log(work_id);

-- Índice de texto completo (sin acentos) para buscar dentro de lo guardado
CREATE VIRTUAL TABLE works_fts USING fts5(
  work_id UNINDEXED, title, authors, abstract, venue, keywords,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Historial de búsquedas
CREATE TABLE searches (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  total_hits INTEGER,
  result_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE search_results (
  search_id TEXT NOT NULL REFERENCES searches(id),
  work_id TEXT NOT NULL REFERENCES works(id),
  rank INTEGER NOT NULL,
  PRIMARY KEY (search_id, work_id)
);

-- Biblioteca personal
CREATE TABLE library_items (
  work_id TEXT PRIMARY KEY REFERENCES works(id),
  favorite INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE tags (
  work_id TEXT NOT NULL REFERENCES works(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (work_id, tag)
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared', 'project')),
  project_id TEXT REFERENCES projects(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id),
  work_id TEXT NOT NULL REFERENCES works(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, work_id)
);

-- Proyectos de investigación
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  objectives TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  hlc TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id),
  member_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'reader')),
  added_at TEXT NOT NULL,
  PRIMARY KEY (project_id, member_id)
);
CREATE TABLE project_works (
  project_id TEXT NOT NULL REFERENCES projects(id),
  work_id TEXT NOT NULL REFERENCES works(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY (project_id, work_id)
);

-- Notas sobre cualquier entidad (artículo, proyecto…)
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX notes_entity ON notes(entity, entity_id);

-- Archivos (PDF) identificados por su huella SHA-256
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  license TEXT,
  work_id TEXT REFERENCES works(id),
  created_at TEXT NOT NULL
);

-- Sincronización (se usa a partir de la Fase 5)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  project_id TEXT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  hlc TEXT NOT NULL,
  prev TEXT,
  sig TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX events_hlc ON events(hlc);
CREATE INDEX events_project ON events(project_id, hlc);
CREATE TABLE sync_peers (
  device_id TEXT PRIMARY KEY,
  name TEXT,
  public_key TEXT,
  authorized INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT
);
CREATE TABLE sync_log (
  id TEXT PRIMARY KEY,
  peer TEXT,
  direction TEXT NOT NULL,
  events_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: "sincronizacion",
    sql: /* sql */ `
-- Llaves Ed25519 de la identidad local (la privada nunca sale de esta computadora,
-- salvo dentro de una copia de seguridad que el usuario decide crear).
CREATE TABLE identity_keys (
  identity_id TEXT PRIMARY KEY REFERENCES identity(id),
  public_key TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Eventos firmados de proyectos compartidos (el texto original se guarda tal cual en raw)
CREATE TABLE sync_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  hlc TEXT NOT NULL,
  type TEXT NOT NULL,
  raw TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reason TEXT,
  local INTEGER NOT NULL DEFAULT 0,
  exported INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
CREATE INDEX sync_events_project ON sync_events(project_id, hlc);
CREATE INDEX sync_events_export ON sync_events(local, exported);
`,
  },
];

import type { SqlDriver, Statement } from "./driver.ts";

export async function migrate(driver: SqlDriver): Promise<number[]> {
  await driver.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const done = new Set((await driver.all<{ version: number }>("SELECT version FROM schema_migrations")).map((r) => Number(r.version)));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    const statements: Statement[] = splitSql(m.sql).map((sql) => ({ sql }));
    statements.push({
      sql: "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      params: [m.version, m.name, new Date().toISOString()],
    });
    await driver.batch(statements);
    applied.push(m.version);
  }
  return applied;
}

/** Divide un script SQL en sentencias (no hay ';' dentro de cadenas en nuestras migraciones). */
export function splitSql(script: string): string[] {
  return script
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}
