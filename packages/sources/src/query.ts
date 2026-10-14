import { normalizeDoi } from "@biociencia/core";

/**
 * Preparación de la consulta del usuario.
 * OpenAlex busca por palabras, no entiende preguntas en lenguaje natural:
 * de una pregunta se conservan los términos con contenido y se muestra
 * al usuario exactamente qué se envió.
 */

const STOPWORDS = new Set(
  (
    // español
    "a al algo algun alguna algunas alguno algunos ante antes como con contra cual cuales cuando cuanto de del desde donde dos e el ella ellas ellos en entre era es esa esas ese eso esos esta estan estas este esto estos fue han hay la las le les lo los mas me mi muy nada ni no nos o otra otro para pero poco por porque que quien quienes se sea segun ser si sido sin sobre son su sus tambien tanto te tiene tienen todo todos tras tu un una uno unos y ya " +
    "existen existe muestran muestra presentan presenta cuales mayor menor recientes reciente investigaciones investigacion estudios estudio resultados resultado sobre efecto efectos eficacia " +
    // inglés
    "the of and or in on at to for with by from is are was were be been what which who how does do did an a as that this these those there their its it about into than most more recent studies study results effect effects efficacy"
  ).split(/\s+/),
);

/** Palabras que deben conservarse aunque estén en la lista de vacías porque cambian el sentido. */
const KEEP = new Set(["no", "not", "sin", "without"]);

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type QueryKind = "doi" | "keywords" | "question";

export interface PreparedQuery {
  kind: QueryKind;
  /** Texto que se enviará a la fuente */
  text: string;
  /** DOI normalizado cuando kind = "doi" */
  doi?: string;
  /** true si se quitaron palabras de una pregunta */
  simplified: boolean;
}

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (/[¿?]/.test(t)) return true;
  const first = fold(t.split(/\s+/)[0] ?? "");
  return ["que", "cual", "cuales", "como", "cuanto", "donde", "por", "what", "which", "how", "does", "do", "is", "are", "can"].includes(first) && t.split(/\s+/).length >= 4;
}

/** Usa operadores booleanos explícitos (AND, OR, NOT en mayúsculas) o comillas. */
export function hasBooleanSyntax(text: string): boolean {
  return /\b(AND|OR|NOT)\b/.test(text) || /"[^"]+"/.test(text);
}

export function prepareQuery(raw: string): PreparedQuery {
  const text = raw.trim().replace(/\s+/g, " ");
  const doi = normalizeDoi(text);
  if (doi) return { kind: "doi", text: doi, doi, simplified: false };
  if (!looksLikeQuestion(text) || hasBooleanSyntax(text)) return { kind: "keywords", text, simplified: false };
  const terms = text
    .replace(/[¿?¡!.,;:()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .filter((w) => KEEP.has(fold(w)) || !STOPWORDS.has(fold(w)))
    .filter((w) => w.length > 1 || /\d/.test(w));
  const out = terms.join(" ").trim();
  // Si la pregunta quedó vacía, se envía tal cual
  return out ? { kind: "question", text: out, simplified: out !== text } : { kind: "keywords", text, simplified: false };
}
