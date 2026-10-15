/**
 * Normalización de identificadores bibliográficos.
 * Un mismo artículo puede llegar con el DOI escrito de muchas formas;
 * todas deben producir la misma clave.
 */

/** Devuelve el DOI en minúsculas sin prefijos de URL, o null si no parece un DOI. */
export function normalizeDoi(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* se deja tal cual si tiene % mal formados */
  }
  s = s
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^(dx\.)?doi\.org\//i, "")
    .trim()
    .toLowerCase();
  // Signos de puntuación finales que suelen pegarse al copiar desde un texto
  s = s.replace(/[.,;:)\]}>]+$/, "");
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s : null;
}

export function normalizePmid(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, "").replace(/\/$/, "");
  return /^\d{1,9}$/.test(s) ? s : null;
}

/** IDs de OpenAlex: "https://openalex.org/W123" -> "W123". */
export function normalizeOpenAlexId(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.trim().match(/(?:openalex\.org\/)?([WAISCFT]\d+)$/i);
  return m && m[1] ? m[1].toUpperCase() : null;
}

export function normalizeArxivId(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().replace(/^arxiv:/i, "").replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, "").replace(/\.pdf$/i, "");
  const m = s.match(/^(\d{4}\.\d{4,5})(v\d+)?$/) ?? s.match(/^([a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i);
  return m && m[1] ? m[1].toLowerCase() : null;
}

/** Texto normalizado para comparar títulos: sin acentos, sin puntuación, espacios simples. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * ORCID: acepta "0000-0002-1825-0097", "https://orcid.org/0000-0002-1825-0097" o sin guiones.
 * Valida el dígito de control (ISO 7064 11,2). Devuelve la forma con guiones o null.
 */
export function normalizeOrcid(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().replace(/^https?:\/\/(www\.)?orcid\.org\//i, "").replace(/[\s-]/g, "").toUpperCase();
  if (!/^\d{15}[\dX]$/.test(raw)) return null;
  let total = 0;
  for (const ch of raw.slice(0, 15)) total = (total + Number(ch)) * 2;
  const result = (12 - (total % 11)) % 11;
  const check = result === 10 ? "X" : String(result);
  if (check !== raw[15]) return null;
  return raw.match(/.{4}/g)!.join("-");
}
