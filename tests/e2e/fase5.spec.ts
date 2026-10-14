import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Fase 5 en la interfaz: dos navegadores aislados hacen de dos computadoras.
 * La versión web usa paquetes de sincronización (la carpeta automática es de la app de Windows).
 */
const SHOTS = process.env.BC_SHOTS;
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });

async function login(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
}

async function exportBundle(page: Page): Promise<string> {
  await nav(page, "Sincronización").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar paquete" }).click()]);
  return (await dl.path())!;
}

async function importBundle(page: Page, path: string) {
  await nav(page, "Sincronización").click();
  await page.getByLabel("Paquete de sincronización").setInputFiles(path);
  await expect(page.getByRole("status").filter({ hasText: "Paquete importado" })).toBeVisible();
}

test("compartir un proyecto entre dos «computadoras», editar en ambas y ver el historial", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  // B obtiene su código de investigador
  await login(b, "Ana Torres");
  await nav(b, "Sincronización").click();
  const codeBox = b.getByLabel("Código de investigador");
  await expect(codeBox).toHaveValue(/^BC1-/);
  const code = await codeBox.inputValue();
  if (SHOTS) await b.screenshot({ path: `${SHOTS}/30-sincronizacion-web.png`, fullPage: true });

  // A crea el proyecto, lo comparte e invita a B
  await login(a, "Christopher Suárez");
  await nav(a, "Proyectos").click();
  await a.getByRole("button", { name: "Nuevo proyecto" }).click();
  await a.getByLabel("Nombre *").fill("Diplodia en Orellana");
  await a.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(a.getByRole("heading", { name: "Diplodia en Orellana" })).toBeVisible();
  await a.getByLabel("Nueva nota").fill("Primera visita de campo");
  await a.getByRole("button", { name: "Añadir", exact: true }).click();
  await a.getByRole("button", { name: "Compartir proyecto" }).click();
  await expect(a.getByRole("status").filter({ hasText: "Proyecto compartido" })).toBeVisible();
  await a.getByLabel("Invitar con el código de investigador").fill(code);
  await a.getByLabel("Rol del invitado").selectOption("editor");
  await a.getByRole("button", { name: "Invitar" }).click();
  await expect(a.getByRole("status").filter({ hasText: "Ana Torres fue invitado" })).toBeVisible();
  await expect(a.getByRole("cell", { name: "Ana Torres", exact: true })).toBeVisible();

  // Un código mal copiado da un error claro
  await a.getByLabel("Invitar con el código de investigador").fill("BC1-roto");
  await a.getByRole("button", { name: "Invitar" }).click();
  await expect(a.getByRole("status").filter({ hasText: "dañado o incompleto" })).toBeVisible();

  // A → B
  const bundle1 = await exportBundle(a);
  expect(JSON.parse(readFileSync(bundle1, "utf8")).format).toBe("biociencia-sync-1");
  expect(readFileSync(bundle1, "utf8")).not.toMatch(/secret/i);
  await importBundle(b, bundle1);
  await nav(b, "Proyectos").click();
  await b.getByText("Diplodia en Orellana").click();
  await expect(b.getByText("Su rol: Investigador editor")).toBeVisible();
  await expect(b.getByText("Primera visita de campo", { exact: true })).toBeVisible();

  // B edita y escribe una nota
  await b.getByLabel("Descripción").fill("Pudrición de mazorca en maíz amarillo duro");
  await b.getByRole("button", { name: "Guardar" }).click();
  await expect(b.getByRole("status").filter({ hasText: "Cambios guardados" })).toBeVisible();
  await b.getByLabel("Nueva nota").fill("Muestras listas para aislamiento");
  await b.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(b.getByText("Muestras listas para aislamiento", { exact: true })).toBeVisible();

  // B → A
  const bundle2 = await exportBundle(b);
  await importBundle(a, bundle2);
  await nav(a, "Proyectos").click();
  await a.getByText("Diplodia en Orellana").click();
  await expect(a.getByLabel("Descripción")).toHaveValue("Pudrición de mazorca en maíz amarillo duro");
  await expect(a.getByText("Muestras listas para aislamiento", { exact: true })).toBeVisible();
  const hist = a.getByTestId("project-history");
  await expect(hist).toContainText("Ana Torres");
  await expect(hist).toContainText("Cambió la descripción");
  await expect(hist).toContainText("Invitó a Ana Torres (editor)");
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/31-proyecto-compartido.png`, fullPage: true });

  // Reimportar el mismo paquete no duplica
  await nav(a, "Sincronización").click();
  await a.getByLabel("Paquete de sincronización").setInputFiles(bundle2);
  await expect(a.getByRole("status").filter({ hasText: "Paquete importado: 0 cambio(s) nuevo(s)" })).toBeVisible();
  await expect(a.getByTestId("sync-log")).toContainText("Paquete importado");

  await ctxA.close();
  await ctxB.close();
});
