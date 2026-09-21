import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright specs live in e2e/ and run via `pnpm test:e2e`
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
