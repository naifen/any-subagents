import { mkdir } from "node:fs/promises";
import { loadConfig } from "../config/load.js";
import { createControlPlane, type ControlPlane } from "./control-plane.js";
import { defaultRuntimePaths, type RuntimePaths } from "../storage/paths.js";

export const createBootstrappedControlPlane = async (paths: RuntimePaths = defaultRuntimePaths()): Promise<ControlPlane> => {
  const config = await loadConfig();
  await Promise.all([
    mkdir(paths.stateDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.artifactsDir, { recursive: true }),
    mkdir(paths.worktreeRoot, { recursive: true }),
    mkdir(paths.runtimeDir, { recursive: true })
  ]);
  const plane = createControlPlane({ paths, config });
  return plane;
};
