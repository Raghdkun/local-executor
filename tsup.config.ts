import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: false,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  // Keep runtime deps external: they are declared in package.json and npm installs them.
  external: ["@clack/prompts", "commander", "systeminformation", "picocolors", "execa"],
});
