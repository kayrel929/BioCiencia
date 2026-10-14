import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/** Prueba de interfaz de la Fase 4: importar, exportar en 6 formatos, copia de seguridad y restauración. */
const SHOTS = process.env.BC_SHOTS;

// Archivo RIS de ejemplo con la estructura que exportan Zotero/Mendeley/EndNote
const RIS = [
  "TY  - JOUR", "TI  - Isolation of Bacteria with Antifungal Activity against the Phytopathogenic Fungi Stenocarpella maydis and Stenocarpella macrospora",
  "AU  - Petatán-Sagahón, Iván", "AU  - Téllez-Jurado, Alejandro", "PY  - 2011", "T2  - International Journal of Molecular Sciences",
  "DO  - 10.3390/ijms12095522", "KW  - biocontrol", "ER  - ", "",
  "TY  - JOUR", "TI  - Prevalence of Stenocarpella maydis and Stenocarpella macrospora causing Diplodia ear rot in Kentucky",
  "AU  - Anderson, Nolan R.", "PY  - 2023", "T2  - Plant Health Progress", "DO  - 10.1094/PHP-06-23-0060-RS", "ER  - ", "",
  "TY  - JOUR", "AU  - Sin título", "ER  - ", "",
].join("\r\n");

const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });

async function login(page: Page, name = "Christopher Suárez") {
  await page.goto("/");
  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
}

test("importar RIS, evitar duplicados, exportar en 6 formatos, copia de seguridad y restauración en otro navegador", async ({ page, browser }) => {
  await login(page);
  await nav(page, "Biblioteca").click();

  // Importar
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await page.getByLabel("Archivo").setInputFiles({ name: "zotero.ris", mimeType: "application/x-research-info-systems", buffer: Buffer.from(RIS, "utf8") });
  await expect(page.getByTestId("import-preview")).toContainText("2 referencia(s) leída(s)");
  await expect(page.getByTestId("import-preview")).toContainText("sin título, no se importó");
  await page.getByRole("button", { name: "Importar a la biblioteca" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Importación terminada" })).toContainText("2 nueva(s), 0 ya existían");
  await page.getByRole("button", { name: "Cerrar", exact: true }).filter({ hasText: "Cerrar" }).click();
  await expect(page.getByTestId("work-item")).toHaveCount(2);

  // Importar el mismo archivo otra vez no duplica
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await page.getByLabel("Archivo").setInputFiles({ name: "zotero.ris", mimeType: "text/plain", buffer: Buffer.from(RIS, "utf8") });
  await page.getByRole("button", { name: "Importar a la biblioteca" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Importación terminada" })).toContainText("0 nueva(s), 2 ya existían");
  await page.getByRole("button", { name: "Cerrar", exact: true }).filter({ hasText: "Cerrar" }).click();
  await expect(page.getByTestId("work-item")).toHaveCount(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/20-biblioteca-importada.png` });

  // Exportar en los 6 formatos y revisar el contenido real de cada archivo
  const expected: Record<string, RegExp> = {
    bib: /@article\{petatansagahon2011isolation,[\s\S]*doi = \{10\.3390\/ijms12095522\}/,
    ris: /TY {2}- JOUR[\s\S]*AU {2}- Petatán-Sagahón, Iván/,
    enw: /%0 Journal Article[\s\S]*%R 10\.1094\/php-06-23-0060-rs/,
    enx: /<ref-type name="Journal Article">17<\/ref-type>/,
    csv: /^﻿titulo,autores,anio/,
    csl: /"DOI": "10\.3390\/ijms12095522"/,
  };
  for (const [fmt, re] of Object.entries(expected)) {
    await page.getByLabel("Formato de exportación").selectOption(fmt);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar esta vista" }).click()]);
    const content = readFileSync((await dl.path())!, "utf8");
    expect(content, `formato ${fmt}`).toMatch(re);
    expect(dl.suggestedFilename()).toMatch(/^biblioteca-\d{4}-\d{2}-\d{2}\.(bib|ris|enw|xml|csv|json)$/);
  }

  // Un proyecto para comprobar que la copia lo conserva
  await nav(page, "Proyectos").click();
  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  await page.getByLabel("Nombre *").fill("Diplodia en Orellana");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.getByRole("heading", { name: "Diplodia en Orellana" })).toBeVisible();

  // Copia de seguridad
  await nav(page, "Configuración").click();
  const [backupDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Crear copia de seguridad" }).click()]);
  const backupPath = (await backupDl.path())!;
  const backup = JSON.parse(readFileSync(backupPath, "utf8"));
  expect(backup.format).toBe("biociencia-backup-1");
  expect(backup.tables.works).toHaveLength(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/21-configuracion-copias.png`, fullPage: true });

  // Restaurar en OTRO navegador vacío (como otra computadora)
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await login(p2, "Usuario temporal");
  await nav(p2, "Configuración").click();
  p2.once("dialog", (d) => d.accept());
  await p2.getByLabel("Archivo de copia de seguridad").setInputFiles(backupPath);
  await expect(p2.getByRole("status").filter({ hasText: "Copia restaurada" })).toBeVisible();
  await expect(p2.getByRole("navigation").locator("..").getByText("Christopher Suárez")).toBeVisible();
  await nav(p2, "Biblioteca").click();
  await expect(p2.getByTestId("work-item")).toHaveCount(2);
  await p2.getByLabel("Buscar en la biblioteca").fill("petatan");
  await p2.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(p2.getByTestId("work-item")).toHaveCount(1);
  await nav(p2, "Proyectos").click();
  await expect(p2.getByText("Diplodia en Orellana")).toBeVisible();

  // Un archivo que no es copia no borra nada
  await nav(p2, "Configuración").click();
  p2.once("dialog", (d) => d.accept());
  await p2.getByLabel("Archivo de copia de seguridad").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hola":1}') });
  await expect(p2.getByRole("status").filter({ hasText: "No se restauró nada" })).toBeVisible();
  await nav(p2, "Biblioteca").click();
  await expect(p2.getByTestId("work-item")).toHaveCount(2);
  await other.close();
});
