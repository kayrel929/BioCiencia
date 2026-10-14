import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BioRepo, type SqlDriver, type SqlValue, type Statement } from "@biociencia/storage";
import { BioCienciaApp, StartupError } from "@biociencia/ui";
import "@biociencia/ui/styles.css";

/** Adaptador Windows: cada operación va a los comandos Rust de src-tauri/src/db.rs. */
const tauriDriver: SqlDriver = {
  exec: (sql: string) => invoke<void>("db_exec", { sql }),
  all: <T,>(sql: string, params: SqlValue[] = []) => invoke<T[]>("db_all", { sql, params }),
  batch: (statements: Statement[]) => invoke<void>("db_batch", { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) }),
  describe: () => invoke<{ kind: string; location: string; persistent: boolean }>("db_describe"),
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
    root.render(<BioCienciaApp repo={repo} platform="desktop" />);
  } catch (e) {
    root.render(<StartupError message={e instanceof Error ? e.message : String(e)} />);
  }
}

void start();
