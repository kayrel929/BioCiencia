import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/** Fase 11: copia de seguridad cifrada y política de seguridad de contenido (CSP). */
const SHOTS = process.env.BC_SHOTS;
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });

async function login(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
}

test("la versión compilada declara CSP y ninguna pantalla la viola", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|CSP/i.test(m.text())) violations.push(m.text()); });
  page.on("pageerror", (e) => violations.push(e.message));
  await login(page, "Christopher Suárez");
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/[\s;]'unsafe-eval'/);
  for (const name of ["Buscador", "Biblioteca", "Descubrimiento", "Investigadores", "Sincronización", "Configuración", "Inicio"]) {
    await nav(page, name).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  expect(violations).toEqual([]);
  // Un script en línea inyectado se bloquea
  const ran = await page.evaluate(() => {
    (window as unknown as { __x?: number }).__x = 0;
    const s = document.createElement("script");
    s.textContent = "window.__x = 1";
    document.body.appendChild(s);
    return (window as unknown as { __x?: number }).__x;
  });
  expect(ran).toBe(0);
});

test("copia cifrada: no se lee sin contraseña y se restaura con ella en otro navegador", async ({ page, browser }) => {
  await login(page, "Christopher Suárez");
  await nav(page, "Proyectos").click();
  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  await page.getByLabel("Nombre *").fill("Ensayo cifrado");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.getByRole("heading", { name: "Ensayo cifrado" })).toBeVisible();

  await nav(page, "Configuración").click();
  const form = page.getByRole("form", { name: "Crear copia de seguridad" });
  await form.getByLabel("Contraseña de la copia").fill("corta");
  await form.getByLabel("Repetir contraseña").fill("corta");
  await form.getByRole("button", { name: "Crear copia cifrada" }).click();
  await expect(page.getByRole("status").filter({ hasText: "al menos 10" })).toBeVisible();

  await form.getByLabel("Contraseña de la copia").fill("Diplodia-Orellana-26");
  await form.getByLabel("Repetir contraseña").fill("Diplodia-Orellana-26");
  const [dl] = await Promise.all([page.waitForEvent("download"), form.getByRole("button", { name: "Crear copia cifrada" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^biociencia-copia-cifrada-\d{4}-\d{2}-\d{2}\.json$/);
  const path = (await dl.path())!;
  const raw = readFileSync(path, "utf8");
  const file = JSON.parse(raw);
  expect(file).toMatchObject({ format: "biociencia-cifrada-1", kdf: "PBKDF2-SHA256", iterations: 600000, cipher: "AES-256-GCM" });
  expect(raw).not.toContain("Ensayo cifrado");
  expect(raw).not.toContain("secret_key");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/110-copia-cifrada.png`, fullPage: true });

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await login(p2, "Otra persona");
  await nav(p2, "Configuración").click();
  await p2.getByLabel("Archivo de copia de seguridad").setInputFiles(path);
  const open = p2.getByRole("form", { name: "Abrir copia cifrada" });
  await open.getByLabel("Contraseña para abrir la copia").fill("contraseña equivocada");
  p2.once("dialog", (d) => d.accept());
  await open.getByRole("button", { name: "Descifrar y restaurar" }).click();
  await expect(p2.getByRole("status").filter({ hasText: "Contraseña incorrecta" })).toBeVisible();
  await nav(p2, "Proyectos").click();
  await expect(p2.getByText("Ensayo cifrado")).toHaveCount(0);

  await nav(p2, "Configuración").click();
  await p2.getByLabel("Archivo de copia de seguridad").setInputFiles(path);
  await p2.getByLabel("Contraseña para abrir la copia").fill("Diplodia-Orellana-26");
  p2.once("dialog", (d) => d.accept());
  await p2.getByRole("button", { name: "Descifrar y restaurar" }).click();
  await expect(p2.getByRole("status").filter({ hasText: "Copia restaurada" })).toBeVisible({ timeout: 15_000 });
  await expect(p2.getByRole("navigation").locator("..").getByText("Christopher Suárez")).toBeVisible();
  await nav(p2, "Proyectos").click();
  await expect(p2.getByText("Ensayo cifrado")).toBeVisible();
  await other.close();
});
