import { defineConfig } from "vitest/config";

// Mediciones de rendimiento (Fase 11). Se ejecutan aparte: npm run test:perf
export default defineConfig({
  test: { include: ["tests/perf/**/*.perf.test.ts"], environment: "node", testTimeout: 300_000, fileParallelism: false },
});
