/// <reference lib="webworker" />
/**
 * Hilo dedicado a SQLite (WebAssembly). Guarda la base de datos en el
 * Origin Private File System (OPFS) del navegador mediante el VFS "opfs-sahpool",
 * que no requiere cabeceras especiales del servidor.
 */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

type Req =
  | { id: number; type: "exec"; sql: string }
  | { id: number; type: "all"; sql: string; params?: unknown[] }
  | { id: number; type: "batch"; statements: { sql: string; params?: unknown[] }[] }
  | { id: number; type: "describe" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let info = { kind: "sqlite-wasm", location: "", persistent: false };

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "biociencia" });
    db = new pool.OpfsSAHPoolDb("/biociencia.sqlite3");
    info = { kind: `SQLite ${sqlite3.version.libVersion} (WebAssembly)`, location: "OPFS del navegador · /biociencia.sqlite3", persistent: true };
  } catch (e) {
    // Navegador sin OPFS: base en memoria, avisada en Configuración
    db = new sqlite3.oo1.DB(":memory:");
    info = { kind: `SQLite ${sqlite3.version.libVersion} (WebAssembly, memoria)`, location: `memoria (${String(e)})`, persistent: false };
  }
  db.exec("PRAGMA foreign_keys = ON;");
})();

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    await ready;
    let result: unknown = null;
    if (req.type === "exec") db.exec(req.sql);
    else if (req.type === "all") result = db.exec({ sql: req.sql, bind: req.params ?? [], rowMode: "object", returnValue: "resultRows" });
    else if (req.type === "batch") {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const s of req.statements) db.exec({ sql: s.sql, bind: s.params ?? [] });
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } else if (req.type === "describe") result = info;
    (self as unknown as Worker).postMessage({ id: req.id, ok: true, result });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
