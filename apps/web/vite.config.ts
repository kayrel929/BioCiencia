import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Servicios externos que la app puede consultar (todos gratuitos y públicos). */
export const API_HOSTS = [
  "https://api.openalex.org",
  "https://api.crossref.org",
  "https://eutils.ncbi.nlm.nih.gov",
  "https://www.ebi.ac.uk",
  "https://doaj.org",
  "https://api.unpaywall.org",
  "https://pub.orcid.org",
  "https://api.opencitations.net",
  "https://api.semanticscholar.org",
  "https://export.arxiv.org",
  "https://api.openaire.eu",
  // Estilos de cita CSL que no vienen incluidos (repositorio oficial, solo al elegirlos)
  "https://raw.githubusercontent.com",
  // IA (Fase 7): solo se usan si el usuario la configura; la nube además requiere su autorización
  "http://127.0.0.1:11434",
  "http://localhost:11434",
  "http://127.0.0.1:1234",
  "https://api.openai.com",
  "https://api.anthropic.com",
  "https://api.groq.com",
  "https://generativelanguage.googleapis.com",
  "https://openrouter.ai",
];

/**
 * Política de seguridad de contenido (CSP) para la versión compilada: solo código propio,
 * sin scripts en línea ni de otros sitios, y conexiones únicamente a las API de la lista.
 * `wasm-unsafe-eval` es necesario para SQLite en WebAssembly. En modo desarrollo no se aplica
 * porque Vite inyecta scripts en línea para recargar en caliente.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  `connect-src 'self' ${API_HOSTS.join(" ")}`,
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "manifest-src 'self'",
  // Recuadro oficial de citas de Scopus (solo si el usuario guarda su propia clave)
  "frame-src https://api.elsevier.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

const cspPlugin = (): Plugin => ({
  name: "biociencia-csp",
  apply: "build",
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
});

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: "./",
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  worker: { format: "es" },
  build: { target: "es2022", outDir: "dist" },
  server: { port: 5173 },
});
