import { defineConfig, devices } from "@playwright/test";

// GUI tests drive the editor app. `pnpm test:e2e` builds it and serves the
// production bundle with `vite preview` — about a third faster per page load
// than the dev server's on-the-fly transforms; set PW_BASE_URL to reuse an
// already running server (dev or preview) instead.
const baseURL = process.env.PW_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  // the tests mostly wait on the browser, so twice the default worker count
  // still keeps a 4-vCPU CI runner busy rather than oversubscribed
  workers: process.env.CI ? 4 : undefined,
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
        command: "pnpm --filter @gmermaid/app build && pnpm --filter @gmermaid/app preview --port 4173 --strictPort --host 127.0.0.1",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
