import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Fase 7 en la interfaz con un Ollama SIMULADO: las respuestas del «modelo» son textos de prueba escritos a mano
 * (no hay un modelo real aquí). Lo que se prueba es el flujo y la verificación: una cita a una fuente inexistente
 * y una frase que no está en el resumen deben marcarse en pantalla. El artículo y su resumen son reales
 * (Europe PMC, PMID 30832079, Flett et al. 2001).
 */
const FX = join(__dirname, "..", "..", "packages", "sources", "tests", "fixtures");
const fx = (n: string) => readFileSync(join(FX, n), "utf8");
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const reply = (route: Route, body: string, status = 200, type = "application/json") =>
  route.fulfill({ status, contentType: type, headers: { "access-control-allow-origin": "*" }, body });
const REAL_QUOTE = "Wheat, soybean, and peanut were the most effective";

async function setup(page: Page) {
  const chats: any[] = [];
  await page.route("https://api.openalex.org/**", (r) => r.abort());
  await page.route("https://eutils.ncbi.nlm.nih.gov/**", (r) => reply(r, '{"esearchresult":{"count":"0","idlist":[]}}'));
  await page.route("https://www.ebi.ac.uk/**", (r) => reply(r, fx("europepmc-keyword-null-30832079.json")));
  await page.route("https://doaj.org/**", (r) => reply(r, '{"total":0,"results":[]}'));
  await page.route("https://api.crossref.org/**", (r) => reply(r, '{"message":{"total-results":0,"items":[]}}'));
  await page.route("https://api.unpaywall.org/**", (r) => reply(r, fx("unpaywall-404.html"), 404, "text/html"));
  await page.route("http://127.0.0.1:11434/api/tags", (r) => reply(r, JSON.stringify({ models: [{ name: "qwen2.5:7b" }, { name: "llama3.2:3b" }] })));
  await page.route("http://127.0.0.1:11434/api/chat", (r) => {
    const body = JSON.parse(r.request().postData() ?? "{}");
    chats.push(body);
    const sys: string = body.messages[0].content;
    let content: string;
    if (body.messages.length === 1) content = "listo";
    else if (sys.includes("términos de búsqueda")) content = JSON.stringify({ terminos: ["crop rotation", "Stenocarpella", "ear rot"] });
    else if (sys.includes("ÚNICAMENTE")) {
      content = JSON.stringify({
        respuesta: "La rotación con trigo, soya o maní fue la más eficaz [1]. Otro estudio dice lo contrario [9].",
        afirmaciones: [
          { texto: "Trigo, soya y maní fueron los cultivos de rotación más eficaces", fuentes: [1], cita: REAL_QUOTE },
          { texto: "La rotación eliminó la enfermedad", fuentes: [1], cita: "crop rotation completely eliminated ear rot" },
        ],
      });
    } else content = JSON.stringify({ veredicto: "apoya", cita: "Stenocarpella ear rot and S. maydis was isolated from kernels more frequently in monoculture corn", explicacion: "El monocultivo tuvo más pudrición que la rotación." });
    return reply(r, JSON.stringify({ model: body.model, message: { role: "assistant", content }, done: true }));
  });
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  return chats;
}

test("configurar Ollama, preguntar a la biblioteca con verificación y evaluar evidencia", async ({ page }) => {
  const chats = await setup(page);
  // Un artículo real con resumen en la biblioteca
  await nav(page, "Buscador").click();
  await page.getByLabel("Texto de búsqueda").fill("Stenocarpella crop rotation");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByTestId("work-item").filter({ hasText: "Crop Rotation Systems" }).getByRole("button", { name: "Guardar en biblioteca" }).click();

  await nav(page, "Análisis con IA").click();
  await expect(page.getByTestId("pending")).toHaveCount(0);
  await expect(page.getByTestId("ai-status")).toHaveText("IA sin configurar");
  const form = page.getByRole("form", { name: "Configuración de la IA" });
  await form.getByRole("button", { name: "Detectar modelos" }).click();
  await expect(form.getByLabel("Modelo")).toHaveValue("qwen2.5:7b");
  await form.getByRole("button", { name: "Probar conexión" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Conexión correcta" })).toContainText("«listo»");
  await form.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByTestId("ai-status")).toHaveText("Ollama en esta computadora · qwen2.5:7b · privado");

  // Preguntar
  await page.getByLabel("Su pregunta").fill("¿Qué cultivos de rotación reducen la pudrición de mazorca por Stenocarpella?");
  await page.getByRole("button", { name: "Preguntar" }).click();
  const ans = page.getByTestId("ai-answer");
  await expect(ans.getByRole("status").filter({ hasText: "fuentes que no existen" })).toContainText("[9]");
  await expect(page.getByTestId("ai-answer-text")).toHaveText("La rotación con trigo, soya o maní fue la más eficaz [1]. Otro estudio dice lo contrario [?].");
  const claims = page.getByTestId("ai-claims").getByRole("listitem");
  await expect(claims.nth(0)).toContainText("Cita verificada en la fuente");
  await expect(claims.nth(1)).toContainText("La frase NO aparece en la fuente");
  await expect(page.getByTestId("ai-sources")).toContainText("Incidence of Stenocarpella maydis Ear Rot of Corn Under Crop Rotation Systems");
  // Lo que se envió al modelo: el resumen real, temperatura 0, sin streaming
  const ask = chats.find((c) => c.messages[0].content.includes("ÚNICAMENTE"));
  expect(ask.messages[1].content).toContain("[1] B C Flett et al. (2001)");
  expect(ask.messages[1].content).toContain(REAL_QUOTE);
  expect(ask).toMatchObject({ model: "qwen2.5:7b", stream: false, options: { temperature: 0 }, format: "json" });
  if (process.env.BC_SHOTS) await page.screenshot({ path: `${process.env.BC_SHOTS}/70-ia-pregunta.png`, fullPage: true });

  // Evidencia (biblioteca + Europe PMC simulado con el mismo registro real → se une, no se repite)
  await page.getByRole("tab", { name: "Evidencia para una afirmación" }).click();
  await page.getByLabel("Afirmación a evaluar").fill("La rotación de cultivos reduce la pudrición de mazorca por Stenocarpella.");
  await page.getByRole("button", { name: "Buscar evidencia" }).click();
  const items = page.getByTestId("evidence-item");
  await expect(items).toHaveCount(1);
  await expect(items.first().getByTestId("verdict")).toHaveText("Apoya");
  await expect(items.first()).toContainText("✓ Frase verificada en el resumen");

  // Verificar una cita por DOI (está en la biblioteca)
  await page.getByRole("tab", { name: "Verificar una cita" }).click();
  await page.getByLabel("Lo que se afirma citando el artículo").fill("Flett et al. (2001) mostraron que el monocultivo aumenta la pudrición.");
  await page.getByLabel("Artículo citado: DOI o palabras del título (de su biblioteca)").fill("10.1094/PDIS.2001.85.1.92");
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByTestId("verify-result").getByTestId("verdict")).toHaveText("Apoya");
});

test("un servicio en la nube no se usa sin autorización expresa", async ({ page }) => {
  await setup(page);
  let anthropicCalls = 0;
  await page.route("https://api.anthropic.com/**", (r) => (anthropicCalls++, r.abort()));
  await nav(page, "Análisis con IA").click();
  const form = page.getByRole("form", { name: "Configuración de la IA" });
  await form.getByLabel("Proveedor").selectOption("anthropic");
  await form.getByLabel("Modelo").fill("modelo-de-prueba");
  await form.getByLabel(/Clave de API/).fill("sk-ant-prueba");
  await expect(form.getByRole("button", { name: "Probar conexión" })).toBeDisabled();
  await form.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByTestId("ai-status")).toHaveText("IA sin configurar");
  await expect(page.getByRole("status").filter({ hasText: "debe autorizar" })).toBeVisible();
  expect(anthropicCalls).toBe(0);
});
