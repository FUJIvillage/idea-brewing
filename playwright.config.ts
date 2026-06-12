import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  use: { baseURL: "http://localhost:3105" },
  webServer: {
    command: "npm run dev -- --port 3105",
    url: "http://localhost:3105",
    env: { IDEA_BREWING_DATA_DIR: path.join(process.cwd(), ".e2e-data") },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
