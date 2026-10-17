import type { SyncFolderAccess } from "@biociencia/ui";
import type { SyncTransport } from "@biociencia/sync";

/**
 * Carpeta de sincronización en la versión web, con la File System Access API
 * (Edge/Chrome; también la abre «Iniciar BioCiencia.cmd» en su navegador).
 *
 * El usuario elige UNA carpeta real del disco (p. ej. la de Syncthing, la red o la USB)
 * y BioCiencia, con su permiso, lee y escribe en ella igual que la versión de Windows.
 * El permiso se recuerda entre sesiones pidiéndolo otra vez con un clic cuando el
 * navegador lo requiere.
 */

interface FsWritable {
  seek(pos: number): Promise<void>;
  write(data: unknown): Promise<void>;
  close(): Promise<void>;
}

/** Manejador de archivo o carpeta de la File System Access API (simplificado). */
interface FsHandle {
  name: string;
  kind: "file" | "directory";
  values(): AsyncIterable<FsHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsHandle>;
  queryPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  getFile?(): Promise<{ size: number; text(): Promise<string> }>;
  createWritable?(opts?: { keepExistingData?: boolean }): Promise<FsWritable>;
}

const DB = "biociencia-carpetas";
const STORE = "handles";
const KEY = "sync-folder";
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("No se pudo abrir el almacenamiento local de carpetas."));
  });
}

async function storedHandle(): Promise<FsHandle | null> {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const rq = tx.objectStore(STORE).get(KEY);
      rq.onsuccess = () => resolve((rq.result as FsHandle | undefined) ?? null);
      rq.onerror = () => reject(rq.error ?? new Error("no"));
    });
  } catch {
    return null;
  }
}

async function saveHandle(h: FsHandle): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(h, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("no"));
  });
}

async function pickHandle(): Promise<FsHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: { mode?: string; id?: string }) => Promise<FsHandle> }).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ mode: "readwrite", id: "biociencia-sync" });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return null; // el usuario canceló
    throw e;
  }
}

const mode = { mode: "readwrite" as const };

class WebFolderTransport implements SyncTransport {
  readonly label: string;
  constructor(private readonly name: string) {
    this.label = `carpeta «${name}» del navegador`;
  }
  private async dir(): Promise<FsHandle> {
    const h = await storedHandle();
    if (!h) throw new Error("Elija de nuevo la carpeta de sincronización (el navegador pidió permisos de nuevo).");
    return h;
  }
  async list() {
    const out: { project: string; device: string }[] = [];
    const root = await this.dir();
    try {
      for await (const entry of root.values()) {
        if (entry.kind !== "directory" || !ULID_RE.test(entry.name)) continue;
        for await (const f of entry.values()) {
          if (f.kind !== "file") continue;
          const m = f.name.match(/^([0-9A-HJKMNP-TV-Z]{26})\.ndjson$/);
          if (m) out.push({ project: entry.name, device: m[1]! });
        }
      }
    } catch {
      /* carpeta recién creada o sin permiso en este momento: se reporta como vacía */
    }
    return out;
  }
  async read(project: string, device: string) {
    const h = await this.dir();
    const sub = await h.getFileHandle(project);
    const file = await sub.getFileHandle(`${device}.ndjson`);
    return (await file.getFile!()).text();
  }
  /** Agrega al final del archivo propio. Se relee el contenido y se reescribe completo:
   *  la carpeta la comparten varias computadoras, así se evitan copias a medio escribir. */
  async append(project: string, device: string, text: string) {
    const h = await this.dir();
    const sub = await h.getFileHandle(project, { create: true });
    const fh = await sub.getFileHandle(`${device}.ndjson`, { create: true });
    const size = (await fh.getFile!()).size;
    const w = await fh.createWritable!({ keepExistingData: true });
    await w.seek(size);
    await w.write(text);
    await w.close();
  }
}

const supports = typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";

export const webSyncFolder: SyncFolderAccess | null = supports
  ? {
      kind: "browser",
      async pick() {
        const h = await pickHandle();
        if (!h) return null;
        await saveHandle(h);
        return h.name;
      },
      transport(name: string) {
        return new WebFolderTransport(name);
      },
      async ensurePermission() {
        const h = await storedHandle();
        if (!h) return false;
        if ((await h.queryPermission?.(mode)) === "granted") return true;
        return (await h.requestPermission?.(mode)) === "granted";
      },
      async hasPermission() {
        const h = await storedHandle();
        if (!h) return false;
        return (await h.queryPermission?.(mode)) === "granted";
      },
    }
  : null;
