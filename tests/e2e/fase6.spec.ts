import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Perfil de investigador con ORCID. Se REPRODUCEN respuestas reales grabadas el 2026-10-15 de
 * la cuenta de DEMOSTRACIÓN oficial de ORCID (Josiah Carberry, 0000-0002-1825-0097).
 */
const FX = join(__dirname, "..", "..", "packages", "sources", "tests", "fixtures");
const fx = (n: string) => readFileSync(join(FX, n), "utf8");
const SHOTS = process.env.BC_SHOTS;
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const reply = (r: Route, body: string, status = 200) => r.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });

test("ORCID: verificar, importar mis publicaciones completadas con Crossref y filtrarlas en la biblioteca", async ({ page }) => {
  const calls: string[] = [];
  await page.route("https://pub.orcid.org/**", (r) => {
    const u = r.request().url();
    calls.push(u);
    return u.endsWith("/personal-details") ? reply(r, fx("orcid-personal-carberry.json")) : reply(r, fx("orcid-works-carberry.json"));
  });
  await page.route("https://api.crossref.org/**", (r) => (calls.push(r.request().url()), reply(r, fx("crossref-dois-carberry.json"))));

  await page.goto("/");
  await page.getByLabel("Nombre").fill("Josiah Carberry");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  await nav(page, "Investigadores").click();

  // ORCID mal escrito: se avisa sin consultar
  await page.getByLabel("Mi ORCID").fill("0000-0002-1825-0098");
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "El ORCID no es válido" })).toBeVisible();
  expect(calls).toHaveLength(0);

  await page.getByLabel("Mi ORCID").fill("https://orcid.org/0000-0002-1825-0097");
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByTestId("orcid-person")).toContainText("Registro ORCID: Josiah Carberry");
  await expect(page.getByTestId("orcid-person")).not.toContainText("no coincide");

  await page.getByRole("button", { name: "Importar mis publicaciones desde ORCID" }).click();
  await expect(page.getByRole("status").filter({ hasText: "publicación(es) de su ORCID" })).toContainText("6 publicación(es) de su ORCID: 6 nueva(s), 0 ya estaban en su biblioteca. 6 completada(s)");
  await expect(page.getByTestId("work-item")).toHaveCount(6);
  const plasma = page.getByTestId("work-item").filter({ hasText: "Bulk and surface plasmons" });
  await expect(plasma).toContainText("John J. Quinn, Josiah S. Carberry");
  await expect(plasma).toContainText("IEEE Transactions on Plasma Science");
  await expect(page.getByTestId("own-summary")).toContainText("Publicaciones propias6");
  expect(calls.filter((u) => u.includes("crossref"))).toHaveLength(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/50-mi-perfil-orcid.png`, fullPage: true });

  // Volver a importar no duplica
  await page.getByRole("button", { name: "Actualizar mis publicaciones desde ORCID" }).click();
  await expect(page.getByRole("status").filter({ hasText: "publicación(es) de su ORCID" })).toContainText("0 nueva(s), 6 ya estaban");
  await expect(page.getByTestId("work-item")).toHaveCount(6);

  // «No es mía» la quita de propias pero sigue en la biblioteca
  await plasma.getByRole("button", { name: "No es mía" }).click();
  await expect(page.getByTestId("work-item")).toHaveCount(5);
  await nav(page, "Biblioteca").click();
  await expect(page.getByTestId("work-item")).toHaveCount(6);
  await page.getByLabel("Mis publicaciones").check();
  await expect(page.getByTestId("work-item")).toHaveCount(5);
  await page.getByLabel("Mis publicaciones").uncheck();
  await page.getByTestId("work-item").filter({ hasText: "Bulk and surface plasmons" }).getByRole("button", { name: "Es mía" }).click();
  await page.getByLabel("Mis publicaciones").check();
  await expect(page.getByTestId("work-item")).toHaveCount(6);
});

test("aviso si el nombre del ORCID no coincide con el usuario", async ({ page }) => {
  await page.route("https://pub.orcid.org/**", (r) => reply(r, fx("orcid-personal-carberry.json")));
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  await nav(page, "Investigadores").click();
  await page.getByLabel("Mi ORCID").fill("0000-0002-1825-0097");
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByTestId("orcid-person")).toContainText("no coincide con «Christopher Suárez»");
});
