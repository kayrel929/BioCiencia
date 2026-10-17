import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts", "tests/two-nodes/**/*.test.ts", "tests/security/**/*.test.ts", "scripts/tests/**/*.test.ts"],
    environment: "node",
    // Algunas pruebas son pesadas (citeproc-js, SQLite) y tardan más bajo carga: se da margen.
    testTimeout: 30000,
  },
});
