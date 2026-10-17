import type { Work } from "./works.ts";
import { evidenceLevel } from "./evidence.ts";

/**
 * Grupos inteligentes: colecciones definidas por reglas («año desde 2020», «título contiene Trichoderma»,
 * «tiene PDF»…). No guardan una lista: se recalculan cada vez, así que las publicaciones nuevas que
 * cumplen las reglas aparecen solas.
 */

export type SmartField =
  | "any" | "title" | "author" | "venue" | "abstract" | "keyword" | "notes"
  | "year" | "type" | "tag" | "collection" | "oa" | "favorite" | "own" | "pdf" | "doi" | "added" | "source" | "evidence" | "retracted";

export type SmartOp = "contains" | "not_contains" | "is" | "is_not" | "gte" | "lte" | "yes" | "no" | "within_days";

export interface SmartRule {
  field: SmartField;
  op: SmartOp;
  value?: string;
}

export interface SmartRules {
  match: "all" | "any";
  rules: SmartRule[];
}

/** Lo que se sabe de cada publicación de la biblioteca para evaluar las reglas. */
export interface SmartEntry {
  work: Work;
  tags: string[];
  notes: string;
  favorite: boolean;
  own: boolean;
  pdfCount: number;
  collectionIds: string[];
  addedAt: string;
}

export const SMART_FIELDS: { field: SmartField; label: string; ops: SmartOp[]; kind: "text" | "number" | "bool" | "choice" | "days" }[] = [
  { field: "any", label: "Cualquier campo", ops: ["contains", "not_contains"], kind: "text" },
  { field: "title", label: "Título", ops: ["contains", "not_contains"], kind: "text" },
  { field: "author", label: "Autor", ops: ["contains", "not_contains"], kind: "text" },
  { field: "venue", label: "Revista", ops: ["contains", "not_contains", "is"], kind: "text" },
  { field: "abstract", label: "Resumen", ops: ["contains", "not_contains"], kind: "text" },
  { field: "keyword", label: "Palabra clave", ops: ["contains", "not_contains"], kind: "text" },
  { field: "notes", label: "Observaciones", ops: ["contains", "not_contains"], kind: "text" },
  { field: "year", label: "Año", ops: ["gte", "lte", "is"], kind: "number" },
  { field: "type", label: "Tipo de publicación", ops: ["is", "is_not"], kind: "choice" },
  { field: "tag", label: "Etiqueta", ops: ["is", "is_not"], kind: "choice" },
  { field: "collection", label: "Colección", ops: ["is", "is_not"], kind: "choice" },
  { field: "source", label: "Fuente", ops: ["is", "is_not"], kind: "choice" },
  { field: "oa", label: "Acceso abierto", ops: ["yes", "no"], kind: "bool" },
  { field: "favorite", label: "Favorito", ops: ["yes", "no"], kind: "bool" },
  { field: "own", label: "Publicación propia", ops: ["yes", "no"], kind: "bool" },
  { field: "pdf", label: "Tiene PDF", ops: ["yes", "no"], kind: "bool" },
  { field: "doi", label: "Tiene DOI", ops: ["yes", "no"], kind: "bool" },
  { field: "added", label: "Añadida a la biblioteca", ops: ["within_days"], kind: "days" },
  { field: "evidence", label: "Nivel de evidencia (1 = metaanálisis … 6 = opinión)", ops: ["lte", "is"], kind: "number" },
  { field: "retracted", label: "Retractada o retirada", ops: ["yes", "no"], kind: "bool" },
];

export const SMART_OP_LABEL: Record<SmartOp, string> = {
  contains: "contiene",
  not_contains: "no contiene",
  is: "es",
  is_not: "no es",
  gte: "desde (≥)",
  lte: "hasta (≤)",
  yes: "sí",
  no: "no",
  within_days: "en los últimos",
};

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function textOf(e: SmartEntry, field: SmartField): string {
  const w = e.work;
  switch (field) {
    case "title": return w.title;
    case "author": return w.authors.map((a) => a.name).join("; ");
    case "venue": return w.venue ?? "";
    case "abstract": return w.abstract ?? "";
    case "keyword": return (w.keywords ?? []).join("; ");
    case "notes": return e.notes;
    default:
      return [w.title, w.authors.map((a) => a.name).join("; "), w.venue, w.abstract, (w.keywords ?? []).join("; "), e.notes, e.tags.join(" "), w.doi].join(" \u0001 ");
  }
}

/** ¿Una regla está completa? (las incompletas se ignoran) */
export function ruleIsComplete(r: SmartRule): boolean {
  if (r.op === "yes" || r.op === "no") return true;
  return !!r.value && r.value.trim() !== "";
}

export function matchRule(e: SmartEntry, r: SmartRule, now = Date.now()): boolean {
  const v = (r.value ?? "").trim();
  switch (r.field) {
    case "year": {
      const n = Number(v);
      const y = e.work.year;
      if (!Number.isFinite(n) || !y) return false;
      return r.op === "gte" ? y >= n : r.op === "lte" ? y <= n : y === n;
    }
    case "type": return (e.work.type === v) === (r.op === "is");
    case "source": return (e.work.source === v) === (r.op === "is");
    case "tag": return e.tags.some((t) => norm(t) === norm(v)) === (r.op === "is");
    case "collection": return e.collectionIds.includes(v) === (r.op === "is");
    case "oa": return !!e.work.isOpenAccess === (r.op === "yes");
    case "favorite": return e.favorite === (r.op === "yes");
    case "own": return e.own === (r.op === "yes");
    case "pdf": return e.pdfCount > 0 === (r.op === "yes");
    case "doi": return !!e.work.doi === (r.op === "yes");
    case "evidence": {
      const n = Number(v);
      const l = evidenceLevel(e.work)?.level;
      if (!Number.isFinite(n) || !l) return false;
      return r.op === "lte" ? l <= n : l === n;
    }
    case "retracted": return (e.work.retraction?.status === "retracted" || e.work.retraction?.status === "withdrawn") === (r.op === "yes");
    case "added": {
      const days = Number(v);
      const t = Date.parse(e.addedAt);
      return Number.isFinite(days) && Number.isFinite(t) && now - t <= days * 86400000;
    }
    default: {
      const hay = norm(textOf(e, r.field));
      // Varias palabras: todas deben estar (en cualquier orden); «"frase exacta"» entre comillas
      const phrase = v.match(/^"(.+)"$/);
      const needles = phrase ? [norm(phrase[1])] : norm(v).split(" ").filter(Boolean);
      if (r.op === "is") return hay === norm(v);
      const has = needles.every((n) => hay.includes(n));
      return r.op === "contains" ? has : !has;
    }
  }
}

export function matchSmartGroup(e: SmartEntry, g: SmartRules, now = Date.now()): boolean {
  const rules = (g.rules ?? []).filter(ruleIsComplete);
  if (rules.length === 0) return false;
  return g.match === "any" ? rules.some((r) => matchRule(e, r, now)) : rules.every((r) => matchRule(e, r, now));
}

/** Valida lo que viene de la base de datos o de otra computadora. */
export function parseSmartRules(raw: unknown): SmartRules {
  const g = raw as Partial<SmartRules> | null;
  const fields = new Set(SMART_FIELDS.map((f) => f.field));
  const rules = Array.isArray(g?.rules)
    ? g!.rules
        .filter((r): r is SmartRule => !!r && fields.has((r as SmartRule).field) && SMART_FIELDS.find((f) => f.field === (r as SmartRule).field)!.ops.includes((r as SmartRule).op))
        .map((r) => ({ field: r.field, op: r.op, ...(r.value !== undefined ? { value: String(r.value).slice(0, 500) } : {}) }))
    : [];
  return { match: g?.match === "any" ? "any" : "all", rules };
}

/** Descripción en una línea: «Año desde (≥) 2020 y Título contiene Trichoderma». */
export function describeSmartRules(g: SmartRules, names: { collection?: (id: string) => string; type?: (t: string) => string } = {}): string {
  return g.rules
    .filter(ruleIsComplete)
    .map((r) => {
      const f = SMART_FIELDS.find((x) => x.field === r.field)!;
      if (r.op === "yes" || r.op === "no") return `${f.label}: ${SMART_OP_LABEL[r.op]}`;
      const v = r.field === "collection" ? names.collection?.(r.value!) ?? r.value : r.field === "type" ? names.type?.(r.value!) ?? r.value : r.value;
      return `${f.label} ${SMART_OP_LABEL[r.op]} ${r.field === "added" ? `${v} días` : `«${v}»`}`;
    })
    .join(g.match === "any" ? " o " : " y ");
}
