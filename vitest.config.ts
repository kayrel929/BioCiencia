import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts", "tests/two-nodes/**/*.test.ts"],
    environment: "node",
  },
});
