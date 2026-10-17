import { formatReference, normalizeDoi, segsToText, type Work } from "@biociencia/core";

/**
 * Enlaces de ayuda para conseguir un artículo por vías legales.
 * Ninguno descarga nada por sí mismo: abren el navegador del usuario.
 */

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

// ---------------- Solicitud formal del artículo completo al autor ----------------

/** Datos de quien solicita (se guardan en Configuración para no escribirlos cada vez). */
export interface RequesterProfile {
  name: string;
  /** Tratamiento o grado: «Dr.», «Ing.», «M. Sc.»… */
  title?: string;
  position?: string;
  institution?: string;
  email?: string;
  orcid?: string;
  phone?: string;
}

export type LetterLang = "es" | "en" | "es-en";
/** Tratamiento del destinatario en español */
export type Salutation = "neutral" | "m" | "f";

/**
 * Apellido para el saludo, a partir de las formas en que llegan los nombres:
 * «Dutta TK» → Dutta, «Huet, Gaëlle» → Huet, «Tushar K Dutta» → Dutta, «B C Flett» → Flett.
 */
export function authorSurname(name: string | null | undefined): string {
  const n = (name ?? "").trim().replace(/\s+/g, " ");
  if (!n) return "";
  if (n.includes(",")) return n.split(",")[0]!.trim();
  const t = n.split(" ");
  if (t.length >= 2 && /^[A-ZÁÉÍÓÚÑÜ]{1,3}\.?$/.test(t[t.length - 1]!) && !/^[A-ZÁÉÍÓÚÑÜ]{1,3}\.?$/.test(t[0]!)) return t.slice(0, -1).join(" ");
  return t[t.length - 1]!;
}

function longDate(d: Date, lang: "es" | "en"): string {
  return d.toLocaleDateString(lang === "es" ? "es-ES" : "en-US", { day: "numeric", month: "long", year: "numeric" });
}

function signature(p: RequesterProfile): string[] {
  const lines = [[p.title, p.name].filter((x) => x && x.trim()).join(" ").trim()];
  if (p.position?.trim()) lines.push(p.position.trim());
  if (p.institution?.trim()) lines.push(p.institution.trim());
  if (p.email?.trim()) lines.push(p.email.trim());
  if (p.phone?.trim()) lines.push(p.phone.trim());
  if (p.orcid?.trim()) lines.push(`ORCID: https://orcid.org/${p.orcid.trim().replace(/^https?:\/\/orcid\.org\//, "")}`);
  return lines.filter(Boolean);
}

function presentation(p: RequesterProfile, lang: "es" | "en"): string {
  const who = [p.title, p.name].filter((x) => x && x.trim()).join(" ").trim() || (lang === "es" ? "[su nombre]" : "[your name]");
  const pos = p.position?.trim();
  const inst = p.institution?.trim();
  if (lang === "es") return `Mi nombre es ${who}${pos ? `, ${pos}` : ""}${inst ? `${pos ? " de" : ", de"} ${inst}` : ""}.`;
  return `My name is ${who}${pos ? `, ${pos}` : ""}${inst ? ` at ${inst}` : ""}.`;
}

/**
 * Carta formal para solicitar al autor una copia del artículo completo, en español, inglés o ambos.
 * BioCiencia no envía nada: el texto se abre en el programa de correo del usuario o se copia.
 */
export function formalAuthorRequest(
  w: Work,
  recipient: { name?: string | null } | null,
  sender: RequesterProfile,
  opts: { lang?: LetterLang; purpose?: string; salutation?: Salutation; noAccess?: boolean; date?: Date } = {},
): { subject: string; body: string } {
  const lang = opts.lang ?? "es";
  const date = opts.date ?? new Date();
  const surname = authorSurname(recipient?.name ?? w.authors[0]?.name ?? "");
  const purpose = opts.purpose?.trim().replace(/[.\s]+$/, "");
  const noAccess = opts.noAccess !== false;
  const refEs = segsToText(formatReference(w, "apa-es"));
  const refEn = segsToText(formatReference(w, "apa-en"));
  const title = w.title.replace(/[.\s]+$/, "");

  const sal = opts.salutation ?? "neutral";
  const greetEs = surname
    ? sal === "m" ? `Estimado Dr. ${surname}:` : sal === "f" ? `Estimada Dra. ${surname}:` : `Estimado(a) Dr(a). ${surname}:`
    : "Estimado(a) autor(a):";
  const es = [
    longDate(date, "es"),
    "",
    greetEs,
    "",
    "Reciba un cordial y respetuoso saludo.",
    "",
    `${presentation(sender, "es")} Me dirijo a usted con el mayor respeto para solicitarle, de la manera más atenta, una copia en formato digital de su artículo:`,
    "",
    refEs,
    "",
    `Su trabajo resulta de especial relevancia para ${purpose || "la investigación que actualmente desarrollo"}.${noAccess ? " Lamentablemente, no dispongo de acceso a esta publicación a través de mi institución." : ""}`,
    "",
    "Me comprometo a utilizar el documento exclusivamente con fines académicos y de investigación, a no redistribuirlo y a respetar los derechos de autor y las condiciones de la editorial. Su trabajo será, desde luego, debidamente citado en las publicaciones que de ello se deriven.",
    "",
    "Agradezco de antemano su amable atención y la generosidad de compartir su trabajo. Quedo a su entera disposición para cualquier información adicional que considere necesaria.",
    "",
    "Con sentimientos de la más alta consideración y estima,",
    "",
    "Atentamente,",
    "",
    ...signature(sender),
  ];
  const en = [
    longDate(date, "en"),
    "",
    surname ? `Dear Dr. ${surname},` : "Dear Author,",
    "",
    "I hope this message finds you well.",
    "",
    `${presentation(sender, "en")} I am writing to respectfully request, if at all possible, a digital copy of your article:`,
    "",
    refEn,
    "",
    `Your work is of particular relevance to ${purpose || "my current research"}.${noAccess ? " Unfortunately, I do not have access to this publication through my institution." : ""}`,
    "",
    "I would use the article solely for academic and research purposes, would not redistribute it, and would fully respect the copyright and the publisher's terms. Your work will, of course, be duly cited in any resulting publications.",
    "",
    "Thank you very much in advance for your kind attention and for your generosity in sharing your work. Please do not hesitate to contact me should you require any further information.",
    "",
    "With my highest consideration and respect,",
    "",
    "Yours sincerely,",
    "",
    ...signature(sender),
  ];
  const subjEs = `Solicitud respetuosa de copia del artículo «${title}»`;
  const subjEn = `Kind request for a copy of your article "${title}"`;
  if (lang === "en") return { subject: subjEn.slice(0, 250), body: en.join("\n") };
  if (lang === "es") return { subject: subjEs.slice(0, 250), body: es.join("\n") };
  return {
    subject: `${subjEs} / ${subjEn}`.slice(0, 250),
    body: [...es, "", "— English version —", "", ...en.slice(2)].join("\n"),
  };
}
