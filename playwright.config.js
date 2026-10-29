import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test/browser",
  workers: 1,
  use: { headless: true },
  timeout: 20000,
});
