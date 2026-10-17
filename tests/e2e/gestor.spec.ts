import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Funciones de gestor de referencias: PDF con subrayados, estilos de cita CSL, grupos inteligentes
 * y solicitud formal del artículo al autor.
 * - Europe PMC: respuesta REAL grabada (fixtures/FUENTES.md, PMID 38117317, con correos de autores).
 * - zootaxa.csl: archivo REAL del repositorio oficial de estilos CSL (CC BY-SA 3.0), servido como si se descargara.
 * - pdf-de-prueba.pdf: PDF GENERADO para la prueba (scripts/pdf-prueba.mjs); no es un artículo real.
 */
const FX = join(__dirname, "..", "..", "packages", "sources", "tests", "fixtures");
const E2E = join(__dirname, "fixtures");
const fx = (n: string) => readFileSync(join(FX, n), "utf8");
const PDF = join(E2E, "pdf-de-prueba.pdf");
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const reply = (route: Route, body: string, status = 200, type = "application/json") =>
  route.fulfill({ status, contentType: type, headers: { "access-control-allow-origin": "*" }, body });

async function setup(page: Page) {
  const calls: string[] = [];
  await page.route("https://api.openalex.org/**", (r) => r.abort());
  await page.route("https://eutils.ncbi.nlm.nih.gov/**", (r) => reply(r, '{"esearchresult":{"count":"0","idlist":[]}}'));
  await page.route("https://www.ebi.ac.uk/**", (r) => (calls.push(decodeURIComponent(r.request().url())), reply(r, fx("europepmc-core-autores-correo-38117317.json"))));
  await page.route("https://doaj.org/**", (r) => reply(r, '{"total":0,"results":[]}'));
  await page.route("https://api.crossref.org/**", (r) => reply(r, '{"message":{"total-results":0,"items":[]}}'));
  await page.route("https://raw.githubusercontent.com/**", (r) => (calls.push(r.request().url()), reply(r, readFileSync(join(E2E, "zootaxa.csl"), "utf8"), 200, "text/plain")));
  await page.goto("/");
  await page.getByLabel("Nombre").fill("Christopher Suárez");
  await page.getByRole("button", { name: "Crear identidad y entrar" }).click();
  return calls;
}

async function addManual(page: Page, title: string, authors: string, year: string, venue: string) {
  await nav(page, "Biblioteca").click();
  await page.getByRole("button", { name: /Referencia manual/ }).click();
  await page.getByLabel("Título *").fill(title);
  await page.getByLabel("Autores (separados por punto y coma)").fill(authors);
  await page.getByLabel("Año").fill(year);
  await page.getByLabel("Revista").fill(venue);
  await page.getByRole("button", { name: "Guardar en la biblioteca" }).click();
  await expect(page.getByTestId("work-item").filter({ hasText: title })).toBeVisible();
}

test("ya no hay editor científico en el menú", async ({ page }) => {
  await setup(page);
  await expect(nav(page, "Editor científico")).toHaveCount(0);
  await page.goto("/#/editor");
  await expect(page.getByText("Página no encontrada.")).toBeVisible();
});

test("solicitud muy formal del artículo completo al autor, con su correo de Europe PMC", async ({ page }) => {
  const calls = await setup(page);
  await nav(page, "Buscador").click();
  await page.getByLabel("Texto de búsqueda").fill("Meloidogyne RNAi tomato");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const item = page.getByTestId("work-item").filter({ hasText: "nematode-inducible promoter" });
  await item.getByRole("button", { name: "Solicitar artículo completo" }).click();
  const dlg = page.getByRole("dialog", { name: "Solicitar el artículo completo al autor" });
  // El correo del autor de correspondencia ya venía en la afiliación (respuesta real)
  await expect(dlg.getByLabel("Correo del autor")).toHaveValue("anilsirohi@yahoo.com");
  await dlg.getByLabel("Tratamiento o grado").fill("Dr.");
  await dlg.getByLabel("Cargo").fill("Investigador");
  await dlg.getByLabel("Institución", { exact: true }).fill("INIAP, Ecuador");
  await dlg.getByLabel("Correo", { exact: true }).fill("investigador@example.org");
  await dlg.getByLabel("Para qué lo necesita (opcional)").fill("mi estudio sobre Meloidogyne en tomate");
  const body = dlg.getByLabel("Texto de la carta (puede editarlo)");
  await expect(body).toHaveValue(/Estimado\(a\) Dr\(a\)\. Sirohi:/);
  await expect(body).toHaveValue(/Reciba un cordial y respetuoso saludo\./);
  await expect(body).toHaveValue(/Mi nombre es Dr\. Christopher Suárez, Investigador de INIAP, Ecuador\. Me dirijo a usted con el mayor respeto/);
  await expect(body).toHaveValue(/Thorat, Y\. E\., Dutta, T\. K\., Jain, P\. K\., Subramaniam, K\., y Sirohi, A\. \(2023\)/);
  await expect(body).toHaveValue(/Su trabajo resulta de especial relevancia para mi estudio sobre Meloidogyne en tomate\./);
  await expect(body).toHaveValue(/Con sentimientos de la más alta consideración y estima,/);
  await expect(dlg.getByLabel("Asunto")).toHaveValue(/^Solicitud respetuosa de copia del artículo «A nematode-inducible promoter/);
  await expect(dlg.getByRole("link", { name: "Abrir en mi correo" })).toHaveAttribute("href", /^mailto:anilsirohi@yahoo\.com\?subject=Solicitud%20respetuosa/);
  // Otro autor y en inglés
  await dlg.getByLabel("Autor", { exact: true }).selectOption({ label: "Tushar K Dutta — tushar.dutta@icar.gov.in" });
  await dlg.getByLabel("Idioma").selectOption("en");
  await expect(body).toHaveValue(/Dear Dr\. Dutta,/);
  await expect(body).toHaveValue(/I am writing to respectfully request/);
  await expect(dlg.getByLabel("Correo del autor")).toHaveValue("tushar.dutta@icar.gov.in");
  // Se puede guardar como Word y los datos de la firma se recuerdan
  const [docx] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "Descargar carta (Word)" }).click()]);
  expect(docx.suggestedFilename()).toMatch(/^Solicitud de articulo - A nematode-inducible.*\.docx$/);
  if (process.env.BC_SHOTS) await page.screenshot({ path: `${process.env.BC_SHOTS}/50-solicitud-autor.png` });
  await dlg.getByRole("button", { name: "Cerrar" }).click();
  await item.getByRole("button", { name: "Solicitar artículo completo" }).click();
  await expect(page.getByLabel("Institución", { exact: true })).toHaveValue("INIAP, Ecuador");
  expect(calls.every((u) => !u.includes("anilsirohi"))).toBe(true); // nada se envía a ningún servicio
});

test("PDF adjunto: búsqueda en su texto, lectura, subrayado con nota y grupo inteligente", async ({ page }) => {
  await setup(page);
  await addManual(page, "Supervivencia de Stenocarpella en rastrojo", "Pinto, F.", "2023", "Revista de prueba");
  await addManual(page, "Otro artículo sin PDF", "Ruiz, A.", "2010", "Otra revista");
  const item = page.getByTestId("work-item").filter({ hasText: "Supervivencia de Stenocarpella" });
  await item.getByRole("button", { name: "Adjuntar PDF" }).click();
  await page.getByLabel("Elegir archivo PDF").setInputFiles(PDF);
  await expect(page.getByRole("status").filter({ hasText: "adjuntado" })).toContainText("«pdf-de-prueba.pdf» adjuntado (2 páginas)");
  // Un archivo que no es PDF se rechaza
  await page.getByLabel("Elegir archivo PDF").setInputFiles({ name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("hola") });
  await expect(page.getByRole("status").filter({ hasText: "falso.pdf" })).toContainText("no es un archivo PDF");
  await expect(page.getByTestId("pdf-attachment")).toHaveCount(1);
  await page.getByRole("button", { name: "Leer y subrayar" }).click();

  const viewer = page.getByRole("dialog", { name: "PDF: pdf-de-prueba.pdf" });
  await expect(viewer.getByTestId("pdf-page")).toHaveText("Página 1 de 2");
  const layer = viewer.getByTestId("pdf-text");
  await expect(layer).toContainText("sobrevivieron en el rastrojo");
  // Selecciona una frase con el ratón (como lo haría el usuario) y la subraya
  const span = layer.locator("span", { hasText: "Los conidios sobrevivieron" }).first();
  const box = (await span.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await viewer.getByRole("button", { name: "Subrayar y anotar" }).click();
  const ann = viewer.getByTestId("annotation");
  await expect(ann).toHaveCount(1);
  await expect(ann).toContainText("Los conidios sobrevivieron en el rastrojo durante dieciocho meses");
  await expect(viewer.locator(".bc-mark")).not.toHaveCount(0);
  await ann.getByLabel("Nota del subrayado").fill("Dato para la discusión");
  await viewer.getByLabel("Buscar en el PDF").click(); // al salir de la nota se guarda
  await viewer.getByLabel("Buscar en el PDF").fill("rotacion");
  await viewer.getByRole("button", { name: "p. 2 (1)" }).click();
  await expect(viewer.getByTestId("pdf-page")).toHaveText("Página 2 de 2");
  await expect(layer).toContainText("La rotacion de cultivos");
  if (process.env.BC_SHOTS) await page.screenshot({ path: `${process.env.BC_SHOTS}/51-pdf-subrayado.png` });
  await viewer.getByRole("button", { name: "Pasar a observaciones" }).click();
  await viewer.getByRole("button", { name: "← Volver" }).click();
  await expect(page.getByTestId("pdf-attachment")).toContainText("1 subrayado(s)");
  await page.getByRole("button", { name: "Cerrar" }).click();

  // El texto del PDF se busca desde la biblioteca, sin internet
  await page.getByLabel("Buscar en la biblioteca").fill("dieciocho meses");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByTestId("work-item")).toHaveCount(1);
  await expect(page.getByTestId("work-item")).toContainText("p. 1 — «Los conidios sobrevivieron");
  await expect(page.getByTestId("work-item")).toContainText("Nota: Dato para la discusión");
  await page.getByLabel("Buscar en la biblioteca").fill("");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByTestId("work-item")).toHaveCount(2);

  // Grupo inteligente: con PDF y desde 2020
  await page.getByRole("button", { name: /Grupo inteligente/ }).click();
  const g = page.getByRole("dialog", { name: "Nuevo grupo inteligente" });
  await g.getByLabel("Nombre").fill("Recientes con PDF");
  await g.getByLabel("Valor de la regla 1").fill("2020");
  await g.getByRole("button", { name: "+ Añadir regla" }).click();
  await g.getByLabel("Campo de la regla 2").selectOption({ label: "Tiene PDF" });
  await expect(g).toContainText("Año desde (≥) «2020» y Tiene PDF: sí");
  await g.getByRole("button", { name: "Guardar grupo" }).click();
  await expect(page.getByTestId("smart-group-info")).toContainText("Recientes con PDF");
  await expect(page.getByTestId("work-item")).toHaveCount(1);
  await expect(page.getByTestId("work-item")).toContainText("Supervivencia de Stenocarpella");
  // Se actualiza solo: al quitar el PDF, la publicación sale del grupo
  await page.getByRole("button", { name: "PDF (1)" }).click();
  const mgr = page.getByRole("dialog", { name: "PDF de la publicación" });
  await mgr.getByRole("button", { name: "Quitar" }).click();
  await mgr.getByRole("button", { name: "¿Seguro? Clic otra vez" }).click();
  await expect(mgr.getByTestId("pdf-attachment")).toHaveCount(0);
  await mgr.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByTestId("work-item")).toHaveCount(0);
  await page.getByLabel("Grupo inteligente").selectOption("");
  await expect(page.getByTestId("work-item")).toHaveCount(2);
});

test("bibliografía con miles de estilos CSL: incluidos, dependientes y descargados", async ({ page }) => {
  const calls = await setup(page);
  await addManual(page, "Maize ear rot caused by Stenocarpella maydis", "Flett, B. C.; McLaren, Nicolaas W.", "1998", "Plant Disease");
  await page.getByRole("button", { name: "Bibliografía de esta vista" }).click();
  const dlg = page.getByRole("dialog", { name: "Bibliografía con estilo de revista" });
  await expect(dlg).toContainText("10.865 estilos");
  const bib = dlg.getByTestId("bibliography");
  await expect(dlg.getByTestId("csl-current")).toContainText("APA Style 7th edition");
  await expect(bib).toHaveText("Flett, B. C., & McLaren, N. W. (1998). Maize ear rot caused by Stenocarpella maydis. Plant Disease.");
  await expect(bib.locator("i")).toHaveText("Plant Disease");
  await expect(dlg.getByTestId("csl-current")).toContainText("Cita en el texto: (Flett & McLaren, 1998)");

  // Estilo de una revista (dependiente): usa el formato de la APS, sin internet
  await dlg.getByLabel("Buscar estilo (revista, editorial o norma)").fill("plant disease");
  await dlg.getByRole("option", { name: /^Plant Disease/ }).first().click();
  await expect(dlg.getByTestId("csl-current")).toContainText("usa el formato «American Phytopathological Society»");
  await expect(bib).toContainText("Flett, B. C., and McLaren, N. W. 1998. Maize ear rot caused by Stenocarpella maydis. Plant Disease.");
  expect(calls.some((u) => u.includes("githubusercontent"))).toBe(false);

  // Estilo no incluido: se descarga del repositorio oficial (versión fija) y queda guardado
  await dlg.getByLabel("Buscar estilo (revista, editorial o norma)").fill("zootaxa");
  await dlg.getByRole("option", { name: /^Zootaxa/ }).click();
  await expect(dlg.getByTestId("csl-current")).toContainText("Descargado ahora del repositorio oficial");
  await expect(bib).toContainText("Flett, B.C. & McLaren, N.W. (1998) Maize ear rot caused by Stenocarpella maydis. Plant Disease.");
  expect(calls.filter((u) => u.includes("githubusercontent"))).toEqual([expect.stringMatching(/^https:\/\/raw\.githubusercontent\.com\/citation-style-language\/styles\/[0-9a-f]{40}\/zootaxa\.csl$/)]);
  const [docx] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "Descargar Word" }).click()]);
  expect(docx.suggestedFilename()).toBe("referencias-zootaxa.docx");
  if (process.env.BC_SHOTS) await page.screenshot({ path: `${process.env.BC_SHOTS}/52-estilos-csl.png` });
  await dlg.getByRole("button", { name: "Cerrar" }).click();

  // La próxima vez recuerda el estilo y no lo vuelve a descargar
  await page.getByRole("button", { name: "Bibliografía de esta vista" }).click();
  await expect(page.getByTestId("csl-current")).toContainText("Guardado en esta computadora");
  expect(calls.filter((u) => u.includes("githubusercontent"))).toHaveLength(1);
});
