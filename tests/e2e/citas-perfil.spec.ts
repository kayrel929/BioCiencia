import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Citas e índices del perfil (estilo perfil académico) y recuadro de Scopus.
 * OpenCitations responde con las respuestas REALES grabadas: 2 citas (2017 y 2023) para el artículo de Bioscience Journal
 * y «[]» (sin citas) para los demás. El recuadro de Scopus no se descarga (no hay clave real en las pruebas): solo se
 * comprueba que se pide a api.elsevier.com con la clave que el usuario guardó.
 */
const FX = join(__dirname, "..", "..", "packages", "sources", "tests", "fixtures");
const fx = (n: string) => readFileSync(join(FX, n), "utf8");
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const reply = (route: Route, body: string, status = 200, type = "application/json") =>
  route.fulfill({ status, contentType: type, headers: { "access-control-allow-origin": "*" }, body });

test("citas totales, índice h, i10 y «desde» con OpenCitations; recuadro de Scopus con la clave del usuario", async ({ page }) => {
  const scopus: string[] = [];
  await page.route("https://api.openalex.org/**", (r) => r.abort());
  await page.route("https://eutils.ncbi.nlm.nih.gov/**", (r) => (r.request().url().includes("esearch") ? reply(r, fx("pubmed-esearch-stenocarpella.json")) : reply(r, fx("pubmed-efetch-41141834.xml"), 200, "text/xml")));
  await page.route("https://www.ebi.ac.uk/**", (r) => reply(r, fx("europepmc-search-stenocarpella.json")));
  await page.route("https://doaj.org/**", (r) => reply(r, fx("doaj-search-stenocarpella.json")));
  await page.route("https://api.crossref.org/**", (r) => reply(r, fx("crossref-search-stenocarpella.json")));
  await page.route("https://api.unpaywall.org/**", (r) => reply(r, fx("unpaywall-404.html"), 404, "text/html"));
  await page.route("https://api.opencitations.net/**", (r) =>
    reply(r, fx(r.request().url().includes("citations/doi:10.14393/bj-v33n1a2017-36068") ? "opencitations-citations-bj36068.json" : "opencitations-citations-vmi4160516.json")));
  await page.route("https://api.elsevier.com/**", (r) => (scopus.push(r.request().url()), r.fulfill({ status: 200, contentType: "text/html", body: "<p>(prueba)</p>" })));

  await page.goto("/");
  await page.getByLabel("Nombre").fill("Justino Luiz Mário");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  await nav(page, "Buscador").click();
  await page.getByLabel("Texto de búsqueda").fill("Stenocarpella maydis");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const bj = page.getByTestId("work-item").filter({ hasText: "in the cerrado and southern Brazil" });
  await bj.getByRole("button", { name: "Guardar en biblioteca" }).click();
  const vmi = page.getByTestId("work-item").filter({ hasText: "Improved Extraction of the Neurotoxin" });
  await vmi.getByRole("button", { name: "Guardar en biblioteca" }).click();

  await nav(page, "Biblioteca").click();
  for (const t of ["in the cerrado and southern Brazil", "Improved Extraction of the Neurotoxin"]) {
    await page.getByTestId("work-item").filter({ hasText: t }).getByRole("button", { name: "Es mía" }).click();
  }

  await nav(page, "Investigadores").click();
  await page.getByRole("button", { name: "Calcular citas e índices" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Citas actualizadas" })).toContainText("Citas actualizadas para 2 de 2 publicaciones.");
  const since = new Date().getFullYear() - 5;
  const m = page.getByTestId("citation-metrics");
  await expect(m.locator("thead")).toContainText(`Desde ${since}`);
  // 2 citas: una de 2017 y otra de 2023 → desde (año actual − 5) solo cuenta la de 2023
  await expect(m.getByRole("row", { name: /^Citas/ })).toHaveText(`Citas2${2023 >= since ? 1 : 0}`);
  await expect(m.getByRole("row", { name: /^Índice h/ })).toHaveText(`Índice h1${2023 >= since ? 1 : 0}`);
  await expect(m.getByRole("row", { name: /^Índice i10/ })).toHaveText("Índice i1000");
  await expect(page.getByTestId("work-citations")).toHaveText(["0 citas", "2 citas"]);

  // Scopus: sin clave no se pide nada; con la clave del usuario aparece el recuadro oficial
  expect(scopus).toEqual([]);
  await page.getByLabel("Clave de API de Scopus").fill("abc");
  await page.getByRole("button", { name: "Guardar clave" }).click();
  await expect(page.getByRole("status").filter({ hasText: "formato esperado" })).toBeVisible();
  await page.getByLabel("Clave de API de Scopus").fill("0123456789abcdef0123456789abcdef");
  await page.getByRole("button", { name: "Guardar clave" }).click();
  const frame = page.locator('iframe[title="Citas en Scopus de 10.14393/bj-v33n1a2017-36068"]');
  await expect(frame).toHaveAttribute("src", "https://api.elsevier.com/content/abstract/citation-count?doi=10.14393%2Fbj-v33n1a2017-36068&apiKey=0123456789abcdef0123456789abcdef&httpAccept=text%2Fhtml");
  await expect.poll(() => scopus.length).toBeGreaterThan(0);
  await page.getByLabel("Mi Scopus Author ID (para ver el índice h oficial de Scopus)").fill("57190000000");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("link", { name: "Ver mi perfil en Scopus (citas e índice h oficiales)" })).toHaveAttribute("href", "https://www.scopus.com/authid/detail.uri?authorId=57190000000");
  if (process.env.BC_SHOTS) await page.screenshot({ path: `${process.env.BC_SHOTS}/130-perfil-citas.png`, fullPage: true });
});
