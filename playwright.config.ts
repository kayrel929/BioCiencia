import { defineConfig } from "@playwright/test";

// BC_SERVIR=1 prueba contra el servidor del lanzador «Iniciar BioCiencia.cmd» (scripts/servir.mjs, 127.0.0.1)
const servir = !!process.env.BC_SERVIR;
// BC_URL=http://127.0.0.1:5173 prueba contra un servidor ya abierto (p. ej. BioCiencia.exe del instalador, con Wine)
const externo = process.env.BC_URL;
const url = externo ?? (servir ? "http://127.0.0.1:5198" : "http://localhost:4173");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: url, screenshot: "only-on-failure" },
  webServer: externo ? undefined : {
    command: servir ? "npm run build:web && BC_PORT=5198 node scripts/servir.mjs" : "npm run build:web && npm run preview -w @biociencia/web",
    url,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
