import { createRoot } from "react-dom/client";
import { BioRepo, type SqlDriver, type SqlValue, type Statement } from "@biociencia/storage";
import { BioCienciaApp, StartupError } from "@biociencia/ui";
import "@biociencia/ui/styles.css";

/** Adaptador web: envía cada operación al hilo de SQLite y espera la respuesta. */
function createWorkerDriver(): SqlDriver {
  const worker = new Worker(new URL("./sqlite-worker.ts", import.meta.url), { type: "module" });
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
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
    await repo.init();
    root.render(<BioCienciaApp repo={repo} platform="web" />);
  } catch (e) {
    root.render(<StartupError message={e instanceof Error ? e.message : String(e)} />);
  }
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* sin service worker la app funciona igual, solo sin modo sin conexión */
    });
  }
}

void start();
