import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open, save } from "@tauri-apps/plugin-dialog";
import { BioRepo, type SqlDriver, type SqlValue, type Statement } from "@biociencia/storage";
import { BioCienciaApp, StartupError, type SaveFile, type SyncFolderAccess } from "@biociencia/ui";
import "@biociencia/ui/styles.css";

/** Adaptador Windows: cada operación va a los comandos Rust de src-tauri/src/lib.rs (lógica en src-tauri/db). */
const tauriDriver: SqlDriver = {
  exec: (sql: string) => invoke<void>("db_exec", { sql }),
  all: <T,>(sql: string, params: SqlValue[] = []) => invoke<T[]>("db_all", { sql, params }),
  batch: (statements: Statement[]) => invoke<void>("db_batch", { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) }),
  describe: () => invoke<{ kind: string; location: string; persistent: boolean }>("db_describe"),
};

/** Guardar archivos con el diálogo nativo de Windows. */
const saveFile: SaveFile = async (fileName, content) => {
  const ext = fileName.split(".").pop() ?? "txt";
  const path = await save({ defaultPath: fileName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (!path) return false; // el usuario canceló
  await invoke("save_text_file", { path, contents: content });
  return true;
};

/** Carpeta de sincronización (Syncthing, red o USB) mediante los comandos sync_* de Rust. */
const syncFolder: SyncFolderAccess = {
  async pick() {
    const p = await open({ directory: true, multiple: false, title: "Carpeta de sincronización de BioCiencia" });
    return typeof p === "string" ? p : null;
  },
  transport(root: string) {
    return {
      label: root,
      list: () => invoke<{ project: string; device: string }[]>("sync_list", { root }),
      read: (project: string, device: string) => invoke<string>("sync_read", { root, project, device }),
      append: (project: string, device: string, text: string) => invoke<void>("sync_append", { root, project, device, text }),
    };
  },
};

// Los enlaces externos (DOI, PDF) se abren en el navegador predeterminado de Windows.
document.addEventListener("click", (ev) => {
  const a = (ev.target as HTMLElement | null)?.closest("a");
  if (!a) return;
  const href = a.getAttribute("href") ?? "";
  if (/^https?:\/\//i.test(href)) {
    ev.preventDefault();
    void openUrl(href);
  }
});

async function start() {
  const root = createRoot(document.getElementById("root")!);
  try {
    const repo = new BioRepo(tauriDriver);
    await repo.init();
    root.render(<BioCienciaApp repo={repo} platform="desktop" saveFile={saveFile} syncFolder={syncFolder} />);
  } catch (e) {
    root.render(<StartupError message={e instanceof Error ? e.message : String(e)} />);
  }
}

void start();
