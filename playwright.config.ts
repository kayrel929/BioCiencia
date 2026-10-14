import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:4173", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run build:web && npm run preview -w @biociencia/web",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
