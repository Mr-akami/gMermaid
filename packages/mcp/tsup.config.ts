import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: false,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: [/^@gmermaid\//],
});
