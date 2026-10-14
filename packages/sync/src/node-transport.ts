import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { deviceFromFileName, ULID_RE, type SyncTransport } from "./transport.ts";

/** Transporte sobre una carpeta del disco (Node). Lo usan las pruebas de dos nodos. */
export class FolderTransport implements SyncTransport {
  readonly label: string;
  constructor(private readonly root: string) {
    this.label = `carpeta ${root}`;
  }

  async list() {
    const out: { project: string; device: string }[] = [];
    let dirs: string[];
    try {
      dirs = await readdir(this.root);
    } catch {
      return out;
    }
    for (const project of dirs) {
      if (!ULID_RE.test(project)) continue;
      let files: string[] = [];
      try {
        files = await readdir(join(this.root, project));
      } catch {
        continue;
      }
      for (const f of files) {
        const device = deviceFromFileName(f);
        if (device) out.push({ project, device });
      }
    }
    return out;
  }

  async read(project: string, device: string) {
    check(project, device);
    return readFile(join(this.root, project, `${device}.ndjson`), "utf8");
  }

  async append(project: string, device: string, text: string) {
    check(project, device);
    await mkdir(join(this.root, project), { recursive: true });
    await appendFile(join(this.root, project, `${device}.ndjson`), text, "utf8");
  }
}

function check(project: string, device: string) {
  if (!ULID_RE.test(project) || !ULID_RE.test(device)) throw new Error("Nombre de proyecto o dispositivo no válido");
}
