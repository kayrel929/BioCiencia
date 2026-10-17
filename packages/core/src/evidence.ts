import type { Work } from "./works.ts";

/**
 * Indicadores rápidos de calidad y una ficha del estudio, SIN inteligencia artificial:
 * se calculan con reglas a partir del tipo de publicación y del texto del resumen, y cada dato
 * muestra la frase de la que salió, para que el investigador lo compruebe.
 */

// ---------------- Nivel de evidencia ----------------

export interface EvidenceLevel {
  /** 1 = más alto (metaanálisis) … 6 = más bajo (opinión / revisión narrativa) */
  level: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  /** De dónde salió la clasificación */
  basis: "tipo de publicación (PubMed)" | "título o resumen";
}

export const EVIDENCE_LEVELS: { level: EvidenceLevel["level"]; label: string }[] = [
  { level: 1, label: "Metaanálisis" },
  { level: 2, label: "Revisión sistemática" },
  { level: 3, label: "Experimento controlado" },
  { level: 4, label: "Estudio observacional o encuesta" },
  { level: 5, label: "Reporte de caso o primer reporte" },
  { level: 6, label: "Revisión narrativa u opinión" },
];

const label = (l: EvidenceLevel["level"]) => EVIDENCE_LEVELS.find((x) => x.level === l)!.label;

const PT_RULES: [RegExp, EvidenceLevel["level"]][] = [
  [/^meta-analysis$/i, 1],
  [/^systematic review$/i, 2],
  [/randomized controlled trial|^controlled clinical trial$|^clinical trial|^equivalence trial|^pragmatic clinical trial/i, 3],
  [/^observational study|^comparative study$|^multicenter study$|^validation study$|^evaluation study$/i, 4],
  [/^case reports$/i, 5],
  [/^review$|^editorial$|^comment$|^letter$|^news$|^practice guideline$/i, 6],
];

const TEXT_RULES: [RegExp, EvidenceLevel["level"]][] = [
  [/\bmeta-?an[aá]lisis\b|\bmeta-?analy(sis|ses|tic)\b/i, 1],
  [/\bsystematic (literature )?review\b|\brevisi[oó]n sistem[aá]tica\b|\bPRISMA\b/i, 2],
  [/\brandomi[sz]ed\b|\baleatori[sz]ad[oa]s?\b|\bcompletely random|\bbloques? (completos? )?al azar\b|\bDBCA\b|\bfield (trial|experiment)s?\b|\bensayos? de campo\b|\bgreenhouse (trial|experiment)|\binvernadero\b|\bin vitro\b|\bcontrol(led)? (treatment|group)s?\b|\bcompared (to|with) (the )?(untreated |non-?inoculated )?controls?\b|\btransgenic lines\b|\btratamiento testigo\b|\btestigo\b/i, 3],
  [/\bsurvey(ed)?\b|\bencuesta\b|\bcross-sectional\b|\bcohort\b|\bcase-control\b|\bobservational\b|\bmonitoring\b|\bmonitoreo\b|\bmuestreo\b|\bsampled\b|\bincidence\b|\bprevalence\b|\bprevalencia\b/i, 4],
  [/\bfirst report\b|\bprimer reporte\b|\bcase report\b|\breporte de caso\b|\bnew record\b/i, 5],
  [/\b(a |this )?(narrative )?review\b|\brevisi[oó]n\b|\bperspective\b|\bopinion\b|\beditorial\b/i, 6],
];

/** Nivel de evidencia según el tipo de publicación de PubMed y, si no hay, el título y el resumen. */
export function evidenceLevel(w: Pick<Work, "pubTypes" | "title" | "abstract" | "type">): EvidenceLevel | null {
  const pts = w.pubTypes ?? [];
  let best: EvidenceLevel["level"] | null = null;
  for (const pt of pts) for (const [re, l] of PT_RULES) if (re.test(pt) && (best === null || l < best)) best = l;
  // «Review» de PubMed solo cuenta si no hay algo más específico
  if (best !== null && !(best === 6 && pts.some((p) => /^review$/i.test(p)) && pts.length > 2)) return { level: best, label: label(best), basis: "tipo de publicación (PubMed)" };
  // Título primero (más fiable), luego el resumen
  for (const text of [w.title, w.abstract ?? ""]) {
    for (const [re, l] of TEXT_RULES) if (text && re.test(text)) return { level: l, label: label(l), basis: "título o resumen" };
  }
  if (w.type === "review") return { level: 6, label: label(6), basis: "título o resumen" };
  return null;
}

// ---------------- Citas por año ----------------

export function citationsPerYear(w: Pick<Work, "citedByCount" | "year">, now = new Date()): number | null {
  if (typeof w.citedByCount !== "number" || !w.year) return null;
  const age = Math.max(1, now.getFullYear() - w.year + 1);
  return w.citedByCount / age;
}

/**
 * Publicaciones «muy citadas» dentro de un conjunto de resultados: el 10 % con más citas por año
 * (con al menos 5 citas). Es relativo a lo que se está viendo, no un índice global.
 */
export function highlyCited(works: Pick<Work, "citedByCount" | "year">[], now = new Date()): Set<number> {
  const rates = works.map((w, i) => ({ i, r: citationsPerYear(w, now), c: w.citedByCount ?? 0 })).filter((x): x is { i: number; r: number; c: number } => x.r !== null && x.c >= 5);
  if (rates.length < 3) return new Set();
  const sorted = [...rates].sort((a, b) => b.r - a.r);
  const n = Math.max(1, Math.ceil(rates.length * 0.1));
  return new Set(sorted.slice(0, n).map((x) => x.i));
}

// ---------------- Ficha del estudio ----------------

export interface SnapshotItem {
  label: string;
  value: string;
  /** Frase del resumen de la que salió el dato */
  sentence: string;
}

/** Divide un resumen en frases (respeta abreviaturas comunes como «sp.», «et al.», «e.g.»). */
export function sentences(text: string): string[] {
  const protectedText = text
    .replace(/\b(sp|spp|var|cv|et al|e\.g|i\.e|vs|ca|approx|aprox|Fig|fig|No|no|Dr|Dra|subsp|f\. sp)\./g, (m) => m.replace(/\./g, "\u0000"))
    .replace(/\b([A-Z])\. (?=[a-z])/g, "$1\u0000 "); // «S. maydis»
  return protectedText
    .split(/(?<=[.!?])\s+(?=[\p{L}0-9(«"])|\n+/u)
    .map((s) => s.replace(/\u0000/g, ".").trim())
    .filter((s) => s.length > 3);
}

const UNITS_N = "plants?|seedlings?|samples?|isolates?|strains?|farms?|farmers?|growers?|households?|fields?|plots?|trees?|participants?|patients?|subjects?|animals?|accessions?|genotypes?|cultivars?|hybrids?|varieties|lines|sites?|locations?|ears?|fruits?|leaves|roots?|soils?|muestras?|plantas?|plántulas?|aislamientos?|cepas?|fincas?|productores?|agricultores?|parcelas?|árboles?|sitios?|localidades|genotipos?|cultivares?|híbridos?|variedades|líneas|mazorcas?|frutos?|hojas|raíces";

const DESIGNS: [RegExp, string][] = [
  [/randomi[sz]ed complete block|bloques completos al azar|\bDBCA\b|\bRCBD\b/i, "Bloques completos al azar"],
  [/completely randomi[sz]ed|completamente al azar|\bDCA\b|\bCRD\b/i, "Completamente al azar"],
  [/split[- ]plot|parcelas divididas/i, "Parcelas divididas"],
  [/\bfactorial\b/i, "Factorial"],
  [/randomi[sz]ed controlled trial|ensayo (cl[ií]nico )?aleatorizado/i, "Ensayo aleatorizado"],
  [/meta-?analy|metaan[aá]lisis/i, "Metaanálisis"],
  [/systematic review|revisi[oó]n sistem[aá]tica/i, "Revisión sistemática"],
  [/\bsurvey|encuesta/i, "Encuesta"],
  [/cross-sectional|transversal/i, "Estudio transversal"],
  [/longitudinal|cohort/i, "Estudio longitudinal"],
];

const SETTINGS: [RegExp, string][] = [
  [/\bfield (trial|experiment|condition|plot|stud)|\bunder field\b|\bcondiciones de campo\b|\ben campo\b|\bensayos? de campo\b/i, "Campo"],
  [/\bgreenhouse|\binvernadero|\bscreenhouse|\bcasa de malla/i, "Invernadero"],
  [/\bin vitro\b|\blaboratory|\blaboratorio|\bPDA\b|\bpetri\b/i, "Laboratorio / in vitro"],
  [/\bin silico\b|\bmodel(l)?ing\b|\bmodelaci[oó]n|\bsimulat/i, "Modelación"],
];

const COUNTRIES: [string, string[]][] = [
  ["Ecuador", ["Ecuador", "Ecuadorian", "ecuatoriana", "ecuatoriano"]], ["Colombia", ["Colombia"]], ["Perú", ["Peru", "Perú"]], ["Bolivia", ["Bolivia"]],
  ["Venezuela", ["Venezuela"]], ["Brasil", ["Brazil", "Brasil", "Brazilian"]], ["Argentina", ["Argentina"]], ["Chile", ["Chile"]], ["Uruguay", ["Uruguay"]],
  ["Paraguay", ["Paraguay"]], ["México", ["Mexico", "México", "Mexican"]], ["Guatemala", ["Guatemala"]], ["Honduras", ["Honduras"]], ["Nicaragua", ["Nicaragua"]],
  ["Costa Rica", ["Costa Rica"]], ["Panamá", ["Panama", "Panamá"]], ["Cuba", ["Cuba"]], ["República Dominicana", ["Dominican Republic", "República Dominicana"]],
  ["El Salvador", ["El Salvador"]], ["Estados Unidos", ["United States", "USA", "U.S.A.", "Estados Unidos"]], ["Canadá", ["Canada", "Canadá"]],
  ["España", ["Spain", "España"]], ["Portugal", ["Portugal"]], ["Francia", ["France", "Francia"]], ["Italia", ["Italy", "Italia"]], ["Alemania", ["Germany", "Alemania"]],
  ["Reino Unido", ["United Kingdom", "UK", "England", "Reino Unido"]], ["Países Bajos", ["Netherlands", "Países Bajos"]], ["China", ["China", "Chinese"]],
  ["India", ["India", "Indian"]], ["Japón", ["Japan", "Japón"]], ["Corea del Sur", ["Korea", "Corea"]], ["Indonesia", ["Indonesia"]], ["Filipinas", ["Philippines", "Filipinas"]],
  ["Vietnam", ["Vietnam", "Viet Nam"]], ["Tailandia", ["Thailand", "Tailandia"]], ["Malasia", ["Malaysia", "Malasia"]], ["Pakistán", ["Pakistan", "Pakistán"]],
  ["Bangladés", ["Bangladesh"]], ["Irán", ["Iran", "Irán"]], ["Turquía", ["Turkey", "Türkiye", "Turquía"]], ["Egipto", ["Egypt", "Egipto"]],
  ["Sudáfrica", ["South Africa", "Sudáfrica"]], ["Nigeria", ["Nigeria"]], ["Kenia", ["Kenya", "Kenia"]], ["Etiopía", ["Ethiopia", "Etiopía"]],
  ["Ghana", ["Ghana"]], ["Tanzania", ["Tanzania"]], ["Uganda", ["Uganda"]], ["Costa de Marfil", ["Côte d'Ivoire", "Ivory Coast", "Costa de Marfil"]],
  ["Camerún", ["Cameroon", "Camerún"]], ["Australia", ["Australia"]], ["Nueva Zelanda", ["New Zealand", "Nueva Zelanda"]],
];

const NOT_GENUS = new Set("The This These That Those Here There Our We In On At For From With Without Among Both Each All Most Some Such Its It However Moreover Therefore Thus Results Methods Conclusions Background Objective Objectives Aims Aim Key Further Next Finally First Second La El Los Las Un Una En Se Este Esta Estos Estas Por Para Con Sin Del Los Resultados Métodos Conclusiones Objetivo Además Sin Sin Asimismo Finalmente Plant Plants Soil Field Two Three Four Five Six Seven Eight Nine Ten Previous Recent Several Many Few New".split(" "));
const LATIN_END = /(us|um|a|ae|is|i|ii|es|ensis|oides|ata|atum|atus|ella|ina|inum|icola|ophila|ana|ianum|alis|ilis|ium|ia|or|ays|ax|ex|ix)$/;

function firstMatch(sents: string[], re: RegExp): string | null {
  return sents.find((s) => re.test(s)) ?? null;
}

/** Ficha rápida del estudio a partir del resumen (y el título). Cada dato trae su frase de origen. */
export function studySnapshot(w: Pick<Work, "title" | "abstract">): SnapshotItem[] {
  const abstract = (w.abstract ?? "").replace(/\s+/g, " ").trim();
  if (!abstract) return [];
  const sents = sentences(abstract);
  const items: SnapshotItem[] = [];

  // Tamaño de muestra: «n = 120», «120 plantas», «36 aislamientos»
  const nRe = new RegExp(`\\b[nN]\\s*=\\s*(\\d[\\d.,]*)|\\b(\\d{1,3}(?:[.,]\\d{3})*|\\d+)\\s+(?:[a-zA-Záéíóúñ-]+\\s+){0,2}?(${UNITS_N})\\b`, "i");
  for (const s of sents) {
    const m = s.match(nRe);
    if (m) {
      const value = m[1] ? `n = ${m[1]}` : `${m[2]} ${m[3]}`;
      // Descarta años y porcentajes
      if (!/^(19|20)\d{2}\b/.test(m[2] ?? "") && !/%/.test(s.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 2))) {
        items.push({ label: "Muestra", value, sentence: s });
        break;
      }
    }
  }

  // Diseño y ámbito
  const designs = DESIGNS.filter(([re]) => re.test(abstract)).map(([, l]) => l);
  if (designs.length) items.push({ label: "Diseño", value: designs.slice(0, 2).join(", "), sentence: firstMatch(sents, DESIGNS.find(([, l]) => l === designs[0])![0]) ?? "" });
  const settings = SETTINGS.filter(([re]) => re.test(abstract));
  if (settings.length) items.push({ label: "Ámbito", value: settings.map(([, l]) => l).join(", "), sentence: firstMatch(sents, settings[0]![0]) ?? "" });

  // Lugar
  const places: { name: string; s: string }[] = [];
  for (const [name, aliases] of COUNTRIES) {
    const re = new RegExp(`(?<![\\p{L}])(${aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}])`, "u");
    const s = firstMatch(sents, re);
    if (s) places.push({ name, s });
  }
  if (places.length) items.push({ label: "Lugar", value: places.slice(0, 4).map((p) => p.name).join(", "), sentence: places[0]!.s });

  // Organismos (nombres científicos binomiales)
  const orgs = new Map<string, string>();
  for (const s of [w.title, ...sents]) {
    for (const m of s.matchAll(/\b([A-Z][a-z]{2,})\s([a-z]{3,})\b/g)) {
      const [full, genus, epithet] = m as unknown as [string, string, string];
      if (NOT_GENUS.has(genus) || !LATIN_END.test(epithet) || /^(and|the|was|were|are|has|had|for|with|las|los|del|que|una|por|con|para|como|sobre)$/.test(epithet)) continue;
      if (!orgs.has(full)) orgs.set(full, s);
    }
  }
  if (orgs.size) items.push({ label: "Organismos", value: [...orgs.keys()].slice(0, 5).join(", "), sentence: [...orgs.values()][0]! });

  // Duración
  const dur = firstMatch(sents, /\b\d+\s*(?:-|to|a|–)?\s*\d*\s*(days?|weeks?|months?|years?|seasons?|d[ií]as|semanas|meses|años|ciclos|campañas)\b/i);
  if (dur) {
    const m = dur.match(/\b(\d+\s*(?:-|to|a|–)?\s*\d*\s*(?:days?|weeks?|months?|years?|seasons?|d[ií]as|semanas|meses|años|ciclos|campañas))\b/i)!;
    items.push({ label: "Duración o tiempo", value: m[1]!.replace(/\s+/g, " "), sentence: dur });
  }

  // Hallazgo principal: la frase de resultados o conclusión más informativa
  const resultRe = /\b(significant(ly)?|reduc(ed|tion)|increas(ed|e)|decreas(ed|e)|improv(ed|ement)|inhibit(ed|ion)|caused|effective|efficacy|higher|lower|p\s*[<≤]|\d+(\.\d+)?\s*%|redujo|reducci[oó]n|aument[oó]|incremento|disminuy[oó]|inhibi[oó]|eficaz|eficacia|significativ[ao]s?|mayor|menor)\b/i;
  const conclusionRe = /\b(we conclude|in conclusion|these results|our results|results (show|suggest|indicate)|concluimos|en conclusi[oó]n|los resultados (muestran|indican|sugieren))\b/i;
  const finding = sents.find((s) => conclusionRe.test(s)) ?? [...sents].reverse().find((s) => resultRe.test(s));
  if (finding) items.push({ label: "Hallazgo principal", value: finding.length > 280 ? `${finding.slice(0, 277)}…` : finding, sentence: finding });

  return items;
}
