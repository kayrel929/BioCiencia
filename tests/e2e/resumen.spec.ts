import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Pestaña «Resumen» en cada publicación. Se reproducen respuestas reales grabadas (fixtures/FUENTES.md):
 * el registro de Europe PMC PMID 30832079 (Flett et al. 2001), que sí trae resumen.
 */
const FX = join(__dirname, "..", "..", "packages", "sources", "tests", "fixtures");
const fx = (n: string) => readFileSync(join(FX, n), "utf8");
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const reply = (route: Route, body: string, status = 200, type = "application/json") =>
  route.fulfill({ status, contentType: type, headers: { "access-control-allow-origin": "*" }, body });

async function setup(page: Page) {
  const epmc: string[] = [];
  await page.route("https://api.openalex.org/**", (r) => r.abort());
  await page.route("https://eutils.ncbi.nlm.nih.gov/**", (r) => reply(r, '{"esearchresult":{"count":"0","idlist":[]}}'));
  await page.route("https://www.ebi.ac.uk/**", (r) => (epmc.push(decodeURIComponent(r.request().url())), reply(r, fx("europepmc-keyword-null-30832079.json"))));
  await page.route("https://doaj.org/**", (r) => reply(r, '{"total":0,"results":[]}'));
  await page.route("https://api.crossref.org/**", (r) => reply(r, '{"message":{"total-results":0,"items":[]}}'));
  await page.route("https://api.unpaywall.org/**", (r) => reply(r, fx("unpaywall-404.html"), 404, "text/html"));
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  return epmc;
}

test("Inicio con sugerencias estilo Consensus; cada resultado tiene su resumen para leer completo", async ({ page }) => {
  await setup(page);
  await expect(page.locator(".bc-chips")).toHaveCount(0);
  await nav(page, "Buscador").click();
  await page.getByLabel("Texto de búsqueda").fill("Stenocarpella crop rotation");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const item = page.getByTestId("work-item").filter({ hasText: "Crop Rotation Systems" });
  const abs = item.getByTestId("abstract");
  await abs.getByRole("button", { name: "Leer resumen completo" }).click();
  await expect(abs).toContainText("Wheat, soybean, and peanut were the most effective, and sunflower the least effective, rotation crops");
  await expect(abs.getByRole("button", { name: "Ocultar resumen" })).toHaveAttribute("aria-expanded", "true");
  if (process.env.BC_SHOTS) await page.screenshot({ path: `${process.env.BC_SHOTS}/31-resumen.png` });
});

test("si la fuente no trajo resumen, «Buscar resumen» lo trae de Europe PMC y queda guardado", async ({ page }) => {
  const epmc = await setup(page);
  await nav(page, "Biblioteca").click();
  await page.getByRole("button", { name: /Agregar|Nueva|manual/i }).first().click();
  await page.getByLabel("Título *").fill("Incidence of Stenocarpella maydis Ear Rot of Corn Under Crop Rotation Systems");
  await page.getByLabel("DOI").fill("10.1094/PDIS.2001.85.1.92");
  await page.getByRole("button", { name: "Guardar en la biblioteca" }).click();
  const abs = page.getByTestId("work-item").first().getByTestId("abstract");
  await expect(abs).toContainText("Resumen no disponible en la fuente.");
  await abs.getByRole("button", { name: "Buscar resumen" }).click();
  await expect(abs).toContainText("Resumen (obtenido de Europe PMC)");
  await expect(abs).toContainText("The efficacy of crop rotation in reducing corn ear rot");
  expect(epmc.some((u) => u.includes('DOI:"10.1094/pdis.2001.85.1.92"'))).toBe(true);
  // Queda guardado: al volver a la biblioteca ya no hace falta buscarlo
  await nav(page, "Inicio").click();
  await nav(page, "Biblioteca").click();
  await expect(page.getByTestId("work-item").first().getByRole("button", { name: "Leer resumen completo" })).toBeVisible();
});
