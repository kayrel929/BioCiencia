//! Carpeta de sincronización: `<raíz>/<idProyecto>/<idDispositivo>.ndjson`.
//! Solo se aceptan nombres con forma de ULID, así ningún comando puede leer o escribir
//! fuera de la carpeta elegida por el usuario (no hay "..", barras ni rutas absolutas).

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Tamaño máximo de un archivo de eventos que se lee de una vez (64 MB).
const MAX_FILE: u64 = 64 * 1024 * 1024;
const CROCKFORD: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

#[derive(Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct SyncFile {
    pub project: String,
    pub device: String,
}

pub fn is_ulid(s: &str) -> bool {
    s.len() == 26 && s.chars().all(|c| CROCKFORD.contains(c))
}

fn root_dir(root: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(root);
    if !p.is_absolute() {
        return Err("La carpeta de sincronización debe ser una ruta completa".into());
    }
    if !p.is_dir() {
        return Err("La carpeta de sincronización no existe o no está disponible (¿unidad desconectada?)".into());
    }
    Ok(p)
}

fn file_path(root: &Path, project: &str, device: &str) -> Result<PathBuf, String> {
    if !is_ulid(project) || !is_ulid(device) {
        return Err("Nombre de proyecto o dispositivo no válido".into());
    }
    Ok(root.join(project).join(format!("{device}.ndjson")))
}

pub fn list(root: &str) -> Result<Vec<SyncFile>, String> {
    let root = root_dir(root)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| format!("No se pudo leer la carpeta: {e}"))? {
        let Ok(entry) = entry else { continue };
        let project = entry.file_name().to_string_lossy().to_string();
        if !is_ulid(&project) || !entry.path().is_dir() {
            continue;
        }
        let Ok(files) = fs::read_dir(entry.path()) else { continue };
        for f in files.flatten() {
            let name = f.file_name().to_string_lossy().to_string();
            if let Some(device) = name.strip_suffix(".ndjson") {
                if is_ulid(device) && f.path().is_file() {
                    out.push(SyncFile { project: project.clone(), device: device.to_string() });
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

pub fn read(root: &str, project: &str, device: &str) -> Result<String, String> {
    let p = file_path(&root_dir(root)?, project, device)?;
    let meta = fs::metadata(&p).map_err(|e| format!("No se pudo leer {project}/{device}: {e}"))?;
    if meta.len() > MAX_FILE {
        return Err(format!("El archivo {project}/{device} es demasiado grande"));
    }
    let bytes = fs::read(&p).map_err(|e| format!("No se pudo leer {project}/{device}: {e}"))?;
    // Una línea a medio copiar puede cortar un carácter UTF-8: se reemplaza y esa línea se descarta luego.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Agrega texto al final del archivo propio del dispositivo (nunca reescribe lo anterior).
pub fn append(root: &str, project: &str, device: &str, text: &str) -> Result<(), String> {
    let root = root_dir(root)?;
    let p = file_path(&root, project, device)?;
    fs::create_dir_all(root.join(project)).map_err(|e| format!("No se pudo crear la carpeta del proyecto: {e}"))?;
    let mut f = OpenOptions::new().create(true).append(true).open(&p).map_err(|e| format!("No se pudo abrir {}: {e}", p.display()))?;
    f.write_all(text.as_bytes()).map_err(|e| format!("No se pudo escribir: {e}"))?;
    f.sync_data().map_err(|e| format!("No se pudo guardar en disco: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: &str = "01KPA00000000000000000000A";
    const D1: &str = "01KPB00000000000000000000B";
    const D2: &str = "01KPC00000000000000000000C";

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("bc-syncdir-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn append_list_read() {
        let d = tmp();
        let r = d.to_str().unwrap();
        append(r, P, D1, "{\"a\":1}\n").unwrap();
        append(r, P, D1, "{\"a\":2}\n").unwrap();
        append(r, P, D2, "{\"b\":1}\n").unwrap();
        fs::write(d.join(P).join("notas.txt"), "x").unwrap(); // se ignora
        fs::create_dir_all(d.join(".stfolder")).unwrap(); // carpeta de Syncthing, se ignora
        assert_eq!(list(r).unwrap(), vec![SyncFile { project: P.into(), device: D1.into() }, SyncFile { project: P.into(), device: D2.into() }]);
        assert_eq!(read(r, P, D1).unwrap(), "{\"a\":1}\n{\"a\":2}\n");
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn rechaza_rutas_fuera_de_la_carpeta() {
        let d = tmp();
        let r = d.to_str().unwrap();
        assert!(append(r, "..", D1, "x").is_err());
        assert!(append(r, P, "../../etc/passwd", "x").is_err());
        assert!(read(r, P, "01kpb00000000000000000000b").is_err()); // minúsculas no son ULID canónico
        assert!(list("relativa").is_err());
        assert!(list(d.join("no-existe").to_str().unwrap()).is_err());
        fs::remove_dir_all(d).unwrap();
    }
}
