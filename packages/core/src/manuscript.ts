import type { Seg } from "./cite.ts";

/**
 * Manuscritos en Markdown sencillo: # títulos, párrafos, listas, **negrita** y *cursiva*.
 * Se convierten a bloques que luego se escriben en HTML o en Word (.docx) sin librerías externas.
 */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type Block =
  | { type: "h1" | "h2" | "h3" | "p"; runs: Run[] }
  | { type: "ul" | "ol"; items: Run[][] };

export function parseInline(s: string): Run[] {
  const out: Run[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else out.push({ text: (m[3] ?? m[4])!, italic: true });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", runs: parseInline(para.join(" ")) });
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (h) {
      flush();
      blocks.push({ type: (["h1", "h2", "h3"] as const)[h[1]!.length - 1]!, runs: parseInline(h[2]!) });
    } else if (ul || ol) {
      flush();
      const type = ul ? "ul" : "ol";
      const prev = blocks.at(-1);
      const item = parseInline((ul ?? ol)![1]!);
      if (prev && prev.type === type) prev.items.push(item);
      else blocks.push({ type, items: [item] });
    } else para.push(line.trim());
  }
  flush();
  return blocks;
}

export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const runHtml = (r: Run) => {
  let t = esc(r.text);
  if (r.italic) t = `<em>${t}</em>`;
  if (r.bold) t = `<strong>${t}</strong>`;
  return t;
};

export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => ("items" in b ? `<${b.type}>${b.items.map((i) => `<li>${i.map(runHtml).join("")}</li>`).join("")}</${b.type}>` : `<${b.type}>${b.runs.map(runHtml).join("")}</${b.type}>`))
    .join("\n");
}

export function referencesHtml(refs: { segs: Seg[] }[], numbered: boolean, heading: string): string {
  if (!refs.length) return "";
  const items = refs.map((r) => `<li>${r.segs.map((s) => (s.italic ? `<em>${esc(s.text)}</em>` : esc(s.text))).join("")}</li>`).join("");
  return `<h2>${esc(heading)}</h2>\n${numbered ? `<ol class="refs">${items}</ol>` : `<ul class="refs apa">${items}</ul>`}`;
}

/** Documento HTML completo (para abrir en el navegador o en Word). */
export function manuscriptHtml(title: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:"Times New Roman",serif;font-size:12pt;line-height:2;max-width:46em;margin:2.5cm auto}h1{font-size:14pt;text-align:center}h2{font-size:12pt}h3{font-size:12pt;font-style:italic}.refs.apa{list-style:none;padding:0}.refs.apa li{padding-left:2em;text-indent:-2em}</style>
</head><body>\n${body}\n</body></html>\n`;
}

export const TEMPLATES: { id: string; label: string; content: string }[] = [
  {
    id: "imryd",
    label: "Artículo científico (IMRyD)",
    content: `# Título del artículo

**Resumen.** Escriba aquí un resumen de 200 a 250 palabras: objetivo, métodos, resultados principales y conclusión.

**Palabras clave:** palabra 1, palabra 2, palabra 3

## Introducción

Contexto del problema y antecedentes [@clave].

## Materiales y métodos

### Área de estudio

### Diseño experimental

### Análisis estadístico

## Resultados

## Discusión

## Conclusiones
`,
  },
  {
    id: "nota",
    label: "Nota corta / primer reporte",
    content: `# Primer reporte de …

**Resumen.**

## Introducción

## Materiales y métodos

## Resultados y discusión
`,
  },
  {
    id: "informe",
    label: "Informe técnico",
    content: `# Informe técnico

## Antecedentes

## Objetivo

## Metodología

## Resultados

## Recomendaciones
`,
  },
  { id: "vacio", label: "Documento en blanco", content: "# Título\n\n" },
];
