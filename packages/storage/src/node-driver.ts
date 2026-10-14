/**
 * Adaptador para Node.js (pruebas automáticas y herramientas de línea de comandos).
 * Usa el módulo node:sqlite incluido en Node 22.5+.
 */
import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlValue, Statement } from "./driver.ts";

export function createNodeDriver(path = ":memory:"): SqlDriver & { close(): void } {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async batch(statements: Statement[]) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const s of statements) db.prepare(s.sql).run(...(s.params ?? []));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    async describe() {
      return { kind: "node:sqlite", location: path, persistent: path !== ":memory:" };
    },
    close() {
      db.close();
    },
  };
}
