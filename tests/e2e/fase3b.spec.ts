import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Fase 3b en la interfaz: búsqueda en fuentes gratuitas y acceso legal al texto completo.
 * Se REPRODUCEN respuestas reales grabadas el 2026-10-15 (packages/sources/tests/fixtures/FUENTES.md).
 */
const FX = join(__dirname, "..", "..", "packages", "sources", "tests", "fixtures");
const fx = (n: string) => readFileSync(join(FX, n), "utf8");
const SHOTS = process.env.BC_SHOTS;
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });

const reply = (route: Route, body: string, status = 200, type = "application/json") =>
  route.fulfill({ status, contentType: type, headers: { "access-control-allow-origin": "*" }, body });

async function routes(page: Page, opts: { crossrefDown?: boolean } = {}) {
  const calls: string[] = [];
  await page.route("https://api.openalex.org/**", (r) => {
    calls.push(r.request().url());
    return r.abort();
  });
  await page.route("https://eutils.ncbi.nlm.nih.gov/**", (r) => {
    calls.push(r.request().url());
    return r.request().url().includes("esearch") ? reply(r, fx("pubmed-esearch-stenocarpella.json")) : reply(r, fx("pubmed-efetch-41141834.xml"), 200, "text/xml");
  });
  await page.route("https://www.ebi.ac.uk/**", (r) => (calls.push(r.request().url()), reply(r, fx("europepmc-search-stenocarpella.json"))));
  await page.route("https://doaj.org/**", (r) => (calls.push(r.request().url()), reply(r, fx("doaj-search-stenocarpella.json"))));
  await page.route("https://api.crossref.org/**", (r) => {
    calls.push(r.request().url());
    return opts.crossrefDown ? reply(r, "Service Unavailable", 503, "text/plain") : reply(r, fx("crossref-search-stenocarpella.json"));
  });
  await page.route("https://api.unpaywall.org/**", (r) => {
    const u = r.request().url();
    calls.push(u);
    return u.includes("10.1155/vmi/4160516") ? reply(r, fx("unpaywall-oa-vmi.json")) : reply(r, fx("unpaywall-404.html"), 404, "text/html");
  });
  return calls;
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
}

test("búsqueda gratuita en 4 fuentes, unión de repetidos y copia legal con Unpaywall", async ({ page }) => {
  const calls = await routes(page);
  await login(page);
  await nav(page, "Buscador").click();

  // Por defecto: las 4 fuentes gratuitas marcadas y OpenAlex (con costo) desmarcado
  for (const s of ["Europe PMC", "PubMed", "Crossref", "DOAJ"]) await expect(page.getByRole("checkbox", { name: new RegExp(`^${s}`) })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^OpenAlex/ })).not.toBeChecked();

  await page.getByLabel("Texto de búsqueda").fill("Stenocarpella maydis");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  // 2 + 1 + 3 + 2 = 8 recibidos, el de PubMed repetido en Europe PMC → 7 distintos
  await expect(page.getByTestId("results-count")).toHaveText("7 resultados combinados");
  const outcomes = page.getByTestId("source-outcomes");
  for (const t of ["Europe PMC: 178 encontrados", "PubMed: 35 encontrados", "Crossref: 2459 encontrados", "DOAJ: 23 encontrados"]) await expect(outcomes).toContainText(t);
  expect(calls.some((u) => u.includes("openalex"))).toBe(false);

  const neuro = page.getByTestId("work-item").filter({ hasText: "Improved Extraction of the Neurotoxin" });
  await expect(neuro).toHaveCount(1);
  await expect(neuro).toContainText("Encontrado en: Europe PMC, PubMed");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/40-busqueda-fuentes-gratis.png` });

  // Sin correo de contacto, Unpaywall no se consulta y se explica por qué
  await neuro.getByRole("button", { name: "¿Dónde leerlo?" }).click();
  await expect(neuro.getByTestId("fulltext-panel")).toContainText("Unpaywall pide un correo de contacto");
  expect(calls.some((u) => u.includes("unpaywall"))).toBe(false);

  // Configurar correo y proxy institucional
  await nav(page, "Configuración").click();
  await page.getByLabel("Correo de contacto").fill("investigador@example.org");
  await page.getByLabel("Proxy de la biblioteca institucional (opcional)").fill("https://login.ezproxy.ejemplo.edu/login?url=");
  await page.locator("form", { hasText: "Fuentes científicas y acceso" }).getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Configuración guardada" })).toBeVisible();

  // Volver a la búsqueda guardada (sin internet ni costo) y buscar la copia legal
  await nav(page, "Buscador").click();
  await page.getByRole("link", { name: "Stenocarpella maydis" }).first().click();
  const n2 = page.getByTestId("work-item").filter({ hasText: "Improved Extraction of the Neurotoxin" });
  await n2.getByRole("button", { name: "¿Dónde leerlo?" }).click();
  const panel = n2.getByTestId("fulltext-panel");
  await expect(panel).toContainText("Hay una copia legal gratuita");
  await expect(panel).toContainText("Revista de acceso abierto");
  await expect(panel.getByRole("link", { name: "PDF de la editorial" })).toHaveAttribute("href", "https://onlinelibrary.wiley.com/doi/pdfdirect/10.1155/vmi/4160516");
  await expect(panel.getByRole("link", { name: /en European Bioinformatics Institute/ })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Acceso institucional" })).toHaveAttribute("href", "https://login.ezproxy.ejemplo.edu/login?url=https%3A%2F%2Fdoi.org%2F10.1155%2Fvmi%2F4160516");
  const upw = calls.filter((u) => u.includes("unpaywall"));
  expect(upw).toEqual(["https://api.unpaywall.org/v2/10.1155/vmi/4160516?email=investigador%40example.org"]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/41-donde-leerlo.png` });

  // Solicitar al autor: la carta formal se prepara, BioCiencia no envía nada
  await panel.getByRole("button", { name: "Solicitar al autor" }).click();
  await expect(page.getByLabel("Texto de la carta (puede editarlo)")).toHaveValue(/Estimado\(a\) Dr\(a\)\. Snyman:/);
  await expect(page.getByLabel("Texto de la carta (puede editarlo)")).toHaveValue(/https:\/\/doi\.org\/10\.1155\/vmi\/4160516/);
  await page.getByLabel("Correo del autor").fill("autor@ejemplo.org");
  await expect(page.getByRole("link", { name: "Abrir en mi correo" })).toHaveAttribute("href", /^mailto:autor@ejemplo\.org\?subject=/);
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();

  // Un DOI que Unpaywall no conoce (404 real) se informa sin inventar enlaces
  const bj = page.getByTestId("work-item").filter({ hasText: "cerrado and southern Brazil" });
  await bj.getByRole("button", { name: "¿Dónde leerlo?" }).click();
  await expect(bj.getByTestId("fulltext-panel")).toContainText("Unpaywall no conoce este DOI");
});

test("si una fuente falla, las demás muestran sus resultados y el error queda a la vista", async ({ page }) => {
  await routes(page, { crossrefDown: true });
  await login(page);
  await nav(page, "Buscador").click();
  await page.getByLabel("Texto de búsqueda").fill("Stenocarpella maydis");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByTestId("source-outcomes")).toContainText("Crossref: error — Crossref respondió con un error (503).");
  await expect(page.getByTestId("results-count")).toHaveText("4 resultados combinados");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
