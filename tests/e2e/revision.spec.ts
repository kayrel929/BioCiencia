import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Funciones sin IA inspiradas en lo que pidió el usuario: red de citas, tipo de estudio y revisión de literatura.
 * Se REPRODUCEN respuestas reales grabadas el 2026-10-15 (packages/sources/tests/fixtures/FUENTES.md).
 * En la revisión, las respuestas de PubMed y Europe PMC son las grabadas para «Stenocarpella maydis»:
 * aquí se prueba el flujo (estrategia, unión, cribado, PRISMA), no el contenido de una búsqueda nueva.
 */
const FX = join(__dirname, "..", "..", "packages", "sources", "tests", "fixtures");
const fx = (n: string) => readFileSync(join(FX, n), "utf8");
const SHOTS = process.env.BC_SHOTS;
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const reply = (route: Route, body: string, status = 200, type = "application/json") =>
  route.fulfill({ status, contentType: type, headers: { "access-control-allow-origin": "*" }, body });

async function routes(page: Page) {
  const calls: string[] = [];
  const log = (r: Route) => calls.push(decodeURIComponent(r.request().url().replace(/\+/g, " ")));
  await page.route("https://api.openalex.org/**", (r) => (log(r), r.abort()));
  await page.route("https://eutils.ncbi.nlm.nih.gov/**", (r) => (log(r), r.request().url().includes("esearch") ? reply(r, fx("pubmed-esearch-stenocarpella.json")) : reply(r, fx("pubmed-efetch-41141834.xml"), 200, "text/xml")));
  await page.route("https://www.ebi.ac.uk/**", (r) => (log(r), reply(r, fx("europepmc-search-stenocarpella.json"))));
  await page.route("https://doaj.org/**", (r) => (log(r), reply(r, fx("doaj-search-stenocarpella.json"))));
  await page.route("https://api.crossref.org/**", (r) => (log(r), reply(r, fx(r.request().url().includes("filter=doi") ? "crossref-dois-citantes-bj36068.json" : "crossref-search-stenocarpella.json"))));
  await page.route("https://api.opencitations.net/**", (r) => {
    log(r);
    // Referencias de este artículo: la respuesta real fue «[]», idéntica al archivo grabado del otro DOI sin datos
    return reply(r, fx(r.request().url().includes("/citations/doi:10.14393/bj-v33n1a2017-36068") ? "opencitations-citations-bj36068.json" : "opencitations-citations-vmi4160516.json"));
  });
  await page.route("https://api.unpaywall.org/**", (r) => reply(r, fx("unpaywall-404.html"), 404, "text/html"));
  return calls;
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
}

test("filtro por tipo de estudio y red de citas desde un resultado", async ({ page }) => {
  const calls = await routes(page);
  await login(page);
  await nav(page, "Buscador").click();
  await page.getByLabel("Texto de búsqueda").fill("Stenocarpella maydis");
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("checkbox", { name: "Metaanálisis" }).check();
  await page.getByLabel("Método (palabras en el texto)").selectOption("field");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const outcomes = page.getByTestId("source-outcomes");
  await expect(outcomes).toContainText("Crossref: omitida");
  await expect(outcomes).toContainText("DOAJ: omitida");
  expect(calls.find((u) => u.includes("esearch"))).toContain('AND (meta-analysis[pt])) AND ("field trial" OR "field experiment"');
  expect(calls.find((u) => u.includes("europepmc/webservices/rest/search"))).toContain('PUB_TYPE:"Meta-Analysis"');
  expect(calls.some((u) => u.includes("api.crossref.org"))).toBe(false);

  // Sin filtros: aparece el artículo brasileño de Crossref (solo DOI) → su red de citas viene de OpenCitations
  await page.getByRole("button", { name: "Quitar filtros" }).click();
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const item = page.getByTestId("work-item").filter({ hasText: "Stenocarpella macrospora and Stenocarpella maydis in the cerrado" });
  await item.getByRole("button", { name: "Red de citas" }).click();
  const dlg = page.getByRole("dialog", { name: "Red de citas" });
  await expect(dlg.getByRole("status").filter({ hasText: "fuente" })).toContainText("2 de 2 publicaciones que la citan · fuente: OpenCitations (índice abierto) + Crossref");
  const list = dlg.getByTestId("citation-list").getByRole("listitem");
  await expect(list).toHaveCount(2);
  await expect(list.first()).toContainText("Comparative genomics of maize ear rot pathogens");
  await expect(list.nth(1)).toContainText("Wordell Filho");
  await list.first().getByRole("button", { name: "Guardar en biblioteca" }).click();
  await expect(list.first().getByText("Guardado")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/120-red-de-citas.png` });

  await dlg.getByRole("tab", { name: "Cita a (referencias)" }).click();
  await expect(dlg.getByRole("status").filter({ hasText: "Sin referencias" })).toContainText("no todas las editoriales depositan sus referencias");
  await dlg.getByRole("button", { name: "Cerrar" }).click();
  await nav(page, "Biblioteca").click();
  await expect(page.getByTestId("work-item").filter({ hasText: "Comparative genomics of maize ear rot pathogens" })).toHaveCount(1);
});

test("revisión de literatura: estrategia, búsqueda, cribado, PRISMA e informe", async ({ page }) => {
  const calls = await routes(page);
  await login(page);
  await nav(page, "Revisión de literatura").click();
  await page.getByLabel("Título de la revisión").fill("Pudrición de mazorca por Stenocarpella");
  await page.getByRole("button", { name: "Crear" }).click();

  await page.getByLabel("Pregunta de investigación").fill("¿Qué se sabe del control de Stenocarpella en maíz?");
  await page.getByLabel("Términos de Población / cultivo").fill("maize\ncorn\nZea mays");
  await page.getByLabel("Términos de Exposición / patógeno / factor").fill("Stenocarpella\nDiplodia");
  await expect(page.getByTestId("strategy-pubmed")).toHaveText('("maize"[tiab] OR "corn"[tiab] OR "Zea mays"[tiab]) AND ("Stenocarpella"[tiab] OR "Diplodia"[tiab])');
  await expect(page.getByTestId("strategy-europepmc")).toHaveText('(TITLE_ABS:"maize" OR TITLE_ABS:"corn" OR TITLE_ABS:"Zea mays") AND (TITLE_ABS:"Stenocarpella" OR TITLE_ABS:"Diplodia")');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/121-revision-estrategia.png`, fullPage: true });
  await page.getByRole("button", { name: "Buscar", exact: true }).click();

  await expect(page.getByRole("status").filter({ hasText: "Búsqueda terminada" })).toContainText("2 registros únicos (2 nuevos; 0 ya estaban");
  expect(calls.find((u) => u.includes("esearch"))).toContain('term=("maize"[tiab] OR "corn"[tiab]');
  // Cribado: el artículo de PubMed (también en Europe PMC) y el preprint de Europe PMC
  const items = page.getByTestId("screen-item");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Improved Extraction of the Neurotoxin");
  await expect(items.first()).toContainText("PubMed, Europe PMC");
  await items.first().getByRole("button", { name: "Incluir" }).click();
  await expect(items).toHaveCount(1);
  await items.first().getByRole("combobox").selectOption("Otro tipo de estudio");
  await items.first().getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("¡Cribado terminado!")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/122-revision-cribado.png` });

  await page.getByRole("tab", { name: "3. Resultados y PRISMA" }).click();
  const prisma = page.getByTestId("prisma");
  await expect(prisma).toContainText("PubMed: 35");
  await expect(prisma).toContainText("Europe PMC: 178");
  await expect(prisma).toContainText("Duplicados eliminados: 1");
  await expect(prisma).toContainText("Registros cribados (título y resumen): 2");
  await expect(prisma).toContainText("Otro tipo de estudio: 1");
  await expect(prisma).toContainText("Estudios incluidos: 1");
  await expect(page.getByTestId("methods-text")).toContainText('- PubMed: ("maize"[tiab]');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/123-revision-prisma.png`, fullPage: true });

  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar informe (.docx)" }).click()]);
  const raw = readFileSync((await dl.path())!).toString("utf8");
  expect(raw.startsWith("PK")).toBe(true);
  expect(raw).toContain("Estudios incluidos");
  expect(raw).toContain("Duplicados eliminados: 1");

  await page.getByRole("button", { name: "Agregar a mi biblioteca" }).click();
  await expect(page.getByRole("status").filter({ hasText: "agregados" })).toContainText("1 estudios agregados a su biblioteca");

  // La lista de revisiones guarda el avance
  await page.getByRole("button", { name: "← Mis revisiones" }).click();
  await expect(page.getByRole("row", { name: /Pudrición de mazorca por Stenocarpella/ })).toContainText("2");
});
