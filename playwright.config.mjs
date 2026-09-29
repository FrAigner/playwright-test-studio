// @ts-check
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./generated-tests",
  timeout: 30000,
  reporter: "list",
  use: {
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/chromium",
    },
  },
});
