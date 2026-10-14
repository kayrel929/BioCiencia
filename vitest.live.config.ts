import { defineConfig } from "vitest/config";

// Pruebas que necesitan internet (se ejecutan en la PC del usuario, no en la nube)
export default defineConfig({
  test: { include: ["tests/live/**/*.live.test.ts"], environment: "node" },
});
