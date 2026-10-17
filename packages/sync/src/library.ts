import type { Work } from "@biociencia/core";
import type { BioRepo } from "@biociencia/storage";
import { canonical, signText, verifyText, type KeyPair } from "./crypto.ts";
import { completeLines, type SyncTransport } from "./transport.ts";

/**
 * Biblioteca compartida sin servidores: cada computadora agrega sus publicaciones a la carpeta
 * de sincronización (la misma que usan los proyectos) y lee las de las demás. El resultado es
 * una base común: la unión de las bibliotecas de todo el grupo.
 *
 * Reglas de convivencia:
 *  - Cada computadora escribe SOLO su propio archivo («biblioteca/<idEquipo>.ndjson»), siempre
 *    agregando al final: la herramienta que copia la carpeta (Syncthing, red, USB) nunca ve conflictos.
 *  - Solo se COMPARTEN publicaciones nuevas; si un dato cambia, cada equipo lo actualiza al
 *    buscar en línea. Nada se borra por esta vía (quitar de la biblioteca sigue siendo privado).
 *  - Cada línea lleva firma Ed25519 con la llave de la identidad; las líneas sin firma válida
 *    de su propio autor se descartan (alguien ajeno no puede inyectar publicaciones falsas).
 *  - Importar dos veces lo mismo no duplica nada: el DOI u otro identificador se reutiliza y
 *    los PDF duplicados no se agregan otra vez.
 */

/** Carpeta interna de la biblioteca compartida. Es un ULID fijo: los transportes solo aceptan nombres seguros. */
export const BIBLIO_PROJECT = "01J8ACDEFGHJKMNPQRSTVWXYZA";
export const BIBLIO_FORMAT = "biociencia-biblio-1";

export interface SharedAttachment {
  filename: string;
  base64: string;
  size: number;
  sha256: string;
  pages: number | null;
  text: string;
}

interface BiblioLine {
  v: 1;
  from: string;
  name: string;
  /** Llave pública del autor de la línea (para verificar la firma) */
  key: string;
  sig: string;
  payload: {
    format: typeof BIBLIO_FORMAT;
    createdAt: string;
    work: Work;
    attachments: SharedAttachment[];
  };
}

export interface LibraryShareReport {
  /** Archivos de otras computadoras leídos */
  files: number;
  /** Líneas leídas con firma válida */
  valid: number;
  invalid: number;
  /** Publicaciones creadas (no estaban) */
  imported: number;
  /** Publicaciones que ya existían (se actualizaron sus datos) */
  merged: number;
  /** PDF nuevos guardados */
  attachments: number;
  errors: string[];
}

export function emptyLibraryReport(): LibraryShareReport {
  return { files: 0, valid: 0, invalid: 0, imported: 0, merged: 0, attachments: 0, errors: [] };
}

/** La cadena exacta que se firma; push y pull la calculan de la misma manera. */
function signedString(from: string, payload: BiblioLine["payload"]): string {
  return `${BIBLIO_FORMAT}|${from}|${canonical(payload)}`;
}

function portableWork(w: Work): Work {
  const { id: _id, ...rest } = w;
  return rest as Work;
}

/**
 * Comparte las publicaciones de la biblioteca que aún no se compartieron en esta carpeta
 * (recuerda las ya enviadas). Devuelve cuántas publicaciones escribió (0 si no había nuevas).
 */
export async function pushLibrary(
  repo: BioRepo,
  t: SyncTransport,
  me: { deviceId: string; name: string },
  kp: KeyPair,
  includePdfs: boolean,
): Promise<number> {
  const entries = await repo.listLibrary({ limit: 5000 });
  const pushedIds: string[] = JSON.parse((await repo.getSetting("biblio_pushed_ids")) ?? "[]");
  const pushed = new Set(pushedIds);
  const pending = entries.filter((e) => e.work.id && !pushed.has(e.work.id));
  if (!pending.length) return 0;
  const lines: string[] = [];
  for (const e of pending) {
    const payload: BiblioLine["payload"] = { format: BIBLIO_FORMAT, createdAt: new Date().toISOString(), work: portableWork(e.work), attachments: [] };
    if (includePdfs) {
      try {
        const list = await repo.listAttachments(e.work.id!);
        let sharedText = "";
        for (const a of list) {
          const b64 = await repo.attachmentData(a.id);
          if (!b64) continue;
          if (!sharedText) sharedText = await repo.attachmentText(e.work.id!);
          payload.attachments.push({ filename: a.filename, base64: b64, size: a.size, sha256: a.sha256, pages: a.pages, text: sharedText });
        }
      } catch {
        /* un PDF que no se pueda leer se comparte igual, sin adjuntarlo */
      }
    }
    const line: BiblioLine = { v: 1, from: me.deviceId, name: me.name, key: kp.publicKey, sig: await signText(signedString(me.deviceId, payload), kp.secretKey), payload };
    lines.push(JSON.stringify(line) + "\n");
  }
  // Un solo append: además de ser atomic-friendlier, evita archivos a medio escribir
  await t.append(BIBLIO_PROJECT, me.deviceId, lines.join(""));
  await repo.setSetting("biblio_pushed_ids", JSON.stringify([...pushedIds, ...pending.map((e) => e.work.id!)]));
  return pending.length;
}

/** Lee las publicaciones compartidas por las demás computadoras y las guarda en la biblioteca propia. */
export async function pullLibrary(repo: BioRepo, t: SyncTransport, myDeviceId: string): Promise<LibraryShareReport> {
  const r = emptyLibraryReport();
  for (const f of await t.list()) {
    if (f.project !== BIBLIO_PROJECT || f.device === myDeviceId) continue;
    let text: string;
    try {
      text = await t.read(f.project, f.device);
    } catch (e) {
      r.errors.push(`No se pudo leer biblioteca/${f.device}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    r.files++;
    const { lines, partial } = completeLines(text);
    if (partial) r.errors.push(`biblioteca/${f.device}: archivo a medio copiar, se reintentará`);
    for (const raw of lines) {
      let line: BiblioLine;
      try {
        line = JSON.parse(raw) as BiblioLine;
      } catch {
        r.invalid++;
        continue;
      }
      const bad =
        !line || line.v !== 1 || line.payload?.format !== BIBLIO_FORMAT || typeof line.from !== "string" || typeof line.key !== "string" ||
        !line.payload?.work || typeof line.payload.work.title !== "string";
      if (bad) {
        r.invalid++;
        continue;
      }
      if (!(await verifyText(signedString(line.from, line.payload), line.sig, line.key))) {
        r.invalid++;
        continue;
      }
      r.valid++;
      try {
        const up = await repo.upsertWork(portableWork(line.payload.work));
        if (up.created) r.imported++;
        else r.merged++;
        await repo.addToLibrary(up.id);
        for (const a of line.payload.attachments) {
          try {
            const res = await repo.addAttachment({ workId: up.id, filename: a.filename, base64: a.base64, size: a.size, sha256: a.sha256, pages: a.pages, text: a.text });
            if (!res.duplicate) r.attachments++;
          } catch {
            /* PDF dañado o demasiado grande: se ignora */
          }
        }
      } catch (e) {
        r.errors.push(`No se pudo guardar una publicación de ${line.from}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return r;
}
