// Genera el catálogo de estilos CSL y copia los estilos y idiomas incluidos sin internet.
// Uso: node scripts/csl-catalogo.mjs <carpeta-del-repositorio-styles> <carpeta-del-repositorio-locales> <commit>
// Fuente: https://github.com/citation-style-language/styles y /locales (licencia CC BY-SA 3.0).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const [stylesDir, localesDir, commit] = process.argv.slice(2);
if (!stylesDir || !localesDir || !commit) throw new Error("Uso: node scripts/csl-catalogo.mjs <styles> <locales> <commit>");
const out = new URL("../packages/cite/src/", import.meta.url).pathname;

const unesc = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
function info(xml) {
  const head = xml.slice(0, xml.indexOf("</info>") + 7);
  const title = unesc(head.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").trim();
  const short = unesc(head.match(/<title-short>([^<]*)<\/title-short>/)?.[1] ?? "").trim();
  const parent = head.match(/<link[^>]*href="http:\/\/www\.zotero\.org\/styles\/([^"]+)"[^>]*rel="independent-parent"/)?.[1]
    ?? head.match(/<link[^>]*rel="independent-parent"[^>]*href="http:\/\/www\.zotero\.org\/styles\/([^"]+)"/)?.[1];
  const format = head.match(/<category[^>]*citation-format="([^"]+)"/)?.[1] ?? "";
  const fields = [...head.matchAll(/<category[^>]*field="([^"]+)"/g)].map((m) => m[1]);
  const lang = xml.match(/<style[^>]*default-locale="([^"]+)"/)?.[1] ?? "";
  return { title, short, parent, format, fields, lang };
}

const catalog = [];
for (const [dir, dep] of [[stylesDir, false], [join(stylesDir, "dependent"), true]]) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".csl")).sort()) {
    const i = info(readFileSync(join(dir, f), "utf8"));
    const id = f.slice(0, -4);
    if (dep && !i.parent) continue;
    const e = { id, t: i.title };
    if (i.short && i.short !== i.title) e.s = i.short;
    if (dep) e.p = i.parent;
    if (i.format) e.c = i.format;
    if (i.fields.length) e.f = i.fields;
    if (i.lang) e.l = i.lang;
    catalog.push(e);
  }
}
// Estilos incluidos en la aplicación (funcionan sin internet). Los demás se descargan al elegirlos.
const INCLUDED = [
  "apa", "apa-6th-edition", "nlm-citation-sequence", "nlm-name-year", "chicago-author-date", "chicago-notes-bibliography", "harvard-cite-them-right", "ieee",
  "modern-language-association", "nature", "science", "american-medical-association", "taylor-and-francis-council-of-science-editors-author-date",
  "elsevier-harvard", "elsevier-with-titles", "elsevier-vancouver", "springer-basic-author-date", "springer-basic-brackets",
  "taylor-and-francis-chicago-author-date", "multidisciplinary-digital-publishing-institute", "frontiers", "plos",
  "iso690-author-date-es", "american-phytopathological-society", "asa-cssa-sssa",
  "american-society-for-horticultural-science", "iica-catie", "cultivos-tropicales", "revista-de-biologia-tropical",
  "revista-fave-seccion-ciencias-agrarias", "molecular-plant-microbe-interactions", "phytopathologia-mediterranea",
  "the-horticulture-journal", "associacao-brasileira-de-normas-tecnicas", "biomed-central", "cell", "pnas",
  "wiley-vch-books", "american-chemical-society", "american-society-for-microbiology", "annual-reviews-author-date",
];
mkdirSync(join(out, "styles"), { recursive: true });
const byId = new Map(catalog.map((e) => [e.id, e]));
const included = [];
for (const id of INCLUDED) {
  const e = byId.get(id);
  if (!e) { console.warn("No existe en el repositorio:", id); continue; }
  if (e.p) { console.warn("Es dependiente, se omite:", id); continue; }
  copyFileSync(join(stylesDir, `${id}.csl`), join(out, "styles", `${id}.csl`));
  included.push(id);
}
const LOCALES = ["es-ES", "es-MX", "es-CL", "en-US", "en-GB", "pt-BR", "pt-PT", "fr-FR", "de-DE", "it-IT"];
mkdirSync(join(out, "locales"), { recursive: true });
for (const l of LOCALES) copyFileSync(join(localesDir, `locales-${l}.xml`), join(out, "locales", `locales-${l}.xml`));

writeFileSync(join(out, "catalog.json"), JSON.stringify({ commit, generated: new Date().toISOString().slice(0, 10), included, styles: catalog }));
console.log(`Catálogo: ${catalog.length} estilos (${catalog.filter((e) => e.p).length} dependientes); incluidos sin internet: ${included.length}; idiomas: ${LOCALES.length}`);
