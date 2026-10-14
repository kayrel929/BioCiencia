use biociencia_db::{Db, Stmt};
use serde_json::{Map, Value};
use tauri::{Manager, State};

#[tauri::command]
fn db_exec(db: State<'_, Db>, sql: String) -> Result<(), String> {
    db.exec(&sql)
}

#[tauri::command]
fn db_all(db: State<'_, Db>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    db.all(&sql, &params)
}

#[tauri::command]
fn db_batch(db: State<'_, Db>, statements: Vec<Stmt>) -> Result<(), String> {
    db.batch(&statements)
}

#[tauri::command]
fn db_describe(db: State<'_, Db>) -> Value {
    db.describe()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Carpeta de datos del usuario: %APPDATA%\ec.biociencia.app\biociencia.db
            let dir = app.path().app_data_dir()?;
            let db = Db::open(&dir.join("biociencia.db")).map_err(|e| Box::<dyn std::error::Error>::from(e))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_exec, db_all, db_batch, db_describe])
        .run(tauri::generate_context!())
        .expect("error al iniciar BioCiencia");
}
