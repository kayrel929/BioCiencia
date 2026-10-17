import { sha256Hex } from "@biociencia/core";

/**
 * Lectura de PDF con pdf.js (Mozilla, licencia Apache 2.0). Se carga solo cuando se abre un PDF,
 * para que el resto de la aplicación no se vuelva más lenta. Todo ocurre en la computadora del usuario.
 */

// Versión «legacy»: incluye los complementos que necesitan navegadores no tan recientes
// (la versión moderna usa funciones de JavaScript que aún no tienen todos los Chrome/Edge).
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let loader: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  loader ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return loader;
}

export async function openPdf(bytes: Uint8Array) {
  const pdfjs = await loadPdfJs();
  // Copia: pdf.js transfiere el búfer al worker
  return pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
}

/** Separador entre páginas en el texto guardado (permite saber de qué página es cada frase). */
export const PAGE_BREAK = "\f";

export function isPdf(bytes: Uint8Array): boolean {
  // «%PDF-» puede ir precedido de unos pocos bytes
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
  return head.includes("%PDF-");
}

/** Número de páginas y texto de cada página. */
export async function extractPdf(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const doc = await openPdf(bytes);
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let t = "";
    for (const it of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof it.str !== "string") continue;
      t += it.str + (it.hasEOL ? "\n" : "");
    }
    // Une palabras cortadas con guion al final de línea
    texts.push(t.replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2").replace(/[ \t]+\n/g, "\n").trim());
  }
  await doc.loadingTask.destroy();
  return { pages: texts.length, text: texts.join(PAGE_BREAK) };
}

export function pageTexts(text: string): string[] {
  return text.split(PAGE_BREAK);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const d = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return sha256Hex(bytes);
}
