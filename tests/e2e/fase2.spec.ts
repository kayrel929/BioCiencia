import { expect, test } from "@playwright/test";

/**
 * Prueba de interfaz de la Fase 2 (versión web con SQLite-WASM/OPFS).
 * Los datos de prueba son metadatos públicos reales escritos a mano;
 * no se simula ninguna búsqueda en línea.
 */
const SHOTS = process.env.BC_SHOTS;
const nav = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("navigation").getByRole("link", { name, exact: true });

test("identidad, biblioteca sin duplicados, proyecto persistente y pantallas pendientes", async ({ page }) => {
  await page.goto("/");

  // 1. Primera apertura: identidad local
  await expect(page.getByRole("heading", { name: "Bienvenido" })).toBeVisible();
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  await expect(page.getByRole("heading", { name: /Investigación científica/ })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-inicio.png` });

  // 2. Referencia manual en la biblioteca
  await nav(page, "Biblioteca").click();
  const addRef = async (doi: string) => {
    await page.getByRole("button", { name: "Referencia manual" }).click();
    await page.getByLabel("Título *").fill("Prevalence of Stenocarpella maydis and Stenocarpella macrospora causing Diplodia ear rot in Kentucky");
    await page.getByLabel(/Autores/).fill("Anderson, Nolan R.");
    await page.getByLabel("Año").fill("2023");
    await page.getByLabel("DOI").fill(doi);
    await page.getByLabel("Revista").fill("Plant Health Progress");
    await page.getByRole("button", { name: "Guardar en la biblioteca" }).click();
  };
  await addRef("10.1094/php-06-23-0060-rs");
  await expect(page.getByTestId("work-item")).toHaveCount(1);

  // 3. El mismo DOI escrito distinto no se duplica
  await addRef("https://doi.org/10.1094/PHP-06-23-0060-RS");
  await expect(page.getByTestId("work-item")).toHaveCount(1);

  // 4. Búsqueda local sin acentos ni mayúsculas
  await page.getByLabel("Buscar en la biblioteca").fill("DIPLODIA kentucky");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByTestId("work-item")).toHaveCount(1);
  await page.getByLabel("Buscar en la biblioteca").fill("ralstonia");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByText("Ninguna publicación coincide")).toBeVisible();
  await page.getByLabel("Buscar en la biblioteca").fill("");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-biblioteca.png` });

  // 5. Proyecto: crear, vincular la publicación, recargar y comprobar que persiste
  await nav(page, "Proyectos").click();
  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  await page.getByLabel("Nombre *").fill("Pudrición de mazorca por Stenocarpella en Orellana");
  await page.getByLabel("Objetivos").fill("Determinar incidencia en 10 fincas");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect(page.getByRole("heading", { name: "Pudrición de mazorca por Stenocarpella en Orellana" })).toBeVisible();
  await page.getByLabel("Nueva nota").fill("Muestreo en noviembre");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByText("Muestreo en noviembre")).toBeVisible();

  await nav(page, "Biblioteca").click();
  await page.getByRole("button", { name: "Etiquetas, notas y proyecto" }).click();
  await page.getByRole("dialog").locator("select").nth(1).selectOption({ label: "Pudrición de mazorca por Stenocarpella en Orellana" });
  await expect(page.getByText("Añadida al proyecto.")).toBeVisible();
  await page.getByRole("button", { name: "Listo" }).click();

  await page.reload();
  await nav(page, "Proyectos").click();
  await expect(page.getByText("1 publicaciones")).toBeVisible();
  await page.getByRole("link", { name: /Pudrición de mazorca/ }).click();
  await expect(page.getByLabel("Objetivos")).toHaveValue("Determinar incidencia en 10 fincas");
  await expect(page.getByText("Muestreo en noviembre")).toBeVisible();
  await expect(page.getByText("Bibliografía del proyecto (1)")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-proyecto.png`, fullPage: true });

  // 6. Almacenamiento persistente y modo oscuro
  await nav(page, "Configuración").click();
  await expect(page.getByRole("cell", { name: "Sí" })).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Modo oscuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-configuracion-oscuro.png` });

  // 7. Los módulos futuros se declaran pendientes, no simulados
  for (const name of ["Análisis con IA", "Editor científico", "Estadística", "Investigadores"]) {
    await nav(page, name).click();
    await expect(page.getByTestId("pending")).toBeVisible();
  }
});

test("la interfaz se adapta a la pantalla de un teléfono", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Prueba móvil");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  await expect(page.getByRole("button", { name: "Menú" })).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll("button, input")].some((el) => el.getBoundingClientRect().right > window.innerWidth + 1));
  expect(overflow).toBe(false);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-movil.png` });
});
