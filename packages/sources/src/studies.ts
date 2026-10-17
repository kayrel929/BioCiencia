/**
 * Búsqueda por tipo de estudio y por método. Sintaxis verificada el 2026-10-15 en las API reales
 * (con «maize», cada filtro redujo los resultados como se esperaba).
 *  - Tipo de estudio: clasificación oficial de PubMed («Publication Type», [pt]) que Europe PMC
 *    expone como PUB_TYPE. Solo esas dos fuentes la tienen.
 *  - Método: palabras del método buscadas en el texto (no es una clasificación). Requiere paréntesis
 *    y OR, que solo se usan en PubMed y Europe PMC.
 */
export type StudyType = "rct" | "clinical" | "meta" | "sysrev" | "review" | "observational" | "case" | "guideline";

export const STUDY_TYPES: { id: StudyType; label: string; pubmed: string; epmc: string }[] = [
  { id: "meta", label: "Metaanálisis", pubmed: "meta-analysis[pt]", epmc: 'PUB_TYPE:"Meta-Analysis"' },
  { id: "sysrev", label: "Revisión sistemática", pubmed: "systematic review[pt]", epmc: 'PUB_TYPE:"Systematic Review"' },
  { id: "review", label: "Revisión (narrativa o sistemática)", pubmed: "review[pt]", epmc: 'PUB_TYPE:"Review"' },
  { id: "rct", label: "Ensayo controlado aleatorizado", pubmed: "randomized controlled trial[pt]", epmc: 'PUB_TYPE:"Randomized Controlled Trial"' },
  { id: "clinical", label: "Ensayo clínico (cualquiera)", pubmed: "clinical trial[pt]", epmc: 'PUB_TYPE:"Clinical Trial"' },
  { id: "observational", label: "Estudio observacional", pubmed: "observational study[pt]", epmc: 'PUB_TYPE:"Observational Study"' },
  { id: "case", label: "Reporte de caso", pubmed: "case reports[pt]", epmc: 'PUB_TYPE:"Case Reports"' },
  { id: "guideline", label: "Guía de práctica", pubmed: "practice guideline[pt]", epmc: 'PUB_TYPE:"Practice Guideline"' },
];

export type MethodId = "field" | "greenhouse" | "invitro" | "molecular" | "survey" | "model" | "remote";

/** Palabras del método en inglés (idioma de casi todos los resúmenes indexados). */
export const METHODS: { id: MethodId; label: string; terms: string[] }[] = [
  { id: "field", label: "Ensayo de campo", terms: ["field trial", "field experiment", "field study", "field conditions"] },
  { id: "greenhouse", label: "Invernadero / casa de malla", terms: ["greenhouse", "glasshouse", "screenhouse", "pot experiment"] },
  { id: "invitro", label: "In vitro / laboratorio", terms: ["in vitro", "dual culture", "laboratory assay"] },
  { id: "molecular", label: "Molecular / secuenciación", terms: ["PCR", "sequencing", "metagenomic", "transcriptome", "genome"] },
  { id: "survey", label: "Encuesta / muestreo", terms: ["survey", "questionnaire", "sampling survey", "incidence survey"] },
  { id: "model", label: "Modelación / simulación", terms: ["simulation model", "crop model", "species distribution model", "forecasting model"] },
  { id: "remote", label: "Sensores remotos / drones", terms: ["remote sensing", "UAV", "drone", "satellite imagery", "multispectral"] },
];

const quote = (t: string) => (/\s/.test(t) ? `"${t}"` : t);

export function studyTypeClause(types: StudyType[] | undefined, engine: "pubmed" | "epmc"): string | null {
  const defs = STUDY_TYPES.filter((s) => types?.includes(s.id));
  if (!defs.length) return null;
  return `(${defs.map((d) => d[engine]).join(" OR ")})`;
}

export function methodClause(method: MethodId | null | undefined): string | null {
  const m = METHODS.find((x) => x.id === method);
  return m ? `(${m.terms.map(quote).join(" OR ")})` : null;
}

/** Fuentes que entienden estos filtros (las demás se omiten y se informa). */
export const STUDY_FILTER_SOURCES = ["pubmed", "europepmc"] as const;
