import { normalizeDoi, type Work } from "@biociencia/core";

/**
 * Enlaces de ayuda para conseguir un artículo por vías legales.
 * Ninguno descarga nada por sí mismo: abren el navegador del usuario.
 */

/** Google Académico no tiene API pública: solo se abre su página de resultados en el navegador. */
export function googleScholarUrl(query: string): string {
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(query.trim())}`;
}

export function googleScholarForWork(w: Pick<Work, "title" | "doi">): string {
  return googleScholarUrl(w.doi ? `"${w.title}" ${w.doi}` : `"${w.title}"`);
}

/**
 * Acceso institucional mediante el proxy de la biblioteca (EZproxy u OpenAthens).
 * El usuario escribe el prefijo que le da su biblioteca, p. ej. "https://login.ezproxy.uni.edu/login?url=".
 */
export function institutionalUrl(prefix: string | null | undefined, w: Pick<Work, "doi" | "landingUrl">): string | null {
  const p = (prefix ?? "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(p)) return null;
  const doi = normalizeDoi(w.doi ?? null);
  const target = doi ? `https://doi.org/${doi}` : w.landingUrl;
  if (!target) return null;
  return p.includes("{url}") ? p.replace("{url}", encodeURIComponent(target)) : `${p}${encodeURIComponent(target)}`;
}

/** Correo cortés al autor pidiendo una copia para uso personal de investigación. */
export function authorRequestEmail(w: Pick<Work, "title" | "doi" | "venue" | "year" | "authors">, sender: string): { subject: string; body: string } {
  const doi = normalizeDoi(w.doi ?? null);
  const firstAuthor = w.authors[0]?.name ?? "";
  const subject = `Solicitud de copia del artículo / Request for a copy: ${w.title}`.slice(0, 180);
  const ref = `${w.title}${w.venue ? `. ${w.venue}` : ""}${w.year ? ` (${w.year})` : ""}${doi ? `. https://doi.org/${doi}` : ""}`;
  const body = [
    `Estimado/a Dr./Dra. ${firstAuthor || "autor/a"}:`,
    "",
    "Le escribo para solicitarle, si es posible, una copia de su artículo para uso personal de investigación:",
    "",
    ref,
    "",
    "Muchas gracias por su atención.",
    "",
    "---",
    "",
    `Dear Dr. ${firstAuthor || "author"},`,
    "",
    "I would be grateful if you could share a copy of your article for my personal research use:",
    "",
    ref,
    "",
    "Thank you very much.",
    "",
    sender || "",
  ].join("\n");
  return { subject, body };
}

export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
