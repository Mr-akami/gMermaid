import { defineConfig, devices } from "@playwright/test";

// GUI tests drive the editor app served by vite. `pnpm test:e2e` starts the
// dev server itself; set PW_BASE_URL to reuse an already running one.
const baseURL = process.env.PW_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: "pnpm --filter @gmermaid/app dev --port 4173 --strictPort --host 127.0.0.1",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
