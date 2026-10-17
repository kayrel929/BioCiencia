// Servidor local mínimo (sin dependencias) para usar BioCiencia como aplicación en esta computadora.
// Sirve la versión compilada (apps/web/dist) solo en 127.0.0.1: nadie más en la red puede entrar.
// 127.0.0.1 también es la dirección que Ollama acepta por defecto para la IA local.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../apps/web/dist/", import.meta.url)));
const port = Number(process.env.BC_PORT ?? 5173);
const host = "127.0.0.1";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

export function resolvePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const file = normalize(join(root, clean === "/" ? "index.html" : clean));
  // Nunca fuera de la carpeta dist
  return file === root || file.startsWith(root + sep) ? file : null;
}

/** Solo se permite consultar el propio perfil público de Google Académico (nunca otras webs). */
export function scholarTarget(rawUrl, userId) {
  if (/^[A-Za-z0-9_-]{6,}$/.test(userId)) return `https://scholar.google.com/citations?hl=es&user=${userId}`;
  try {
    const t = new URL(rawUrl);
    if (/(^|\.)scholar\.google\./i.test(t.hostname) && t.pathname.startsWith("/citations")) return t.toString();
  } catch {
    /* dirección no válida */
  }
  return null;
}

/** Extrae las cifras (citas, índice h, índice i10) del HTML del perfil de Google Académico. */
export function parseScholarProfile(html) {
  const out = {};
  const name = html.match(/<div[^>]*id="gsc_prf_in"[^>]*>([^<]+)</i);
  if (name) out.name = name[1].trim();
  const since = html.match(/(?:Since|Desde)\s+(\d{4})/i);
  if (since) out.sinceYear = Number(since[1]);
  const domain = html.replace(/<[^>]+>/g, " ").match(/(?:verified email at|correo verificad[ao] de)\s*([A-Za-z0-9.-]+\.[A-Za-z]{2,})/i);
  if (domain) out.emailDomain = domain[1];
  const table = html.match(/<table[^>]*id="gsc_rsb_st"[\s\S]*?<\/table>/i)?.[0] ?? "";
  for (const row of table.split(/<tr\b/i).slice(1)) {
    const labelCell = row.match(/class="[^"]*gsc_rsb_sc1[^"]*"[\s\S]*?<\/td>/i)?.[0] ?? "";
    const label = labelCell.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const nums = [...row.matchAll(/class="[^"]*gsc_rsb_std[^"]*"[^>]*>\s*(\d+)/gi)].map((m) => Number(m[1]));
    if (!nums.length) continue;
    if (/citas|cited by/.test(label)) { out.citations = nums[0]; if (nums[1] != null) out.sinceCitations = nums[1]; }
    else if (/índice h|indice h|h-?index/.test(label)) { out.h = nums[0]; if (nums[1] != null) out.sinceH = nums[1]; }
    else if (/i10/.test(label)) { out.i10 = nums[0]; if (nums[1] != null) out.sinceI10 = nums[1]; }
  }
  return out;
}

/** Puente /api/scholar: consulta el perfil público desde esta computadora (el navegador no puede por CORS). */
async function scholarReply(url, res, method) {
  const json = (code, data) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(method === "HEAD" ? undefined : JSON.stringify(data));
  };
  const target = scholarTarget(url.searchParams.get("url") ?? "", url.searchParams.get("user") ?? "");
  if (!target) return json(400, { error: "Dirección no válida: use el enlace de su perfil de Google Académico." });
  try {
    const r = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; BioCiencia/1.0; uso personal)", "accept-language": "es, en;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return json(502, { error: `Google respondió ${r.status}. Inténtelo más tarde o use el pegado manual.` });
    const datos = parseScholarProfile(await r.text());
    if (typeof datos.citations !== "number") return json(502, { error: "No se leyeron las cifras (quizá Google pidió un captcha). Use el pegado manual." });
    return json(200, datos);
  } catch {
    return json(502, { error: "No se pudo consultar Google Académico. Use el pegado manual." });
  }
}

/** Solo se permite consultar la API pública de Semantic Scholar, y solo por DOI. */
export function s2Target(doi) {
  const d = String(doi ?? "").trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d : null;
}

/** Parámetros de búsqueda que el puente deja pasar a Semantic Scholar (lo demás se descarta). */
const S2_SEARCH_PARAMS = new Set(["query", "limit", "fields", "year", "sort", "offset"]);

/**
 * Puente /api/s2: consulta Semantic Scholar desde esta computadora (el navegador no puede leerla por CORS).
 * Acepta ?doi=… (un artículo) o los parámetros de búsqueda: ?query=…&limit=…&year=…&sort=…&offset=…&fields=…
 */
async function s2Reply(url, res, method) {
  const json = (code, data) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(method === "HEAD" ? undefined : JSON.stringify(data));
  };
  const doi = s2Target(url.searchParams.get("doi") ?? "");
  const query = (url.searchParams.get("query") ?? "").trim();
  if (!doi && !query) return json(400, { error: "Falta un DOI o una consulta." });
  let target;
  if (doi) {
    const fields = "paperId,citationCount,influentialCitationCount,year";
    target = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=${fields}`;
  } else {
    const qs = new URLSearchParams();
    for (const [k, v] of url.searchParams) if (S2_SEARCH_PARAMS.has(k)) qs.set(k, v.slice(0, 400));
    target = `https://api.semanticscholar.org/graph/v1/paper/search?${qs}`;
  }
  try {
    const r = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; BioCiencia/1.0; uso personal)", accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (r.status === 404) return json(404, { encontrado: false });
    if (r.status === 429) return json(429, { error: "Semantic Scholar limitó las consultas seguidas. Espere un minuto e inténtelo otra vez." });
    if (!r.ok) return json(502, { error: `Semantic Scholar respondió ${r.status}. Inténtelo más tarde.` });
    return json(200, await r.json());
  } catch {
    return json(502, { error: "No se pudo consultar Semantic Scholar. Inténtelo más tarde." });
  }
}

/**
 * Rutas de OpenAI que el puente deja pasar (lo demás se descarta, para que no sirva de
 * intermediario hacia cualquier cosa). Son las que usa la app: crear respuestas y listar modelos.
 */
export const OPENAI_ROUTES = new Set(["/v1/chat/completions", "/v1/models"]);

/** Comprueba que la ruta pedida sea una de las permitidas y devuelve la dirección final en OpenAI. */
export function openaiTarget(pathname) {
  const resto = typeof pathname === "string" && pathname.startsWith("/api/openai") ? pathname.slice("/api/openai".length) : "";
  return OPENAI_ROUTES.has(resto) ? `https://api.openai.com${resto}` : null;
}

/** Lee el cuerpo de la petición (con un tope para no agotar la memoria). */
function leerCuerpo(req, limite = 4_000_000) {
  return new Promise((resolver, rechazar) => {
    let datos = "";
    req.on("data", (trozo) => {
      datos += trozo;
      if (datos.length > limite) {
        rechazar(new Error("cuerpo demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => resolver(datos));
    req.on("error", rechazar);
  });
}

/**
 * Puente /api/openai: OpenAI no permite que las páginas del navegador lean sus respuestas (CORS),
 * así que quien consulta es esta computadora, igual que con arXiv y Semantic Scholar. La clave del
 * usuario solo viaja de su navegador a esta máquina (127.0.0.1) y de aquí a OpenAI; nunca se guarda
 * ni se escribe en el registro. Solo se permite consultar api.openai.com, y solo esas rutas.
 */
async function openaiReply(url, req, res, method) {
  const responder = (code, cuerpo) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(method === "HEAD" ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo));
  };
  const destino = openaiTarget(url.pathname);
  if (!destino) return responder(404, { error: "Dirección de OpenAI no permitida." });
  const clave = req.headers["authorization"];
  if (!clave) return responder(401, { error: "Falta la clave de API de OpenAI." });
  if (method !== "POST" && method !== "GET") return responder(405, { error: "Método no permitido." });
  let cuerpo;
  if (method === "POST") {
    try {
      cuerpo = await leerCuerpo(req);
    } catch {
      return responder(413, { error: "La petición era demasiado grande." });
    }
  }
  try {
    const r = await fetch(destino, {
      method,
      headers: { authorization: String(clave), "content-type": "application/json", accept: "application/json" },
      body: cuerpo,
      signal: AbortSignal.timeout(120000),
    });
    // Se devuelve la respuesta tal cual (incluidos los errores de OpenAI) para que la app los explique.
    return responder(r.status, await r.text());
  } catch {
    return responder(502, { error: "No se pudo consultar OpenAI. Revise su conexión a internet." });
  }
}

/** Parámetros de búsqueda que el puente deja pasar a arXiv (lo demás se descarta). */
const ARXIV_PARAMS = new Set(["search_query", "start", "max_results", "sortBy"]);

/** Puente /api/arxiv: consulta arXiv desde esta computadora (el navegador no puede leerla por CORS). */
async function arxivReply(url, res, method) {
  const enviar = (code, body, tipo) => {
    res.writeHead(code, { "content-type": tipo, "cache-control": "no-store" });
    res.end(method === "HEAD" ? undefined : body);
  };
  const error = (code, mensaje) => enviar(code, JSON.stringify({ error: mensaje }), "application/json; charset=utf-8");
  const consulta = (url.searchParams.get("search_query") ?? "").trim();
  if (!consulta) return error(400, "Falta la consulta.");
  const qs = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (ARXIV_PARAMS.has(k)) qs.set(k, v.slice(0, 600));
  try {
    const r = await fetch(`https://export.arxiv.org/api/query?${qs}`, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; BioCiencia/1.0; uso personal)", accept: "application/atom+xml" },
      signal: AbortSignal.timeout(25000),
    });
    if (r.status === 429 || r.status === 503) return error(429, "arXiv pidió esperar un momento (demasiadas consultas seguidas).");
    if (!r.ok) return error(502, `arXiv respondió ${r.status}. Inténtelo más tarde.`);
    return enviar(200, await r.text(), "application/atom+xml; charset=utf-8");
  } catch {
    return error(502, "No se pudo consultar arXiv. Inténtelo más tarde.");
  }
}

const server = createServer(async (req, res) => {
  const api = new URL(req.url ?? "/", `http://${host}`);
  // El puente de IA recibe POST (con el cuerpo de la consulta); los demás puentes son de solo lectura.
  if (api.pathname === "/api/openai" || api.pathname.startsWith("/api/openai/")) return openaiReply(api, req, res, req.method ?? "GET");
  if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
  if (api.pathname === "/api/scholar") return scholarReply(api, res, req.method);
  if (api.pathname === "/api/s2") return s2Reply(api, res, req.method);
  if (api.pathname === "/api/arxiv") return arxivReply(api, res, req.method);
  const file = resolvePath(req.url ?? "/");
  try {
    if (!file || !(await stat(file)).isFile()) throw new Error("no");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": extname(file) === ".html" || file.endsWith("sw.js") ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("No encontrado");
  }
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await stat(join(root, "index.html"));
  } catch {
    console.error("Falta la versión compilada. Ejecute primero: npm.cmd run build:web");
    process.exit(1);
  }
  server.listen(port, host, () => {
    console.log(`\nBioCiencia está abierta en  http://${host}:${port}/\n(deje esta ventana abierta mientras la usa; ciérrela para salir)\n`);
  });
  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `El puerto ${port} ya está en uso: quizá BioCiencia ya está abierta en http://${host}:${port}/` : e.message);
    process.exit(1);
  });
}
export { server };
