//! Acceso a la base de datos local de BioCiencia en Windows.
//! Expone la misma interfaz que usa el código TypeScript (`SqlDriver`):
//! exec, all, batch (transacción) y describe.

pub mod syncdir;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Db {
    conn: Mutex<Connection>,
    path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct Stmt {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

fn to_sql(v: &Value) -> Result<SqlValue, String> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().ok_or("número inválido")?),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        _ => return Err("tipo de parámetro no soportado (solo texto, número o nulo)".into()),
    })
}

fn from_sql(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        // Los archivos no se guardan como BLOB en BioCiencia; se informa el tamaño por si acaso
        ValueRef::Blob(b) => json!({ "blobBytes": b.len() }),
    }
}

fn params(values: &[Value]) -> Result<Vec<SqlValue>, String> {
    values.iter().map(to_sql).collect()
}

impl Db {
    /// Abre (o crea) la base de datos en `path` con WAL y claves foráneas activas.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("no se pudo crear la carpeta de datos: {e}"))?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
            .map_err(|e| e.to_string())?;
        Ok(Self { conn: Mutex::new(conn), path: path.to_path_buf() })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn.lock().map_err(|_| "la base de datos quedó bloqueada por un error anterior".to_string())
    }

    pub fn exec(&self, sql: &str) -> Result<(), String> {
        self.lock()?.execute_batch(sql).map_err(|e| e.to_string())
    }

    pub fn all(&self, sql: &str, values: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query(params_from_iter(params(values)?)).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut m = Map::with_capacity(names.len());
            for (i, n) in names.iter().enumerate() {
                m.insert(n.clone(), from_sql(row.get_ref(i).map_err(|e| e.to_string())?));
            }
            out.push(m);
        }
        Ok(out)
    }

    /// Ejecuta todas las sentencias en una transacción: o todas o ninguna.
    pub fn batch(&self, statements: &[Stmt]) -> Result<(), String> {
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for s in statements {
            let mut st = tx.prepare(&s.sql).map_err(|e| format!("{e} · SQL: {}", s.sql.chars().take(80).collect::<String>()))?;
            st.execute(params_from_iter(params(&s.params)?)).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn describe(&self) -> Value {
        json!({
            "kind": format!("SQLite {} (nativo)", rusqlite::version()),
            "location": self.path.display().to_string(),
            "persistent": true
        })
    }

    /// Copia de seguridad en caliente (se usará en la Fase 4).
    pub fn backup_to(&self, dest: &Path) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute("VACUUM INTO ?1", [dest.display().to_string()]).map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("biociencia-test-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn crea_consulta_y_persiste() {
        let p = tmp("a.db");
        {
            let db = Db::open(&p).unwrap();
            db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, x REAL, s TEXT)").unwrap();
            db.batch(&[Stmt { sql: "INSERT INTO t VALUES (?, ?, ?, ?)".into(), params: vec![json!("a"), json!(3), json!(1.5), Value::Null] }]).unwrap();
        }
        let db = Db::open(&p).unwrap();
        let rows = db.all("SELECT * FROM t WHERE id = ?", &[json!("a")]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["n"], json!(3));
        assert_eq!(rows[0]["x"], json!(1.5));
        assert_eq!(rows[0]["s"], Value::Null);
    }

    #[test]
    fn transaccion_atomica() {
        let db = Db::open(&tmp("b.db")).unwrap();
        db.exec("CREATE TABLE t (k TEXT PRIMARY KEY)").unwrap();
        let r = db.batch(&[
            Stmt { sql: "INSERT INTO t VALUES ('uno')".into(), params: vec![] },
            Stmt { sql: "INSERT INTO tabla_inexistente VALUES (1)".into(), params: vec![] },
        ]);
        assert!(r.is_err());
        assert!(db.all("SELECT * FROM t", &[]).unwrap().is_empty());
    }

    #[test]
    fn fts5_sin_acentos_disponible() {
        let db = Db::open(&tmp("c.db")).unwrap();
        db.exec("CREATE VIRTUAL TABLE f USING fts5(t, tokenize = 'unicode61 remove_diacritics 2')").unwrap();
        db.batch(&[Stmt { sql: "INSERT INTO f VALUES (?)".into(), params: vec![json!("Control biológico de Ralstonia")] }]).unwrap();
        let r = db.all("SELECT t FROM f WHERE f MATCH ?", &[json!("\"biologico\"*")]).unwrap();
        assert_eq!(r.len(), 1);
    }

    #[test]
    fn copia_de_seguridad() {
        let db = Db::open(&tmp("d.db")).unwrap();
        db.exec("CREATE TABLE t (k TEXT); INSERT INTO t VALUES ('x');").unwrap();
        let dest = tmp("d-backup.db");
        db.backup_to(&dest).unwrap();
        let copy = Db::open(&dest).unwrap();
        assert_eq!(copy.all("SELECT k FROM t", &[]).unwrap().len(), 1);
    }
}
