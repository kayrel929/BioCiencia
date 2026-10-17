import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Beneficios añadidos (retracciones, nivel de evidencia, ficha del estudio, alertas).
 * Respuestas REALES grabadas (packages/sources/tests/fixtures/FUENTES.md):
 *  - Europe PMC «lite» con el artículo retractado de Wakefield (1998);
 *  - Europe PMC «core» de Thorat et al. (2023);
 *  - Crossref con «updated-by» (Retraction Watch) de ambos.
 */
const FX = join(__dirname, "..", "..", "packages", "sources", "tests", "fixtures");
const fx = (n: string) => readFileSync(join(FX, n), "utf8");
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const reply = (route: Route, body: string, status = 200) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });

async function setup(page: Page) {
  const state = { epmc: "europepmc-retractados-wakefield.json", calls: [] as string[] };
  await page.route("https://api.openalex.org/**", (r) => r.abort());
  await page.route("https://eutils.ncbi.nlm.nih.gov/**", (r) => reply(r, '{"esearchresult":{"count":"0","idlist":[]}}'));
  await page.route("https://doaj.org/**", (r) => reply(r, '{"total":0,"results":[]}'));
  await page.route("https://www.ebi.ac.uk/**", (r) => {
    const u = decodeURIComponent(r.request().url().replace(/\+/g, " "));
    state.calls.push(u);
    return reply(r, fx(u.includes("Retracted Publication") ? "europepmc-retractados-wakefield.json" : state.epmc));
  });
  await page.route("https://api.crossref.org/**", (r) => {
    const u = decodeURIComponent(r.request().url());
    state.calls.push(u);
    return reply(r, u.includes("filter=doi") ? fx("crossref-dois-retraccion-wakefield.json") : '{"message":{"total-results":0,"items":[]}}');
  });
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  return state;
}

async function search(page: Page, text: string) {
  await nav(page, "Buscador").click();
  await page.getByLabel("Texto de búsqueda").fill(text);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
}

test("aviso de retractación, nivel de evidencia y alertas de búsquedas nuevas", async ({ page }) => {
  const state = await setup(page);
  await search(page, "ileal hyperplasia colitis children");
  const item = page.getByTestId("work-item").filter({ hasText: "Ileal-lymphoid-nodular hyperplasia" });
  await expect(item.getByTestId("retraction")).toContainText("⚠ Artículo retractado. No conviene citarlo como evidencia.");
  await expect(item.getByTestId("retraction")).toContainText("Fuente: PubMed");
  // Seguir la búsqueda: lo de ahora queda como visto
  await page.getByRole("button", { name: "🔔 Seguir esta búsqueda" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Siguiendo esta búsqueda" })).toBeVisible();
  await nav(page, "Inicio").click();
  const alerts = page.getByTestId("alerts");
  await expect(alerts.getByTestId("alert")).toContainText("ileal hyperplasia colitis children");
  await expect(alerts.getByTestId("alert")).toContainText("sin novedades");
  // Aparece una publicación nueva en la fuente
  state.epmc = "europepmc-core-autores-correo-38117317.json";
  await alerts.getByRole("button", { name: "Revisar ahora" }).click();
  await expect(alerts.getByRole("status").filter({ hasText: "nueva" })).toContainText("ileal hyperplasia colitis children: 1 nueva(s)");
  expect(state.calls.some((u) => u.includes("sort=P_PDATE_D desc"))).toBe(true); // se piden las más recientes
  await alerts.getByRole("button", { name: "Ver" }).click();
  await expect(alerts.getByTestId("work-item")).toContainText("A nematode-inducible promoter");
  // Revisar de nuevo no repite lo ya encontrado
  await alerts.getByRole("button", { name: "Revisar ahora" }).click();
  await expect(alerts.getByRole("status").filter({ hasText: "nueva" })).toContainText("0 nueva(s)");
  await alerts.getByRole("button", { name: "Marcar como vistas" }).click();
  await expect(alerts.getByTestId("alert")).toContainText("sin novedades");
  if (process.env.BC_SHOTS) await page.screenshot({ path: `${process.env.BC_SHOTS}/60-alertas.png` });
});

test("ficha del estudio con su frase de origen, «mejor evidencia primero» y revisión de retracciones de la biblioteca", async ({ page }) => {
  const state = await setup(page);
  state.epmc = "europepmc-core-autores-correo-38117317.json";
  await search(page, "Meloidogyne RNAi tomato");
  const item = page.getByTestId("work-item").filter({ hasText: "nematode-inducible promoter" });
  await expect(item.getByTestId("evidence-level")).toHaveText("Evidencia: Experimento controlado");
  await item.getByRole("button", { name: "Ficha del estudio" }).click();
  const snap = item.getByTestId("snapshot");
  await expect(snap.getByRole("row", { name: /Organismos/ })).toContainText("Meloidogyne incognita, Arabidopsis thaliana, Solanum lycopersicum");
  await expect(snap.getByRole("row", { name: /Duración o tiempo/ })).toContainText("10-21 days");
  await snap.getByRole("row", { name: /Duración o tiempo/ }).getByRole("button", { name: "¿de dónde?" }).click();
  await expect(snap).toContainText("«pAt2g18140 was found to be nematode-responsive during 10-21 days post-inoculation (dpi)");
  await page.getByLabel("Mejor evidencia primero").check();
  await item.getByRole("button", { name: "Guardar en biblioteca" }).click();
  if (process.env.BC_SHOTS) await page.screenshot({ path: `${process.env.BC_SHOTS}/61-ficha-estudio.png` });

  // También el artículo retractado, para revisarlo desde la biblioteca
  state.epmc = "europepmc-retractados-wakefield.json";
  await search(page, "ileal hyperplasia colitis children");
  await page.getByTestId("work-item").filter({ hasText: "Ileal-lymphoid" }).getByRole("button", { name: "Guardar en biblioteca" }).click();
  await nav(page, "Biblioteca").click();
  await page.getByRole("button", { name: "Revisar retracciones" }).click();
  await expect(page.getByTestId("retraction-summary")).toHaveText("2 de 2 publicaciones revisadas · Avisos — artículo retractado: 1");
  const wk = page.getByTestId("work-item").filter({ hasText: "Ileal-lymphoid" });
  await expect(wk.getByTestId("retraction")).toContainText("Artículo retractado (2010-02-06)");
  await expect(wk.getByTestId("retraction")).toContainText("Fuente: Crossref / Retraction Watch");
  await expect(wk.getByRole("link", { name: "Ver el aviso" })).toHaveAttribute("href", "https://doi.org/10.1016/s0140-6736(10)60175-4");
  await expect(page.getByTestId("work-item").filter({ hasText: "nematode-inducible" }).getByTestId("retraction")).toHaveCount(0);
});
