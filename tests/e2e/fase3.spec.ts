import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Prueba de interfaz del buscador (Fase 3).
 * La nube de desarrollo no tiene acceso a api.openalex.org, así que aquí se
 * REPRODUCEN respuestas reales grabadas el 2026-10-14 (packages/sources/tests/fixtures).
 * La prueba contra la API en vivo está en tests/live y se ejecuta en la PC del usuario.
 */
const FX = join(__dirname, "..", "..", "packages", "sources", "tests", "fixtures");
const SEARCH = readFileSync(join(FX, "openalex-search-stenocarpella.json"), "utf8");
const DOI = readFileSync(join(FX, "openalex-doi-ijms12095522.json"), "utf8");
const AUTHOR = readFileSync(join(__dirname, "fixtures", "openalex-autocomplete-author.json"), "utf8");
const SHOTS = process.env.BC_SHOTS;

const json = (route: Route, body: string, status = 200, cost = "0.001") =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "x-ratelimit-cost-usd": cost, "x-ratelimit-remaining-usd": "0.097", "access-control-expose-headers": "X-RateLimit-Cost-USD, X-RateLimit-Remaining-USD" },
    body,
  });

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
}

test("pregunta científica → resultados reales grabados → guardar → ver sin conexión", async ({ page }) => {
  const requests: string[] = [];
  await page.route("https://api.openalex.org/**", (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url.includes("/works/doi:")) return json(route, DOI, 200, "0");
    if (url.includes("/autocomplete/authors")) return json(route, AUTHOR, 200, "0");
    return json(route, SEARCH);
  });
  await login(page);

  // Desde Inicio, con una pregunta en lenguaje natural
  await page.getByLabel("Buscar publicaciones").fill("¿Qué estudios existen sobre Stenocarpella macrospora en maíz?");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByTestId("results-count")).toHaveText("345 resultados");
  await expect(page.getByTestId("work-item")).toHaveCount(5);
  await expect(page.getByTestId("sent-query")).toContainText("Stenocarpella macrospora maíz");
  await expect(page.getByText(/Costo de esta consulta en OpenAlex: 0.001 USD/)).toBeVisible();
  const sent = new URL(requests[0]!);
  expect(sent.searchParams.get("search")).toBe("Stenocarpella macrospora maíz");

  // Guardar un resultado
  const tpp = page.getByTestId("work-item").filter({ hasText: "Tropical Plant Pathology" });
  await tpp.getByRole("button", { name: "Guardar en biblioteca" }).click();
  await expect(tpp.getByText("En su biblioteca")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/10-resultados.png`, fullPage: false });

  // Filtros: año, acceso abierto, tipo e idioma llegan a la consulta
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByLabel("Año desde").fill("2010");
  await page.getByLabel("Año hasta").fill("2025");
  await page.getByLabel("Tipo de documento").selectOption("article");
  await page.getByLabel("Idioma").selectOption("en");
  await page.getByLabel("Solo acceso abierto").check();
  await page.getByLabel("Orden").selectOption("cited");
  await page.getByLabel("Texto de búsqueda").fill("Stenocarpella");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByTestId("results-count")).toBeVisible();
  const f = new URL(requests.at(-1)!);
  expect(f.searchParams.get("filter")).toBe("publication_year:2010-2025,is_oa:true,type:article,language:en");
  expect(f.searchParams.get("sort")).toBe("cited_by_count:desc");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/11-filtros.png` });

  // DOI: búsqueda exacta y gratuita
  await page.getByRole("button", { name: "Quitar filtros" }).click();
  await page.getByLabel("Texto de búsqueda").fill("https://doi.org/10.3390/ijms12095522");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByTestId("results-count")).toHaveText("1 resultados");
  await expect(page.getByText(/Isolation of Bacteria with Antifungal Activity/)).toBeVisible();
  expect(requests.at(-1)).toContain("/works/doi:10.3390/ijms12095522");

  // Autor sin homónimos: se elige la persona y se filtra por su identificador
  await page.getByRole("button", { name: "Autor", exact: true }).click();
  await page.getByLabel("Texto de búsqueda").fill("Ricardo Trezzi Casa");
  await page.getByRole("option", { name: /Ricardo Trezzi Casa/ }).click();
  await expect(page.getByText(/Universidade do Estado de Santa Catarina/).first()).toBeVisible();
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByTestId("results-count")).toBeVisible();
  expect(new URL(requests.at(-1)!).searchParams.get("filter")).toBe("authorships.author.id:A5057456807");

  // Sin conexión: la búsqueda guardada se abre desde el historial con sus resultados
  await page.unroute("https://api.openalex.org/**");
  await page.route("https://api.openalex.org/**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("link", { name: /Stenocarpella macrospora en maíz/ }).first().click();
  await expect(page.getByText("Búsqueda guardada · mostrada sin conexión, sin costo")).toBeVisible();
  await expect(page.getByTestId("work-item")).toHaveCount(5);
  await expect(page.getByTestId("work-item").filter({ hasText: "Tropical Plant Pathology" }).getByText("En su biblioteca")).toBeVisible();

  // Y el guardado está en la biblioteca
  await page.getByRole("navigation").getByRole("link", { name: "Biblioteca", exact: true }).click();
  await expect(page.getByTestId("work-item")).toHaveCount(1);
  await expect(page.getByText("Fuente: OpenAlex")).toBeVisible();
});

test("si OpenAlex falla se informa el error real y queda en el historial", async ({ page }) => {
  await page.route("https://api.openalex.org/**", (route) => json(route, '{"error":"rate limit"}', 429));
  await login(page);
  await page.getByRole("navigation").getByRole("link", { name: "Buscador", exact: true }).click();
  await page.getByLabel("Texto de búsqueda").fill("Trichoderma banano");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("límite de uso gratuito de OpenAlex");
  await expect(page.getByTestId("work-item")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: /límite de uso/ })).toBeVisible();

  await page.unroute("https://api.openalex.org/**");
  await page.route("https://api.openalex.org/**", (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Texto de búsqueda").fill("Ralstonia");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo conectar con OpenAlex");
});
