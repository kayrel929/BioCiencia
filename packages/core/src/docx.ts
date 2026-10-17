import type { Seg } from "./cite.ts";
import type { Block, Run } from "./manuscript.ts";

/**
 * Escritor mínimo de Word (.docx, Office Open XML) sin dependencias:
 * títulos, párrafos, listas, negrita/cursiva y referencias con sangría francesa.
 * El paquete ZIP se escribe sin compresión («store»), que Word y LibreOffice aceptan.
 */

// ---------------- ZIP (store) ----------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en formato DOS; fija para que el mismo documento produzca los mismos bytes. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // nombres en UTF-8
    lh.setUint16(8, 0, true); // store
    lh.setUint16(10, DOS_TIME, true);
    lh.setUint16(12, DOS_DATE, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, f.data.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    const local = concat([new Uint8Array(lh.buffer), name, f.data]);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, DOS_TIME, true);
    ch.setUint16(14, DOS_DATE, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, f.data.length, true);
    ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    centrals.push(concat([new Uint8Array(ch.buffer), name]));
    locals.push(local);
    offset += local.length;
  }
  const cd = concat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cd.length, true);
  end.setUint32(16, offset, true);
  return concat([...locals, cd, new Uint8Array(end.buffer)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

// ---------------- WordprocessingML ----------------

const x = (s: string) =>
  s
    // caracteres de control no permitidos en XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function runXml(r: { text: string; bold?: boolean; italic?: boolean }): string {
  const props = (r.bold ? "<w:b/>" : "") + (r.italic ? "<w:i/>" : "");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${x(r.text)}</w:t></w:r>`;
}

const para = (style: string | null, runs: string, extra = "") => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>` : ""}${runs}</w:p>`;

const STYLE_OF: Record<string, string | null> = { h1: "Title", h2: "Heading1", h3: "Heading2", p: null };

export interface DocxInput {
  title: string;
  blocks: Block[];
  references?: { segs: Seg[] }[];
  numbered?: boolean;
  referencesHeading?: string;
  lang?: string;
  /** «letter»: interlineado sencillo, sin sangría (cartas). Por defecto, formato de manuscrito (doble espacio). */
  layout?: "manuscript" | "letter";
}

export function documentXml(inp: DocxInput): string {
  const body: string[] = [];
  for (const b of inp.blocks) {
    if ("items" in b) {
      b.items.forEach((item: Run[], i) => {
        const mark = b.type === "ol" ? `${i + 1}.\t` : "•\t";
        body.push(para("ListParagraph", runXml({ text: mark }) + item.map(runXml).join("")));
      });
    } else body.push(para(STYLE_OF[b.type] ?? null, b.runs.map(runXml).join("")));
  }
  const refs = inp.references ?? [];
  if (refs.length) {
    body.push(para("Heading1", runXml({ text: inp.referencesHeading ?? "Referencias" })));
    refs.forEach((r, i) => {
      const lead = inp.numbered ? runXml({ text: `${i + 1}. ` }) : "";
      body.push(para("Bibliography", lead + r.segs.map(runXml).join("")));
    });
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function stylesXml(lang: string, layout: "manuscript" | "letter" = "manuscript"): string {
  const letter = layout === "letter";
  const style = (id: string, name: string, ppr: string, rpr: string) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="${x(lang)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${letter ? '<w:spacing w:after="160" w:line="276" w:lineRule="auto"/>' : '<w:spacing w:after="0" w:line="480" w:lineRule="auto"/>'}</w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr>${letter ? '<w:jc w:val="both"/>' : '<w:ind w:firstLine="720"/>'}</w:pPr></w:style>
${style("Title", "Title", '<w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:after="240"/>', '<w:b/><w:sz w:val="28"/>')}
${style("Heading1", "heading 1", '<w:keepNext/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/>', "<w:b/>")}
${style("Heading2", "heading 2", '<w:keepNext/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/>', "<w:b/><w:i/>")}
${style("ListParagraph", "List Paragraph", '<w:ind w:left="720" w:hanging="360"/>', "")}
${style("Bibliography", "Bibliography", '<w:ind w:left="720" w:hanging="720"/>', "")}
</w:styles>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const coreXml = (title: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(title)}</dc:title><dc:creator>BioCiencia</dc:creator></cp:coreProperties>`;

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Construye el archivo .docx completo. */
export function manuscriptDocx(inp: DocxInput): Uint8Array {
  const enc = new TextEncoder();
  const f = (name: string, s: string) => ({ name, data: enc.encode(s) });
  return zipStore([
    f("[Content_Types].xml", CONTENT_TYPES),
    f("_rels/.rels", ROOT_RELS),
    f("word/_rels/document.xml.rels", DOC_RELS),
    f("word/document.xml", documentXml(inp)),
    f("word/styles.xml", stylesXml(inp.lang ?? "es-ES", inp.layout)),
    f("docProps/core.xml", coreXml(inp.title)),
  ]);
}
