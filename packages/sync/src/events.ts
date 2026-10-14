import type { Work } from "@biociencia/core";
import { canonical, signText, verifyText } from "./crypto.ts";

/**
 * Evento de sincronización: cada cambio en un proyecto compartido.
 * Es inmutable, lleva identificador único (ULID), reloj HLC y firma Ed25519 del autor.
 */
export type ProjectRole = "admin" | "editor" | "reader";

export type EventBody =
  | { type: "project.create"; data: { name: string; description: string; objectives: string; ownerName: string } }
  | { type: "project.update"; data: { field: "name" | "description" | "objectives"; value: string } }
  | { type: "project.archive"; data: Record<string, never> }
  | { type: "member.set"; data: { memberId: string; displayName: string; role: ProjectRole; publicKey: string } }
  | { type: "member.remove"; data: { memberId: string } }
  | { type: "work.add"; data: { key: string; work: Work } }
  | { type: "work.remove"; data: { key: string } }
  | { type: "note.add"; data: { noteId: string; body: string } }
  | { type: "note.delete"; data: { noteId: string } };

export type EventType = EventBody["type"];

export interface UnsignedEvent {
  v: 1;
  id: string; // ULID
  project: string; // id del proyecto (ULID, igual en todas las computadoras)
  author: string; // id de identidad
  authorKey: string; // llave pública Ed25519 (hex)
  device: string; // dispositivo que lo creó
  hlc: string; // reloj lógico híbrido
  type: EventType;
  data: unknown;
}

export interface SyncEvent extends UnsignedEvent {
  sig: string;
}

export async function signEvent(e: UnsignedEvent, secretKey: string): Promise<SyncEvent> {
  return { ...e, sig: await signText(canonical(e), secretKey) };
}

export async function verifyEventSignature(e: SyncEvent): Promise<boolean> {
  const { sig, ...rest } = e;
  if (typeof sig !== "string" || typeof e.authorKey !== "string") return false;
  return verifyText(canonical(rest), sig, e.authorKey);
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Comprueba la forma del evento antes de confiar en él (los archivos pueden venir de cualquier lado). */
export function isWellFormed(x: unknown): x is SyncEvent {
  const e = x as SyncEvent;
  return (
    !!e && e.v === 1 && ULID.test(e.id) && ULID.test(e.project) && typeof e.author === "string" && e.author.length > 0 &&
    /^[0-9a-f]{64}$/.test(e.authorKey) && typeof e.device === "string" && /^\d{13}-\d{5}-.+$/.test(e.hlc) &&
    typeof e.type === "string" && /^[0-9a-f]{128}$/.test(e.sig)
  );
}

/** Orden total y determinista: HLC y, en empate, id. Igual en todas las computadoras. */
export function compareEvents(a: SyncEvent, b: SyncEvent): number {
  return a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Código que un investigador comparte para ser invitado a un proyecto. */
export interface ResearcherCode {
  id: string;
  name: string;
  key: string;
}

export function encodeResearcherCode(c: ResearcherCode): string {
  const json = JSON.stringify({ v: 1, ...c });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return `BC1-${b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export function decodeResearcherCode(code: string): ResearcherCode {
  const m = code.trim().match(/^BC1-([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error("El código no tiene el formato de BioCiencia (debe empezar con BC1-).");
  try {
    const b64 = m[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(bytes));
    if (o.v !== 1 || typeof o.id !== "string" || typeof o.name !== "string" || !/^[0-9a-f]{64}$/.test(o.key)) throw new Error();
    return { id: o.id, name: o.name, key: o.key };
  } catch {
    throw new Error("El código de investigador está dañado o incompleto.");
  }
}
