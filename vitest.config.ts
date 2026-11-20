import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright specs live in e2e/ and run via `pnpm test:e2e`
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", ".claude/**"],
    // absolute: vitest is also run from inside a package directory
    setupFiles: [fileURLToPath(new URL("./vitest.setup.ts", import.meta.url))],
  },
});
