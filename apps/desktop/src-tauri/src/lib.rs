use biociencia_db::{syncdir, Db, Stmt};
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

/// Extensiones que la app puede escribir (exportaciones y copias de seguridad).
const ALLOWED_EXT: [&str; 7] = ["bib", "ris", "enw", "xml", "csv", "json", "txt"];

/// Escribe un archivo elegido por el usuario en el diálogo «Guardar como».
/// Se escribe primero a un temporal y luego se reemplaza, para no dejar archivos a medias.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        return Err(format!("Extensión no permitida: .{ext}"));
    }
    let tmp = p.with_extension(format!("{ext}.tmp"));
    std::fs::write(&tmp, contents.as_bytes()).map_err(|e| format!("No se pudo escribir: {e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("No se pudo guardar: {e}")
    })
}

// ---------------- Carpeta de sincronización (Fase 5) ----------------
// La carpeta la elige el usuario con el diálogo nativo; los nombres se validan en syncdir.

#[tauri::command]
fn sync_list(root: String) -> Result<Vec<syncdir::SyncFile>, String> {
    syncdir::list(&root)
}

#[tauri::command]
fn sync_read(root: String, project: String, device: String) -> Result<String, String> {
    syncdir::read(&root, &project, &device)
}

#[tauri::command]
fn sync_append(root: String, project: String, device: String, text: String) -> Result<(), String> {
    syncdir::append(&root, &project, &device, &text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Carpeta de datos del usuario: %APPDATA%\ec.biociencia.app\biociencia.db
            let dir = app.path().app_data_dir()?;
            let db = Db::open(&dir.join("biociencia.db")).map_err(|e| Box::<dyn std::error::Error>::from(e))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_exec, db_all, db_batch, db_describe, save_text_file, sync_list, sync_read, sync_append])
        .run(tauri::generate_context!())
        .expect("error al iniciar BioCiencia");
}
