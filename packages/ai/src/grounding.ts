import type { Work } from "@biociencia/core";
import type { ChatMessage } from "./providers.ts";

/**
 * Respuestas con fuentes verificables. El modelo solo recibe fuentes reales (de la biblioteca o de las bases
 * de datos) y debe citarlas por número. Después, BioCiencia COMPRUEBA sin IA:
 *  - que cada número citado corresponda a una fuente entregada (si no, se marca y se quita);
 *  - que cada «cita textual» aparezca literalmente en el texto de esa fuente (si no, se marca «no verificada»).
 * Así no puede aparecer un artículo, DOI o cita inventada como si fuera real.
 */

export interface Source {
  n: number;
  work: Work;
  /** Texto que se entrega al modelo (resumen o texto pegado por el usuario) */
  text: string;
}

// ---------------- Comparación de citas textuales ----------------

/** Normaliza para comparar: minúsculas, sin tildes, comillas y guiones uniformes, espacios simples. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’‚′`´]/g, "'")
    .replace(/[“”„″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, "")
    .trim();
}

export const MIN_QUOTE_WORDS = 4;

/** ¿La cita aparece literalmente en el texto? Se exigen al menos 4 palabras para que no sea trivial. */
export function quoteFound(quote: string | null | undefined, text: string): boolean {
  if (!quote) return false;
  const q = normalizeForMatch(quote).replace(/\.{3}|…/g, " ");
  if (q.split(" ").filter(Boolean).length < MIN_QUOTE_WORDS) return false;
  const t = normalizeForMatch(text);
  // Una cita con «…» se acepta si cada tramo aparece en orden
  const parts = normalizeForMatch(quote).split(/\s*(?:\.{3}|…)\s*/).filter((p) => p.length);
  let from = 0;
  for (const p of parts) {
    const at = t.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
}

/** Extrae el primer objeto JSON de una respuesta (los modelos a veces agregan texto alrededor). */
export function parseJsonLoose(raw: string): any | null {
  const s = raw.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ---------------- Fuentes para el modelo ----------------

export function sourceLabel(w: Work): string {
  const first = w.authors[0]?.name ?? "Autor no indicado";
  return `${first}${w.authors.length > 1 ? " et al." : ""} (${w.year ?? "s. f."}). ${w.title}${w.venue ? `. ${w.venue}` : ""}`;
}

export function sourcesBlock(sources: Source[], maxCharsEach = 3000): string {
  return sources
    .map((s) => `[${s.n}] ${sourceLabel(s.work)}\n${s.text.slice(0, maxCharsEach)}${s.text.length > maxCharsEach ? " […]" : ""}`)
    .join("\n\n");
}

// ---------------- 1. Preguntar a las fuentes ----------------

export function askMessages(question: string, sources: Source[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Eres un asistente de investigación científica. Responde en español usando ÚNICAMENTE la información de las fuentes numeradas que se te entregan. " +
        "No uses conocimiento propio ni inventes artículos, autores, datos o DOI. Cita cada afirmación con el número de la fuente entre corchetes, por ejemplo [2]. " +
        "Si las fuentes no permiten responder, dilo claramente. " +
        'Responde solo con JSON: {"respuesta": "texto con citas [n]", "afirmaciones": [{"texto": "afirmación", "fuentes": [n], "cita": "frase copiada literalmente de la fuente, en su idioma original"}]}',
    },
    { role: "user", content: `FUENTES:\n\n${sourcesBlock(sources)}\n\nPREGUNTA: ${question}` },
  ];
}

export type ClaimStatus = "verificada" | "cita_no_encontrada" | "sin_cita" | "fuente_inexistente";

export interface CheckedClaim {
  text: string;
  sources: number[];
  quote: string | null;
  status: ClaimStatus;
}

export interface CheckedAnswer {
  /** Respuesta con las citas inválidas reemplazadas por [?] */
  answer: string;
  /** Números citados que no corresponden a ninguna fuente entregada */
  invalidRefs: number[];
  /** Fuentes realmente citadas, en orden */
  cited: number[];
  claims: CheckedClaim[];
  /** El modelo no respondió en el formato pedido (se muestra el texto tal cual, igualmente verificado) */
  unstructured: boolean;
}

/** Números en marcas como [1], [1, 3], [2-4] o [1;2]. */
export function citationNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\[(\d+(?:\s*[-–,;]\s*\d+)*)\]/g)) {
    for (const part of m[1]!.split(/\s*[,;]\s*/)) {
      const r = part.split(/\s*[-–]\s*/).map(Number);
      if (r.length === 2 && r[1]! >= r[0]! && r[1]! - r[0]! < 50) for (let i = r[0]!; i <= r[1]!; i++) out.push(i);
      else out.push(r[0]!);
    }
  }
  return out;
}

export function checkAnswer(raw: string, sources: Source[]): CheckedAnswer {
  const valid = new Set(sources.map((s) => s.n));
  const byN = new Map(sources.map((s) => [s.n, s]));
  const j = parseJsonLoose(raw);
  const unstructured = !j || typeof j.respuesta !== "string";
  let answer = unstructured ? raw.trim() : String(j.respuesta);
  const all = citationNumbers(answer);
  const invalidRefs = [...new Set(all.filter((n) => !valid.has(n)))];
  // Se quitan los números que no existen
  answer = answer.replace(/\[(\d+(?:\s*[-–,;]\s*\d+)*)\]/g, (m) => {
    const ns = citationNumbers(m);
    const ok = ns.filter((n) => valid.has(n));
    return ok.length === ns.length ? m : ok.length ? `[${ok.join(", ")}]` : "[?]";
  });
  const claims: CheckedClaim[] = (Array.isArray(j?.afirmaciones) ? j.afirmaciones : [])
    .filter((c: any) => c && typeof c.texto === "string")
    .map((c: any) => {
      const srcs: number[] = (Array.isArray(c.fuentes) ? c.fuentes : []).map(Number).filter(Number.isFinite);
      const quote = typeof c.cita === "string" && c.cita.trim() ? c.cita.trim() : null;
      let status: ClaimStatus;
      if (!srcs.length || srcs.some((n) => !valid.has(n))) status = "fuente_inexistente";
      else if (!quote) status = "sin_cita";
      else status = srcs.some((n) => quoteFound(quote, byN.get(n)!.text)) ? "verificada" : "cita_no_encontrada";
      return { text: c.texto, sources: srcs.filter((n) => valid.has(n)), quote, status };
    });
  for (const c of claims) for (const n of c.sources) if (!all.includes(n)) all.push(n);
  const cited = [...new Set(all.filter((n) => valid.has(n)))];
  return { answer, invalidRefs, cited, claims, unstructured };
}

// ---------------- 2. ¿Esta fuente apoya la afirmación? ----------------

export type Verdict = "apoya" | "refuta" | "mixto" | "no_relacionado";
export const VERDICT_LABEL: Record<Verdict | "no_verificado" | "sin_respuesta", string> = {
  apoya: "Apoya",
  refuta: "Refuta",
  mixto: "Resultados mixtos",
  no_relacionado: "No trata el tema",
  no_verificado: "Sin cita verificable",
  sin_respuesta: "Sin respuesta del modelo",
};

export function verdictMessages(claim: string, source: Source): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Evalúas si un texto científico apoya o refuta una afirmación. Usa solo el texto entregado. " +
        'Responde solo con JSON: {"veredicto": "apoya" | "refuta" | "mixto" | "no_relacionado", ' +
        '"cita": "frase copiada literalmente del texto que justifica el veredicto (vacía si no_relacionado)", "explicacion": "una oración en español"}',
    },
    { role: "user", content: `AFIRMACIÓN: ${claim}\n\nTEXTO [${source.n}]: ${sourceLabel(source.work)}\n${source.text.slice(0, 4000)}` },
  ];
}

export interface CheckedVerdict {
  verdict: Verdict | "no_verificado" | "sin_respuesta";
  /** Lo que dijo el modelo antes de verificar */
  modelVerdict: Verdict | null;
  quote: string | null;
  quoteVerified: boolean;
  explanation: string;
}

const VERDICTS: Verdict[] = ["apoya", "refuta", "mixto", "no_relacionado"];

/** Versión del veredicto para una pregunta (flujo de consenso): la misma verificación, pero la pregunta no es una afirmación. */
export function questionVerdictMessages(question: string, source: Source): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Evalúas si un texto científico sirve como respuesta a una pregunta de investigación y en qué dirección. Usa solo el texto entregado. " +
        'Responde solo con JSON: {"veredicto": "apoya" | "refuta" | "mixto" | "no_relacionado", ' +
        '"cita": "frase copiada literalmente del texto que justifica el veredicto (vacía si no_relacionado)", "explicacion": "una oración en español"}',
    },
    { role: "user", content: `PREGUNTA: ${question}\n\nTEXTO [${source.n}]: ${sourceLabel(source.work)}\n${source.text.slice(0, 4000)}` },
  ];
}

export function checkVerdict(raw: string, source: Source): CheckedVerdict {
  const j = parseJsonLoose(raw);
  const v = String(j?.veredicto ?? "").toLowerCase().replace(/\s+/g, "_") as Verdict;
  if (!j || !VERDICTS.includes(v)) return { verdict: "sin_respuesta", modelVerdict: null, quote: null, quoteVerified: false, explanation: "" };
  const quote = typeof j.cita === "string" && j.cita.trim() ? j.cita.trim() : null;
  const ok = quoteFound(quote, source.text);
  const explanation = typeof j.explicacion === "string" ? j.explicacion : "";
  // Un «apoya» o «refuta» sin una cita que exista en el texto no se acepta
  if (v !== "no_relacionado" && !ok) return { verdict: "no_verificado", modelVerdict: v, quote, quoteVerified: false, explanation };
  return { verdict: v, modelVerdict: v, quote, quoteVerified: ok, explanation };
}

// ---------------- Términos de búsqueda ----------------

/** Pide al modelo términos en inglés para buscar en la biblioteca (los resúmenes suelen estar en inglés). */
export function keywordMessages(question: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Extrae de la pregunta de 3 a 8 términos de búsqueda científicos, en inglés y en el idioma original, sin palabras vacías. " +
        'Responde solo con JSON: {"terminos": ["término", "..."]}',
    },
    { role: "user", content: question },
  ];
}

export function parseKeywords(raw: string, fallbackQuestion: string): string[] {
  const j = parseJsonLoose(raw);
  const list: string[] = Array.isArray(j?.terminos) ? j.terminos.filter((t: unknown) => typeof t === "string") : [];
  const fromQuestion = fallbackQuestion
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((w) => w.length > 3);
  return [...new Set([...list, ...fromQuestion].map((t) => t.trim()).filter((t) => t.length > 1))].slice(0, 12);
}

// ---------------- Preguntas relacionadas (flujo de consenso) ----------------

/** Pide 3 preguntas de investigación estrechamente relacionadas, para sugerir la siguiente búsqueda. */
export function relatedQuestionsMessages(question: string, sources: Source[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "A partir de una pregunta de investigación y sus fuentes, redacte 3 preguntas de investigación estrechamente relacionadas y útiles para el siguiente paso del investigador, en español, cada una terminando en «?», sin repetir la pregunta original. " +
        'Responde solo con JSON: {"preguntas": ["pregunta", "pregunta", "pregunta"]}',
    },
    { role: "user", content: `PREGUNTA: ${question}\n\nFUENTES:\n\n${sourcesBlock(sources, 800)}` },
  ];
}

export function parseRelatedQuestions(raw: string): string[] {
  const j = parseJsonLoose(raw);
  const list: string[] = Array.isArray(j?.preguntas) ? j.preguntas : [];
  return [
    ...new Set(list),
  ]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 10)
    .slice(0, 3);
}

// ---------------- Texto de los PDF adjuntos ----------------

const normWord = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Elige los pasajes del texto completo (PDF) que más se relacionan con los términos, sin pasar de `maxChars`.
 * Los pasajes se devuelven en el orden del documento, separados por « […] », y son copias literales
 * del texto: así la verificación de frases citadas sigue siendo exacta.
 */
export function relevantPassages(fullText: string, terms: string[], maxChars = 1800, chunk = 600): string {
  const text = fullText.replace(/\f/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  // Trozos por párrafos, de unos `chunk` caracteres
  const paras = text.split(/\n\s*\n|\n(?=[A-ZÁÉÍÓÚÑ0-9])/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > chunk) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur} ${p}` : p;
    while (cur.length > chunk * 2) {
      const cut = cur.lastIndexOf(". ", chunk * 1.5);
      const at = cut > chunk / 2 ? cut + 1 : chunk;
      chunks.push(cur.slice(0, at).trim());
      cur = cur.slice(at).trim();
    }
  }
  if (cur) chunks.push(cur);
  const words = [...new Set(terms.flatMap((t) => normWord(t).split(/[^\p{L}\p{N}-]+/u)).filter((w) => w.length > 3))];
  const scored = chunks.map((c, i) => {
    const n = normWord(c);
    const score = words.reduce((s, w) => s + (n.split(w).length - 1), 0);
    return { i, c, score };
  });
  const picked: typeof scored = [];
  let size = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (s.score === 0 && picked.length) break;
    if (size + s.c.length > maxChars && picked.length) continue;
    picked.push(s);
    size += s.c.length;
    if (size >= maxChars) break;
  }
  return picked.sort((a, b) => a.i - b.i).map((p) => p.c.slice(0, maxChars)).join(" […] ");
}

/** Texto que se entrega al modelo para una publicación: el resumen y, si hay PDF, sus pasajes más relevantes. */
export function sourceTextFor(abstract: string | null | undefined, pdfText: string | null | undefined, terms: string[]): string {
  const a = (abstract ?? "").trim();
  const p = pdfText ? relevantPassages(pdfText, terms) : "";
  if (a && p) return `RESUMEN: ${a}\n\nTEXTO COMPLETO (pasajes): ${p}`;
  return a || p;
}

// ---------------- Carta para pedir el texto completo al autor (redacción asistida con IA) ----------------

export interface RequesterIdea {
  name: string;
  institution: string;
  position?: string;
  purpose?: string;
}

/**
 * Mensajes para que la IA redacte la carta formal que pide el texto completo al autor.
 * La carta SIEMPRE se muestra a la persona antes de enviarla: la IA solo propone el texto y
 * BioCiencia no envía nada por sí solo. Sin IA configurada, la carta de plantilla local sigue
 * disponible igual que siempre.
 */
export function articleRequestMessages(input: { work: Work; requester: RequesterIdea; lang: "es" | "en" }): ChatMessage[] {
  const { work, requester, lang } = input;
  const idioma = lang === "en" ? "in English" : "en español";
  const meta = [
    `Título: ${work.title}`,
    work.authors.length ? `Autores: ${work.authors.map((a) => a.name).join(", ")}` : "",
    work.year ? `Año: ${work.year}` : "",
    work.doi ? `DOI: ${work.doi}` : "",
  ].filter(Boolean).join("\n");
  return [
    {
      role: "system",
      content:
        `Redacta ${idioma} una carta formal, breve y respetuosa para pedir a los autores una copia del texto completo de un artículo científico. ` +
        `Responde EXCLUSIVAMENTE con JSON: {"asunto": "...", "cuerpo": "párrafo1\\n\\npárrafo2..."} (asunto sin comillas largas; cuerpo con 3 a 4 párrafos separados por doble salto de línea). ` +
        `Reglas: tono cordial y concreto; menciona el título del artículo y el DOI si existe; explica el uso previsto; no inventes datos del solicitante más allá de los entregados; ` +
        `no incluyas listas ni espacios por llenar; cierra agradeciendo y ofreciendo compartir resultados si colaboran.`,
    },
    {
      role: "user",
      content:
        `ARTÍCULO:\n${meta}\n\nSOLICITANTE:\nNombre: ${requester.name || "(no indicado)"}\nCargo o rol: ${requester.position || "(no indicado)"}\nInstitución: ${requester.institution || "(no indicada)"}\nUso previsto: ${requester.purpose || "(no indicado)"}`,
    },
  ];
}

// ---------------- Citas inteligentes (estilo Scite) ----------------

export type CitationType = "supporting" | "contrasting" | "mentioning";

export const CITATION_TYPE_LABEL: Record<CitationType, string> = {
  supporting: "Apoya",
  contrasting: "Contrasta",
  mentioning: "Menciona",
};

/**
 * Pide al modelo que clasifique cómo cita una publicación a otra.
 * Scite muestra si las citas apoyan, contrastan o solo mencionan.
 */
export function smartCitationMessages(citingWork: Work, citedWork: Work, context: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Clasifica cómo una publicación cita a otra. Usa solo el contexto entregado. " +
        'Responde solo con JSON: {"tipo": "supporting" | "contrasting" | "mentioning", "razon": "una oración"}.\n' +
        "supporting: la cita usa el trabajo para apoyar una afirmación. " +
        "contrasting: la cita discrepa, matiza o contradice el trabajo. " +
        "mentioning: la cita solo menciona el trabajo de pasada.",
    },
    {
      role: "user",
      content:
        `PUBLICACIÓN QUE CITA:\n${citingWork.title}\n\nTRABAJO CITADO:\n${citedWork.title}\n\nCONTEXTO DE LA CITA:\n${context.slice(0, 2000)}`,
    },
  ];
}

// ---------------- Extracción de datos (estilo Elicit) ----------------

export interface ExtractedData {
  population?: string;
  intervention?: string;
  comparison?: string;
  outcome?: string;
  studyDesign?: string;
  sampleSize?: string;
  location?: string;
  duration?: string;
  keyFindings?: string;
  limitations?: string;
}

/**
 * Pide al modelo que extraiga datos estructurados de un resumen.
 * Elicit extrae PICO y otros datos de los papers automáticamente.
 */
export function extractDataMessages(work: Work): ChatMessage[] {
  const text = (work.abstract ?? "").trim();
  if (!text) throw new Error("Este paper no tiene resumen para extraer datos.");
  return [
    {
      role: "system",
      content:
        "Extrae datos estructurados de un resumen científico. " +
        'Responde solo con JSON con estas claves (vacías si no están): ' +
        '{"population": "", "intervention": "", "comparison": "", "outcome": "", "studyDesign": "", "sampleSize": "", "location": "", "duration": "", "keyFindings": "", "limitations": ""}',
    },
    { role: "user", content: `RESUMEN:\n${text.slice(0, 4000)}` },
  ];
}

// ---------------- Búsqueda profunda iterativa (estilo Undermind) ----------------

/**
 * Pide al modelo que refine una búsqueda para encontrar papers que una
 * búsqueda por palabras clave no encontraría.
 */
export function deepSearchMessages(question: string, foundTitles: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Eres un experto en búsqueda de literatura científica. Dada una pregunta y los títulos ya encontrados, " +
        "sugiere 5 términos o frases de búsqueda alternativos que encontrarían papers relevantes que la búsqueda original no halló. " +
        'Responde solo con JSON: {"terminos": ["término1", "término2", ...]}',
    },
    {
      role: "user",
      content:
        `PREGUNTA: ${question}\n\nTÍTULOS YA ENCONTRADOS:\n${foundTitles.slice(0, 20).map((t) => `- ${t}`).join("\n")}`,
    },
  ];
}
