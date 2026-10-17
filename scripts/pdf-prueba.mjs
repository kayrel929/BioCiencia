// Genera un PDF de PRUEBA (no es un artículo real) para las pruebas de interfaz del lector de PDF.
// Uso: node scripts/pdf-prueba.mjs tests/e2e/fixtures/pdf-de-prueba.pdf
import { writeFileSync } from "node:fs";

const pages = [
  ["Documento de prueba de BioCiencia", "Este PDF fue generado para las pruebas automaticas.", "Los conidios sobrevivieron en el rastrojo durante dieciocho meses.", "Primera pagina del documento."],
  ["Segunda pagina", "La rotacion de cultivos reduce la fuente de inoculo.", "Fin del documento de prueba."],
];
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const objs = [];
const add = (s) => (objs.push(s), objs.length);
const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
const pagesId = objs.length + 1 + pages.length * 2; // se crea al final
const kids = [];
for (const lines of pages) {
  const stream = ["BT", "/F1 14 Tf", "72 760 Td", "18 TL", ...lines.map((l) => `(${esc(l)}) Tj T*`), "ET"].join("\n");
  const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
}
const pg = add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
if (pg !== pagesId) throw new Error("numeración");
const cat = add(`<< /Type /Catalog /Pages ${pg} 0 R >>`);
let out = "%PDF-1.4\n";
const offs = [];
objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = out.length;
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(process.argv[2], Buffer.from(out, "latin1"));
console.log("PDF de prueba:", process.argv[2], out.length, "bytes");
