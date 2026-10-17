import { createRoot } from "react-dom/client";
import { BioRepo, type SqlDriver, type SqlValue, type Statement } from "@biociencia/storage";
import { BioCienciaApp, StartupError } from "@biociencia/ui";
import "@biociencia/ui/styles.css";
import { webSyncFolder } from "./webFolders.ts";

/** Adaptador web: envía cada operación al hilo de SQLite y espera la respuesta. */
function createWorkerDriver(): SqlDriver {
  const worker = new Worker(new URL("./sqlite-worker.ts", import.meta.url), { type: "module" });
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  // Si el hilo de SQLite no arranca (fichero no encontrado, WebAssembly bloqueado…), las llamadas se
  // quedaban esperando para siempre: la página se veía en blanco y sin ninguna explicación.
  const fallar = (motivo: string) => {
    for (const p of pending.values()) p.reject(new Error(motivo));
    pending.clear();
  };
  worker.onerror = (ev) => fallar(`El motor de datos no se pudo cargar (${ev.message || "error del hilo de SQLite"}). Pruebe con Chrome o Edge actualizados.`);
  worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) p.resolve(ev.data.result);
    else p.reject(new Error(ev.data.error));
  };
  const call = <T,>(msg: Record<string, unknown>) =>
    new Promise<T>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, ...msg });
    });
  return {
    exec: (sql: string) => call<void>({ type: "exec", sql }),
    all: <T,>(sql: string, params: SqlValue[] = []) => call<T[]>({ type: "all", sql, params }),
    batch: (statements: Statement[]) => call<void>({ type: "batch", statements }),
    describe: () => call<{ kind: string; location: string; persistent: boolean }>({ type: "describe" }),
  };
}

async function start() {
  const root = createRoot(document.getElementById("root")!);
  try {
    const repo = new BioRepo(createWorkerDriver());
    // Si la base de datos no responde, se avisa en vez de dejar «Cargando…» para siempre.
    await Promise.race([
      repo.init(),
      new Promise((_, rechazar) =>
        setTimeout(() => rechazar(new Error("La base de datos local no respondió. Recargue la página (F5); si continúa, use Chrome o Edge actualizados.")), 20_000),
      ),
    ]);
    root.render(<BioCienciaApp repo={repo} platform="web" syncFolder={webSyncFolder ?? undefined} />);
  } catch (e) {
    root.render(<StartupError message={e instanceof Error ? e.message : String(e)} />);
  }
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    // Si ya había una versión controlando la página y entra una nueva, recargamos
    // una sola vez para mostrar al instante la interfaz actualizada (menú y pantallas al día).
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        // Preguntar al servidor si hay una versión nueva (evita quedarse «pegado» en la vieja).
        reg.update().catch(() => {});
      })
      .catch(() => {
        /* sin service worker la app funciona igual, solo sin modo sin conexión */
      });
  }
}

void start();
