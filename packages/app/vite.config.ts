import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // mermaid is large and only reached through a dynamic import, so vite
    // discovers it on the first page load and re-optimizes mid-session —
    // which reloads the page under a test runner and makes every spec that
    // clicks straight after `goto` flaky. Pre-bundle it at server start.
    include: ["mermaid"],
  },
});
