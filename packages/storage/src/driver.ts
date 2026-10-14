/**
 * Interfaz mínima de base de datos que implementa cada entorno:
 *  - Windows (Tauri): comandos Rust sobre rusqlite (apps/desktop/src-tauri/src/db.rs)
 *  - Web: SQLite compilado a WebAssembly sobre OPFS (apps/web/src/sqlite-worker.ts)
 *  - Pruebas: node:sqlite (src/node-driver.ts)
 * Todo el SQL de BioCiencia vive en este paquete y es idéntico en los tres.
 */
export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

export interface SqlDriver {
  /** Ejecuta varias sentencias sin parámetros (migraciones). */
  exec(sql: string): Promise<void>;
  /** Consulta que devuelve filas como objetos. */
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Ejecuta todas las sentencias en una sola transacción: o todas o ninguna. */
  batch(statements: Statement[]): Promise<void>;
  /** Descripción para la pantalla de configuración (ruta del archivo, tipo de almacenamiento). */
  describe(): Promise<{ kind: string; location: string; persistent: boolean }>;
}
