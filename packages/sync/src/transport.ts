/**
 * Transporte por carpeta compartida. Estructura:
 *
 *   <carpeta>/<idProyecto>/<idDispositivo>.ndjson
 *
 * Cada computadora SOLO escribe (agrega al final) su propio archivo, y lee los de las demás.
 * Así nunca hay dos equipos escribiendo el mismo archivo y la herramienta que copia la carpeta
 * (Syncthing, una unidad de red, una memoria USB…) no produce conflictos.
 */
export interface SyncTransport {
  /** Nombre visible del transporte (para el registro) */
  readonly label: string;
  list(): Promise<{ project: string; device: string }[]>;
  read(project: string, device: string): Promise<string>;
  append(project: string, device: string, text: string): Promise<void>;
}

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Nombre de archivo válido de un dispositivo: "<ULID>.ndjson" */
export function deviceFromFileName(name: string): string | null {
  const m = name.match(/^([0-9A-HJKMNP-TV-Z]{26})\.ndjson$/);
  return m ? m[1]! : null;
}

/**
 * Separa un archivo NDJSON en líneas completas. La última línea sin salto final se
 * descarta: puede estar a medio copiar y se leerá completa en la próxima sincronización.
 */
export function completeLines(text: string): { lines: string[]; partial: boolean } {
  const parts = text.split("\n");
  const last = parts.pop() ?? "";
  return { lines: parts.map((l) => l.replace(/\r$/, "")).filter((l) => l.trim().length > 0), partial: last.trim().length > 0 };
}

/** Transporte en memoria: útil para pruebas y para importar paquetes manuales. */
export class MemoryTransport implements SyncTransport {
  readonly label = "memoria";
  readonly files = new Map<string, string>();
  async list() {
    return [...this.files.keys()].map((k) => {
      const [project, device] = k.split("/") as [string, string];
      return { project, device };
    });
  }
  async read(project: string, device: string) {
    return this.files.get(`${project}/${device}`) ?? "";
  }
  async append(project: string, device: string, text: string) {
    const k = `${project}/${device}`;
    this.files.set(k, (this.files.get(k) ?? "") + text);
  }
}
