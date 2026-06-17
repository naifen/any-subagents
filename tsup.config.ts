import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli/main.ts",
    mcp: "src/mcp/main.ts"
  },
  format: ["esm"],
  sourcemap: true,
  clean: true,
  dts: true,
  banner: {
    js: "#!/usr/bin/env node"
  },
  external: ["better-sqlite3"]
});
