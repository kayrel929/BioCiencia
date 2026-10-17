/**
 * Conexión con modelos de lenguaje, sin librerías. Tres tipos:
 *  - Ollama en la misma computadora (privado y gratuito; el usuario lo instala si quiere). API: POST /api/chat, GET /api/tags.
 *    Por defecto Ollama solo acepta páginas servidas desde 127.0.0.1 (docs.ollama.com/faq): abrir BioCiencia en
 *    http://127.0.0.1:5173 o definir OLLAMA_ORIGINS.
 *  - Servicios compatibles con la API de OpenAI (/chat/completions): LM Studio local, OpenAI, Groq, OpenRouter.
 *  - Anthropic (Messages API con «anthropic-dangerous-direct-browser-access: true» para llamadas desde el navegador).
 * Las claves son del usuario; los servicios en la nube solo se usan con su autorización expresa.
 * OpenAI es la excepción al «directo»: no permite que el navegador lea sus respuestas (CORS), así que sus
 * consultas las hace esta computadora con el puente local /api/openai (ver conPuenteLocal).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface LlmProvider {
  readonly label: string;
  /** true si los datos no salen de la computadora */
  readonly local: boolean;
  chat(messages: ChatMessage[], opts?: { temperature?: number; json?: boolean; timeoutMs?: number }): Promise<string>;
}

export type ProviderKind = "ollama" | "openai-compatible" | "anthropic";

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string | null;
}

/** Direcciones permitidas (también están en la política de seguridad de contenido de la app). */
export const PROVIDER_PRESETS: { id: string; label: string; kind: ProviderKind; baseUrl: string; local: boolean; needsKey: boolean }[] = [
  { id: "ollama", label: "Ollama en esta computadora (privado, gratis)", kind: "ollama", baseUrl: "http://127.0.0.1:11434", local: true, needsKey: false },
  { id: "lmstudio", label: "LM Studio en esta computadora (privado, gratis)", kind: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1", local: true, needsKey: false },
  { id: "openai", label: "OpenAI (en la nube, con su clave)", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", local: false, needsKey: true },
  { id: "anthropic", label: "Anthropic Claude (en la nube, con su clave)", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", local: false, needsKey: true },
  { id: "groq", label: "Groq (en la nube, tiene plan gratuito)", kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", local: false, needsKey: true },
  { id: "google", label: "Google Gemini (en la nube, tiene plan gratuito)", kind: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", local: false, needsKey: true },
  { id: "openrouter", label: "OpenRouter (en la nube, con clave; tiene modelos gratis)", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", local: false, needsKey: true },
];

export class LlmError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "LlmError";
  }
}

async function post(fetchFn: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, label: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (e) {
    const abort = e instanceof Error && e.name === "AbortError";
    throw new LlmError(abort ? `${label} tardó demasiado en responder.` : `No se pudo conectar con ${label}.`);
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message ?? j?.error ?? j?.message ?? "";
    } catch {
      detail = text.slice(0, 200);
    }
    const hint = res.status === 401 || res.status === 403 ? " Revise su clave." : res.status === 404 ? " Revise el nombre del modelo." : res.status === 429 ? " Límite de uso alcanzado; espere un momento." : "";
    throw new LlmError(`${label} respondió con error ${res.status}: ${String(detail).slice(0, 200)}${hint}`, res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError(`${label} devolvió una respuesta que no se pudo leer.`);
  }
}

/**
 * OpenAI no permite que una página del navegador lea sus respuestas (CORS), así que —igual que con arXiv
 * y Semantic Scholar— la consulta la hace esta computadora con el puente local /api/openai que abre
 * «Iniciar BioCiencia». La clave del usuario solo viaja a esta máquina y de aquí a OpenAI; nunca se guarda.
 * Si el puente no está (modo desarrollo, o la app de escritorio), se intenta directo como antes.
 */
export function conPuenteLocal(fetchFn: FetchLike, presetId: string): FetchLike {
  if (presetId !== "openai") return fetchFn;
  return async (url, init) => {
    const m = /^https:\/\/api\.openai\.com\/(.*)$/.exec(String(url));
    if (!m) return fetchFn(url, init);
    try {
      const r = await fetchFn(`/api/openai/${m[1]}`, init);
      // Sin puente: el servidor de desarrollo responde con la página de la app (text/html) y se descarta.
      if (!(r.headers.get("content-type") ?? "").includes("text/html")) return r;
    } catch {
      /* sin puente: se intenta directo */
    }
    return fetchFn(url, init);
  };
}

export function createProvider(cfg: ProviderConfig, fetchFn: FetchLike = (u, i) => fetch(u, i)): LlmProvider {
  const preset = PROVIDER_PRESETS.find((p) => p.baseUrl === cfg.baseUrl);
  if (!preset) throw new LlmError("Dirección de proveedor no permitida.");
  if (!cfg.model.trim()) throw new LlmError("Indique el nombre del modelo.");
  if (preset.needsKey && !cfg.apiKey) throw new LlmError(`${preset.label}: falta la clave de API.`);
  const label = preset.label.replace(/ \(.*\)$/, "");
  const base = cfg.baseUrl.replace(/\/$/, "");
  const enviar = conPuenteLocal(fetchFn, preset.id);
  return {
    label,
    local: preset.local,
    async chat(messages, opts = {}) {
      const temperature = opts.temperature ?? 0;
      const timeout = opts.timeoutMs ?? (preset.local ? 300_000 : 120_000);
      if (cfg.kind === "ollama") {
        const body: Record<string, unknown> = { model: cfg.model, messages, stream: false, options: { temperature } };
        if (opts.json) body.format = "json";
        const r = await post(enviar, `${base}/api/chat`, {}, body, timeout, label);
        return String(r?.message?.content ?? "");
      }
      if (cfg.kind === "anthropic") {
        const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
        const r = await post(
          enviar,
          `${base}/messages`,
          { "x-api-key": cfg.apiKey!, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          { model: cfg.model, max_tokens: 2000, temperature, system: system || undefined, messages: messages.filter((m) => m.role !== "system") },
          timeout,
          label,
        );
        return (r?.content ?? []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("");
      }
      const headers: Record<string, string> = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};
      const body: Record<string, unknown> = { model: cfg.model, messages, temperature };
      if (opts.json && preset.id !== "lmstudio") body.response_format = { type: "json_object" };
      const r = await post(enviar, `${base}/chat/completions`, headers, body, timeout, label);
      return String(r?.choices?.[0]?.message?.content ?? "");
    },
  };
}

/** Modelos instalados en Ollama (para elegir uno). */
export async function listOllamaModels(baseUrl = "http://127.0.0.1:11434", fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<string[]> {
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl.replace(/\/$/, "")}/api/tags`);
  } catch {
    throw new LlmError(
      "No se encontró Ollama en esta computadora. Si ya lo instaló, ábralo y abra BioCiencia en http://127.0.0.1:5173 (Ollama solo acepta esa dirección por defecto).",
    );
  }
  if (!res.ok) throw new LlmError(`Ollama respondió con error ${res.status}.`, res.status);
  const j = await res.json();
  return (j?.models ?? []).map((m: any) => String(m?.name ?? "")).filter(Boolean);
}
