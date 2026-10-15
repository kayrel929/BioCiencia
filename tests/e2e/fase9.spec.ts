import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Estadística en la interfaz. Los datos «PlantGrowth» (Dobson 1983) y el DBCA de prueba son los mismos
 * cuyos resultados se verificaron contra statsmodels (packages/stats/tests/ref/referencias.json).
 */
const REF = JSON.parse(readFileSync(join(__dirname, "..", "..", "packages", "stats", "tests", "ref", "referencias.json"), "utf8"));
const SHOTS = process.env.BC_SHOTS;
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const es = (x: number, d: number) => x.toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: d });

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  await nav(page, "Estadística").click();
}

test("DCA con Tukey (PlantGrowth): tabla de ANOVA, letras, supuestos y exportación", async ({ page }) => {
  await login(page);
  const { y, g } = REF.plantgrowth;
  // Como lo copiaría Excel en español: tabulador y coma decimal
  const text = ["Tratamiento\tPeso seco (g)", ...y.map((v: number, i: number) => `${g[i]}\t${String(v).replace(".", ",")}`)].join("\n");
  await page.getByLabel("Pegue aquí su tabla (con encabezados)").fill(text);
  await expect(page.getByTestId("data-preview")).toContainText("30 filas · 2 columnas · separador tabulador · coma decimal");
  await page.getByLabel("Tipo de análisis").selectOption("dca");
  await page.getByLabel("Variable respuesta").selectOption("Peso seco (g)");
  await page.getByLabel("Tratamiento").selectOption("Tratamiento");
  await page.getByRole("button", { name: "Calcular" }).click();

  const res = page.getByTestId("stats-result");
  await expect(res).toContainText("ANOVA (DCA): Peso seco (g) según Tratamiento");
  await expect(res.getByRole("row", { name: /^Tratamientos 2/ })).toContainText(es(REF.plantgrowth.anova.f, 3));
  await expect(res.getByRole("row", { name: /^Tratamientos 2/ })).toContainText("0,016");
  await expect(res.getByRole("row", { name: /^trt2 10/ })).toContainText("a");
  await expect(res.getByRole("row", { name: /^ctrl 10/ })).toContainText("ab");
  await expect(res.getByRole("row", { name: /^trt1 10/ })).toContainText("b");
  await expect(res).toContainText("Normalidad de residuos (Shapiro-Wilk)");
  await expect(page.getByTestId("stats-interpretation")).toContainText("hay diferencias estadísticamente significativas entre tratamientos");
  if (SHOTS) await res.screenshot({ path: `${SHOTS}/60-estadistica-dca.png` });

  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar resultados (CSV)" }).click()]);
  const csv = readFileSync((await dl.path())!, "utf8");
  expect(csv).toContain('"Análisis de varianza"');
  expect(csv).toContain('"trt2";"10"');

  // Guardar los datos y volver a abrirlos
  await page.getByLabel("Nombre del conjunto de datos").fill("PlantGrowth");
  await page.getByRole("button", { name: "Guardar datos" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Datos guardados" })).toBeVisible();
  await page.getByLabel("Pegue aquí su tabla (con encabezados)").fill("");
  await page.getByRole("row", { name: /PlantGrowth/ }).getByRole("button", { name: "Abrir" }).click();
  await expect(page.getByTestId("data-preview")).toContainText("30 filas");

  // t de Student con 3 grupos: error claro
  await page.getByLabel("Tipo de análisis").selectOption("t");
  await page.getByLabel("Variable respuesta").selectOption("Peso seco (g)");
  await page.getByLabel("Grupo (2 niveles)").selectOption("Tratamiento");
  await page.getByRole("button", { name: "Calcular" }).click();
  await expect(page.getByRole("status").filter({ hasText: "necesita exactamente 2" })).toBeVisible();
});

test("DBCA: tratamientos y bloques igual que statsmodels", async ({ page }) => {
  await login(page);
  const r = REF.rcbd;
  const text = ["trat;bloque;rendimiento", ...r.y.map((v: number, i: number) => `${r.t[i]};${r.b[i]};${String(v).replace(".", ",")}`)].join("\n");
  await page.getByLabel("Pegue aquí su tabla (con encabezados)").fill(text);
  await page.getByLabel("Tipo de análisis").selectOption("dbca");
  await page.getByLabel("Variable respuesta").selectOption("rendimiento");
  await page.getByLabel("Tratamiento").selectOption("trat");
  await page.getByLabel("Bloque").selectOption("bloque");
  await page.getByRole("button", { name: "Calcular" }).click();
  const res = page.getByTestId("stats-result");
  await expect(res.getByRole("row", { name: /^Tratamientos 4/ })).toContainText(es(r.f_t, 3));
  await expect(res.getByRole("row", { name: /^Error 12/ })).toContainText(es(r.mse, 4));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/61-estadistica-dbca.png`, fullPage: true });
});
