import { mkdir } from "node:fs/promises";
import { createControlPlane } from "../core/control-plane.js";
import { defaultRuntimePaths } from "../storage/paths.js";
import { createCli } from "./program.js";

const paths = defaultRuntimePaths();
await Promise.all([
  mkdir(paths.stateDir, { recursive: true }),
  mkdir(paths.logsDir, { recursive: true }),
  mkdir(paths.artifactsDir, { recursive: true }),
  mkdir(paths.worktreeRoot, { recursive: true }),
  mkdir(paths.runtimeDir, { recursive: true })
]);

const plane = createControlPlane({ paths });
const program = createCli({ plane });

try {
  await program.parseAsync(process.argv);
} finally {
  await plane.close();
}
