import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Work } from "@biociencia/core";
import {
  askMessages, articleRequestMessages, checkAnswer, checkVerdict, citationNumbers, createProvider, listOllamaModels, normalizeForMatch, parseJsonLoose, parseRelatedQuestions, parseKeywords,
  questionVerdictMessages, quoteFound, type FetchLike, type Source,
} from "../src/index.ts";

/**
 * Las respuestas del «modelo» son textos de prueba escritos a mano (no hay un modelo real en las pruebas):
 * sirven para comprobar que la verificación detecta citas inventadas y frases que no están en la fuente.
 * El resumen sí es real: registro de Europe PMC PMID 30832079 (Flett et al., 2001, Plant Disease).
 */
const rec = JSON.parse(readFileSync(join(__dirname, "..", "..", "sources", "tests", "fixtures", "europepmc-keyword-null-30832079.json"), "utf8")).resultList.result[0];
const flett: Work = { title: rec.title.replace(/\.$/, ""), authors: [{ name: "B C Flett" }, { name: "N W McLaren" }], year: 2001, venue: "Plant disease", doi: rec.doi, source: "europepmc", fetchedAt: "" };
const other: Work = { title: "Otro trabajo", authors: [{ name: "Ana Torres" }], year: 2020, source: "manual", fetchedAt: "" };
const sources: Source[] = [
  { n: 1, work: flett, text: rec.abstractText },
  { n: 2, work: other, text: "Texto pegado por el usuario sobre fertilización nitrogenada en arroz bajo riego." },
];

describe("verificación de citas textuales", () => {
  it("encuentra frases reales aunque cambien mayúsculas, comillas o espacios", () => {
    expect(quoteFound("Wheat, soybean, and peanut were the most effective", rec.abstractText)).toBe(true);
    expect(quoteFound("“WHEAT,   soybean, and peanut were the most effective”", rec.abstractText)).toBe(true);
    expect(quoteFound("efficacy of crop rotation … the least effective, rotation crops", rec.abstractText)).toBe(true);
  });
  it("rechaza frases inventadas, alteradas o demasiado cortas", () => {
    expect(quoteFound("Maize was the most effective rotation crop", rec.abstractText)).toBe(false);
    expect(quoteFound("Wheat, soybean, and maize were the most effective", rec.abstractText)).toBe(false);
    expect(quoteFound("crop rotation", rec.abstractText)).toBe(false);
    expect(quoteFound(null, rec.abstractText)).toBe(false);
  });
  it("normalización y lectura de JSON con texto alrededor", () => {
    expect(normalizeForMatch("  Ácido   «nítrico» – ")).toBe('acido "nitrico" -');
    expect(parseJsonLoose('Claro: ```json\n{"a": {"b": "x}"}}\n``` listo')).toEqual({ a: { b: "x}" } });
    expect(parseJsonLoose("sin json")).toBeNull();
    expect(citationNumbers("Ver [1], [2-4] y [5; 7]")).toEqual([1, 2, 3, 4, 5, 7]);
  });
});

describe("preguntar a las fuentes", () => {
  it("las instrucciones prohíben conocimiento propio e incluyen las fuentes numeradas", () => {
    const m = askMessages("¿Qué cultivos reducen la pudrición?", sources);
    expect(m[0]!.content).toContain("ÚNICAMENTE");
    expect(m[1]!.content).toContain("[1] B C Flett et al. (2001). Incidence of Stenocarpella maydis Ear Rot of Corn Under Crop Rotation Systems");
  });

  it("acepta una cita verificable, quita un número inventado y marca una frase que no está en la fuente", () => {
    const raw = JSON.stringify({
      respuesta: "La rotación con trigo, soya o maní fue la más eficaz [1]. Según Pérez (2019) el maíz continuo es mejor [7].",
      afirmaciones: [
        { texto: "Trigo, soya y maní fueron los más eficaces", fuentes: [1], cita: "Wheat, soybean, and peanut were the most effective" },
        { texto: "El maíz continuo reduce la enfermedad", fuentes: [1], cita: "monoculture corn reduced ear rot incidence significantly" },
        { texto: "Dato de otro artículo", fuentes: [7], cita: "algo" },
        { texto: "Sin cita", fuentes: [2] },
      ],
    });
    const r = checkAnswer(raw, sources);
    expect(r.unstructured).toBe(false);
    expect(r.invalidRefs).toEqual([7]);
    expect(r.answer).toContain("mejor [?].");
    expect(r.claims.map((c) => c.status)).toEqual(["verificada", "cita_no_encontrada", "fuente_inexistente", "sin_cita"]);
    expect(r.cited).toEqual([1, 2]);
  });

  it("si el modelo no responde en JSON, igual se verifican los números", () => {
    const r = checkAnswer("La rotación ayuda [1][3].", sources);
    expect(r.unstructured).toBe(true);
    expect(r.invalidRefs).toEqual([3]);
    expect(r.answer).toBe("La rotación ayuda [1][?].");
  });
});

describe("¿la fuente apoya la afirmación?", () => {
  const claim = "La rotación de cultivos reduce la pudrición de mazorca por Stenocarpella";
  it("apoya con cita real → aceptado", () => {
    const v = checkVerdict('{"veredicto":"apoya","cita":"Stenocarpella ear rot and S. maydis was isolated from kernels more frequently in monoculture corn","explicacion":"..."}', sources[0]!);
    expect(v).toMatchObject({ verdict: "apoya", quoteVerified: true });
  });
  it("apoya con cita inventada → «sin cita verificable»", () => {
    const v = checkVerdict('{"veredicto":"apoya","cita":"crop rotation eliminated all ear rot in every season","explicacion":"..."}', sources[0]!);
    expect(v).toMatchObject({ verdict: "no_verificado", modelVerdict: "apoya", quoteVerified: false });
  });
  it("no relacionado no necesita cita; respuesta ilegible → sin respuesta", () => {
    expect(checkVerdict('{"veredicto":"no_relacionado","cita":""}', sources[1]!).verdict).toBe("no_relacionado");
    expect(checkVerdict("no sé", sources[1]!).verdict).toBe("sin_respuesta");
    expect(claim).toBeTruthy();
  });
  it("términos de búsqueda: los del modelo más palabras de la pregunta", () => {
    expect(parseKeywords('{"terminos":["crop rotation","ear rot","Stenocarpella"]}', "¿La rotación reduce la pudrición?")).toEqual(["crop rotation", "ear rot", "Stenocarpella", "rotación", "reduce", "pudrición"]);
    expect(parseKeywords("???", "maíz y riego")).toEqual(["maíz", "riego"]);
  });
});

describe("flujo de consenso (estilo Consensus)", () => {
  it("el veredicto de pregunta usa PREGUNTA (no AFIRMACIÓN) y entrega el texto numerado", () => {
    const m = questionVerdictMessages("¿La rotación reduce la enfermedad?", sources[0]!);
    expect(m[1]!.content).toContain("PREGUNTA: ¿La rotación reduce la enfermedad?");
    expect(m[1]!.content).toContain("TEXTO [1]");
  });
  it("preguntas relacionadas: descarta respuestas ilegibles y las demasiado cortas", () => {
    expect(parseRelatedQuestions('{"preguntas":["¿Corta?"]}')).toEqual([]);
    expect(parseRelatedQuestions("sin json")).toEqual([]);
  });
  it("preguntas relacionadas válidas: deduplica y corta a 3", () => {
    expect(parseRelatedQuestions('{"preguntas":["¿Los biopesticidas controlan la pudrición de mazorca?","¿Los biopesticidas controlan la pudrición de mazorca?","¿Qué híbridos resisten a la pudrición de mazorca?","¿Cómo influye el riego en la enfermedad?","¿Y una quinta pregunta más para el recorte?"]}')).toEqual([
      "¿Los biopesticidas controlan la pudrición de mazorca?",
      "¿Qué híbridos resisten a la pudrición de mazorca?",
      "¿Cómo influye el riego en la enfermedad?",
    ]);
    expect(parseRelatedQuestions("sin json")).toEqual([]);
  });
});

describe("conexión con los modelos (formato de las API documentadas)", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  it("Ollama: POST /api/chat sin streaming, temperatura 0, JSON opcional", async () => {
    const f = vi.fn(async () => ok({ message: { role: "assistant", content: "hola" }, done: true })) as unknown as FetchLike;
    const p = createProvider({ kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen2.5:7b" }, f);
    expect(p.local).toBe(true);
    expect(await p.chat([{ role: "user", content: "x" }], { json: true })).toBe("hola");
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(JSON.parse(init.body)).toEqual({ model: "qwen2.5:7b", messages: [{ role: "user", content: "x" }], stream: false, options: { temperature: 0 }, format: "json" });
  });
  it("Anthropic: cabeceras para el navegador y mensaje de sistema aparte", async () => {
    const f = vi.fn(async () => ok({ content: [{ type: "text", text: "respuesta" }] })) as unknown as FetchLike;
    const p = createProvider({ kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "modelo-x", apiKey: "sk-ant-prueba" }, f);
    expect(p.local).toBe(false);
    expect(await p.chat([{ role: "system", content: "S" }, { role: "user", content: "U" }])).toBe("respuesta");
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "sk-ant-prueba", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
    expect(JSON.parse(init.body)).toMatchObject({ model: "modelo-x", system: "S", messages: [{ role: "user", content: "U" }] });
  });
  it("compatibles con OpenAI: /chat/completions con su clave", async () => {
    const f = vi.fn(async () => ok({ choices: [{ message: { content: "ok" } }] })) as unknown as FetchLike;
    const p = createProvider({ kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", model: "m", apiKey: "k" }, f);
    expect(await p.chat([{ role: "user", content: "x" }], { json: true })).toBe("ok");
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer k");
    expect(JSON.parse(init.body).response_format).toEqual({ type: "json_object" });
  });
  it("errores claros: dirección no permitida, falta clave, 401, sin conexión", async () => {
    expect(() => createProvider({ kind: "ollama", baseUrl: "http://evil.example", model: "m" })).toThrow("no permitida");
    expect(() => createProvider({ kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "m" })).toThrow("falta la clave");
    const f401 = (async () => new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 })) as FetchLike;
    await expect(createProvider({ kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "m", apiKey: "k" }, f401).chat([{ role: "user", content: "x" }])).rejects.toThrow(/401: invalid x-api-key Revise su clave/);
    const down = (async () => { throw new TypeError("Failed to fetch"); }) as FetchLike;
    await expect(listOllamaModels(undefined, down)).rejects.toThrow("http://127.0.0.1:5173");
    expect(await listOllamaModels(undefined, (async () => ok({ models: [{ name: "llama3.2:3b" }, { name: "qwen2.5:7b" }] })) as FetchLike)).toEqual(["llama3.2:3b", "qwen2.5:7b"]);
  });
});

describe("puente local de OpenAI (el navegador no puede leer sus respuestas)", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const pagina = () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } });
  const abierto = { kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "k" } as const;

  it("con el lanzador, la consulta la hace esta computadora por /api/openai", async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: "hola" } }] })) as unknown as FetchLike;
    expect(await createProvider(abierto, f).chat([{ role: "user", content: "x" }])).toBe("hola");
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe("/api/openai/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer k"); // la clave sigue siendo la del usuario
  });

  it("sin puente (modo desarrollo) se intenta directo", async () => {
    const llamadas: string[] = [];
    const f = (async (url: string) => {
      llamadas.push(url);
      return url.startsWith("/api/openai") ? pagina() : json({ choices: [{ message: { content: "directo" } }] });
    }) as unknown as FetchLike;
    expect(await createProvider(abierto, f).chat([{ role: "user", content: "x" }])).toBe("directo");
    expect(llamadas).toEqual(["/api/openai/v1/chat/completions", "https://api.openai.com/v1/chat/completions"]);
  });

  it("un error de OpenAI (clave mala) se explica y no se reintenta a ciegas", async () => {
    const f = vi.fn(async () => new Response('{"error":{"message":"Incorrect API key provided"}}', { status: 401, headers: { "content-type": "application/json" } })) as unknown as FetchLike;
    await expect(createProvider(abierto, f).chat([{ role: "user", content: "x" }])).rejects.toThrow(/401: Incorrect API key provided Revise su clave/);
    expect((f as any).mock.calls).toHaveLength(1);
  });

  it("los demás proveedores no pasan por el puente (Groq, Gemini, OpenRouter y locales van directo)", async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: "ok" } }] })) as unknown as FetchLike;
    await createProvider({ kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", model: "m", apiKey: "k" }, f).chat([{ role: "user", content: "x" }]);
    expect((f as any).mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });
});

describe("carta al autor con IA", () => {
  it("el prompt pide la carta con los datos del artículo y del solicitante, en JSON revisable", () => {
    const m = articleRequestMessages({
      work: flett,
      requester: { name: "María Pérez", institution: "INIA", position: "Investigadora", purpose: "mi tesis de maestría" },
      lang: "es",
    });
    expect(m[0]!.role).toBe("system");
    expect(m[0]!.content).toContain('"asunto"');
    expect(m[0]!.content).toContain('"cuerpo"');
    const user = m[1]!.content;
    expect(user).toContain(flett.doi!);
    expect(user).toContain("María Pérez");
    expect(user).toContain("INIA");
    expect(user).toContain("mi tesis de maestría");
  });
  it("respeta el idioma pedido (en inglés dice «in English»)", () => {
    const m = articleRequestMessages({ work: flett, requester: { name: "John", institution: "USDA" }, lang: "en" });
    expect(m[0]!.content).toContain("in English");
    expect(articleRequestMessages({ work: flett, requester: { name: "Ana", institution: "" }, lang: "es" })[0]!.content).toContain("en español");
  });
});
