import { expect, test } from "@playwright/test";

/** Fase 12: la guía de uso está dentro de la aplicación y se puede buscar. */
test("la Ayuda muestra la guía completa, sus tablas y el buscador filtra por secciones", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Ayuda", exact: true }).click();
  const help = page.getByTestId("help-content");
  await expect(help.getByRole("heading", { name: "Guía de uso de BioCiencia" })).toBeVisible();
  await expect(help.getByRole("heading", { level: 2 })).toHaveCount(14);
  // Tabla de problemas frecuentes y bloque de comandos
  await expect(help.getByRole("cell", { name: "No está en la carpeta del proyecto: cd C:\\BioCiencia" })).toBeVisible();
  await expect(help.locator("pre").first()).toContainText("cd C:\\BioCiencia");
  // Búsqueda
  await page.getByLabel("Buscar en la ayuda").fill("Ollama");
  await expect(help.getByRole("heading", { level: 2 })).toHaveText(["11. Análisis con IA (opcional)"]);
  await page.getByLabel("Buscar en la ayuda").fill("palabra-que-no-existe");
  await expect(help).toContainText("No hay resultados");
  // Sin HTML inyectado: los enlaces de la guía son solo https
  await page.getByLabel("Buscar en la ayuda").fill("");
  const hrefs = await help.locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.length).toBeGreaterThan(0);
  expect(hrefs.every((h) => h.startsWith("https://"))).toBe(true);
});
